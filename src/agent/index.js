/**
 * Entry point for the dev:agent script.
 *
 * This file serves as the main entry point for the server-side participant.
 * It imports from doc-client.js and runs the main logic.
 */

import { connect, readDoc, appendText } from './doc-client.js';
import { ROOM, WS_URL, FIELD } from '../config.js';

console.log('Starting server-side participant...');
console.log(`Connecting to ${WS_URL} in room ${ROOM}`);

const { doc, provider } = connect();

provider.on('synced', () => {
  console.log('Synced with relay');
  console.log(`Share keys: ${[...doc.share.keys()]}`);
  console.log(`FIELD: ${FIELD}`);

  const content = readDoc(doc);
  console.log(`Initial document content (${content.length} chars):`);
  console.log(content);

  appendText(doc, 'Appended by Assistant');
  console.log('\nAppended marker line: "Appended by Assistant"');
  console.log('Updated document content:');
  console.log(readDoc(doc));
});

provider.on('status', (event) => {
  console.log(`Connection status: ${event.status}`);
});

process.on('SIGINT', () => {
  console.log('Disconnecting...');
  provider.disconnect();
  doc.destroy();
  process.exit(0);
});

console.log('Press Ctrl+C to disconnect');
