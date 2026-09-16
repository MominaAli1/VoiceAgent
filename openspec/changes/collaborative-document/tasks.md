# Milestone A — Collaborative Document

Work is split into two independently verifiable tracks:

| Track | Owner | Scope | Proved by |
| --- | --- | --- | --- |
| A | **Momina** | Project setup, shared config, browser editor | Gate A (group 4) — two tabs, no server code needed |
| B | **Rumaisa** | Server-side participant, harness, README | Gate B (group 8) — no browser code needed |
| Joint | **Both** | Integration | Milestone A (group 9) |

Neither track imports the other's code. They meet only at the shared config
contract below, which is pinned here so both can start on day one without
waiting for the other to land anything.

---

## Tech stack restrictions

Binding for both tracks. Every one of these is a decision already made in
design.md; none is open to preference during implementation.

**Fixed dependency set.** Exactly these runtime packages, no others:
`yjs`, `y-websocket`, `y-prosemirror`, `@tiptap/core`, `@tiptap/pm`,
`@tiptap/starter-kit`, `@tiptap/extension-collaboration`,
`@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`, `ws`.
Dev dependencies: `vite` and `@y/websocket-server` only.

This is the **Tiptap v3** line, and it differs from the brief's original list in
three ways, all forced rather than chosen (design D7, D8):

- `@tiptap/extension-collaboration-caret` replaces `@tiptap/extension-collaboration-cursor`.
  The `-cursor` package never shipped for v3 — its `3.0.0` is deprecated as a
  mispublish, so `latest` is `2.26.2` peering on `@tiptap/core@^2.7.0`, which
  fails ERESOLVE against `extension-collaboration@3.31.3`.
- `@tiptap/pm` and `@tiptap/y-tiptap` are added — both are declared peers of
  `extension-collaboration@3.31.3`, not optional extras.
- `@y/websocket-server` is added as a dev dependency to supply the relay binary.

Do not add a framework (React, Vue, Svelte), a different transport
(`socket.io`, raw `WebSocket` handling), a persistence provider (`y-indexeddb`,
`y-leveldb`), a CSS framework, or a test runner. If a task seems to need a
package that is not on this list, raise it rather than installing it.

**No bespoke relay.** The websocket server is the stock upstream binary via
`npx y-websocket` on port 1234. Do not write a relay, do not wrap one, do not
fork one. `y-websocket@3` is client-only and ships no binary; the binary comes
from the `@y/websocket-server` dev dependency, which registers a bin named
`y-websocket` so the command works verbatim (design D8).

**Never `ydoc.getText(FIELD)`.** The shared field holds a `Y.XmlFragment`.
`getText()` on that key returns an empty string with no error, and then
permanently poisons the key so the correct `getXmlFragment()` call throws for
the life of that `Y.Doc`. This applies to both tracks and to throwaway debug
snippets. Measured evidence is in design.md — D1.

**Never `fragment.toString()` to read text.** It returns XML markup
(`<paragraph>Hello</paragraph>`), not text. Walk the fragment.

**Appends are structural.** A `Y.XmlElement('paragraph')` containing a
`Y.XmlText`, inserted at the end of the fragment. Never a bare text node at
fragment level — that is invalid ProseMirror content.

**ProseMirror history stays off.** `StarterKit` with the history plugin
disabled; Yjs owns undo. On the installed `@tiptap/starter-kit@3.31.3` the key
is **`undoRedo: false`** — there is no `history` key at all, so the brief's
literal `history: false` is silently ignored and leaves history enabled.
Verify against the installed extension list, not the key name (design D2).

**No literals for `ROOM`, `WS_URL`, `FIELD`.** One config module, imported by
both sides.

**`WS_URL` uses `localhost`, never `127.0.0.1`.** The relay binds the IPv6
loopback only, so the IPv4 literal is refused with ECONNREFUSED. Measured, not
assumed (design D9).

**ESM throughout.** `"type": "module"` in the manifest; `import`, not
`require`.

**Nothing from later phases.** No microphone, AssemblyAI, Anthropic, Tavily,
ElevenLabs, orchestrator, `edit_doc` tool, or typing-throttle code in this
change. Appends here are immediate and unthrottled.

---

## Shared contract (pinned — do not renegotiate mid-flight)

Both tracks code against this from the start. Momina creates the file in task
2.1; Rumaisa does not wait for it, she writes imports against these names and
they resolve once Track A lands.

