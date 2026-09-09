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
    color: '#9b59b6', // Purple colour reserved for server participant
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