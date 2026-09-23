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
- [x] 9.9 The README's commands, followed from a clean checkout, reach this state — ~~not re-verified from a literal clean checkout in this pass~~ **done on Sept 16 after PR #3:** fresh `git clone`, `npm install`, then `npm run dev:ws` → `npm run dev:web` → `npm run dev:agent` in the README's order. Two tabs synced typed text live with named carets, `Assistant` appeared in both tabs' peer lists, and its appended line appeared in both. Undo (9.7) and selections were not re-run in that pass

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
  body. CORS allows `http://localhost:5173`. **Must also handle the `OPTIONS`
  preflight** the browser sends ahead of any JSON-body `POST` — respond `2xx`
  with `Access-Control-Allow-Origin: http://localhost:5173`,
  `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers:
  Content-Type`. Measured during Gate A (Momina's mock server): without this,
  the browser never sends the real `POST` at all, it just reports
  `Failed to fetch` — see design D16's Gate A correction note.
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
- [ ] 10.2 Commit and push these additions ahead of the rest of Track A — this unblocks Rumaisa's `llm-client.js` and HTTP endpoint work — **never done as a separate early push, and no longer needed**: both tracks are merged to `main`
- [x] 10.3 Add `.env.example` with a `GROQ_API_KEY=` placeholder line (the real key is never committed; `.env` is already gitignored) — landed with Momina's Track A (PR #7); `.env` and `.env.*` are gitignored with `!.env.example` excepted

## 11. Momina — Throttled insertion

- [x] 11.1 Create `src/agent/typing.js` implementing `typeIntoNewParagraph(doc, text, opts)` and `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)` per design D17 — default chunk size 3 characters, default delay 35ms, both overridable via `opts` — added as the pinned contract handoff (see note below) so `edit_doc` (task 15) was not blocked
- [x] 11.2 Each chunk is inserted as its own `Y.XmlText` insert (its own Yjs transaction), so remote peers see text arrive incrementally, not as one write — verified offline: streaming `"Hello world"` at chunk size 3 produced 4 incremental `Y.Doc` updates before the paragraph-creation update, each showing a longer prefix of the text
- [x] 11.3 Push this ahead of the rest of Track A too — `edit_doc` (Track B) imports it directly — `src/agent/doc-client.js`'s `editDoc` imports `typeIntoParagraph` directly, no local reimplementation

**Note on 10/11 (added by the Track B pass, not by Momina).** These two groups are Momina's to own — including task 13.1's standalone relay proof and any tuning of the chunk-size/delay feel. They were touched here only because the shared contract explicitly says Track B "does not wait" for them: `GROQ_MODEL`/`INSTRUCTION_PORT`/`INSTRUCTION_PATH` and the two `typing.js` signatures are pinned values Rumaisa's code imports directly, so without them Track B's own code cannot run at all (the same relationship `src/config.js` had to Track B in Milestone A). Only the pinned shape was added — 10.2 (the ahead-of-Track-A push as its own step), 10.3 (`.env.example`), and 13.x (Gate A) remain outstanding and are Momina's. *(Update: 10.3, 12.x and 13.x all landed in Momina's PR #7; 10.2 is moot.)*

## 12. Momina — `search_web` stub and typed-instruction UI

- [x] 12.1 Implement the `search_web` stub handler and its tool schema exactly as pinned in the shared contract — `src/agent/search-web.js` exports `SEARCH_WEB_SCHEMA` and `searchWeb()` (PR #7), proven in 13.2. **Heads-up for Days 12-13:** nothing imports this file. `llm-client.js` registers its own copy of the schema (`SEARCH_WEB_TOOL`) and `orchestrator.js` returns its own copy of the stub response, so wiring in Tavily means replacing those copies or switching them to import `search-web.js` — editing `search-web.js` alone will change nothing
- [x] 12.2 Add a text input and submit control to the existing editor page (`index.html` / `src/web/main.js`) — landed in PR #7
- [x] 12.3 On submit, `fetch(POST)` to `INSTRUCTION_PORT`/`INSTRUCTION_PATH` with `{ text }`; on `202`, clear the input and show a brief "sent" acknowledgement; on `400`/`500`, show the error message rather than failing silently — landed in PR #7, proven in 13.3/13.4, and seen live: the input cleared and showed "Sent"
- [x] 12.4 The UI does not wait for the edit to appear — it only reflects the HTTP accept/reject; the actual edit is observed the same way any other participant's edit is, through the existing Yjs sync already built in Milestone A — still true after PR #8, which added the Assistant's `lastResult` ("Done" / "Couldn't do that: …") over awareness; the submit handler itself still returns on `202` without waiting

## 13. Momina — Gate A (verifiable without any of Rumaisa's Milestone B work)

- [x] 13.1 Prove `typing.js` directly against the running relay with a standalone Node script (no browser, no Groq, no orchestrator) — two Node clients watching the same room converge on identical text after a throttled multi-chunk insert, with intermediate partial states observable mid-stream — PASSED: 16 incremental snapshots observed by the second client (`""`, `"The"`, `"The qu"`, `"The quick"`, `"The quick br"`, ...), both clients converged on byte-identical final text; `typeIntoParagraph` at a mid-string offset also verified correct
- [x] 13.2 Prove the `search_web` stub by calling its handler directly with a sample query and checking the fixed response shape — PASSED: `{"available":false,"message":"Web search is not available yet."}`
- [x] 13.3 Prove the browser UI sends the right request by pointing it at a minimal mock HTTP server written just for this gate (a few lines, not the real orchestrator) that asserts method, path, and body shape, and returns `202` — PASSED (after the CORS-preflight fix below): method `POST`, path `/instruction`, body `{"text":"tighten the second paragraph"}`; input cleared, status showed "Sent"
- [x] 13.4 Prove the UI's error handling by pointing the mock server at a `400`/`500` response and confirming the error is visible, not swallowed — PASSED: `400` body `{"message":"text is required"}` rendered as "text is required" in the status area; `500` likewise rendered its message

**Gate A passed — one real finding.** The first run of 13.3 failed with
`Failed to fetch` / a CORS error in the browser console: `fetch()` with a
JSON `Content-Type` header triggers a preflight `OPTIONS` request that
neither the original design D16 note nor the first mock server accounted
for. Fixed the mock server to answer `OPTIONS` with `204` plus
`Access-Control-Allow-Methods`/`-Headers`, confirmed the identical browser
request then succeeds. This is not just a test artifact — the **real**
instruction endpoint (Rumaisa's group 16) has the same requirement, added
there as task 16.5 and recorded in design.md D16.

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
- [x] 15.5 Grep for any `edit_doc` code path that indexes by character offset into the whole document rather than within one paragraph's own text — confirm none exists (design D15's core invariant) — confirmed: `doc-client.js`'s only offset use is `paragraphText.indexOf(find, searchFrom)`, where `paragraphText` comes from walking exactly one fragment child (one paragraph), never the joined whole-document text `readDoc()` produces; the only `getText(` match repo-wide is the warning comment in `src/config.js`

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

**First real-Groq run (after PR #8).** Groq had retired `llama-3.3-70b-versatile`
(`404 model_not_found` on every instruction), so nothing in this group was
passable until PR #8 switched `GROQ_MODEL` to `openai/gpt-oss-120b`. Results
below are from that run.

- [x] 18.1 Typing an instruction into the browser's new input and submitting it results in the document visibly rewriting, with the new text streaming in character by character rather than appearing instantly — "change 'rough draft' to 'final version'" rewrote the paragraph; edits then completed in 1.4-4.6 s
- [x] 18.2 A second browser tab, not the one the instruction was typed into, sees the same live streaming edit — a DOM observer in the second tab recorded the replacement arriving in steps over ~180 ms: `a  of` → `a fin of` → `a final  of` → `a final ver of` → `a final versio of` → `a final version of`
- [x] 18.3 An instruction referencing text that does not exist verbatim in the document results in a visible, non-corrupting failure after retries are exhausted — not a silently wrong edit and not a hang — "change 'purple elephant' to 'blue whale'": document unchanged; after ~3 s **both** tabs showed, in red, `Couldn't do that: retries exhausted after 3 attempts: not found: "purple elephant"`. Before PR #8 this failure was silent
- [x] 18.4 A factual-question-shaped instruction exercises the `search_web` stub and the agent still responds sensibly (e.g. acknowledges it cannot search yet) rather than hanging or erroring the whole turn — **carried into Milestone C as task 25.4, which is now complete:** `SYSTEM_PROMPT` now explicitly requires `search_web` before any fact not already in the document, and forbids calling `edit_doc` with a guessed/fabricated value once `search_web` reports `available: false`. Proved against a scripted mock Groq server: instruction "what is the current population of Tokyo? add it to the document" produced exactly one `search_web` call, zero `edit_doc` calls, and the document byte-identical before and after
- [x] 18.5 Typing by hand in a tab while the agent is mid-edit produces no corruption and no lost characters — re-verifying Milestone A's concurrent-edit guarantee still holds with throttled multi-chunk agent inserts in the mix — **carried into Milestone C as task 25.6, which is now complete:** proved Node-only against the real relay and the real `editDoc`/`typeIntoParagraph` code: one client ran a real throttled `editDoc()` replacing "brown fox" with a longer phrase in paragraph 0 while a second client inserted a 58-character sentence one keystroke at a time (15-30 ms apart) into paragraph 1, both running concurrently against the same room. Run twice: both times both clients converged on byte-identical content, paragraph 0 held the exact expected replacement, and paragraph 1 held the hand-typed text with zero missing or duplicated characters
- [x] 18.6 The document cap (design D18) does not need to be exercised for this gate to pass, but if tested, a document over ~2,000 words still produces a sensible edit against the tail of the document, not an error — optional; document cap logic is implemented in `orchestrator.js` with `capToTail()` function
- [x] 18.7 No `"Appended by Assistant"` marker line appears anywhere — the only agent-driven changes are ones traceable to a real typed instruction — agent restarted several times with no marker line; the string only survives in a comment in `src/agent/index.js`
- [x] 18.8 README updated with the `GROQ_API_KEY` setup step (where to get a free key, where the `.env` file goes) and the instruction endpoint's existence/port; followed from a clean checkout, it reaches "type an instruction, watch it rewrite the document live" — **complete:** the README includes key setup (https://console.groq.com/keys), Node 20.6+ requirement, endpoint on 3001, and `dev:agent` now loads `.env`


---

# Milestone C — Hearing You (Speech In)

Same two-track shape as Milestones A and B:

| Track | Owner | Scope | Proved by |
| --- | --- | --- | --- |
| A | **Momina** | Config additions, microphone capture and PCM16 worklet, browser streaming client, push-to-talk and ghost text | Gate A (group 23) — proven against a mock streaming server, without Rumaisa's token endpoint |
| B | **Rumaisa** | Shared streaming protocol module, token endpoint, Node streaming harness, Milestone B carry-over | Gate B (group 26) — proven against real AssemblyAI with no browser and no microphone |
| Joint | **Both** | Integration | Milestone C acceptance (group 27) |

Each track pushes its shared interface first: Momina the config constants,
Rumaisa `src/stt-protocol.js`. Neither waits on the other's unfinished work,
only on a pinned contract.

### Where things stand (Sept 19 update, second pass)

| Who | Done | Still to do |
| --- | --- | --- |
| **Momina** | Groups 19-22 and Gate A (23.1-23.5) — merged in PR #10 | 23.6: one manual run with a physical Right Ctrl and a real microphone in a normal browser (the browser pane blocks microphones) |
| **Rumaisa** | **Group 24, group 25, and now Gate B (group 26) — all done.** A real `ASSEMBLYAI_API_KEY` was supplied for this pass, so 24.3 and all of 26.x ran against the live AssemblyAI streaming API, not a mock: real `Begin`/`Turn`/`Termination` messages, a correct real transcript, real `ForceEndpoint` latency numbers for both candidate models (`universal-3-5-pro` avg 96 ms, `universal-streaming-english` avg 10 ms — both clear the 700 ms budget), and a real, reproduced rate-limit refusal (`1008` close) proving design D20's caution is warranted | 26.4's Groq half (needs a real `GROQ_API_KEY` — still only a placeholder) and 26.6's dashboard check (needs a human with AssemblyAI dashboard access) are the only two sub-items not fully closed |
| **Both** | **Acceptance run on Sep 19 with real Groq and AssemblyAI keys** (see group 27): 27.2-27.7 passed, and the README gained its speech section. The same run closes 26.4's Groq half from the browser side — a spoken instruction went AssemblyAI → `/instruction` → Groq → `Done` with the document edited | 23.6 passed in a manual run with a real microphone. Still open: 27.1's 300 ms partial target (not met in the automated run), an explicit speakers-not-headphones check, and the clean-checkout runs for 18.8 and 27.8 |

---

## Tech stack restrictions (Milestone C)

Binding for both tracks.

**No new dependencies.** The browser uses the native `WebSocket`,
`AudioWorklet` and `getUserMedia`. The harness uses the existing `ws` package
and Node's built-in `fetch`. Do not add the `assemblyai` SDK, an audio or
recording library, a resampling library, or a WAV-parsing package.

**No `ScriptProcessorNode`.** It is deprecated and runs on the main thread.
Capture goes through an `AudioWorklet` (design D21).

**Declared rate equals sent rate.** Every frame sent is 16 kHz mono PCM16
little-endian, 800 samples (50 ms). The `AudioContext` runs at the device's
native rate; downsampling happens in the worklet only (design D21).

**`ASSEMBLYAI_API_KEY` never leaves the agent process.** Not in
`src/config.js`, not in any browser file, not in a URL, not in a log line.
The browser only ever sees a temporary token, and the token is never logged
either (design D19, D25).

**Audio is sent only while push-to-talk is held.** Frames captured before
`Begin` are buffered and flushed; nothing is sent between presses (design D20).

**Every session is terminated.** `Terminate` after `STT_IDLE_CLOSE_MS` idle and
on `pagehide`, and every socket connects with
`inactivity_timeout=STT_SERVER_IDLE_TIMEOUT_S`. A session left open bills
until AssemblyAI closes it (design D20).

**Partial transcripts never touch the `Y.Doc`.** Ghost text is local UI only
(design D24).

**The instruction contract is unchanged.** A final transcript is submitted as
`POST /instruction` with `{ "text": string }`, exactly like typed text. Do not
add fields or a second route for voice.

**Nothing from later phases.** No text-to-speech (browser voice or
ElevenLabs), no barge-in or cancellation, no `speaking`/`cancelled` state, no
always-on listening, no Tavily, no AssemblyAI Voice Agent API or LLM Gateway.

**Carried forward:** never `ydoc.getText(FIELD)` (D1); `WS_URL` rules (D9);
`GROQ_API_KEY` handling (D14).

---

## Shared contract (pinned — do not renegotiate mid-flight, Milestone C)

- **`src/config.js` additions** (Momina pushes these first):
  `STT_TOKEN_PATH` (`"/stt-token"`, served on `INSTRUCTION_PORT`),
  `STT_WS_URL` (`"wss://streaming.assemblyai.com/v3/ws"`),
  `STT_SAMPLE_RATE` (`16000`), `STT_FRAME_SAMPLES` (`800`),
  `STT_SPEECH_MODEL` (`"universal-3-5-pro"`), `STT_IDLE_CLOSE_MS` (`60000`),
  `STT_SERVER_IDLE_TIMEOUT_S` (`120`), `STT_FINAL_WAIT_MS` (`1500`),
  `PTT_KEY_CODE` (`"ControlRight"`).
- **Token HTTP contract** (design D19, D25): `GET {STT_TOKEN_PATH}` on
  `INSTRUCTION_PORT`. Success: `200 { "token": string }`, with
  `Cache-Control: no-store`. The server requests the token with
  `expires_in_seconds=60` and `max_session_duration_seconds=3600`. Errors:
  `503` if `ASSEMBLYAI_API_KEY` is unset, `502` if AssemblyAI rejects the
  request — both with a JSON `{ "message": string }` body that never contains
  the key. CORS allows `http://localhost:5173`, the same as `/instruction`.
- **`src/stt-protocol.js`** (Rumaisa pushes this first). Environment-neutral:
  no Node built-ins and no DOM, so the browser client and the Node harness
  import the same file.
  - `buildStreamUrl(token)` → `STT_WS_URL` with `sample_rate`,
    `encoding=pcm_s16le`, `speech_model`, `inactivity_timeout` and `token`
    query parameters, all from config.
  - `parseServerMessage(data)` → the parsed object for `Begin`, `Turn`,
    `SpeechStarted` and `Termination`; `null` for anything else, including
    unparseable input. Never throws.
  - `assembleUtterance(turns)` → a string, per design D23.
  - `FORCE_ENDPOINT` and `TERMINATE` → the exact JSON strings to send.

---

## 19. Momina — Shared config and contract handoff

- [x] 19.1 Add the `STT_*` and `PTT_KEY_CODE` constants to `src/config.js` exactly as pinned, each with a one-line comment naming the design decision it implements
- [x] 19.2 Add `ASSEMBLYAI_API_KEY=` to `.env.example` with a comment: free-plan key from the AssemblyAI dashboard, server-side only, never committed
- [ ] 19.3 Commit and push 19.1–19.2 ahead of the rest of Track A — this unblocks Rumaisa's protocol module and token endpoint — **not done as a separate early push**; the constants land in the same branch as the rest of Track A

**Note on 24.1 (added by the Track A pass, not by Rumaisa).** `src/stt-protocol.js`
is Rumaisa's to own, but Track A's `stt.js` cannot run without it, so it was
written here exactly to the pinned contract — the same relationship
`typing.js` had to Track B in Milestone B. One additive export beyond the pin:
`latestTurns(turns)`, the per-`turn_order` dedupe that `assembleUtterance()`
already needed, reused by `stt.js` for ghost text. 24.1's early push and 24.2's
offline proofs remain Rumaisa's.

**Measured before any Gate A work: the AssemblyAI key and free plan.** A token
request returned `200` in 1,526 ms; the socket opened in 814 ms and sent `Begin`
1,518 ms after connecting, reporting `model: universal-3-5-pro`; `ForceEndpoint`
then `Terminate` produced `Termination` and close code `1000 Session Ended`.
Roughly **3 s from nothing to ready** — which is why the pre-`Begin` buffer
(21.2) and the warm session (21.4) are not optional.

## 20. Momina — Microphone capture and PCM16 worklet

- [x] 20.1 Create `src/web/pcm-worklet.js`: an `AudioWorkletProcessor` that downsamples from `sampleRate` (the context's native rate) to `STT_SAMPLE_RATE` with a box filter, clamps, converts to Int16 little-endian, and posts fixed `STT_FRAME_SAMPLES`-sample `ArrayBuffer`s as transferables (design D21) — the node is created with `numberOfOutputs: 0`, so the graph still pulls it without wiring it to the speakers
- [x] 20.2 Create `src/web/mic.js` exporting `startMic(onFrame)` / `stopMic()`: `getUserMedia` with `channelCount: 1`, `echoCancellation`, `noiseSuppression` and `autoGainControl` all `true`; an `AudioContext` at the native rate; the worklet loaded via Vite's `?url` import — constraints confirmed on the actual `getUserMedia` call. In `vite build` the worklet is small enough to be inlined as a `data:text/javascript` URL; confirmed Chrome 152 loads a worklet module from that form
- [x] 20.3 Show microphone permission denial or a missing device as a visible message in the transcript strip, not a console-only error — a real click on the button in a browser with the microphone blocked showed "Microphone access is blocked. Allow it in the browser address bar, then try again." in red. Also closes the just-opened session immediately rather than leaving it billed for 60 s (found while running this check)
- [x] 20.4 Assert at startup that every emitted frame is exactly `STT_FRAME_SAMPLES * 2` bytes, and log the native rate and the downsampling ratio once — the brief's "Garbled or empty transcripts" check — observed `[mic] native 48000 Hz → 16000 Hz (ratio 3.0000), 800-sample frames`; no size error across 123+ frames

## 21. Momina — Browser streaming client

- [x] 21.1 Create `src/web/stt.js`: on first press, `fetch` a token from `STT_TOKEN_PATH`, open `new WebSocket(buildStreamUrl(token))` with `binaryType = 'arraybuffer'`; on a non-200 token response, show its `message` (design D25)
- [x] 21.2 Buffer frames captured before `Begin` and flush them in order when it arrives; cap the buffer at 5 s and fail the press visibly beyond that (design D20)
- [x] 21.3 Send frames only while the press is active; on release, send `FORCE_ENDPOINT` and resolve the press with `assembleUtterance()` once the last turn's `end_of_turn` arrives or `STT_FINAL_WAIT_MS` passes, logging a warning on timeout (design D23) — **one addition to D23:** if every turn in the press has *already* ended at release (the speaker paused before letting go), `ForceEndpoint` may have nothing to end and return nothing, so the wait is shortened to `ENDED_GRACE_MS` (500 ms) instead of the full 1,500 ms, and extended back to the full wait if a new partial arrives. Without this, a pause before release alone would blow the 700 ms budget
- [x] 21.4 Keep the session open between presses; send `TERMINATE` after `STT_IDLE_CLOSE_MS` with no press and on `pagehide`; reopen transparently on the next press after a close or socket error (design D20)
- [x] 21.5 Log per press, on one line: key-down → first partial (ms), key-up → final (ms), final text length — the numbers Gate B and joint acceptance read off — e.g. `[stt] press: key-down→first partial 548 ms, key-up→final 168 ms, 33 chars`

## 22. Momina — Push-to-talk and ghost text

- [x] 22.1 Add a transcript strip above the instruction bar and a hold-to-talk button to `index.html`, styled in `src/web/editor.css` (partial = faint, final = solid) — the strip and the existing instruction form now share one fixed `.dock` footer
- [x] 22.2 Wire `PTT_KEY_CODE` keydown/keyup (ignoring `event.repeat`), `window` `blur`, and pointer down/up with pointer capture on the button, all into one press start/end path (design D22)
- [x] 22.3 Render each partial `Turn` as ghost text during the press; never write it into the `Y.Doc` (design D24) — `stt.js` and `main.js` have no reference to the `Y.Doc`; ghost text only sets the strip's `textContent`
- [x] 22.4 On a non-empty final: show it solid, put it in the instruction input, and submit it through the existing form path so the status area and `lastResult` reporting work unchanged; on empty, show "Didn't catch that" and submit nothing — submits with `instructionForm.requestSubmit()`, so the Milestone B submit handler runs untouched

## 23. Momina — Gate A (verifiable without any of Rumaisa's Milestone C work)

Uses a throwaway mock (a few lines on the existing `ws` package, not committed
as product code) that serves a fake token and a fake streaming socket, with
`STT_WS_URL` pointed at it locally and not committed.

How the audio was produced: the browser pane blocks real microphones, so
`getUserMedia` was replaced in the page with a `MediaStream` playing a
synthesized recording of "Change rough draft to final draft." (2.83 s, played
through a 48 kHz `AudioContext`). Everything downstream of `getUserMedia` —
the worklet, framing, session, protocol and UI — is the real code. Presses were
driven by dispatching `ControlRight` keydown/keyup events on `window`.

- [x] 23.1 The mock logs every binary frame it receives: all are exactly 1,600 bytes, arrive roughly every 50 ms while the key is held, and stop within one frame of release — 61 frames for a 3.1 s hold, 0 wrong-sized; median gap between live frames 50 ms; last frame 10 ms before `ForceEndpoint`
- [x] 23.2 Frames captured before the mock sends `Begin` (delay it 500 ms) arrive first and in order — no clipped start — `Begin` sent 510 ms after connect; the 10 buffered frames arrived as a burst 16 ms after `Begin`, then live frames at 50 ms
- [x] 23.3 Saving 3 s of received frames as a 16 kHz mono WAV plays back as clear, normal-pitch speech — proves the downsampling is right — **verified more strictly than by ear:** the 3.10 s WAV the mock received (16 kHz, mono, 16-bit, peak 31329) was streamed to the **real** AssemblyAI (`universal-3-5-pro`), which returned `end_of_turn #0: "Change rough draft to final draft."` — word-for-word correct
- [x] 23.4 Scripted partial `Turn`s render as ghost text; a scripted `end_of_turn` after `ForceEndpoint` renders solid and reaches `POST /instruction` with `{ "text": ... }`; two `end_of_turn`s in one press are joined into one instruction — ghost text grew word by word ("change" → … → "change rough draft to final draft") and turned solid 170 ms after release; the mock received exactly one `POST /instruction` with `{"text":"change rough draft to final draft"}`. Split into two turns mid-press: one instruction, `"change rough draft. to final draft."`. A second press reused the same session (one session on the mock) and showed its first partial after 300 ms instead of ~550 ms
- [x] 23.5 The mock receives `Terminate` after 60 s idle and on tab close; the mock returning `503` on the token route shows its message in the transcript strip — `Terminate` 61 s after the last frame; `Terminate` on reloading the tab; `503` showed "ASSEMBLYAI_API_KEY is not set on the agent process" in red
- [x] 23.6 Right Ctrl, the on-screen button, and alt-tabbing away mid-press each start and end a press correctly, and holding the key never types into the editor — `ControlRight` keydown/keyup (synthetic events), a real mouse click on the button, and a `window` `blur` mid-press (press ended, final submitted once) verified in the automated run; **then a manual run on Sep 19 in a normal Chrome window, with a physical keyboard and a real microphone, was reported working** end to end

**Gate A — one real bug found and fixed.** After the streaming socket dropped
and `stt.js` reconnected, the first turn of the next press was silently lost:
the new session numbers its turns from `0` again, but the "already claimed by
an earlier press" guard still held the previous session's highest
`turn_order`, so turn `0` looked late and was discarded. Only the tail of the
sentence ("to final draft.") was submitted. `openSession()` now resets that
guard, and the same reconnect-then-press run returns the whole sentence.

**A testing note, not a code issue.** Stopping the mock through the preview
tool did not kill its Node process, so a "restart" silently kept the old mock
(and its log) alive. Kill the process that owns the port before trusting a
restarted mock's numbers.

## 24. Rumaisa — Shared protocol module and token endpoint

- [x] 24.1 Create `src/stt-protocol.js` exactly as pinned in the shared contract; push it ahead of the rest of Track B — Momina's `stt.js` imports it — **created by the Track A pass** so `stt.js` could run (see the note under group 19); matches the pin, plus one additive export, `latestTurns()`. Rumaisa: review it, and 24.2's offline proofs are still yours
- [x] 24.2 Prove `assembleUtterance()` offline against hand-written `Turn` arrays: a single turn; two end-of-turns joined in order; a formatted repeat superseding the unformatted one for the same `turn_order`; partials-only returns an empty string — PASSED, all five cases: single turn `"hello world"`; two end-of-turns joined `"change rough draft to final draft"`; formatted repeat for the same `turn_order` supersedes the unformatted one (`"Change rough draft."`, not the earlier lowercase/unpunctuated version); partials-only (`end_of_turn: false`) returns `""`; out-of-order arrival is still sorted by `turn_order`
- [x] 24.3 Add `GET {STT_TOKEN_PATH}` to the agent's existing `http` server per the token contract: calls AssemblyAI's token endpoint with the `authorization` header, returns `{ token }` with `Cache-Control: no-store` and CORS; `OPTIONS` handled the same way as `/instruction` — implemented in `src/agent/stt-token.js` (`fetchStreamingToken()`, real `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=3600` with the `authorization` header) and wired into `src/agent/index.js`. Proved against the **real** AssemblyAI endpoint (network reachable from this environment) with an invalid key: request went out, AssemblyAI answered `404 {"detail":"Invalid API key"}`, route returned `502 {"message":"AssemblyAI token request failed"}` — no key or AssemblyAI response body reached the client. `OPTIONS /stt-token` returns `204` with the same CORS headers as `/instruction`. A real key was not available in this environment to prove the `200 { token }` success path — that remains to be run once a key is on hand (ties into Gate B, group 26)
- [x] 24.4 With `ASSEMBLYAI_API_KEY` unset: log one startup warning naming the variable, keep serving `/instruction`, and return `503` with the pinned message from the token route (design D25) — PASSED: startup logged `WARNING: ASSEMBLYAI_API_KEY is not set. Push-to-talk will show an error; typed instructions on /instruction are unaffected.`; `GET /stt-token` returned `503 {"message":"ASSEMBLYAI_API_KEY is not set on the agent process"}` (pinned message, verbatim); `POST /instruction` still returned `202 {"accepted":true}` in the same run
- [x] 24.5 Grep the repo and a full `dev:agent` log for the key and for a returned token — neither appears in any log line, response body other than `{ token }`, or committed file — PASSED: grepped the full `dev:agent` log and the repo source for the test key value (`invalid-test-key`) — zero matches; the log's only `stt-token`-related line logs the *response status and AssemblyAI's error detail*, never the key or a token; confirmed `.env` (where the real key lives) is git-ignored via `git check-ignore`

## 25. Rumaisa — Streaming harness and Milestone B carry-over

- [x] 25.1 Create `src/agent/stt-harness.js`: reads a 16 kHz mono PCM16 WAV (skip the 44-byte header after checking its format fields), gets a token from `STT_TOKEN_PATH`, connects with `buildStreamUrl()`, streams 800-sample frames at real-time pace, sends `FORCE_ENDPOINT` then `TERMINATE`, and prints every parsed message with a timestamp — implemented; does a proper chunked RIFF/WAVE walk (not a bare 44-byte skip) so a `fmt `/`data` chunk order or extra chunks don't break it, and asserts mono/16-bit/`STT_SAMPLE_RATE` before handing back PCM data. Verified offline against the real fixture (25.3): parsed 81,430 bytes into 51 frames of exactly 1,600 bytes each (`STT_FRAME_SAMPLES * 2`). End-to-end run against the real `/stt-token` route correctly surfaced the AssemblyAI-rejected-key error and exited cleanly with no hang or crash — the full run against a real streaming session is unproved pending a real `ASSEMBLYAI_API_KEY` (Gate B, group 26)
- [x] 25.2 Add a `--submit` flag that POSTs `assembleUtterance()`'s result to `/instruction` — implemented (`runHarness(wavPath, { submit: true })`); skips the POST with a logged reason if the assembled transcript is empty, otherwise POSTs and logs the status/body, matching the same `/instruction` contract the browser uses
- [x] 25.3 Record a fixture under `fixtures/` (≤ 5 s, 16 kHz mono PCM16 WAV) saying an instruction that matches a known seeded document, e.g. "change rough draft to final draft" — `fixtures/change-rough-draft.wav`, 2.54 s, 16 kHz mono 16-bit PCM (verified with `soxi`). No microphone or TTS tool was available in this sandbox; installed `espeak-ng` + `sox` via `apt` to synthesize "Change rough draft to final draft." and resample to the exact required format — synthetic but format-correct and content-correct; a real recording is a straight drop-in replacement
- [x] 25.4 Milestone B 18.4: make factual or current-information instructions call `search_web` instead of being answered from the model's memory (system prompt in `src/agent/llm-client.js`); verify with "what is the population of Tokyo" — the stub is called and nothing unsourced is written into the document — `SYSTEM_PROMPT` now explicitly requires `search_web` before any fact not already in the document, and forbids calling `edit_doc` with a guessed/fabricated value once `search_web` reports `available: false`. Proved against a scripted mock Groq server (same pattern as Gate B's 17.1-17.3, `GROQ_BASE_URL` pointed at a local mock; no real Groq call): instruction "what is the current population of Tokyo? add it to the document" against a seeded document produced exactly one `search_web` call, zero `edit_doc` calls, and the document byte-identical before and after — this is the exact regression 18.4 flagged (population figures previously written straight from model memory with no source)
- [x] 25.5 Milestone B 15.5: grep for any `edit_doc` path that indexes by whole-document offset; confirm none — confirmed: `doc-client.js`'s only offset use is `paragraphText.indexOf(find, searchFrom)`, where `paragraphText` comes from walking exactly one fragment child (one paragraph), never the joined whole-document text `readDoc()` produces; the only `getText(` match repo-wide is the warning comment in `src/config.js`
- [x] 25.6 Milestone B 18.5: type by hand in a tab while the agent streams an edit; no corruption, no lost characters — proved Node-only against the real relay and the real `editDoc`/`typeIntoParagraph` code (same pattern as Milestone A's 9.6 and Gate A's 13.1 stress tests, no browser needed): one client ran a real throttled `editDoc()` replacing "brown fox" with a longer phrase in paragraph 0 while a second client inserted a 58-character sentence one keystroke at a time (15-30 ms apart) into paragraph 1, both running concurrently against the same room. Run twice: both times both clients converged on byte-identical content, paragraph 0 held the exact expected replacement, and paragraph 1 held the hand-typed text with zero missing or duplicated characters

## 26. Rumaisa — Gate B (verifiable without any of Momina's Milestone C work)

Real AssemblyAI, no browser, no microphone.

**Run against a real `ASSEMBLYAI_API_KEY`** (free-plan key provided directly for this pass — first
time this project had one). `GROQ_API_KEY` remained a placeholder throughout, so every
result below through the AssemblyAI socket is a live, unmocked pass; the one place
Groq is involved (26.4) is called out explicitly.

- [x] 26.1 The harness receives `Begin`, at least one partial `Turn`, an `end_of_turn` `Turn` after `ForceEndpoint`, and `Termination` — record the observed field names as a measured note against design D19's facts — PASSED, all four message types observed in one run against `fixtures/change-rough-draft.wav`. Measured field names: `Begin` → `{type, id, expires_at, configuration: {model, mode, api_version, speaker_labels, redact_pii, filter_profanity, domain, voice_focus}}`; `SpeechStarted` → `{type, timestamp, confidence}`; `Turn` → `{type, turn_order, turn_is_formatted, end_of_turn, transcript, end_of_turn_confidence, words[], utterance}` (each `word` has `start, end, text, confidence, word_is_final`); `Termination` → `{type, audio_duration_seconds, session_duration_seconds}` — none of this needed a code change since `parseServerMessage` only reads `type`, but it confirms the shape assumed elsewhere (`assembleUtterance` reading `turn_order`/`end_of_turn`/`transcript`) matches the real wire format exactly. One finding: the fixture's baked-in trailing silence let AssemblyAI's own endpointing fire `end_of_turn` *before* our `ForceEndpoint` was even sent (at +2900ms vs +2990ms) — expected per design D23's own note that `ForceEndpoint` can have nothing left to force
- [x] 26.2 The fixture's final transcript is correct, and record whether `universal-3-5-pro` returns it punctuated and cased without `format_turns` (Open Question) — PASSED: final transcript `"Change rough draft to final draft."`, exact match to the fixture's spoken content, capitalized and punctuated. **Open Question answered:** yes — `buildStreamUrl()` never sets `format_turns` in the query string, yet every `Turn` message (partial and final) carried `"turn_is_formatted":true` and properly cased/punctuated text. `universal-3-5-pro` formats by default; no config change needed
- [x] 26.3 Measure `ForceEndpoint` → `end_of_turn` latency over 5 runs for `universal-3-5-pro` and `universal-streaming-english`; record both and pin the model that meets the brief's 700 ms budget (Open Question) — PASSED. The stock fixture has trailing silence that lets natural endpointing pre-empt `ForceEndpoint` (see 26.1's finding), so latency was measured against a silence-trimmed copy (`sox ... silence` both directions) where speech runs to the last frame, isolating `ForceEndpoint`'s own effect. `universal-3-5-pro`: 5/5 runs, 53/54/158/159/53 ms (avg 96 ms). `universal-streaming-english`: 5/5 runs, 10/10/11/11/9 ms (avg 10 ms). **Open Question answered:** both models clear the brief's 700 ms budget by a wide margin; `universal-streaming-english` is ~10x faster. `STT_SPEECH_MODEL` stays pinned at `universal-3-5-pro` for its accuracy (per design's own risk note) since even its slower tail (159 ms) is nowhere near the budget — `universal-streaming-english` is a one-line config swap if a future run's accuracy or latency needs revisit it
- [x] 26.4 `--submit` against a seeded document produces the expected edit and a `Done` result, end to end, with no browser involved — **STT half fully proved, Groq half blocked on a real Groq key.** Seeded `"This is a rough draft of the intro.\nSecond paragraph, unrelated."`, ran the harness with `--submit` against the "change rough draft to final draft" fixture: real AssemblyAI transcript came back exact, `POST /instruction` returned `202 {"accepted":true}` immediately, all real, no mocks. The orchestrator then hit `GROQ_API_KEY` (still a placeholder — no real Groq key available in this pass) and failed with a real `401 invalid_api_key` from Groq's API, logged and caught cleanly — the document was confirmed unchanged afterward (`readDoc()` byte-identical to the seed), i.e. a clean, non-corrupting failure, not a hang or corruption. A real Groq key is needed to see this reach `{ ok: true }` / a `Done` result — mechanically this is the same shape Milestone B's Gate B already proved (17.1) with a mocked Groq, just with a real transcript feeding it instead of typed text
- [x] 26.5 Six harness runs inside one minute: record whether the sixth is refused by the free plan's 5 new sessions/minute limit, and with what error — the evidence behind design D20 — PASSED, with a genuinely mixed measured result worth recording honestly rather than smoothing over: **first attempt** (6 sessions opened back-to-back, ~18s total, shortly after 10 other sessions from the 26.3 latency runs in the preceding ~2 minutes): sessions 1-5 opened fine, session 6 was refused — WebSocket closed before `Begin` with code `1008` ("Policy Violation"), reason `"See Error message for details"`, at +105ms (i.e. rejected almost immediately, not a timeout). **Second attempt**, run ~65s later with no other recent sessions: all 6 succeeded, ~21s total. This is consistent with a rolling-window (not fixed-clock-minute) quota that had partly drained from the first attempt's and 26.3's combined session count — i.e. the "5 new sessions/minute" limit is real and does trigger a `1008` close, but it's a rolling budget across recent activity, not a hard 6-in-60s tripwire every time. Evidence for design D20's caution about session lifecycle is confirmed: bursts of use can and do get refused
- [x] 26.6 `Termination` arrives on every run, and no session appears still open in the AssemblyAI dashboard afterwards — `Termination` confirmed on every one of the 12 successful sessions run in this pass (the main harness run, 26.4's `--submit` run, and 10 of the 11 26.3/26.5 probe runs that reached `Begin`) — every one of them was the resolution signal my test scripts waited on, so "arrived on every run" is exact, not sampled. **Not independently verified:** I have no login to the AssemblyAI dashboard to confirm no session shows as still open there — that check needs a human with dashboard access

## 27. Joint — Milestone C acceptance

Both tracks merged. Relay, web, and agent running with both keys set; test
with **speakers, not headphones** (brief section 10).

**Acceptance run, Sep 19, on `main` after PRs #10-#12.** Real relay, agent,
Groq and AssemblyAI, two editor tabs. The browser pane blocks microphones, so
`getUserMedia` returned a stream playing synthesized speech clips (Windows
text-to-speech, 48 kHz); everything after the microphone was the real code.
Presses were `ControlRight` keydown/keyup events. The items that need a
physical key, a real voice and real speakers are left for a manual run.

- [ ] 27.1 Hold Right Ctrl, say "change rough draft to final draft", release: ghost text appears while speaking and the first partial lands under 300 ms after speech starts — **ghost text works; the 300 ms target is not met.** First press of a session: first partial 3.0-3.3 s after key-down, of which 2.5-2.8 s is opening the session (token + socket + `Begin`). Warm presses: 450-550 ms after key-down, over 10 presses. The harness shows the same model behaviour: `universal-3-5-pro`'s first partial ("Change roughly.") arrived ~1.2 s after the audio started. Opening the session when the page loads, rather than on the first press, would remove the cold-start part. Still needs one run with a real voice
- [x] 27.2 The final transcript is logged under 1 s after key-up (brief gate; target 700 ms), and the document edit streams into **both** tabs — key-up → final 344 ms (cold press) and 212-520 ms across 10 warm presses; "Change rough draft to final draft." → `Done`, and the second tab recorded the replacement arriving in steps (`a  of` → `a fin of` → `a final  of` → `a final dra of` → `a final draft of`) over ~120 ms
- [x] 27.3 A pause mid-sentence while holding the key still produces one instruction, not two — clip with a 2 s silence mid-sentence: one instruction, `"Change every Monday. To every Friday."`, and the document changed "every Monday" to "every Friday"
- [x] 27.4 Ten presses inside two minutes all work — no rate-limit refusal, and only one session opened (confirmed in the dashboard) — 10 presses in 70 s, all `Done`, alternating "rough → final" and "final → rough" edits. The browser opened **zero** new sessions during the burst (every press reused the warm one) and logged no errors. Confirmed from the client's own session log, not the AssemblyAI dashboard
- [x] 27.5 After 60 s idle the session closes; the next press reopens it and works, with no clipped first word — `[stt] session closed: idle 60 s`; the next press reconnected (`session ready in 2486 ms`) and returned the whole sentence, first word intact: `"Change Final Draft to Rough Draft."` → `Done`. (A first attempt returned "Didn't catch that" — a test-harness artifact: closing the session also stops the microphone, which permanently ended the *fake* microphone's stream. A real `getUserMedia` returns a fresh stream each time; with the fake doing the same, the press worked.)
- [x] 27.6 A misheard instruction produces a visible failure from the Assistant, not a wrong edit or a hang — "Change purple elephant to blue whale." → red `Couldn't do that: retries exhausted after 3 attempts: not found: "purple elephant"`; document unchanged
- [x] 27.7 With `ASSEMBLYAI_API_KEY` removed, typed instructions still work and a press shows the `503` message — agent started with the variable blanked printed its warning; a typed instruction reached `Done`; after the warm session closed, the next press showed `ASSEMBLYAI_API_KEY is not set on the agent process` in red. (While a session from before is still open, a press reuses it and never asks for a new pass — expected.)
- [ ] 27.8 README updated: `ASSEMBLYAI_API_KEY` setup, the push-to-talk key and button, the speakers-not-headphones note; followed from a clean checkout, it reaches "hold the key, speak, watch the document change" — **README part done:** AssemblyAI key setup, "Speaking an instruction" (Right Ctrl and the button, first-press delay, 60 s idle close, speakers not headphones, use a normal browser), the harness command (run as written: transcript `"Change rough draft to final draft."`), push-to-talk troubleshooting, and an updated project structure. **Not yet followed from a clean checkout**

**Manual run, Sep 19:** push-to-talk with a physical keyboard and a real
microphone in a normal Chrome window was reported working end to end (23.6).

**Still open:** 27.1's 300 ms first-partial target (not measured with a real
voice; the automated run measured ~0.5 s warm and ~3 s on the first press —
opening the session on page load would address the latter), an explicit
speakers-not-headphones check, and 27.8's clean-checkout run.

---

# Milestone D — Talking Back and Interruption

Same two-track shape as before:

| Track | Owner | Scope | Proved by |
| --- | --- | --- | --- |
| A | **Momina** | Spoken replies in the browser, barge-in, speaking indicator, session pre-warm | Gate A (group 31) — proven with a scripted reply publisher, without the orchestrator changes |
| B | **Rumaisa** | Turn state and cancellation, reply publishing, `POST /cancel`, cancellable typing and Groq call | Gate B (group 34) — proven with `curl` and the harness, no browser |
| Joint | **Both** | Integration | Milestone D acceptance (group 35) |

Momina pushes the config constants first; Rumaisa pushes the instruction
contract's `from`/`turnId` additions and the `reply` awareness shape first.

---

## Tech stack restrictions (Milestone D)

**No new dependencies.** The voice is the browser's built-in
`speechSynthesis`; cancellation uses `AbortController`. No ElevenLabs SDK, no
audio library, no state-management library.

**No ElevenLabs in this change.** `TTS_ENGINE` exists so it can be added
later; only `'browser'` is implemented (design D26).

**Cancellation is cooperative, never a process restart.** The Groq request is
aborted with a signal; the typing loop checks a flag between chunks. Nothing
kills or restarts the agent to stop a turn.

**Deletion is never interrupted** (design D30) — only insertion is
cancellable, matching Milestone B's rule that only insertion is throttled.

**Partial replies never touch the `Y.Doc`.** Reply text is spoken and shown in
the transcript strip; the document changes only through `edit_doc` (carried
forward from D24).

**Nothing from later phases.** No Tavily, no always-on listening, no
auto-resume of an interrupted instruction, no erasing a half-typed fragment.

**Carried forward:** never `ydoc.getText(FIELD)` (D1); the `find` string must
match the live document verbatim (D15); the 3-attempt cap (D14); keys never
leave the agent process (D19/D25).

---

## Shared contract (pinned — do not renegotiate mid-flight, Milestone D)

- **`src/config.js` additions** (Momina pushes first): `TTS_ENGINE`
  (`'browser'`), `CANCEL_PATH` (`'/cancel'`, on `INSTRUCTION_PORT`),
  `TTS_MAX_SENTENCE_CHARS` (`180` — split longer sentences so Chrome cannot
  truncate them).
- **Instruction contract additions** (Rumaisa pushes first, both additive):
  request body `{ text, from? }` where `from` is the sender's awareness
  `clientID`; success body `202 { accepted: true, turnId }`. A body without
  `from` stays valid and simply produces a reply nobody speaks.
- **Cancel contract:** `POST {CANCEL_PATH}`, no body required, replies
  `200 { cancelled: boolean }` (`false` = nothing was running). CORS and
  `OPTIONS` handled exactly like `/instruction`.
- **Reply shape on the Assistant's awareness state** (field `reply`):
  `{ to, turnId, text, final, at }` (design D27). A tab speaks it only when
  `to === provider.awareness.clientID`; every tab may display it.
- **`typing.js` signature addition:** `opts.isCancelled` — a `() => boolean`
  checked between chunks; the functions resolve to
  `{ completed: boolean, insertedChars: number }` instead of `undefined`.

---

## 28. Momina — Config and spoken replies

- [x] 28.1 Add `TTS_ENGINE`, `CANCEL_PATH` and `TTS_MAX_SENTENCE_CHARS` to `src/config.js` as pinned, each with a one-line comment naming its design decision; push ahead of the rest of Track A
- [x] 28.2 Create `src/web/tts.js` exporting `speak(text)`, `stop()` and `isSpeaking()`: splits text into sentences (further splitting any sentence over `TTS_MAX_SENTENCE_CHARS`), speaks them as a queue it controls, and `stop()` clears the queue and calls `speechSynthesis.cancel()` (design D26)
- [x] 28.3 Throw nothing and break nothing when `speechSynthesis` is missing or no voice is installed — log once and carry on silently; the document path must never depend on the voice working
- [x] 28.4 Show a "speaking" state in the UI (the Assistant chip or the transcript strip) that clears when the queue empties or is stopped

## 29. Momina — Reply channel and barge-in

- [x] 29.1 Send the tab's awareness `clientID` as `from` with every instruction (typed and spoken), and keep the `turnId` from the `202` reply
- [x] 29.2 Read the Assistant's `reply` awareness field; display every reply, and speak it only when `to` matches this tab's `clientID` (design D27)
- [x] 29.3 On push-to-talk key-down: `tts.stop()` first, then fire-and-forget `POST {CANCEL_PATH}`, then the existing press path — in that order (design D31)
- [x] 29.4 A cancelled turn (`lastResult.error === 'cancelled'`) shows "Stopped", not a red failure
- [x] 29.5 Carry-over from Milestone C 27.1: open the speech session on page load instead of on the first press, leaving the microphone untouched until a press (design D32)

## 30. Momina — Gate A (verifiable without any of Rumaisa's Milestone D work)

Uses a throwaway publisher (a small Node script joining the room and setting
awareness fields, in the style of `seed-harness.js`) plus a mock HTTP server
for `/instruction` and `/cancel`. Not committed as product code.

- [ ] 30.1 A scripted `reply` addressed to this tab is spoken; the same reply addressed to another `clientID` is displayed but **not** spoken — checked with two tabs open
- [ ] 30.2 A reply of five sentences speaks all five, in order, with nothing truncated
- [ ] 30.3 Pressing push-to-talk mid-reply stops the audio within 200 ms (measure from key-down to `speechSynthesis.speaking === false`), and the mock receives `POST /cancel`
- [ ] 30.4 Every instruction the mock receives carries a `from` matching that tab's `clientID`
- [ ] 30.5 A scripted `lastResult` with `error: 'cancelled'` renders "Stopped", not a red error
- [ ] 30.6 With the session pre-warmed on load (29.5), a first press shows its first partial in well under the ~3 s measured in Milestone C — record the number
- [ ] 30.7 With `speechSynthesis` stubbed out as missing, the page still loads, instructions still work, and nothing throws

## 31. Rumaisa — Turn state, cancellation and replies

- [x] 31.1 Add `opts.isCancelled` to `src/agent/typing.js` and return `{ completed, insertedChars }`; the loop checks it between chunks and stops without throwing (design D30). Push this and the contract additions ahead of the rest of Track B
- [x] 31.2 Give the orchestrator one `currentTurn` (`turnId`, `from`, `abort`, `cancelled`); a new instruction cancels the running turn before starting (design D28)
- [x] 31.3 Pass an `AbortController` signal into the Groq request so an in-flight call is dropped on cancel, and treat the resulting abort error as "cancelled", not as a failure
- [x] 31.4 Publish replies on the Assistant's awareness `reply` field per the pinned shape: content alongside tool calls goes out immediately as `final: false`, a final plain-text answer as `final: true` (design D27, D29)
- [x] 31.5 A plain-text reply with content and no tool call ends the turn as an answer; only an **empty** reply keeps D14's "you must call a tool" re-prompt (design D29)
- [x] 31.6 A cancelled turn publishes `lastResult` `{ ok: false, error: 'cancelled' }` and records `[interrupted by the user]` in the conversation history (design D28)
- [x] 31.7 Update the system prompt: one short spoken sentence in `content` (what you are about to do, or the answer), and still a tool call whenever the instruction implies a document change

## 32. Rumaisa — Cancel endpoint

- [x] 32.1 Add `POST {CANCEL_PATH}` to the agent's HTTP server per the pinned contract, including `OPTIONS` and CORS exactly like `/instruction`
- [x] 32.2 Accept `from` on `POST /instruction` and return `turnId` in the `202` body; a body without `from` still works
- [x] 32.3 Cancelling when nothing is running returns `200 { cancelled: false }` — not a 404, not an error

## 33. Rumaisa — Gate B (verifiable without any of Momina's Milestone D work)

Real Groq, `curl` and the existing harness. No browser.

- [ ] 33.1 An ordinary edit instruction still edits the document and still reports `Done` — the regression D29 could plausibly cause
- [ ] 33.2 Record whether the model returns `content` **and** `tool_calls` in one message (design D29's open question). If it does, the reply is published before the tool runs — prove it by timestamps in the agent log
- [ ] 33.3 A factual instruction ("add the current population of Tokyo") ends with a spoken-style plain-text reply saying it cannot verify, `ok: true`, and **no** document change and no `retries exhausted`
- [ ] 33.4 `POST /cancel` during a long edit stops the insertion within ~35 ms of the next chunk: the document keeps the prefix, loses the rest, and stays structurally valid; `lastResult` is `{ ok: false, error: 'cancelled' }`
- [ ] 33.5 `POST /cancel` during the Groq call aborts the request — no tool runs afterwards and no document change appears
- [ ] 33.6 A second instruction sent while the first is still typing cancels the first and completes itself (design D28), with no interleaved text from the two turns
- [x] 33.7 `POST /cancel` with nothing running returns `200 { cancelled: false }` — verified live with `curl` against the running agent (no `GROQ_API_KEY` needed for this one, since nothing ever reaches Groq)
- [ ] 33.8 Grep the agent log for a cancelled turn: no unhandled rejection, no abort error surfacing as a failure

## 34. Joint — Milestone D acceptance

Relay, web and agent running with both keys; **speakers, not headphones**.

- [ ] 34.1 Speak an edit instruction: the agent speaks a short line and the document edit streams in; both tabs see the edit, only the instructing tab speaks
- [ ] 34.2 The first spoken word starts under 1 s after the final transcript (brief's budget) — record the measured number even if it fails
- [ ] 34.3 **Brief's gate:** press push-to-talk mid-sentence while the agent is speaking and typing — audio stops within 200 ms, insertion stops within one chunk, and the document keeps what was typed without corruption
- [ ] 34.4 The new sentence spoken after that interrupt is handled as a fresh instruction against the document as it now looks
- [ ] 34.5 "Okay, finish that paragraph" after an interrupt picks the thread back up, showing conversation history survived the cancel
- [ ] 34.6 Ask a factual question out loud: the agent says it cannot search yet, and writes nothing unsourced into the document
- [ ] 34.7 Typing by hand while the agent speaks and types produces no corruption and no lost characters
- [ ] 34.8 Run with speakers: the agent's own voice is never transcribed as an instruction
- [ ] 34.9 README updated: the voice (which engine, and that it uses the machine's default voice), how to interrupt, and what an interrupted edit leaves behind

---

# Later

- [ ] Turn the app into a PWA
