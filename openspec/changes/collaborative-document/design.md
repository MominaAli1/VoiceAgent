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
