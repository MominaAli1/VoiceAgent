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
import { getConnection, startInstruction, cancelCurrentTurn } from './orchestrator.js';
import { fetchStreamingToken, hasAssemblyAiKey, MissingAssemblyAiKeyError, AssemblyAiTokenError } from './stt-token.js';
import { ROOM, WS_URL, FIELD, INSTRUCTION_PORT, INSTRUCTION_PATH, STT_TOKEN_PATH, CANCEL_PATH } from '../config.js';

const CORS_ORIGIN = 'http://localhost:5173';

console.log('Starting server-side participant...');
console.log(`Connecting to ${WS_URL} in room ${ROOM}`);

// Design D25: a missing AssemblyAI key is loud but non-fatal — the typed
// path (and Groq, checked separately in llm-client.js) must keep working
// without speech. Warn once at startup rather than failing every /stt-token
// request silently.
if (!hasAssemblyAiKey()) {
  console.warn(
    'WARNING: ASSEMBLYAI_API_KEY is not set. Push-to-talk will show an error; ' +
      `typed instructions on ${INSTRUCTION_PATH} are unaffected.`,
  );
}

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

  // CORS preflight for the token route (task 24.3) — handled the same way
  // as /instruction's, per the pinned contract.
  if (req.method === 'OPTIONS' && req.url === STT_TOKEN_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // CORS preflight for the cancel route (design D28, task 32.1) — handled
  // exactly like /instruction's, per the pinned Milestone D contract.
  if (req.method === 'OPTIONS' && req.url === CANCEL_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Cancel the currently running turn, if any (design D28). Not running is
  // not an error — `{ cancelled: false }` is a normal, expected response
  // (task 32.3).
  if (req.method === 'POST' && req.url === CANCEL_PATH) {
    const cancelled = cancelCurrentTurn();
    sendJson(res, 200, { cancelled });
    return;
  }

  // Mint a short-lived AssemblyAI streaming token (design D19/D25). The
  // permanent ASSEMBLYAI_API_KEY never leaves this process, and neither the
  // key nor the returned token is ever logged.
  if (req.method === 'GET' && req.url === STT_TOKEN_PATH) {
    try {
      const { token } = await fetchStreamingToken();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      });
      res.end(JSON.stringify({ token }));
    } catch (err) {
      if (err instanceof MissingAssemblyAiKeyError) {
        sendJson(res, 503, { message: err.message });
      } else if (err instanceof AssemblyAiTokenError) {
        console.error('[stt-token] AssemblyAI rejected the token request:', err.message);
        sendJson(res, 502, { message: 'AssemblyAI token request failed' });
      } else {
        console.error('[stt-token] unexpected error:', err);
        sendJson(res, 502, { message: 'AssemblyAI token request failed' });
      }
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== INSTRUCTION_PATH) {
    sendJson(res, 404, { message: `not found: ${req.method} ${req.url}` });
    return;
  }

  let text, from;
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    text = body.text;
    // Additive, optional (design D27): the instructing tab's awareness
    // clientID. A body without it stays valid — the harness sends none —
    // and simply produces a reply nobody speaks.
    from = typeof body.from === 'string' ? body.from : undefined;
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
    // finishing (design D16). The outcome is logged here and published on
    // the Assistant's awareness state as `lastResult`, so every tab can show
    // whether the instruction worked instead of failing silently.
    const publishResult = (ok, error) => {
      provider.awareness.setLocalStateField('lastResult', { text, ok, error, at: Date.now() });
    };
    const { turnId, done } = startInstruction(text, { from });
    done
      .then((result) => {
        if (result.ok) console.log(`[orchestrator] done: "${text}"`);
        else if (result.error === 'cancelled') console.log(`[orchestrator] cancelled: "${text}"`);
        else console.warn(`[orchestrator] failed: "${text}" — ${result.error}`, result.message ?? '');
        publishResult(result.ok, result.error ?? null);
      })
      .catch((err) => {
        console.error('[orchestrator] instruction crashed:', err);
        publishResult(false, err.message);
      });
    sendJson(res, 202, { accepted: true, turnId });
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