- Module path: `src/config.js`
- Exports: `ROOM` (string), `WS_URL` = `ws://localhost:1234`, `FIELD` = `"default"`
- npm scripts: `dev:ws` (relay), `dev:web` (Vite), `dev:agent` (server participant)
- Server participant module path: `src/agent/doc-client.js`, exporting
  `connect()`, `readDoc()`, `appendText(text)`

If task 1.6 finds the installed extension's `field` default is not `"default"`,
`FIELD` changes here once and both tracks pick it up. That is the only sanctioned
change to this contract.

**Addendum — `src/palette.js`.** Group 3 added a second shared module holding the
participant colours: `USER_COLORS`, `ASSISTANT_COLOR` (`#12a594`, teal) and
`randomUserColor()`. Rumaisa imports `ASSISTANT_COLOR` for task 6.2 rather than
hard-coding a colour. Colours MUST be 6-digit hex — the caret extension validates
with `/^#[0-9a-fA-F]{6}$/` and silently renders `transparent` for anything else,
with no selection highlight and no error. This is additive; the pinned `config.js`
exports are unchanged.

**Status: landed and verified.** `src/config.js` is on `main` with exactly these
values. Task 1.6 confirmed `field: "default"`, so nothing changed. The contract was
smoke-tested end to end against the running relay — two Node clients, one room,
a `getXmlFragment(FIELD)` round-trip returning the written text, share keys
`['default']`. Rumaisa can import it now.

---

## 1. Momina — Project setup (Phase 0)

- [x] 1.1 Run `npm init`, set `"type": "module"`, and add a `.gitignore` covering `node_modules/`, build output, and local env files
- [x] 1.2 Install the runtime packages listed under Tech stack restrictions — that exact set, nothing else
- [x] 1.3 Install `vite` (design D5) and `@y/websocket-server` (design D8) as the only dev dependencies
- [x] 1.4 Add the three npm scripts named in the shared contract; `dev:ws` must delegate to `npx y-websocket` on port 1234
- [x] 1.5 Start the relay and confirm it reports listening on :1234 — **Phase 0 gate** — PASSED: `running at 'localhost' on port 1234`, netstat shows `[::1]:1234 LISTENING`
- [x] 1.6 Record the installed `@tiptap/extension-collaboration` version, confirm its default `field` value and that it binds via `getXmlFragment` (design D1) — CONFIRMED at 3.31.3: `field: "default"`, binds via `getXmlFragment`. `FIELD` unchanged, contract stands, no action needed from Rumaisa

## 2. Momina — Shared configuration

- [x] 2.1 Create `src/config.js` exporting `ROOM`, `WS_URL`, `FIELD` exactly as pinned in the shared contract, with a comment stating that `FIELD` must match the Collaboration extension's `field` option (design D3, REQ-D1b)
- [x] 2.2 Confirm no room name, websocket URL, or field name appears as a literal anywhere outside this module — verified; the only `1234` outside the module is the relay CLI flag in `package.json`, which cannot import JS
- [x] 2.3 Commit and push `src/config.js` ahead of the rest of Track A — this is the handoff that unblocks Rumaisa's integration

## 3. Momina — Browser editor

- [x] 3.1 Create the HTML page with the `#editor` element and a name/colour input for the local participant
- [x] 3.2 Create the browser entry point: a `Y.Doc` plus a `WebsocketProvider` using `WS_URL` and `ROOM` from config
- [x] 3.3 Mount Tiptap on `#editor` with `StarterKit.configure({ undoRedo: false })` — the installed v3.31.3 has no `history` key, so `history: false` would be silently ignored — then verify no ProseMirror history plugin is active by inspecting the editor's extension list (design D2). A runtime guard logs `[D2 ok]` or `[D2 VIOLATION]` on boot; observed `[D2 ok]`
- [x] 3.4 Add the `Collaboration` extension bound to the `Y.Doc` with `field: FIELD` passed explicitly rather than relying on the default (REQ-D1b)
- [x] 3.5 Add `CollaborationCaret` (from `@tiptap/extension-collaboration-caret`; the v2 `CollaborationCursor` does not exist on this line) with the provider and a local user `{ name, color }`, drawing colours from a small fixed palette that reserves one colour for the server participant — palette lives in `src/palette.js`, see the addendum to the shared contract

## 4. Momina — Gate A (verifiable without any of Rumaisa's work)

