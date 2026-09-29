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
 *
 * Milestone D additions: POST /cancel endpoint, 'from' field on
 * /instruction, turnId in 202 response.
 */

import http from 'node:http';
import { readDoc, appendText } from './doc-client.js';
import { getConnection, handleInstruction, cancelCurrentTurn, nextTurnId, activeRooms } from './orchestrator.js';
import { fetchStreamingToken, hasAssemblyAiKey, MissingAssemblyAiKeyError, AssemblyAiTokenError } from './stt-token.js';
import { hasTavilyKey } from './search-web.js';
import { checkRateLimit } from './rate-limit.js';
import {
  ROOM, WS_URL, FIELD, INSTRUCTION_PORT, INSTRUCTION_PATH,
  STT_TOKEN_PATH, CANCEL_PATH, CORS_ORIGIN,
} from '../config.js';

// Render (and most hosts) inject the port to bind; locally there is none and
// the pinned INSTRUCTION_PORT applies (design D39, task 44.6).
const PORT = Number(process.env.PORT) || INSTRUCTION_PORT;

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

// Design D38: same treatment as ASSEMBLYAI_API_KEY — loud but non-fatal.
// search_web degrades to { available: false } and the agent says it cannot
// check; everything else keeps working.
if (!hasTavilyKey()) {
  console.warn(
    'WARNING: TAVILY_API_KEY is not set. search_web will report it cannot check; ' +
      'everything else is unaffected.',
  );
}

// The agent no longer joins a room at startup (design D41): each visitor has
// their own room, joined on demand when their first instruction arrives. The
// D4 diagnostics move with it, logged once per room on first sync.
export function watchRoom(room) {
  const { doc, provider } = getConnection(room);
  if (provider.__watched) return { doc, provider };
  provider.__watched = true;

  provider.once('synced', () => {
    console.log(`[room ${room}] synced | share keys: ${[...doc.share.keys()]} | FIELD: ${FIELD}`);
    const content = readDoc(doc);
    console.log(`[room ${room}] document: ${content.length} chars`);
    seedIfEmpty(doc, room);
  });
  return { doc, provider };
}

/**
 * Give a brand-new room something to work with (design D44).
 *
 * A judge opening a fresh link would otherwise see a blank page and have
 * nothing to instruct the agent about. Written instantly, not typed, and only
 * when the document is genuinely empty, so it can never overwrite a visitor's
 * work or double-seed after a reconnect.
 */
function seedIfEmpty(doc, room) {
  const fragment = doc.getXmlFragment(FIELD);
  if (fragment.length > 0) return;
  appendText(doc, 'This is a rough draft of the intro to our project.');
  appendText(doc, 'The team meets every Monday to plan the week.');
  console.log(`[room ${room}] seeded the starter document`);
}

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

function handleCorsPreflight(req, res, methods) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

const server = http.createServer(async (req, res) => {
  // CORS preflight for the browser's POST + JSON body.
  if (req.method === 'OPTIONS' && req.url === INSTRUCTION_PATH) {
    handleCorsPreflight(req, res, 'POST, OPTIONS');
    return;
  }

  // CORS preflight for the cancel route (design D31).
  if (req.method === 'OPTIONS' && req.url === CANCEL_PATH) {
    handleCorsPreflight(req, res, 'POST, OPTIONS');
    return;
  }

  // CORS preflight for the token route (task 24.3) — handled the same way
  // as /instruction's, per the pinned contract.
  if (req.method === 'OPTIONS' && req.url === STT_TOKEN_PATH) {
    handleCorsPreflight(req, res, 'GET, OPTIONS');
    return;
  }

  // Mint a short-lived AssemblyAI streaming token (design D19/D25). The
  // permanent ASSEMBLYAI_API_KEY never leaves this process, and neither the
  // key nor the returned token is ever logged.
  if (req.method === 'GET' && req.url === STT_TOKEN_PATH) {
    const tokenLimit = checkRateLimit(req, 'token');
    if (!tokenLimit.allowed) {
      sendJson(res, 429, { message: tokenLimit.message });
      return;
    }
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

  // POST /cancel — cancel the running turn (design D31, task 32.1).
  if (req.method === 'POST' && req.url === CANCEL_PATH) {
    // Never rate-limited: stopping the agent must always work (design D42).
    let room = ROOM;
    try {
      const raw = await readBody(req);
      if (raw) room = JSON.parse(raw).room || ROOM;
    } catch {
      // A cancel with no body, or a malformed one, still cancels the default room.
    }
    const { cancelled } = cancelCurrentTurn(room);
    sendJson(res, 200, { cancelled });
    return;
  }

  if (req.method !== 'POST' || req.url !== INSTRUCTION_PATH) {
    sendJson(res, 404, { message: `not found: ${req.method} ${req.url}` });
    return;
  }

  const instructionLimit = checkRateLimit(req, 'instruction');
  if (!instructionLimit.allowed) {
    sendJson(res, 429, { message: instructionLimit.message });
    return;
  }

  let text, from, room;
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    text = body.text;
    from = body.from ?? null;
    room = body.room || ROOM;
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
    const turnId = nextTurnId();
    const { provider } = watchRoom(room);
    handleInstruction(text, { from, provider, turnId, room })
      .then((result) => {
        if (result.ok) console.log(`[orchestrator] done: "${text}" (room: ${room}, turnId: ${result.turnId})`);
        else console.warn(`[orchestrator] failed: "${text}" — ${result.error} (turnId: ${result.turnId})`, result.message ?? '');
      })
      .catch((err) => {
        console.error('[orchestrator] instruction crashed:', err);
      });

    // Task 32.2: return turnId in the 202 body.
    sendJson(res, 202, { accepted: true, turnId });
  } catch (err) {
    sendJson(res, 500, { message: err.message || 'orchestrator failed to accept instruction' });
  }
});

server.listen(PORT, () => {
  console.log(`Agent listening on port ${PORT} — ${INSTRUCTION_PATH}, ${CANCEL_PATH}, ${STT_TOKEN_PATH}`);
  console.log(`Accepting browsers from ${CORS_ORIGIN}; relay ${WS_URL}`);
});

process.on('SIGINT', () => {
  console.log(`Disconnecting (${activeRooms().length} room(s) open)...`);
  server.close();
  for (const room of activeRooms()) {
    const { provider, doc } = getConnection(room);
    provider.disconnect();
    doc.destroy();
  }
  process.exit(0);
});

console.log('Press Ctrl+C to disconnect');
