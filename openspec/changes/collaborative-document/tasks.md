## 1. Project setup (Phase 0)

- [ ] 1.1 Run `npm init` and set the package manifest to ESM (`"type": "module"`); confirm git is initialised and add a `.gitignore` covering `node_modules/`, build output, and local env files
- [ ] 1.2 Install the collaboration stack: `yjs y-websocket y-prosemirror @tiptap/core @tiptap/starter-kit @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor ws`
- [ ] 1.3 Install `vite` as a dev dependency for serving and bundling the browser page (design D5)
- [ ] 1.4 Add the `dev:ws` script running the stock relay via `npx y-websocket` on port 1234 — do not write a relay implementation; add `dev:web` (Vite) and `dev:agent` (server participant) scripts alongside it
- [ ] 1.5 Start the relay and confirm it reports listening on :1234 — **Phase 0 gate**
- [ ] 1.6 Record the installed `@tiptap/extension-collaboration` version and confirm its default `field` value and that it binds via `getXmlFragment` (design D1); if it differs from `"default"`, update `FIELD` in task 2.1 to match

## 2. Shared configuration

- [ ] 2.1 Create the single config module exporting `ROOM`, `WS_URL` (`ws://localhost:1234`), and `FIELD` (`"default"`), with a comment stating that `FIELD` must match the Collaboration extension's `field` option (design D3, REQ-D1b)
- [ ] 2.2 Verify no room name, websocket URL, or field name is written as a literal anywhere outside this module

## 3. Browser editor

- [ ] 3.1 Create the HTML page containing the `#editor` element and a name/colour input for the local participant
- [ ] 3.2 Create the browser entry point: build a `Y.Doc`, connect a `WebsocketProvider` using `WS_URL` and `ROOM` from config
- [ ] 3.3 Mount Tiptap on `#editor` with `StarterKit` configured `history: false`, and verify against the installed StarterKit that no ProseMirror history plugin is active — check the editor's extension list, do not trust the key name alone (design D2)
- [ ] 3.4 Add the `Collaboration` extension bound to the `Y.Doc` with `field: FIELD` passed explicitly (REQ-D1b)
- [ ] 3.5 Add `CollaborationCursor` with the provider and a local user `{ name, color }` so remote carets render labelled and coloured
- [ ] 3.6 Open two tabs and confirm text typed in one appears in the other, and that each tab shows the other's named caret and selection

## 4. Server-side participant

- [ ] 4.1 Create the server participant module: a `Y.Doc` plus a `WebsocketProvider` joining the same `ROOM` and `WS_URL`, supplying a `ws` implementation for Node
- [ ] 4.2 Set its awareness local state to name `Assistant` with a colour reserved for it, distinct from human participants
- [ ] 4.3 Implement `readDoc()` — walk `ydoc.getXmlFragment(FIELD)` recursively, `Y.XmlText` nodes contribute their string, siblings join with `\n`; never call `ydoc.getText(FIELD)` and never use `fragment.toString()` (REQ-D1a, REQ-D1c)
- [ ] 4.4 Implement `appendText(text)` — insert a `Y.XmlElement('paragraph')` containing a `Y.XmlText` at the end of the fragment, never a bare text node at fragment level (REQ-D1d)
- [ ] 4.5 On the provider's `synced` event, log the document share keys, the `FIELD` in use, and a preview of the initial `readDoc()` (design D4)
- [ ] 4.6 Add a runnable entry point that connects, logs the diagnostic line, prints `readDoc()`, and appends a marker line
- [ ] 4.7 Grep the whole codebase for `getText(` and confirm zero matches against the shared field (REQ-D1a)

## 5. Documentation

- [ ] 5.1 Write the README: the three processes, their exact commands, the required start order, and the editor URL
- [ ] 5.2 Document in the README that `FIELD` must match Tiptap's Collaboration `field`, that a mismatch shows up as an empty `readDoc()` with no error, and that the share-key log line is the first thing to check

## 6. Milestone A acceptance

The change is complete when all of the following hold, verified by running the system — not by inspection alone:

- [ ] 6.1 Two browser tabs open on the same document: text typed in either tab appears live in the other
- [ ] 6.2 Each tab shows the other participant's cursor, labelled with their name and drawn in their colour, with selections visible and markers removed on disconnect
- [ ] 6.3 The server participant joins the same room and appears to the browser tabs as a third participant named `Assistant`
- [ ] 6.4 `readDoc()` returns the text currently visible in the browser tabs — non-empty for a non-empty document, with paragraphs separated by line breaks
- [ ] 6.5 Text appended by the server participant appears live in **both** browser tabs, renders as a normal editable paragraph, and leaves the document editable and uncorrupted
- [ ] 6.6 Typing by hand in a tab while the server participant appends produces no corruption and no lost characters
- [ ] 6.7 Undo in one tab reverts only that participant's own change, leaves the other participant's text intact, and leaves all replicas converged
- [ ] 6.8 The share-key diagnostic line is present in the server participant's output on sync
- [ ] 6.9 The README's commands, followed from a clean checkout, reach this state
