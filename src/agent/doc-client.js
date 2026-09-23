/**
 * Server-side participant for the collaborative document.
 *
 * This module provides the agent's ability to join the document room,
 * read the current document content, and append text to it.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { ROOM, WS_URL, FIELD } from '../config.js';
import { typeIntoParagraph } from './typing.js';
import { ASSISTANT_COLOR } from '../palette.js';

/**
 * Connect to the document room.
 * @returns {{ doc: Y.Doc, provider: WebsocketProvider }}
 */
export function connect() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, ROOM, doc, {
    // Supply ws implementation for Node
    WebSocket,
  });

  // Set awareness local state to name 'Assistant' with reserved colour
  provider.awareness.setLocalStateField('user', {
    name: 'Assistant',
    color: ASSISTANT_COLOR,
  });

  return { doc, provider };
}

/**
 * Read the document content by walking the fragment recursively.
 * @param {Y.Doc} doc
 * @returns {string} Plain text with paragraphs separated by newlines
 */
export function readDoc(doc) {
  const fragment = doc.getXmlFragment(FIELD);
  return walkFragment(fragment);
}

/**
 * Append text to the document.
 * Inserts a Y.XmlElement('paragraph') containing a Y.XmlText at the end of the fragment.
 *
 * @param {Y.Doc} doc
 * @param {string} text - Text to append
 */
export function appendText(doc, text) {
  const fragment = doc.getXmlFragment(FIELD);
  const paragraph = new Y.XmlElement('paragraph');
  const textNode = new Y.XmlText(text);
  paragraph.insert(0, [textNode]);
  fragment.insert(fragment.length, [paragraph]);
}

/**
 * Locate `find` within exactly one paragraph's plain text and replace it,
 * streaming the replacement in via `typeIntoParagraph` (design D17).
 *
 * Re-reads the live fragment inside the same synchronous pass that performs
 * the mutation — the caller's copy of the document (e.g. what was sent to
 * Groq at the start of a turn) is never trusted (design D15).
 *
 * @param {Y.Doc} doc
 * @param {string} find - Exact, verbatim substring to locate, within a single paragraph
 * @param {string} replace - Replacement text
 * @param {{ chunkSize?: number, delayMs?: number, isCancelled?: () => boolean }} [opts]
 * @returns {Promise<{ ok: true, completed: boolean, insertedChars: number } | { ok: false, error: string }>}
 */
export async function editDoc(doc, find, replace, opts = {}) {
  // A `find` string that crosses a paragraph boundary is out of scope for
  // this milestone (design D15) — detected before attempting anything.
  if (find.includes('\n')) {
    return { ok: false, error: 'find text spans multiple paragraphs; must be within a single paragraph' };
  }

  const fragment = doc.getXmlFragment(FIELD);

  /** @type {Array<{ paragraphIndex: number, offset: number }>} */
  const matches = [];

  for (let i = 0; i < fragment.length; i++) {
    const node = fragment.get(i);
    if (!(node instanceof Y.XmlElement)) continue;

    const paragraphText = walkElement(node);
    let searchFrom = 0;
    for (;;) {
      const offset = paragraphText.indexOf(find, searchFrom);
      if (offset === -1) break;
      matches.push({ paragraphIndex: i, offset });
      searchFrom = offset + Math.max(find.length, 1);
    }
  }

  if (matches.length === 0) {
    return { ok: false, error: `not found: "${find}"` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `found ${matches.length} times, ambiguous: "${find}"` };
  }

  const { paragraphIndex, offset } = matches[0];

  // Re-fetch the paragraph fresh, in this same synchronous pass, rather
  // than reusing anything computed before this point in a prior turn.
  const paragraph = fragment.get(paragraphIndex);
  if (!(paragraph instanceof Y.XmlElement)) {
    return { ok: false, error: `paragraph ${paragraphIndex} no longer exists` };
  }

  const textChildren = [];
  for (let i = 0; i < paragraph.length; i++) {
    const child = paragraph.get(i);
    if (child instanceof Y.XmlText) textChildren.push(child);
  }
  if (textChildren.length > 1) {
    throw new Error(
      `editDoc invariant violation: paragraph ${paragraphIndex} has ${textChildren.length} text-bearing children, expected exactly 1 (design D15)`,
    );
  }
  if (textChildren.length === 0) {
    return { ok: false, error: `paragraph ${paragraphIndex} has no text content` };
  }

  const textNode = textChildren[0];

  // Delete step is a single, instant, un-throttled transaction — only the
  // replacement's insertion is throttled (design D17).
  textNode.delete(offset, find.length);

  const { completed, insertedChars } = await typeIntoParagraph(doc, paragraphIndex, offset, replace, opts);

  return { ok: true, completed, insertedChars };
}

/**
 * Walk a Y.XmlFragment recursively to extract plain text.
 * @param {Y.XmlFragment} fragment
 * @returns {string}
 */
function walkFragment(fragment) {
  const result = [];

  for (let i = 0; i < fragment.length; i++) {
    const node = fragment.get(i);
    if (node instanceof Y.XmlElement) {
      result.push(walkElement(node));
    } else if (node instanceof Y.XmlText) {
      result.push(node.toString());
    }
  }

  return result.join('\n');
}

/**
 * Walk a Y.XmlElement recursively to extract plain text.
 * @param {Y.XmlElement} element
 * @returns {string}
 */
function walkElement(element) {
  const result = [];

  for (let i = 0; i < element.length; i++) {
    const node = element.get(i);
    if (node instanceof Y.XmlElement) {
      result.push(walkElement(node));
    } else if (node instanceof Y.XmlText) {
      result.push(node.toString());
    }
  }

  return result.join('');
}