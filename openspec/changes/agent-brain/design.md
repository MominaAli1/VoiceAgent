# Design — Agent Brain (Milestone B)

This is a new change directory, so D-numbering restarts at D1 here; it does not
continue collaborative-document's D1-D12. Two of that change's decisions still
bind this one without restating them in full: D1 (the shared field is a
`Y.XmlFragment`, read and written only through `getXmlFragment(FIELD)`, never
`getText`) and D9 (`WS_URL` uses `localhost`, never `127.0.0.1`). Every module
this change adds that touches the document goes through the existing
`readDoc()`/`appendText()` machinery in `src/agent/doc-client.js`, so those
rules carry forward unchanged.

### D1 — Groq via an OpenAI-compatible tool-calling call, not the Anthropic Messages API

Groq's `/openai/v1/chat/completions` endpoint accepts the same `tools` /
`tool_choice` / `messages` shape as OpenAI's chat-completions API — a JSON
Schema `parameters` object per tool, an `assistant` message carrying
`tool_calls` when the model wants to act, and a `tool` role message carrying
`tool_call_id` + result content fed back in. This is a different shape from
Anthropic's Messages API (`tool_use`/`tool_result` content blocks inside a
single message), so `llm-client.js` is not a thin swap of an Anthropic SDK
call — it is written against the OpenAI-style contract from the start.

Client: the official `groq-sdk` package, pointed at Groq's endpoint by
default (no manual `baseURL` juggling, unlike routing the generic `openai`
package at Groq). Model: `GROQ_MODEL` in `src/config.js`, defaulting to
`"llama-3.3-70b-versatile"` — chosen over the free tier's smaller
`llama-3.1-8b-instant` because multi-step tool orchestration (decide to call
`edit_doc`, receive an error, retry with a corrected `find` string) needs a
model that reliably re-reads a tool's error message rather than repeating the
same failed call; the smaller model is markedly worse at this in informal
testing reported across Groq's own docs and community benchmarks. This is a
config value, not a hardcoded string in `llm-client.js`, precisely so it can
be swapped without touching orchestrator logic if that assumption turns out
wrong once real usage starts.

`GROQ_API_KEY` is read from `process.env` only, loaded via Node's built-in
`--env-file=.env` flag (Node 20.6+; confirm the installed Node version
supports it before committing to it over the `dotenv` package — this project
already runs Node 22 per earlier verification, so the flag is available with
no new dependency). The `dev:agent` script gains `--env-file=.env`. The key
is never written to `src/config.js`, never logged, and `llm-client.js` throws
a clear startup error naming the missing environment variable if it is unset,
rather than making an API call that fails opaquely.

### D2 — Risk carried by using Groq's free tier instead of Claude: retries go up, and so does the chance of a stuck loop

This is a known, accepted trade-off, not a defect to design around silently.
Two concrete failure modes are more likely on Groq's free-tier models than
they would be on Claude:

- The model calls `edit_doc` with a `find` string that is a paraphrase of the
  document rather than a verbatim substring — plausible-sounding, wrong.
- The model narrates what it intends to do in plain text instead of emitting
  a tool call — technically a valid chat response, but it does not move the
  document.

The first is exactly what `edit_doc`'s re-check-before-mutate step (D5) turns
into a descriptive, retryable error rather than a corrupted edit. The second
has no tool-shaped error to hand back, so the orchestrator treats "Groq
responded with no tool call, and the instruction has not yet resulted in a
document change" as a signal to re-prompt once, explicitly restating that a
tool call is required — not a silent success. The retry cap is 3 attempts
total per instruction (shared across both failure modes); on exhaustion the
orchestrator returns a failure result rather than looping forever. This caps
the worst case at a few seconds of extra latency and a few extra free-tier
requests, not an infinite loop.

Free-tier rate limits (on the order of 30 requests/minute for
`llama-3.3-70b-versatile` at the time of writing) are not a concern at this
milestone's usage pattern — one instruction, at most 4 model calls
(1 initial + up to 3 retries) — but the orchestrator surfaces a rate-limit
response as a distinct, user-visible error rather than treating it the same
as a tool-call failure and burning a retry on it.

### D3 — `edit_doc` is restricted to a single paragraph's text for this milestone

The document structure fixed by collaborative-document's D1/append design is:
one `Y.XmlElement('paragraph')` per paragraph, each currently containing
exactly one `Y.XmlText` child (`appendText` builds it that way, and nothing
in the browser editor's toolbar can split a paragraph's text run with a mark
boundary yet — there is no bold/italic control wired up). Under that
structure, a `find` string that is entirely inside one paragraph maps
directly onto a character-offset delete/insert on that paragraph's single
`Y.XmlText` node, using `indexOf` on the paragraph's own plain text to locate
the offset.

