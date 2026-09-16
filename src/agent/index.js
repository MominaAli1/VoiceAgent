/**
 * Entry point for the dev:agent script.
 *
 * Connects the server-side participant, logs the D1/D4 sync diagnostics,
 * and starts the instruction HTTP endpoint (design D16) that feeds typed
 * instructions into the orchestrator's tool-calling loop.
 *
 * Milestone B behavior change from Milestone A: this process no longer
 * appends the hardcoded "Appended by Assistant" marker line on startup —
 * the orchestrator loop is now the only source of document edits from the
 * agent process (task 16.5).
 */

import http from 'node:http';
import { readDoc } from './doc-client.js';
import { getConnection, handleInstruction } from './orchestrator.js';
import { ROOM, WS_URL, FIELD, INSTRUCTION_PORT, INSTRUCTION_PATH } from '../config.js';

const CORS_ORIGIN = 'http://localhost:5173';

console.log('Starting server-side participant...');
console.log(`Connecting to ${WS_URL} in room ${ROOM}`);

const { doc, provider } = getConnection();

provider.on('synced', () => {
  console.log('Synced with relay');
  console.log(`Share keys: ${[...doc.share.keys()]}`);
  console.log(`FIELD: ${FIELD}`);

  const content = readDoc(doc);
  console.log(`Initial document content (${content.length} chars):`);
  console.log(content);
});

provider.on('status', (event) => {
  console.log(`Connection status: ${event.status}`);
});

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight for the browser's POST + JSON body.
  if (req.method === 'OPTIONS' && req.url === INSTRUCTION_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== INSTRUCTION_PATH) {
    sendJson(res, 404, { message: `not found: ${req.method} ${req.url}` });
    return;
  }

  let text;
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    text = body.text;
  } catch {
    sendJson(res, 400, { message: 'invalid JSON body' });
    return;
  }

  if (typeof text !== 'string' || text.trim() === '') {
    sendJson(res, 400, { message: 'missing or empty "text" field' });
    return;
  }

  try {
    // Fire-and-forget: the response does not block on the orchestrator
    // finishing (design D16). The instruction's outcome is observed
    // through the document itself, the same way any other participant's
    // edit is.
    handleInstruction(text).catch((err) => {
      console.error('[orchestrator] instruction failed:', err);
    });
    sendJson(res, 202, { accepted: true });
  } catch (err) {
    sendJson(res, 500, { message: err.message || 'orchestrator failed to accept instruction' });
  }
});

server.listen(INSTRUCTION_PORT, () => {
  console.log(`Instruction endpoint listening on http://localhost:${INSTRUCTION_PORT}${INSTRUCTION_PATH}`);
});

process.on('SIGINT', () => {
  console.log('Disconnecting...');
  server.close();
  provider.disconnect();
  doc.destroy();
  process.exit(0);
});

console.log('Press Ctrl+C to disconnect');
