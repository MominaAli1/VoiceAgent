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

- [ ] 5.1 Create `src/agent/seed-harness.js` — a `Y.Doc` plus `WebsocketProvider` joining the same room, inserting one or more `Y.XmlElement('paragraph')` nodes containing `Y.XmlText`, exactly as Tiptap's binding would
- [ ] 5.2 Give it a runnable entry point that seeds known fixture text and stays connected
- [ ] 5.3 Confirm two harness instances converge on the same content, proving the room and transport work independently of the browser

## 6. Rumaisa — Server-side participant

- [ ] 6.1 Create `src/agent/doc-client.js` with `connect()` — a `Y.Doc` plus `WebsocketProvider` joining `ROOM` at `WS_URL`, supplying a `ws` implementation for Node
- [ ] 6.2 Set awareness local state to name `Assistant` with the colour reserved for it in the palette
- [ ] 6.3 Implement `readDoc()` — walk `ydoc.getXmlFragment(FIELD)` recursively; `Y.XmlText` nodes contribute their string, element nodes contribute their walked children, siblings join with `\n` (REQ-D1a, REQ-D1c)
- [ ] 6.4 Implement `appendText(text)` — insert a `Y.XmlElement('paragraph')` containing a `Y.XmlText` at the end of the fragment (REQ-D1d)
- [ ] 6.5 On the provider's `synced` event, log the document share keys, the `FIELD` in use, and a preview of the initial `readDoc()` (design D4)
- [ ] 6.6 Add the `dev:agent` entry point: connect, log the diagnostic line, print `readDoc()`, append a marker line
- [ ] 6.7 Grep the whole codebase for `getText(` and confirm zero matches against the shared field (REQ-D1a)

## 7. Rumaisa — README

- [ ] 7.1 Write the README: all three processes, their exact commands, the required start order (relay → web → agent), and the editor URL
- [ ] 7.2 Document that `FIELD` must match Tiptap's Collaboration `field`, that a mismatch shows up as an empty `readDoc()` with no error, and that the share-key log line is the first thing to check

## 8. Rumaisa — Gate B (verifiable without any of Momina's work)

Run the relay, the seed harness, and the server participant. No browser involved.

- [ ] 8.1 The participant connects and emits the share-key diagnostic line on sync
- [ ] 8.2 `readDoc()` returns the harness's seeded fixture text — non-empty, matching what was seeded
- [ ] 8.3 Multi-paragraph fixture text comes back with paragraphs separated by `\n`
- [ ] 8.4 `appendText()` output is visible to the harness instance as a well-formed paragraph node, and a subsequent `readDoc()` includes it
- [ ] 8.5 The logged share keys contain `FIELD`, and `readDoc()` is non-empty for a seeded document — the two together rule out the D1 failure mode

## 9. Joint — Milestone A acceptance

Both tracks merged. Run the relay, two browser tabs, and the server participant
together. Verified by running the system, not by inspection.

- [ ] 9.1 Two browser tabs open on the same document: text typed in either appears live in the other
- [ ] 9.2 Each tab shows the other's cursor, labelled and coloured, with selections visible and markers removed on disconnect
- [ ] 9.3 The server participant joins the same room and appears to both tabs as a third participant named `Assistant`
- [ ] 9.4 `readDoc()` returns the text currently visible in the browser tabs — non-empty, paragraphs separated by line breaks
- [ ] 9.5 Text appended by the server participant appears live in **both** tabs, renders as a normal editable paragraph, and leaves the document editable and uncorrupted
- [ ] 9.6 Typing by hand in a tab while the server participant appends produces no corruption and no lost characters
- [ ] 9.7 Undo in one tab reverts only that participant's own change and leaves all replicas converged
- [ ] 9.8 The share-key diagnostic line is present in the server participant's output on sync
- [ ] 9.9 The README's commands, followed from a clean checkout, reach this state