A `find` string that spans a paragraph boundary (contains the `\n` that
`readDoc()` uses to join paragraphs, or otherwise straddles two `Y.XmlText`
nodes) is out of scope for this milestone. `edit_doc` detects this case
before attempting anything and returns a descriptive error
(`"find text must be within a single paragraph"`) rather than attempting a
multi-node edit or silently editing only part of the match. This is a
deliberate MVP cut, not an oversight: cross-paragraph CRDT edits need to
reason about two `Y.XmlElement` siblings atomically, which is materially more
complex than this milestone's gate requires. It is recorded here so it is
revisited explicitly rather than rediscovered as a bug later.

A related, currently-safe assumption worth flagging for the same reason: if a
future change adds text formatting (bold/italic/etc.), a paragraph could gain
more than one `Y.XmlText` child (one per differently-formatted run), and the
single-node offset math this milestone relies on would need to walk multiple
text nodes within the paragraph, not just index into one. Not a problem
today — StarterKit's mark extensions are not exposed in the UI — but the
`edit_doc` implementation should assert (not silently truncate) if it ever
finds more than one text-bearing child in the target paragraph, so this
surfaces as a loud error rather than a silently wrong edit if formatting
lands later.

`edit_doc` re-reads the fragment fresh, inside the same synchronous pass that
performs the mutation, rather than trusting whatever copy of the document the
orchestrator handed to Groq at the start of the turn. This is what makes
concurrent human edits safe: if a human's edit already changed or removed the
target text between Groq deciding to act and `edit_doc` actually running, the
fresh read will not find the expected match, and the tool returns the same
"not found" error a wrong `find` string would — the orchestrator's retry path
handles both identically, which is also the brief's own stated behavior
("its edit tool reports couldn't find that exact text, and Claude re-reads
the live document and retries").

### D4 — Browser-to-orchestrator transport: a small HTTP endpoint on the agent process, not a Yjs `Y.Map`

Two options were considered for how a typed instruction gets from the
browser to the orchestrator, which runs in the separate `dev:agent` Node
process:

1. **A dedicated `Y.Map`** in the already-connected document room (e.g.
   `ydoc.getMap('instructions')`), written by the browser and observed by the
   agent process, since both are already connected to the same room.
2. **A small HTTP endpoint** the agent process listens on, POSTed to
   directly by the browser.

This change uses (2). Reasons:

- The brief's own architecture (section 7) draws voice input as a channel
  separate from the Yjs room — audio goes browser-to-server over its own
  path to AssemblyAI, not through the CRDT. Days 7-9 will replace this
  milestone's typed-text input with that transcript, arriving over
  *some* non-Yjs channel either way. Building the typed-instruction path as
  an HTTP call now means Days 7-9 swaps the browser-side sender (an audio
  stream instead of a fetch call) without needing to rethink the
  server-side entry point — `orchestrator.handleInstruction(text)` — or
  retire a `Y.Map`-based mechanism that would otherwise have to be built and
  then discarded.
- A `Y.Map` used as a request queue needs its own idempotency handling (an
  instruction must not be reprocessed after a reconnect/resync replays
  history) and its own "done" signaling back to the browser — solving a
  request/response problem with a data-replication primitive. Plain HTTP
  gives request/response semantics for free.
- The document itself already is the response channel for the *result* of an
  instruction (the edit streams in over Yjs, same as any other participant's
  edit) — only the *instruction itself* needs a way in, which is a single,
  short-lived request, not shared state.

Contract, pinned in `src/config.js`:

- `INSTRUCTION_PORT` — e.g. `3001`. A separate port from both the relay
  (`1234`) and Vite (`5173`).
- `INSTRUCTION_PATH` — `/instruction`.
- Request: `POST /instruction`, JSON body `{ "text": string }`.
- Response: `202 { "accepted": true }` immediately, before the orchestrator
  necessarily finishes — the call does not block on the LLM round trip, in
  keeping with the brief's governing principle that tool work must not hold
  a live loop open. The browser does not wait on this response for anything
  beyond clearing the input and showing "sent"; it learns the outcome by
  watching the document change, the same way it learns about any other
  participant's edit.
- Error responses (`400` for a missing/empty `text` field, `500` if the
  orchestrator throws before accepting the instruction) carry a JSON body
  with a `message` field, surfaced in the UI as a visible error rather than
  swallowed.

CORS: the instruction endpoint sets
`Access-Control-Allow-Origin: http://localhost:5173` (Vite's fixed dev port,
already pinned by collaborative-document's `vite.config.js`) so the browser
fetch succeeds without a proxy.

### D5 — Throttled insertion: chunked `Y.XmlText` inserts, not a single write

`src/agent/typing.js` exposes two entry points, both used by both the
append path and `edit_doc`'s replacement step:

- `typeIntoNewParagraph(doc, text, opts)` — creates a `Y.XmlElement('paragraph')`
  at the end of the fragment (as `appendText` does today), then streams
  `text` into its `Y.XmlText` in chunks.
- `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)` — inserts
  `text` into an existing paragraph's `Y.XmlText` at a given character
  offset, in chunks, starting immediately after `offset`. `edit_doc` calls
  this after its delete step (D3) to type the replacement in rather than
  drop it in as one write.

Default chunk size is 3 characters, default delay 35ms between chunks — fast
enough that a multi-sentence edit finishes in around a second per 30
characters, slow enough to visibly read as typing rather than a paste,
matching the brief's own framing ("a small pause, so it reads as a person
typing rather than a block appearing"). Both are `opts` overrides, not
constants baked into call sites, so they can be tuned once this is watched
running rather than guessed correctly on the first try.

Each chunk is its own Yjs transaction (a single `insert` call on the
`Y.XmlText`), so remote peers observe the text arriving incrementally over
the existing awareness/update broadcast — no separate "typing indicator"
protocol is needed, the CRDT updates themselves are the indicator. Deletion
(removing the old `find` text in an `edit_doc` call) is a single, un-throttled
`delete` — the brief specifies throttling for *insertion*, and a visible
"typing deletion" effect is not part of this milestone's scope.

There is no cancellation path in `typeIntoNewParagraph`/`typeIntoParagraph`
in this milestone — barge-in belongs to Days 10-11 and is explicitly out of
scope here. The functions run to completion once started.

### D6 — Document cap: truncate from the start, flag it in the prompt when it happens

The brief's MVP simplification caps the document sent to the model at
roughly 2,000 words (~2,700 tokens), with no retrieval. `orchestrator.js`
implements this as: split `readDoc()`'s output on whitespace, and if it
exceeds 2,000 words, keep the **last** 2,000 (the end of the document, on the
assumption that an instruction like "tighten the second paragraph" or "add a
note at the end" is almost always about recent content, not the document's
opening) and prepend a fixed system-prompt sentence noting the view is
truncated. This is a placeholder heuristic, not a considered retrieval
strategy — the brief is explicit that building retrieval is out of scope for
the MVP, and 2,000 words is far beyond what a typed-instruction demo is
expected to produce in this milestone anyway.

## Risks / Trade-offs

- **Groq tool-call reliability is the dominant new risk this change
  introduces.** Mitigated by D2's retry-and-re-prompt loop and a hard cap,
  but not eliminated — worth budgeting real testing time against the actual
  model before considering this milestone's gate reliably passable, not just
  passable once.
- **Single-paragraph `edit_doc` restriction (D3) will eventually need
  lifting.** Accepted for this milestone; the failure mode if skipped
  (attempting a cross-paragraph edit) is a loud, descriptive tool error, not
  silent corruption, so shipping the restriction now is safe to build on.
- **A second server port (`INSTRUCTION_PORT`) adds a moving part** to the
  three-process story collaborative-document's README established (relay,
  web, agent). It lives inside the existing `dev:agent` process rather than
  as a fourth process, so the process count is unchanged, but the README
  needs a clear line about what's listening where.
- **`GROQ_API_KEY` absence must fail loudly at startup**, not on the first
  instruction — a silent no-op agent that never edits anything looks
  identical to a D1-class field mismatch from collaborative-document, and
  this project has already paid once for how confusing that failure mode is
  to debug from symptoms alone.
- **Truncating from the end of the document (D6) is a guess**, not a
  measured decision — flagged explicitly so it is not mistaken for one if it
  turns out wrong once there is a document long enough to test it against.

## Migration Plan

Not applicable — additive to the existing agent process and browser page; no
existing data. Rollback is `git revert`.

## Open Questions

- Whether `llama-3.3-70b-versatile` is in fact the most reliable free-tier
  Groq model for this tool-calling pattern is an assumption pending real
  testing against this project's actual prompts, not a measured fact the way
  collaborative-document's D-notes were (that change had a running system to
  test claims against; this one does not yet). Task 6 in tasks.md exists to
  turn this from an assumption into a measured note, the way collaborative-
  document's D9/D10/D11 were.