Run the relay and two browser tabs. No server participant involved.

- [x] 4.1 Text typed in either tab appears live in the other, with no refresh — verified in two live tabs
- [x] 4.2 Each tab shows the other's caret labelled with their name, and their selection highlighted in their colour — caret `.collaboration-carets__caret` labelled `Guest 592` with `borderColor rgb(48,164,108)`; selection span `rgba(48,164,108,0.44)` matching that participant's colour
- [x] 4.3 Closing one tab removes its cursor and selection markers from the other — see the note below on why this needed an explicit `pagehide` handler
- [x] 4.4 A tab opened against a document that already has content renders that content on load — a third tab rendered the existing two paragraphs immediately
- [x] 4.5 Undo in one tab reverts only that tab's own change, leaves the other tab's text intact, and leaves both tabs converged on identical content — tab 1's undo dropped only its own paragraph; the other tab's paragraph and the shared base line survived, both tabs identical

**Gate A passed.** Two notes from running it:

*Presence withdrawal needed code we did not plan for.* `y-websocket` registers its
awareness exit handler for Node only (`env.isNode && process.on('exit')`) and
installs nothing in the browser, so a closed tab's caret and peer chip lingered on
other clients for the full ~30s awareness timeout. `src/web/main.js` now withdraws
presence on `pagehide`, which makes 4.3 immediate instead of eventual.

*Concurrent editing was stress-tested beyond Gate A.* Two tabs each inserted
single characters into the same paragraph at the same offset, 78 inserts
interleaved. Both replicas converged on byte-identical text with no lost or
duplicated characters. One earlier ad-hoc run, where both tabs typed into the same
paragraph and one then undid, left a single character attributed to the wrong side
(`"TAB TWO…undo."` came back as `"AB TWO…undo.T"`); both replicas agreed, so this
is not divergence, but concurrent-insert-at-identical-offset followed by undo is
worth a second look during Milestone A (9.6).

## 5. Rumaisa — Standalone verification harness

Built first, so Track B needs nothing from Track A to prove itself. This
harness stands in for the browser: it writes the same fragment structure
Tiptap writes.

- [x] 5.1 Create `src/agent/seed-harness.js` — a `Y.Doc` plus `WebsocketProvider` joining the same room, inserting one or more `Y.XmlElement('paragraph')` nodes containing `Y.XmlText`, exactly as Tiptap's binding would
- [x] 5.2 Give it a runnable entry point that seeds known fixture text and stays connected
- [x] 5.3 Confirm two harness instances converge on the same content, proving the room and transport work independently of the browser

## 6. Rumaisa — Server-side participant

- [x] 6.1 Create `src/agent/doc-client.js` with `connect()` — a `Y.Doc` plus `WebsocketProvider` joining `ROOM` at `WS_URL`, supplying a `ws` implementation for Node
- [x] 6.2 Set awareness local state to name `Assistant` with the colour reserved for it in the palette
- [x] 6.3 Implement `readDoc()` — walk `ydoc.getXmlFragment(FIELD)` recursively; `Y.XmlText` nodes contribute their string, element nodes contribute their walked children, siblings join with `\n` (REQ-D1a, REQ-D1c)
- [x] 6.4 Implement `appendText(text)` — insert a `Y.XmlElement('paragraph')` containing a `Y.XmlText` at the end of the fragment (REQ-D1d)
- [x] 6.5 On the provider's `synced` event, log the document share keys, the `FIELD` in use, and a preview of the initial `readDoc()` (design D4)
- [x] 6.6 Add the `dev:agent` entry point: connect, log the diagnostic line, print `readDoc()`, append a marker line
- [x] 6.7 Grep the whole codebase for `getText(` and confirm zero matches against the shared field (REQ-D1a) — only match is the warning comment in `src/config.js`

## 7. Rumaisa — README

- [x] 7.1 Write the README: all three processes, their exact commands, the required start order (relay → web → agent), and the editor URL
- [x] 7.2 Document that `FIELD` must match Tiptap's Collaboration `field`, that a mismatch shows up as an empty `readDoc()` with no error, and that the share-key log line is the first thing to check

## 8. Rumaisa — Gate B (verifiable without any of Momina's work)

Run the relay, the seed harness, and the server participant. No browser involved.

