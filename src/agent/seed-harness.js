/**
 * Standalone verification harness for Track B.
 *
 * This stands in for the browser: it writes the same fragment structure
 * Tiptap writes, proving the room and transport work independently of
 * the browser.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { ROOM, WS_URL, FIELD } from '../config.js';

/**
 * Create a Y.Doc and WebsocketProvider joining the same room.
 * @returns {{ doc: Y.Doc, provider: WebsocketProvider }}
 */
export function createHarness() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, ROOM, doc, {
    // Supply ws implementation for Node
    WebSocket,
  });

  return { doc, provider };
}

/**
 * Seed the document with fixture text.
 * Inserts Y.XmlElement('paragraph') nodes containing Y.XmlText,
 * exactly as Tiptap's binding would.
 *
 * @param {Y.Doc} doc
 * @param {string[]} paragraphs - Array of paragraph texts to insert
 */
export function seedDocument(doc, paragraphs) {
  const fragment = doc.getXmlFragment(FIELD);

  // Clear existing content
  fragment.delete(0, fragment.length);

  // Insert each paragraph as a Y.XmlElement('paragraph') containing Y.XmlText
  for (const text of paragraphs) {
    const paragraph = new Y.XmlElement('paragraph');
    const textNode = new Y.XmlText(text);
    paragraph.insert(0, [textNode]);
    fragment.insert(fragment.length, [paragraph]);
  }
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

// Runnable entry point
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('seed-harness.js') ||
  process.argv[1].endsWith('seed-harness')
);

if (isMainModule) {
  const fixtureText = [
    'This is the first paragraph of fixture text.',
    'This is the second paragraph, providing multi-paragraph content for testing.',
    'And a third paragraph to ensure proper handling of multiple blocks.',
  ];

  console.log('Starting seed harness...');
  console.log(`Connecting to ${WS_URL} in room ${ROOM}`);

  const { doc, provider } = createHarness();

  provider.on('synced', () => {
    console.log('Synced with relay');
    console.log(`Share keys: ${[...doc.share.keys()]}`);
    console.log(`FIELD: ${FIELD}`);

    seedDocument(doc, fixtureText);
    console.log('Seeded document with fixture text:');
    console.log(readDoc(doc));
  });

  provider.on('status', (event) => {
    console.log(`Connection status: ${event.status}`);
  });

  // Keep the process running
  process.on('SIGINT', () => {
    console.log('Disconnecting...');
    provider.disconnect();
    doc.destroy();
    process.exit(0);
  });

  console.log('Press Ctrl+C to disconnect');
}