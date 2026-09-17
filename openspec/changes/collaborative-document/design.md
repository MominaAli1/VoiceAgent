# Milestone A — Collaborative Document

## Context

See proposal.md — Why. The repository is empty apart from a LICENSE, so every decision here is a greenfield one.

Two constraints shape the whole design. First, the brief's build order exists to isolate faults: the document layer must be provably correct before audio or an LLM is layered on, because a bug at this layer is otherwise indistinguishable from a bug in the agent path. Second, the brief's own risk table lists "Agent text never appears in editor — Y field name mismatch" as risk number one, and separately "Undo corrupts the document — disable ProseMirror's own history." Both are silent failures. Neither throws. Both are cheap to prevent now and expensive to diagnose later, which is why they appear below as hard requirements rather than notes.

Versions this design was verified against, as installed: `@tiptap/core`, `@tiptap/pm`,
`@tiptap/starter-kit`, `@tiptap/extension-collaboration` and
`@tiptap/extension-collaboration-caret` all at `3.31.3`; `@tiptap/y-tiptap@3.0.9`;
`yjs@13.6.32`; `y-websocket@3.1.0`; `y-prosemirror@1.3.7`; `ws@8.21.3`;
`@y/websocket-server@0.1.5` (dev); `vite@8.2.2` (dev); Node v24.18.1.

## Goals / Non-Goals

**Goals:**

- A single Yjs document with three live participants: two browser tabs and one Node process, all equal peers on the same room.
- A server-side read path that returns the true document text, and an append path whose output is valid ProseMirror content.
- Fault isolation for later phases: when the orchestrator lands, any "the agent's text didn't appear" bug is attributable to the orchestrator, because this layer has been demonstrated.
- Diagnostics for the two silent failure modes, built in from the start.

**Non-Goals:**

- Persistence. The y-websocket dev server keeps documents in memory; a restart clears them. Acceptable for this phase and for the demo, which begins from a fixture document anyway.
- Authentication, authorisation, or multi-room routing. One hard-coded room.
- Production deployment concerns — TLS, process supervision, reconnect backoff tuning.
- Any typing-throttle or "types like a person" effect. That is Days 4-6; the append here is a plain immediate insert.
- Rich-text fidelity in `readDoc()`. Plain text with line breaks at block boundaries is the contract; marks and attributes are dropped.

## Decisions

### D1 — The shared field is a `Y.XmlFragment`, and both sides go through `getXmlFragment(FIELD)`

**This decision overrides the `ydoc.getText(FIELD)` instruction in the change request. It is the single most load-bearing decision in this document.**

`@tiptap/extension-collaboration@3.31.3` defaults its `field` option to `"default"` and binds the editor with `this.options.document.getXmlFragment(this.options.field)`. The share key therefore holds a `Y.XmlFragment`. Yjs share keys are single-typed: one key, one constructor.

The behaviour of `getText()` against that key was measured, not assumed. Setup: doc A creates `getXmlFragment('default')` and inserts a `paragraph` containing the text `Hello world`; doc B is synced from A by update exchange, standing in for the server participant.

| Call on the synced doc | Observed result |
| --- | --- |
| `b.getText('default').toString()` | `""` — **empty string, no error thrown** |
| `b.getText('default').insert(0, 'AGENT TEXT')`, then sync back to A | A's fragment becomes `AGENT TEXT<paragraph>Hello world</paragraph>` — a bare text node at the fragment root, outside any block |
| `b.getXmlFragment('default')` *after* the `getText` call | throws `Type with the name default has already been defined with a different constructor` |
| `b.getXmlFragment('default')` on a clean doc | returns the fragment; walking it yields `"Hello world"` |

So `getText(FIELD)` fails in the three worst possible ways at once: `readDoc()` reports an empty document while the document plainly has content; the append produces schema-invalid content outside any block; and the first call poisons the key so the correct call throws afterwards, making the mistake look like a different bug entirely. This is precisely the brief's risk #1, and it does not announce itself.

The design therefore requires:

- **REQ-D1a.** Both the browser editor and the server participant SHALL address the shared document through `getXmlFragment(FIELD)`. `ydoc.getText(FIELD)` MUST NOT appear anywhere in the codebase.
- **REQ-D1b.** `FIELD` SHALL be the constant `"default"`, matching `@tiptap/extension-collaboration`'s default `field` option. The browser SHALL pass `field: FIELD` to the Collaboration extension explicitly rather than relying on the default, so the two sides are pinned to the same constant by construction.
- **REQ-D1c.** `readDoc()` SHALL return plain text by walking the fragment recursively — `Y.XmlText` nodes contribute their string, element nodes contribute their walked children, and sibling nodes are joined with `\n`. It SHALL NOT use `fragment.toString()`, which returns XML markup (`<paragraph>Hello world</paragraph>`), not text.
- **REQ-D1d.** Appending SHALL insert a `Y.XmlElement('paragraph')` containing a `Y.XmlText` at the end of the fragment. It SHALL NOT insert a bare text node at fragment level.

Verified correct behaviour of the required approach: `readDoc()` returns `"Hello world"`; after appending, the browser fragment reads `<paragraph>Hello world</paragraph><paragraph>Appended by Assistant</paragraph>` and `readDoc()` returns `"Hello world\nAppended by Assistant"`.

*Alternative considered:* configure Tiptap with a Y.Text-backed field to honour the original instruction literally. Rejected — y-prosemirror's binding is defined over `Y.XmlFragment`; a `Y.Text` cannot express ProseMirror's block structure, so this would mean abandoning Tiptap's collaboration extension and hand-writing the binding. The instruction's intent (one field constant, mismatch made visible, first suspect for missing agent text) is fully preserved; only the accessor changes.

### D2 — StarterKit runs with the history plugin disabled

**REQ-D2.** The browser editor SHALL configure `StarterKit` so that no ProseMirror-native history plugin is active, and undo/redo SHALL be provided by the Yjs layer instead. On the installed version that means `undoRedo: false` — see the confirmation below.

ProseMirror's history plugin keeps a local undo stack that is unaware of remote operations. Left enabled alongside Yjs it will revert other participants' changes and push the local replica out of convergence with its peers — the brief's "Undo corrupts the document" risk. Yjs owns undo: `UndoManager`, scoped to the local client's origin, so undo reverts only your own edits. This is not a preference; the two histories cannot coexist.

*Confirmed against the installed `@tiptap/starter-kit@3.31.3`:* the option key is
**`undoRedo`**, and there is **no `history` key at all**. `StarterKit.configure({ history: false })`
would therefore be silently ignored and the UndoRedo extension would stay enabled — the exact
corruption this decision exists to prevent, arriving with no error. The correct configuration is:

```js
StarterKit.configure({ undoRedo: false })
```

The requirement is that no ProseMirror-native history plugin is active, not that a particular
literal string appears. Verify by inspecting the editor's active extension list, not by trusting
the key name.

### D3 — One configuration module, imported by both sides

**REQ-D3.** `ROOM`, `WS_URL`, and `FIELD` SHALL be exported from exactly one module, imported by both the browser entry point and the server participant. Neither side SHALL restate any of these values as a literal.

A room-name typo produces two participants who each work correctly in isolation and simply never see each other — another silent failure. Sharing the constants makes divergence impossible rather than merely unlikely. `FIELD` lives here alongside the connection values because it is the same class of hazard.

### D4 — Log the share keys once, on first sync

**REQ-D4.** On the server participant's `synced` event, it SHALL log the document's share keys (`[...ydoc.share.keys()]`), the `FIELD` it is reading, and the byte length or preview of the initial `readDoc()` result.

Logging must happen after sync, not at startup: before the first sync the share map may legitimately be empty, so an early log proves nothing. One line after sync distinguishes the three states cheaply — key missing entirely (wrong room, or the browser has never connected), key present but `readDoc()` empty (field or accessor mismatch), key present with text (working).

### D5 — Bundle the browser page; do not hand-roll a static server

The Tiptap and Yjs packages are ESM npm modules, so the browser page needs a bundler. Use Vite as a dev dependency: it serves the page and bundles in one command, which keeps the README's process list to three. The relay stays the stock `npx y-websocket` per the change request — we are not writing a websocket server.

*Alternative considered:* import maps plus a CDN, avoiding a build step. Rejected — it decouples browser dependency versions from `package.json`, and this design depends on knowing exactly which `@tiptap/extension-collaboration` version is in the browser.

### D6 — Three processes, started in order

Relay (`:1234`) → Vite dev server (browser page) → server participant. The participant needs the relay up to connect. The browser tolerates the relay coming up late, since `WebsocketProvider` reconnects, but the README documents the strict order anyway so a first-time run does not depend on that tolerance.

### D7 — Tiptap v3, with `collaboration-caret` in place of `collaboration-cursor`