- [x] 8.1 The participant connects and emits the share-key diagnostic line on sync
- [x] 8.2 `readDoc()` returns the harness's seeded fixture text — non-empty, matching what was seeded
- [x] 8.3 Multi-paragraph fixture text comes back with paragraphs separated by `\n`
- [x] 8.4 `appendText()` output is visible to the harness instance as a well-formed paragraph node, and a subsequent `readDoc()` includes it
- [x] 8.5 The logged share keys contain `FIELD`, and `readDoc()` is non-empty for a seeded document — the two together rule out the D1 failure mode

**Gate B re-verified after the D12 fix.** The code for groups 5-8 was already
correct, but it could not be proven against the relay as originally pinned
(`@y/websocket-server@^0.1.5`) — see the note on Milestone A below. Re-run
against `0.1.1`: harness seeds three paragraphs, agent's `readDoc()` returns
them non-empty with `\n` separators, `appendText()`'s marker line is visible
to a subsequent `readDoc()`, share keys log `default` on sync.

## 9. Joint — Milestone A acceptance

Both tracks merged. Run the relay, two browser tabs, and the server participant
together. Verified by running the system, not by inspection.

- [x] 9.1 Two browser tabs open on the same document: text typed in either appears live in the other
- [x] 9.2 Each tab shows the other's cursor, labelled and coloured, with selections visible and markers removed on disconnect
- [x] 9.3 The server participant joins the same room and appears to both tabs as a third participant named `Assistant`
- [x] 9.4 `readDoc()` returns the text currently visible in the browser tabs — non-empty, paragraphs separated by line breaks
- [x] 9.5 Text appended by the server participant appears live in **both** tabs, renders as a normal editable paragraph, and leaves the document editable and uncorrupted
- [x] 9.6 Typing by hand in a tab while the server participant appends produces no corruption and no lost characters
- [x] 9.7 Undo in one tab reverts only that participant's own change and leaves all replicas converged
- [x] 9.8 The share-key diagnostic line is present in the server participant's output on sync
- [ ] 9.9 The README's commands, followed from a clean checkout, reach this state — not re-verified from a literal clean checkout in this pass; commands were run manually in the existing checkout after the D12 fix, not via a scripted fresh-clone run

**Milestone A — blocked, then passed, by a bug outside both tracks.** Running
the full system for the first time (relay + two Playwright-driven browser
tabs + the server participant, together) surfaced that `@y/websocket-server`
as pinned (`^0.1.5`, resolving to `0.1.5`) silently breaks all cross-client
sync: it depends on a Yjs v14 pre-release with a wire format incompatible
with the `yjs@13.6.32` every client here uses. The relay accepted
connections but threw `TypeError: store.getClock is not a function` on every
real update, so a second tab never saw a first tab's text and the agent's
`readDoc()` came back empty even after the harness had seeded content — with
no client-side error at all. This was present in the exact state pushed to
`main`, so neither Gate A nor Gate B were actually provable end-to-end
despite both tracks' code being correct in isolation. See design.md D12.

Fixed by pinning `@y/websocket-server` to `0.1.1` exactly (last version on
the Yjs v13 line). Re-running the identical two-tab + agent flow against
`0.1.1`: both tabs converge on typed text, remote carets render, the
`#peers` list shows `Assistant` in both tabs once the agent connects, the
agent's appended line appears live in both tabs, and undo in one tab reverts
only that tab's own edit while the other tab's content (including the
agent's append) is untouched.

---

# Milestone B — Agent Brain

Work is split into two independently verifiable tracks again, the same way
Milestone A was:

| Track | Owner | Scope | Proved by |
| --- | --- | --- | --- |
| A | **Momina** | Shared config additions, throttled insertion, `search_web` stub, typed-instruction browser UI | Gate A (group 13) — proven without Rumaisa's orchestrator/Groq work |
| B | **Rumaisa** | Groq client, orchestrator, `edit_doc` tool, instruction HTTP endpoint | Gate B (group 17) — proven without Momina's browser UI |
| Joint | **Both** | Integration | Milestone B acceptance (group 18) |

The split follows the same shape as before: the track that owns a shared
interface pushes it early, ahead of the rest of its own track, so the other
track is never blocked waiting on unfinished work — only on a pinned
contract.

---

## Tech stack restrictions (Milestone B)

Binding for both tracks.

**New runtime dependency:** `groq-sdk` only. Do not add the generic `openai`
package, `dotenv`, `langchain`, or any other LLM/agent framework. Env vars
load via Node's built-in `--env-file=.env` flag (confirm the installed Node
version supports it — this project is on Node 22, so it does), not a
dependency.

