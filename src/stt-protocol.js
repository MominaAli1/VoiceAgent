/**
 * AssemblyAI v3 streaming protocol, shared by the browser client
 * (src/web/stt.js) and the Node harness (src/agent/stt-harness.js).
 *
 * Environment-neutral on purpose: no Node built-ins and no DOM, so both sides
 * import this same file. Shape pinned by the Milestone C shared contract in
 * openspec/changes/collaborative-document/tasks.md.
 */

import {
  STT_WS_URL,
  STT_SAMPLE_RATE,
  STT_SPEECH_MODEL,
  STT_SERVER_IDLE_TIMEOUT_S,
} from './config.js';

/** Ask the server to end the current turn now (sent on push-to-talk release). */
export const FORCE_ENDPOINT = JSON.stringify({ type: 'ForceEndpoint' });

/** End the session. Billing runs until this is sent or the server times out (design D20). */
export const TERMINATE = JSON.stringify({ type: 'Terminate' });

const KNOWN_TYPES = new Set(['Begin', 'Turn', 'SpeechStarted', 'Termination']);

/**
 * The streaming socket URL for a temporary token. The token goes in the query
 * string because browsers cannot set headers on a WebSocket (design D19).
 *
 * @param {string} token
 * @returns {string}
 */
export function buildStreamUrl(token) {
  const params = new URLSearchParams({
    sample_rate: String(STT_SAMPLE_RATE),
    encoding: 'pcm_s16le',
    speech_model: STT_SPEECH_MODEL,
    inactivity_timeout: String(STT_SERVER_IDLE_TIMEOUT_S),
    token,
  });
  return `${STT_WS_URL}?${params}`;
}

/**
 * Parse one server message. Returns the object for the message types this
 * project uses, and `null` for anything else — unknown types, binary data,
 * malformed JSON. Never throws.
 *
 * @param {unknown} data
 * @returns {object | null}
 */
export function parseServerMessage(data) {
  if (typeof data !== 'string') return null;
  try {
    const message = JSON.parse(data);
    return message && KNOWN_TYPES.has(message.type) ? message : null;
  } catch {
    return null;
  }
}

/**
 * Keep the latest message for each `turn_order`, in turn order. A later
 * message for the same turn supersedes an earlier one, including a formatted
 * repeat of an unformatted end of turn (design D23).
 *
 * @param {object[]} turns `Turn` messages, in arrival order
 * @returns {object[]}
 */
export function latestTurns(turns) {
  const byOrder = new Map();
  for (const turn of turns) byOrder.set(turn.turn_order, turn);
  return [...byOrder.values()].sort((a, b) => a.turn_order - b.turn_order);
}

/**
 * One instruction from every completed turn inside a press (design D23):
 * latest message per turn, end-of-turn only, in order, joined with spaces.
 * Partials-only input returns an empty string.
 *
 * @param {object[]} turns `Turn` messages, in arrival order
 * @returns {string}
 */
export function assembleUtterance(turns) {
  return latestTurns(turns)
    .filter((turn) => turn.end_of_turn)
    .map((turn) => turn.transcript.trim())
    .filter(Boolean)
    .join(' ');
}