The brief's package list was written against Tiptap v2. `@tiptap/extension-collaboration-cursor`
never shipped a real v3: its `3.0.0` is **deprecated** as a mispublish ("There are no breaking
changes in this packages, we meant to release 2.5.0"), so its `latest` tag is `2.26.2`, peering on
`@tiptap/core@^2.7.0`. That collides head-on with `@tiptap/extension-collaboration@3.31.3`, and
`npm install` of the literal eight-package list fails with ERESOLVE.

Resolved by building on the v3 line:

- `@tiptap/extension-collaboration-caret` replaces `@tiptap/extension-collaboration-cursor`. Same
  capability — named, coloured remote carets and selections — under the v3 name.
- `@tiptap/pm` and `@tiptap/y-tiptap` are added. Neither is discretionary: both are declared peers
  of `@tiptap/extension-collaboration@3.31.3`.
- `y-prosemirror` stays on the dependency list per the brief, though Tiptap v3 binds through
  `@tiptap/y-tiptap` rather than using it directly.

*Alternative considered:* pin the whole Tiptap stack to `^2` so the brief's list holds literally.
Resolves cleanly (65 packages) but builds the remaining fifteen-day plan on the previous major,
and D1's evidence would need re-verifying against v2. Rejected in favour of the current line.

### D8 — The relay binary comes from `@y/websocket-server`

`npx y-websocket` is the command the change request specifies, but `y-websocket@3.1.0` is
**client-only** — it declares no `bin` at all, and shipping only `dist/` and `src/`. Two dead ends
were tried and rejected: `npx y-websocket` against the installed v3 fails with "could not determine
executable to run", and `y-websocket-server@1.0.2` is a stub package whose entire behaviour is to
print "this is incorrect, please use `npx y-websocket` instead" and exit 0 — a circular redirect.

`@y/websocket-server@0.1.5` ("Backend for y-websocket") is the upstream server, and it registers
bins under **both** `y-websocket-server` and `y-websocket`. Installed as a dev dependency, it makes
the specified command work verbatim:

```
"dev:ws": "npx y-websocket --port 1234"
```

This honours the constraint's intent exactly — the relay is stock upstream, and we have not written,
wrapped, or forked one.

### D9 — `WS_URL` uses the hostname `localhost`, never `127.0.0.1`

The relay binds the IPv6 loopback only. `netstat` shows `TCP [::1]:1234 LISTENING` and no IPv4
listener, so an IPv4 literal is refused outright. Measured against the running relay:

| URL | Result |
| --- | --- |
| `ws://127.0.0.1:1234` | **ECONNREFUSED** |
| `ws://localhost:1234` | connects |
| `ws://[::1]:1234` | connects |

`WS_URL` is therefore `ws://localhost:1234`, with the reason recorded in `src/config.js` so nobody
"helpfully" substitutes the IPv4 literal later.

### D10 — The browser withdraws presence on `pagehide`

`y-websocket@3.1.0` registers its awareness exit handler for Node only —
`if (env.isNode && typeof process !== 'undefined') process.on('exit', this._exitHandler)` —
and installs no `beforeunload` or `pagehide` listener in the browser. Observed
consequence: a closed tab's caret and peer chip persisted on the other clients for the
full awareness timeout (~30s measured), which fails the spec's "presence is withdrawn
on disconnect" scenario in any practical sense.

The browser entry point therefore calls `provider.awareness.setLocalState(null)` on
`pagehide`. Withdrawal is then immediate, and reloads no longer leave a ghost peer.

`pagehide` rather than `beforeunload`: it fires in cases `beforeunload` does not,
including bfcache navigations and mobile Safari.

### D11 — Colours are 6-digit hex, from a shared palette

`@tiptap/extension-collaboration-caret` validates colours with
`/^#[0-9a-fA-F]{6}$/` and falls back to `transparent` for anything that fails —
a named colour or 3-digit hex yields an invisible caret and no selection
highlight, with no warning. `src/palette.js` holds `USER_COLORS`,
`ASSISTANT_COLOR` and `randomUserColor()`, shared by both sides so the server
participant's reserved colour cannot collide with a human's.

Participant identity is stored in `sessionStorage`, not `localStorage`:
sessionStorage is per-tab, so a second tab is a second participant, which is what
the two-tab test requires. `localStorage` would make both tabs the same person and
quietly defeat the test.

### D12 — `@y/websocket-server` pinned to `0.1.1` exactly, not `^0.1.5`

D8 chose `@y/websocket-server` as the relay binary and pinned it as `^0.1.5`.
Running Gate B and Milestone A end-to-end (relay + two browser tabs + the
server participant, all together) surfaced that `^0.1.5` resolves to
`0.1.5`, and `0.1.5` is **not wire-compatible** with the rest of this project.

`0.1.5` depends on `yjs@^14.0.0-7`, a pre-release rewrite of Yjs with a
different internal encoding (`store.getClock is not a function` when the
relay tries to integrate an update from a `yjs@13.6.32` client). Every other
package here — `y-websocket`, `y-prosemirror`, `@tiptap/extension-collaboration`,
this project's own `src/config.js`-based clients — is on Yjs **v13**. `0.1.2`
made the same jump; both were published as 0.1.x patch bumps despite being a
breaking wire-protocol change. `0.1.0` and `0.1.1` still depend on
`y-protocols@^1.0.5`/`yjs@13.6.32` and interoperate correctly.

Measured effect of running against `0.1.5`, reproduced from a clean
`npm install` against the committed lockfile: the relay accepts connections
and reports `connected`, but every `readSyncStep2` / update it receives
throws and is dropped. Two browser tabs never converge — a second tab shows
empty content after the first tab types — and the server participant's
`readDoc()` returns `""` even after the seed harness has written fixture
text. This is silent: no client-side error, just a relay-side stack trace
and content that never arrives. It fully masked Track A/B's own internal
correctness — both tracks were individually well-built, but nothing they
wrote could be validated against each other over this relay.

**Fix:** pin `"@y/websocket-server": "0.1.1"` exactly (no `^`), so a future
`npm install` cannot silently re-resolve onto `0.1.5` or a later 0.1.x that
repeats the same jump. Re-run of the full two-tab + agent flow against
`0.1.1` converges correctly with no relay errors. If `@y/websocket-server`
ever needs to move past `0.1.1`, re-verify the exact failure mode above
before widening the version range.

## Risks / Trade-offs

- **Field/accessor mismatch (`getText` vs `getXmlFragment`)** → The primary risk, and the reason for D1. Mitigated by the ban on `getText(FIELD)`, the shared `FIELD` constant (D3), and the post-sync share-key log (D4). First suspect if the agent's text never appears.
- **A `getText(FIELD)` call anywhere poisons the `Y.Doc`** → Once made, the correct `getXmlFragment` call throws for the life of that `Y.Doc` instance, and the resulting error names a constructor conflict rather than the real mistake. Mitigated by D1a as an absolute rule; worth a grep before declaring the milestone met.
- **StarterKit's history key differs across versions** → **Confirmed real, and resolved.** The installed `@tiptap/starter-kit@3.31.3` has no `history` key, so the brief's literal `history: false` would have been silently ignored and left ProseMirror history enabled. The key is `undoRedo`. Verify against the installed extension list, never the literal key (D2).
- **No persistence; relay restart clears the document** → Accepted for this phase. Later phases start from a fixture document, and the brief's demo plan resets the fixture between runs anyway.
- **Cursor colours could collide** → Cosmetic only. Pick from a small fixed palette and give the server participant a colour reserved for it.
- **`readDoc()` drops formatting** → Deliberate. The brief's Day 4-6 contract is that Claude receives a plain-text view; anything richer is scope that phase does not want.
- **Vite adds a build step to a hackathon project** → Modest cost, and it buys version-pinned browser dependencies, which D1 depends on.

## Migration Plan

Not applicable — greenfield, no existing users, no data to migrate. Rollback is `git revert`.

## Open Questions

None that block implementation. Colour palette and the fixture document's initial content are cosmetic and settled during the work.

---

# Milestone B — Agent Brain

## Context

Builds directly on Milestone A. Two of its decisions bind this one without
restating them in full: D1 (the shared field is a `Y.XmlFragment`, read and
written only through `getXmlFragment(FIELD)`, never `getText`) and D9
(`WS_URL` uses `localhost`, never `127.0.0.1`). Every module this section
adds that touches the document goes through the existing
`readDoc()`/`appendText()` machinery in `src/agent/doc-client.js`, so those
rules carry forward unchanged. D-numbering continues from D12 above.

### D13 — Groq via an OpenAI-compatible tool-calling call, not the Anthropic Messages API

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

### D14 — Risk carried by using Groq's free tier instead of Claude: retries go up, and so does the chance of a stuck loop

This is a known, accepted trade-off, not a defect to design around silently.
Two concrete failure modes are more likely on Groq's free-tier models than
they would be on Claude:

- The model calls `edit_doc` with a `find` string that is a paraphrase of the
  document rather than a verbatim substring — plausible-sounding, wrong.
- The model narrates what it intends to do in plain text instead of emitting
  a tool call — technically a valid chat response, but it does not move the
  document.

The first is exactly what `edit_doc`'s re-check-before-mutate step (D15) turns
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

### D15 — `edit_doc` is restricted to a single paragraph's text for this milestone

The document structure fixed by Milestone A's D1/append design is: one
`Y.XmlElement('paragraph')` per paragraph, each currently containing exactly
one `Y.XmlText` child (`appendText` builds it that way, and nothing in the
browser editor's toolbar can split a paragraph's text run with a mark
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

### D16 — Browser-to-orchestrator transport: a small HTTP endpoint on the agent process, not a Yjs `Y.Map`

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
already pinned by Milestone A's `vite.config.js`) so the browser fetch
succeeds without a proxy.

**Measured correction, from running Gate A's UI test against a mock server:**
the browser's `fetch(POST, { headers: { 'Content-Type': 'application/json' } })`
triggers a CORS **preflight** `OPTIONS` request before the real `POST` —
this was not in the original D16 note and the first version of the Gate A
mock server didn't handle it, which failed with
`Response to preflight request doesn't pass access control check` and the
UI never even reached its own error-handling code, it just saw
`Failed to fetch`. The real endpoint (group 16) MUST respond to `OPTIONS
/instruction` with a `2xx` status and headers `Access-Control-Allow-Origin:
http://localhost:5173`, `Access-Control-Allow-Methods: POST`, and
`Access-Control-Allow-Headers: Content-Type` — not just the `POST` handler.
Confirmed fixed: with the `OPTIONS` branch added, the identical browser
request succeeds and reaches the `POST` handler.

### D17 — Throttled insertion: chunked `Y.XmlText` inserts, not a single write

`src/agent/typing.js` exposes two entry points, both used by both the
append path and `edit_doc`'s replacement step:

- `typeIntoNewParagraph(doc, text, opts)` — creates a `Y.XmlElement('paragraph')`
  at the end of the fragment (as `appendText` does today), then streams
  `text` into its `Y.XmlText` in chunks.
- `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)` — inserts
  `text` into an existing paragraph's `Y.XmlText` at a given character
  offset, in chunks, starting immediately after `offset`. `edit_doc` calls
  this after its delete step (D15) to type the replacement in rather than
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

### D18 — Document cap: truncate from the start, flag it in the prompt when it happens

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
  introduces.** Mitigated by D14's retry-and-re-prompt loop and a hard cap,
  but not eliminated — worth budgeting real testing time against the actual
  model before considering this milestone's gate reliably passable, not just
  passable once.
- **Single-paragraph `edit_doc` restriction (D15) will eventually need
  lifting.** Accepted for this milestone; the failure mode if skipped
  (attempting a cross-paragraph edit) is a loud, descriptive tool error, not
  silent corruption, so shipping the restriction now is safe to build on.
- **A second server port (`INSTRUCTION_PORT`) adds a moving part** to the
  three-process story Milestone A's README established (relay, web, agent).
  It lives inside the existing `dev:agent` process rather than as a fourth
  process, so the process count is unchanged, but the README needs a clear
  line about what's listening where.
- **`GROQ_API_KEY` absence must fail loudly at startup**, not on the first
  instruction — a silent no-op agent that never edits anything looks
  identical to a D1-class field mismatch from Milestone A, and this project
  has already paid once for how confusing that failure mode is to debug from
  symptoms alone.
- **Truncating from the end of the document (D18) is a guess**, not a
  measured decision — flagged explicitly so it is not mistaken for one if it
  turns out wrong once there is a document long enough to test it against.

## Migration Plan

Not applicable — additive to the existing agent process and browser page; no
existing data. Rollback is `git revert`.

## Open Questions

- Whether `llama-3.3-70b-versatile` is in fact the most reliable free-tier
  Groq model for this tool-calling pattern is an assumption pending real
  testing against this project's actual prompts, not a measured fact the way
  Milestone A's D-notes were (that milestone had a running system to test
  claims against; this one does not yet). Gate B (group 17) and the joint
  Milestone B acceptance (group 18) in tasks.md exist to turn this from an
  assumption into a measured note, the way Milestone A's D9/D10/D11 were.