**No HTTP framework.** The instruction endpoint is a single route on Node's
built-in `http` module. Do not add Express, Fastify, or similar for one
route.

**`GROQ_MODEL` lives in `src/config.js`, never hardcoded in `llm-client.js`.**
Same no-literals convention as `ROOM`/`WS_URL`/`FIELD`.

**`GROQ_API_KEY` is never in `src/config.js`, never logged, never committed.**
It is read from `process.env` only. Its absence at startup is a loud,
immediate error — not a silent no-op agent that never edits anything.

**`edit_doc` never touches more than one paragraph.** If the `find` string
crosses a paragraph boundary, return a descriptive error. Do not attempt a
multi-node edit (design D15).

**`edit_doc` re-reads the live document immediately before mutating.** Never
trust the copy of the document the orchestrator sent to Groq at the start of
the turn — it may be stale by the time the tool actually runs (design D15).

**Only insertion is throttled, never deletion.** `edit_doc`'s delete step
(removing the old `find` text) is a single instant `Y.XmlText.delete`; only
the replacement text streams in via `typing.js` (design D17).

**Retry cap is 3 attempts per instruction, shared across all failure
modes** (a wrong `find` string, a missing tool call, anything else) — not 3
per failure mode. On exhaustion, return a clear failure, do not loop further
(design D14).

**Nothing from later phases.** No microphone, AssemblyAI, ElevenLabs,
barge-in/cancellation, real Tavily network call, or position-based document
references ("the second paragraph") in this change. `search_web` is a stub
that returns a fixed response with no network call.

**Never `ydoc.getText(FIELD)`.** Still applies — carried forward from
Milestone A's D1. Every read/write in this change's new code goes through
the existing `readDoc()`/`getXmlFragment(FIELD)` machinery.

---

## Shared contract (pinned — do not renegotiate mid-flight, Milestone B)

- **`src/config.js` additions** (Momina pushes these first, ahead of the
  rest of Track A): `GROQ_MODEL` (string, default `"llama-3.3-70b-versatile"`),
  `INSTRUCTION_PORT` (number, `3001`), `INSTRUCTION_PATH` (string,
  `"/instruction"`).
- **Instruction HTTP contract** (design D16): `POST {INSTRUCTION_PATH}` on
  `INSTRUCTION_PORT`, JSON body `{ "text": string }`. Success:
  `202 { "accepted": true }`, returned before the orchestrator necessarily
  finishes. Errors: `400` for a missing/empty `text`, `500` if the
  orchestrator throws before accepting — both with a JSON `{ "message": string }`
  body. CORS allows `http://localhost:5173`.
- **`src/agent/typing.js` public signatures** (Momina pushes this early,
  Rumaisa's `edit_doc` imports it without waiting for the throttling to be
  tuned): `typeIntoNewParagraph(doc, text, opts)` and
  `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)`, both
  returning a Promise that resolves once every chunk has been inserted.
- **`search_web` tool schema** (Momina pins the shape, Rumaisa's
  `llm-client.js` registers it verbatim): name `search_web`, one required
  string parameter `query`, description stating it is not yet backed by a
  real search. The stub handler returns
  `{ available: false, message: "Web search is not available yet." }`.
- **`edit_doc` tool schema**: name `edit_doc`, required string parameters
  `find` and `replace`.
- **Orchestrator entry point**: `orchestrator.handleInstruction(text)`,
  returning a Promise. This is the signature Days 7-9's speech input is
  expected to call unchanged — keeping it stable is the point of pinning it
  here.

---

## 10. Momina — Shared config and contract handoff

- [x] 10.1 Add `GROQ_MODEL`, `INSTRUCTION_PORT`, `INSTRUCTION_PATH` to `src/config.js` exactly as pinned above, with a comment noting `GROQ_MODEL` must stay in sync with whatever model `llm-client.js` actually calls — added as the minimal contract handoff so Track B was not blocked; values match the pin exactly (`llama-3.3-70b-versatile`, `3001`, `/instruction`)
- [ ] 10.2 Commit and push these additions ahead of the rest of Track A — this unblocks Rumaisa's `llm-client.js` and HTTP endpoint work — **not done by this pass**; only the contract values themselves were added (see 10.1), not a dedicated push/PR ahead of the rest of Track A
- [ ] 10.3 Add `.env.example` with a `GROQ_API_KEY=` placeholder line (the real key is never committed; `.env` is already gitignored) — **left for Momina**, out of scope for Track B

