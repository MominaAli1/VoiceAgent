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
 * Use the hostname `localhost`, not `127.0.0.1`. The relay binds the IPv6
 * loopback only (netstat shows `[::1]:1234`), so an IPv4 literal is refused
 * with ECONNREFUSED. Verified: `localhost` and `[::1]` connect, `127.0.0.1`
 * does not.
 */
export const WS_URL = 'ws://localhost:1234';

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
