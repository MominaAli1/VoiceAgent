/**
 * Throttled insertion into the shared Yjs document.
 *
 * --- Milestone B shared-contract handoff ---
 * Per the pinned contract in
 * openspec/changes/collaborative-document/tasks.md, this file's two public
 * signatures are pushed early so Track B's `edit_doc` (task 15) can import
 * them without waiting for the throttling to be tuned. Defaults below match
 * design D17 exactly (chunk size 3, delay 35ms); tuning those defaults for
 * feel, and Gate A (task 13.1)'s standalone proof against the relay, remain
 * Momina's Track A work and are not performed here.
 *
 * Each chunk is inserted as its own `Y.XmlText.insert` call — its own Yjs
 * transaction — so remote peers see the text arrive incrementally rather
 * than as a single write. Deletion is never throttled (design D17); only
 * insertion streams in chunks.
 *
 * --- Milestone D addition (design D30) ---
 * Both public functions accept `opts.isCancelled`, a `() => boolean` checked
 * between chunks, and resolve to `{ completed, insertedChars }` instead of
 * `undefined` so a caller (the orchestrator) can tell a cancelled turn from
 * a finished one. A cancel lands within one chunk (~35 ms at the pinned
 * defaults) — well inside the barge-in's 200 ms budget.
 */

import * as Y from 'yjs';
import { FIELD } from '../config.js';

const DEFAULT_CHUNK_SIZE = 3;
const DEFAULT_DELAY_MS = 35;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split `text` into chunks of `chunkSize` characters, preserving order.
 * @param {string} text
 * @param {number} chunkSize
 * @returns {string[]}
 */
function chunk(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Create a new paragraph at the end of the shared fragment, then stream
 * `text` into its Y.XmlText in chunks.
 *
 * @param {Y.Doc} doc
 * @param {string} text
 * @param {{ chunkSize?: number, delayMs?: number, field?: string, isCancelled?: () => boolean }} [opts]
 * @returns {Promise<{ completed: boolean, insertedChars: number }>}
 */
export async function typeIntoNewParagraph(doc, text, opts = {}) {
  const { chunkSize = DEFAULT_CHUNK_SIZE, delayMs = DEFAULT_DELAY_MS, field = FIELD, isCancelled } = opts;

  const fragment = doc.getXmlFragment(field);
  const paragraph = new Y.XmlElement('paragraph');
  const textNode = new Y.XmlText();
  paragraph.insert(0, [textNode]);
  fragment.insert(fragment.length, [paragraph]);

  return streamInto(textNode, text, chunkSize, delayMs, undefined, isCancelled);
}

/**
 * Insert `text` into an existing paragraph's Y.XmlText at `offset`, in
 * chunks, starting immediately after `offset`.
 *
 * @param {Y.Doc} doc
 * @param {number} paragraphIndex - Index of the paragraph within the shared fragment
 * @param {number} offset - Character offset within the paragraph's text to insert after
 * @param {string} text
 * @param {{ chunkSize?: number, delayMs?: number, field?: string, isCancelled?: () => boolean }} [opts]
 * @returns {Promise<{ completed: boolean, insertedChars: number }>}
 */
export async function typeIntoParagraph(doc, paragraphIndex, offset, text, opts = {}) {
  const { chunkSize = DEFAULT_CHUNK_SIZE, delayMs = DEFAULT_DELAY_MS, field = FIELD, isCancelled } = opts;

  const fragment = doc.getXmlFragment(field);
  const paragraph = fragment.get(paragraphIndex);
  if (!(paragraph instanceof Y.XmlElement)) {
    throw new Error(`typeIntoParagraph: no paragraph at index ${paragraphIndex}`);
  }

  const textNode = paragraph.get(0);
  if (!(textNode instanceof Y.XmlText)) {
    throw new Error(`typeIntoParagraph: paragraph ${paragraphIndex} has no Y.XmlText child`);
  }

  return streamInto(textNode, text, chunkSize, delayMs, offset, isCancelled);
}

/**
 * Insert `text` into `textNode` in chunks, each its own transaction.
 * Checked between chunks (design D30): a cancel stops the loop before the
 * next chunk is inserted, keeping whatever was already typed and dropping
 * the rest — never auto-resumed, never erased.
 * @param {Y.XmlText} textNode
 * @param {string} text
 * @param {number} chunkSize
 * @param {number} delayMs
 * @param {number} [startOffset] - Defaults to the end of the current text
 * @param {() => boolean} [isCancelled]
 * @returns {{ completed: boolean, insertedChars: number }}
 */
async function streamInto(textNode, text, chunkSize, delayMs, startOffset, isCancelled) {
  const start = startOffset ?? textNode.length;
  let position = start;
  const chunks = chunk(text, chunkSize);

  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled?.()) {
      return { completed: false, insertedChars: position - start };
    }

    const piece = chunks[i];
    textNode.insert(position, piece);
    position += piece.length;

    if (i < chunks.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return { completed: true, insertedChars: position - start };
}