## 11. Momina — Throttled insertion

- [x] 11.1 Create `src/agent/typing.js` implementing `typeIntoNewParagraph(doc, text, opts)` and `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)` per design D17 — default chunk size 3 characters, default delay 35ms, both overridable via `opts` — added as the pinned contract handoff (see note below) so `edit_doc` (task 15) was not blocked
- [x] 11.2 Each chunk is inserted as its own `Y.XmlText` insert (its own Yjs transaction), so remote peers see text arrive incrementally, not as one write — verified offline: streaming `"Hello world"` at chunk size 3 produced 4 incremental `Y.Doc` updates before the paragraph-creation update, each showing a longer prefix of the text
- [x] 11.3 Push this ahead of the rest of Track A too — `edit_doc` (Track B) imports it directly — `src/agent/doc-client.js`'s `editDoc` imports `typeIntoParagraph` directly, no local reimplementation

**Note on 10/11 (added by the Track B pass, not by Momina).** These two groups are Momina's to own — including task 13.1's standalone relay proof and any tuning of the chunk-size/delay feel. They were touched here only because the shared contract explicitly says Track B "does not wait" for them: `GROQ_MODEL`/`INSTRUCTION_PORT`/`INSTRUCTION_PATH` and the two `typing.js` signatures are pinned values Rumaisa's code imports directly, so without them Track B's own code cannot run at all (the same relationship `src/config.js` had to Track B in Milestone A). Only the pinned shape was added — 10.2 (the ahead-of-Track-A push as its own step), 10.3 (`.env.example`), and 13.x (Gate A) remain outstanding and are Momina's.

## 12. Momina — `search_web` stub and typed-instruction UI

- [ ] 12.1 Implement the `search_web` stub handler and its tool schema exactly as pinned in the shared contract — **left for Momina**; `src/agent/llm-client.js` (task 14.2) registers the schema, and `src/agent/orchestrator.js` (task 16.2) carries its own copy of the fixed stub response so Track B's dispatch loop is exercisable, but there is no standalone, independently-callable stub handler function yet — that ownership stays with Momina
- [ ] 12.2 Add a text input and submit control to the existing editor page (`index.html` / `src/web/main.js`) — **left for Momina**, out of scope for Track B
- [ ] 12.3 On submit, `fetch(POST)` to `INSTRUCTION_PORT`/`INSTRUCTION_PATH` with `{ text }`; on `202`, clear the input and show a brief "sent" acknowledgement; on `400`/`500`, show the error message rather than failing silently — **left for Momina**
- [ ] 12.4 The UI does not wait for the edit to appear — it only reflects the HTTP accept/reject; the actual edit is observed the same way any other participant's edit is, through the existing Yjs sync already built in Milestone A — **left for Momina**

## 13. Momina — Gate A (verifiable without any of Rumaisa's Milestone B work)

- [ ] 13.1 Prove `typing.js` directly against the running relay with a standalone Node script (no browser, no Groq, no orchestrator) — two Node clients watching the same room converge on identical text after a throttled multi-chunk insert, with intermediate partial states observable mid-stream
- [ ] 13.2 Prove the `search_web` stub by calling its handler directly with a sample query and checking the fixed response shape
- [ ] 13.3 Prove the browser UI sends the right request by pointing it at a minimal mock HTTP server written just for this gate (a few lines, not the real orchestrator) that asserts method, path, and body shape, and returns `202`
- [ ] 13.4 Prove the UI's error handling by pointing the mock server at a `400`/`500` response and confirming the error is visible, not swallowed

## 14. Rumaisa — Groq client

