## Why

The brief's fifteen-day plan deliberately builds the document layer first, with no audio and no LLM, "so every later bug is clearly in the audio or agent path, not the document." Right now the repository holds only a LICENSE, so there is nothing to build that later work onto.

This change delivers Day 0 (setup) and Days 1-3 (the collaborative document) and stops there. It establishes the one thing every later phase depends on: a shared Yjs document that a browser editor and a server-side Node process both edit as equal participants. Proving that seam now is what makes the orchestrator, the STT path, and the TTS path debuggable later.

## What Changes

- **Project setup.** Initialise the Node project (`npm init`) and git; install `yjs`, `y-websocket`, `y-prosemirror`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, and `ws`. Add a package.json script that runs the stock `npx y-websocket` dev server on port 1234. We do not write our own relay server.
- **Browser editor page.** A page with an `#editor` element mounting a Tiptap editor bound to a `Y.Doc` through a `WebsocketProvider`, with per-user named cursors rendered via the collaboration-cursor extension. StarterKit runs with `history: false`.
- **Server-side participant.** A Node client that joins the *same* room as a second peer, publishes awareness (name `"Assistant"`, a distinct colour), exposes `readDoc()` returning the document as plain text, and can append text that both browser tabs see.
- **Shared configuration.** Room name, websocket URL, and the Yjs field name live in exactly one module imported by both browser and server.
- **README.** Exact commands to run the websocket server, serve the browser page, and run the server client.

Explicitly out of scope for this change: microphone capture, AssemblyAI, Claude, Tavily, ElevenLabs, the orchestrator, the `edit_doc` tool, and throttled typing. No audio, no LLM, no voice code.

### One correction to the stated approach

The brief and the change request both specify that the server client reads the document via `ydoc.getText(FIELD)`. Against the installed packages this is wrong, and it fails silently rather than loudly:

`@tiptap/extension-collaboration@3.31.3` binds the editor to `document.getXmlFragment(field)` with `field` defaulting to `"default"`. That share key therefore holds a `Y.XmlFragment`, not a `Y.Text`. Calling `ydoc.getText("default")` on the synced document returns an **empty string** with no error, and writing through it inserts a bare text node at the fragment root — outside any paragraph, which is invalid ProseMirror content. It also permanently poisons the key: a later `getXmlFragment("default")` on the same `Y.Doc` throws `Type with the name default has already been defined with a different constructor`.

This change keeps the intent of the constraint — one `FIELD` constant, share keys logged, treated as the first suspect — but reads and writes through `getXmlFragment(FIELD)`, with `readDoc()` walking the fragment to plain text. See design.md for the verification transcript.

## Capabilities

### New Capabilities

- `collaborative-document`: the shared document surface — the browser editor, the Yjs transport and room configuration, presence and named cursors, and the server-side participant's read and append operations.
- `project-setup`: the runnable skeleton — dependency set, the y-websocket dev server script, and the documented commands to bring all three processes up.

### Modified Capabilities

None. This is the first change in the repository; there are no existing specs.

## Impact

- **New dependencies:** `yjs`, `y-websocket`, `y-prosemirror`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, `ws`, plus a dev-time static server and a bundler for the browser page.
- **New code:** shared config module, browser editor entry point and HTML page, server-side Yjs client module, README.
- **No existing code affected** — the repository contains only a LICENSE.
- **Downstream:** Days 4-6 (the orchestrator) will import `readDoc()` and the append path from the server client established here. The `FIELD` correction above is load-bearing for that work; getting it wrong is the brief's own first-listed risk ("Agent text never appears in editor").
