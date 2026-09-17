/**
 * Throttled insertion — new text streams into the document a few characters
 * at a time instead of appearing as one instant write, so it reads as typed
 * rather than pasted (design.md D17, Milestone B).
 *
 * Used by both the append path (typeIntoNewParagraph) and edit_doc's
 * replacement step (typeIntoParagraph, Rumaisa's Track B — not built yet).
 * This module has no dependency on Groq or the orchestrator; it only
 * touches the Y.Doc via the same getXmlFragment(FIELD) machinery as
 * doc-client.js and seed-harness.js.
 */

import * as Y from 'yjs';
import { FIELD } from '../config.js';

const DEFAULT_CHUNK_SIZE = 3;
const DEFAULT_DELAY_MS = 35;

/**
 * Create a new paragraph at the end of the document and stream `text` into
 * it a few characters at a time.
 *
 * @param {Y.Doc} doc
 * @param {string} text
 * @param {{ chunkSize?: number, delayMs?: number }} [opts]
 * @returns {Promise<void>} resolves once every chunk has been inserted
 */
export async function typeIntoNewParagraph(doc, text, opts = {}) {
  const { chunkSize = DEFAULT_CHUNK_SIZE, delayMs = DEFAULT_DELAY_MS } = opts;

  const fragment = doc.getXmlFragment(FIELD);
  const paragraph = new Y.XmlElement('paragraph');
  // Insert an empty text node structurally first (append semantics, same as
  // doc-client.js's appendText), then stream characters into it below —
  // never a bare text node at fragment level.
  const textNode = new Y.XmlText();
  paragraph.insert(0, [textNode]);
  fragment.insert(fragment.length, [paragraph]);

  await typeChunks(textNode, 0, text, chunkSize, delayMs);
}

/**
 * Stream `text` into an existing paragraph's text node at `offset`, a few
 * characters at a time. Used by edit_doc after it deletes the matched range
 * (deletion itself is instant and un-throttled — only insertion streams).
 *
 * @param {Y.Doc} doc
 * @param {number} paragraphIndex index of the target paragraph within the
 *   document fragment
 * @param {number} offset character offset within the paragraph's own text
 *   to start inserting at
 * @param {string} text
 * @param {{ chunkSize?: number, delayMs?: number }} [opts]
 * @returns {Promise<void>} resolves once every chunk has been inserted
 */
export async function typeIntoParagraph(doc, paragraphIndex, offset, text, opts = {}) {
  const { chunkSize = DEFAULT_CHUNK_SIZE, delayMs = DEFAULT_DELAY_MS } = opts;

  const fragment = doc.getXmlFragment(FIELD);
  const paragraph = fragment.get(paragraphIndex);
  if (!(paragraph instanceof Y.XmlElement)) {
    throw new Error(`typeIntoParagraph: no paragraph at index ${paragraphIndex}`);
  }
  const textNode = soleTextNode(paragraph);

  await typeChunks(textNode, offset, text, chunkSize, delayMs);
}

/**
 * Insert `text` into `textNode` starting at `startOffset`, one chunk at a
 * time, each its own Yjs transaction (its own `insert` call), waiting
 * `delayMs` between chunks. This — not one instant insert — is the entire
 * point of this module: remote peers observe each chunk arrive over the
 * existing update broadcast, so no separate "typing indicator" protocol is
 * needed (design D17).
 */
async function typeChunks(textNode, startOffset, text, chunkSize, delayMs) {
  let offset = startOffset;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    textNode.insert(offset, chunk);
    offset += chunk.length;
    if (i + chunkSize < text.length) {
      await sleep(delayMs);
    }
  }
}

/**
 * Find the paragraph's single text-bearing child. Throws rather than
 * silently picking one if there's more than one (or none) — per design D15,
 * a paragraph with more than one Y.XmlText child (e.g. from future
 * formatting/marks) is a loud error, not something to guess through.
 */
function soleTextNode(paragraph) {
  let found = null;
  for (let i = 0; i < paragraph.length; i++) {
    const child = paragraph.get(i);
    if (child instanceof Y.XmlText) {
      if (found) {
        throw new Error('soleTextNode: paragraph has more than one text-bearing child');
      }
      found = child;
    }
  }
  if (!found) {
    throw new Error('soleTextNode: paragraph has no text-bearing child');
  }
  return found;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