- [x] 14.1 Create `src/agent/llm-client.js` using `groq-sdk`, calling `GROQ_MODEL` from `src/config.js`, never a hardcoded model string
- [x] 14.2 Register the `edit_doc` and `search_web` tool schemas exactly as pinned in the shared contract (the `search_web` schema must match Momina's stub verbatim, or the tool-dispatch loop breaks on a valid call) — name/parameter shape matches the pin (`find`/`replace` both required strings for `edit_doc`; single required `query` string for `search_web`)
- [x] 14.3 System prompt states the document is authoritative and that `find` in any `edit_doc` call must match it exactly, verbatim
- [x] 14.4 Throw a clear, named error at startup if `GROQ_API_KEY` is unset — do not let a missing key surface later as an agent that silently never edits anything — verified: `GROQ_API_KEY` unset, `node src/agent/index.js` throws `MissingApiKeyError` and exits 1 immediately, before the HTTP listener or the relay connection is opened
- [x] 14.5 Surface a rate-limit response as its own distinct error type, not folded into the generic tool-call-failure retry path (design D14) — `chat()` catches `Groq.RateLimitError` and rethrows as `llm-client.js`'s own `RateLimitError`; `orchestrator.js` checks for it explicitly and returns immediately instead of burning a retry attempt on it

## 15. Rumaisa — `edit_doc` tool

- [x] 15.1 Extend `src/agent/doc-client.js` with `editDoc(doc, find, replace)`: locate `find` within exactly one paragraph's plain text (walking the fragment the same way `readDoc()` does); if not found in exactly one paragraph, return a descriptive error (`not found` / `found N times, ambiguous` / `spans multiple paragraphs`) rather than guessing — verified against an in-memory `Y.Doc` (no relay needed): unambiguous match replaces correctly and leaves sibling paragraphs untouched; zero matches returns `not found: "..."`; three matches in one paragraph returns `found 3 times, ambiguous: "..."`; a `find` string containing `\n` is rejected before any fragment walk with `find text spans multiple paragraphs...`
- [x] 15.2 Re-read the live fragment inside the same synchronous pass that performs the mutation — never trust a copy read earlier in the turn (design D15) — `editDoc` takes `doc` and always calls `doc.getXmlFragment(FIELD)` and re-fetches the target paragraph fresh at call time; it never accepts a pre-computed offset or cached text from the orchestrator's earlier `readDoc()` snapshot
- [x] 15.3 Delete the matched range as a single instant `Y.XmlText.delete`, then call Momina's `typeIntoParagraph` to stream the replacement in (design D17) — do not write the replacement in one instant insert
- [x] 15.4 Assert (throw, do not silently truncate) if the target paragraph is ever found to contain more than one text-bearing child, per the formatting note in design D15 — verified: a paragraph constructed with two `Y.XmlText` children throws `editDoc invariant violation: paragraph 0 has 2 text-bearing children, expected exactly 1 (design D15)` rather than truncating or guessing
- [ ] 15.5 Grep for any `edit_doc` code path that indexes by character offset into the whole document rather than within one paragraph's own text — confirm none exists (design D15's core invariant)

## 16. Rumaisa — Orchestrator and instruction endpoint

- [x] 16.1 Create `src/agent/orchestrator.js` exporting `handleInstruction(text)` exactly as pinned in the shared contract: reads the live document via `readDoc()`, applies the ~2,000-word cap from the tail of the document if exceeded (design D18, with the truncation noted in the prompt when it fires), sends it plus instruction and conversation history to Groq
- [x] 16.2 Tool-dispatch loop: on a tool call, execute it (`edit_doc` or the `search_web` stub) and feed the result back to Groq; on no tool call and no document change yet, re-prompt once explicitly requiring a tool call; cap total attempts at 3 (design D14)
- [x] 16.3 Keep conversation history in memory for the life of the process — no persistence, no `speaking`/`cancelled` state (those are out of scope per the tech stack restrictions)
- [x] 16.4 Add the HTTP listener to `src/agent/index.js`: `POST /instruction` per the pinned contract, wired to `orchestrator.handleInstruction()`, responding `202` before the orchestrator necessarily finishes
- [x] 16.5 Remove Milestone A's hardcoded `"Appended by Assistant"` marker-line append from `dev:agent`'s startup — replace it with the orchestrator loop as the only source of document edits from the agent process; note this explicitly as a behavior change from Milestone A's `dev:agent` — confirmed removed; `dev:agent`'s `synced` handler now only logs diagnostics, no `appendText` call remains anywhere in `index.js`

## 17. Rumaisa — Gate B (verifiable without any of Momina's Milestone B work)

Run the relay and the agent process. No browser involved; use `curl`/`fetch`
directly against the instruction endpoint, and the seed harness from
Milestone A to set up fixture documents.

