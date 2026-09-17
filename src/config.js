/**
 * Single source of truth for the collaboration connection.
 *
 * Both the browser editor and the server-side participant import from here.
 * Do not restate any of these values as a literal anywhere else — a room-name
 * or field-name typo produces two participants that each work perfectly in
 * isolation and simply never see each other, with no error to point at.
 */

/** The y-websocket room every participant joins. */
export const ROOM = 'voice-doc-agent';

/**
 * The y-websocket relay. Started by `npm run dev:ws`.
 *
 * The relay binds the IPv6 loopback only (`[::1]:1234`). The `ws` npm module
 * resolves `localhost` to `127.0.0.1` (IPv4) on some systems, which causes
 * ECONNREFUSED. Use the IPv6 literal `[::1]` to ensure a reliable connection.
 */
export const WS_URL = 'ws://[::1]:1234';

/**
 * The Yjs share key holding the document.
 *
 * MUST match the `field` option of @tiptap/extension-collaboration. Verified
 * against the installed v3.31.3, whose default is "default" and which binds
 * via `document.getXmlFragment(field)`.
 *
 * That share key therefore holds a Y.XmlFragment, NOT a Y.Text:
 *
 *   - `ydoc.getText(FIELD)` returns an empty string with NO error, and then
 *     permanently poisons the key — a later `getXmlFragment(FIELD)` on the
 *     same Y.Doc throws "already been defined with a different constructor".
 *   - Always read and write through `ydoc.getXmlFragment(FIELD)`.
 *
 * If the agent's text never appears in the editor, this constant is the first
 * thing to check. See openspec/changes/collaborative-document/design.md — D1.
 */
export const FIELD = 'default';

/**
 * --- Milestone B additions ---
 *
 * Pinned by the shared contract in openspec/changes/collaborative-document/tasks.md
 * so Track B (Rumaisa) is never blocked waiting on the rest of Track A. These
 * three values are the contract handoff only; Momina's remaining Track A work
 * (typed-instruction UI, `search_web` stub wiring, `.env.example`, Gate A) is
 * separate and unaffected by this file.
 */

/**
 * The Groq model `llm-client.js` calls. Must stay in sync with whatever
 * model `llm-client.js` actually calls — never hardcode a model string
 * there, import it from here instead.
 */
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

/**
 * Port the agent process's instruction HTTP endpoint listens on. Separate
 * from both the relay (1234) and Vite (5173). See design.md D16.
 */
export const INSTRUCTION_PORT = 3001;

/** Path of the instruction HTTP endpoint. See design.md D16. */
export const INSTRUCTION_PATH = '/instruction';