**No real `GROQ_API_KEY` was available in this environment**, so 17.1-17.3
were proven against `orchestrator.handleInstruction()` directly (not
through a live Groq account) by pointing `groq-sdk` at a small local mock
HTTP server via `GROQ_BASE_URL`, returning canned `chat.completions`
responses in Groq's own wire format (including real `tool_calls` payloads).
This exercises the real `orchestrator.js` + `doc-client.js` code against a
real `Y.Doc`/relay, only the Groq network call itself is substituted — it
is not a full live pass with an actual model and should be re-run against a
real key before this gate is called fully proven. 17.4 and 17.5 were run
against the real `dev:agent` process and the real Groq endpoint (with an
invalid key for 17.5, to prove the HTTP layer doesn't crash on a downstream
failure), no substitution needed there.

- [x] 17.1 A well-formed instruction against a seeded document (e.g. "change 'rough draft' to 'final draft'") results in exactly the matched paragraph changing, verified by a subsequent `readDoc()` — seeded `"This is a rough draft of the intro.\nSecond paragraph."`, mock Groq returned an `edit_doc` tool call, `handleInstruction` returned `{ ok: true }`, `readDoc()` came back `"This is a final draft of the intro.\nSecond paragraph."`
- [x] 17.2 An instruction whose implied `find` text does not exist verbatim in the seeded document triggers at least one retry, and after 3 failed attempts returns a clear failure rather than looping or corrupting the document — mock Groq returned the same wrong `find` 3 times in a row; `handleInstruction` made exactly 3 attempts, returned `{ ok: false, error: 'retries exhausted after 3 attempts: not found: "dog sat"' }`, and `readDoc()` afterward was byte-identical to the seeded text
- [x] 17.3 A factual/search-shaped instruction exercises the `search_web` stub path without hanging or erroring the whole turn — mock Groq returned a `search_web` tool call followed by plain-text (no-tool-call) responses; the loop dispatched the stub, re-prompted on the no-tool-call turns, and returned a clean `{ ok: false, ... }` after exhausting attempts with no hang, no throw, and the document unchanged
- [x] 17.4 Starting the agent process with `GROQ_API_KEY` unset fails immediately and loudly, before accepting any instruction — `GROQ_API_KEY` unset, `node src/agent/index.js` throws `MissingApiKeyError` synchronously at import time and exits 1 before the relay connection or HTTP listener are ever opened
- [x] 17.5 `POST /instruction` with a missing `text` field returns `400`; a valid request returns `202` before the tool-dispatch loop necessarily completes — verified live with `curl` against the running `dev:agent` process: `{}` and `{"text":"   "}` both → `400 {"message":"missing or empty \"text\" field"}`; `{"text":"change X to Y"}` → `202 {"accepted":true}` returned immediately, with the real (failing, invalid-key) Groq call visibly still in flight afterward in the process log — the server stayed up and kept answering `202` to further requests, confirming the async failure is caught and doesn't crash the listener

## 18. Joint — Milestone B acceptance

Both tracks merged. Run all three processes (relay, web, agent — the agent
now also listening on `INSTRUCTION_PORT`) together. Verified by running the
system, not by inspection.

- [ ] 18.1 Typing an instruction into the browser's new input and submitting it results in the document visibly rewriting, with the new text streaming in character by character rather than appearing instantly
- [ ] 18.2 A second browser tab, not the one the instruction was typed into, sees the same live streaming edit
- [ ] 18.3 An instruction referencing text that does not exist verbatim in the document results in a visible, non-corrupting failure after retries are exhausted — not a silently wrong edit and not a hang
- [ ] 18.4 A factual-question-shaped instruction exercises the `search_web` stub and the agent still responds sensibly (e.g. acknowledges it cannot search yet) rather than hanging or erroring the whole turn
- [ ] 18.5 Typing by hand in a tab while the agent is mid-edit produces no corruption and no lost characters — re-verifying Milestone A's concurrent-edit guarantee still holds with throttled multi-chunk agent inserts in the mix
- [ ] 18.6 The document cap (design D18) does not need to be exercised for this gate to pass, but if tested, a document over ~2,000 words still produces a sensible edit against the tail of the document, not an error
- [ ] 18.7 No `"Appended by Assistant"` marker line appears anywhere — the only agent-driven changes are ones traceable to a real typed instruction
- [ ] 18.8 README updated with the `GROQ_API_KEY` setup step (where to get a free key, where the `.env` file goes) and the instruction endpoint's existence/port; followed from a clean checkout, it reaches "type an instruction, watch it rewrite the document live"
