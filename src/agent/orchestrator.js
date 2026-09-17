/**
 * Orchestrator: turns one typed instruction into (at most) one document
 * edit, via Groq's tool-calling loop.
 *
 * `handleInstruction(text)` is the pinned entry point (shared contract,
 * Milestone B) — Days 7-9's speech input is expected to call this
 * unchanged, so its signature stays exactly `(text) => Promise`.
 */

import { connect, readDoc, editDoc } from './doc-client.js';
import { chat, SYSTEM_PROMPT, RateLimitError } from './llm-client.js';

/** Retry cap per instruction, shared across all failure modes (design D14). */
const MAX_ATTEMPTS = 3;

/** Document cap sent to the model, in words (design D18). */
const MAX_WORDS = 2000;

/** search_web stub response, pinned by the shared contract. */
const SEARCH_WEB_STUB_RESPONSE = {
  available: false,
  message: 'Web search is not available yet.',
};

// In-memory conversation history for the life of the process — no
// persistence, no speaking/cancelled state (out of scope this milestone).
const history = [];

let connection = null;

/**
 * Lazily connect once and reuse the same participant connection across
 * every instruction — a single "Assistant" presence for the process rather
 * than one connection per call. `src/agent/index.js` reuses this same
 * connection for its own diagnostic logging instead of opening a second one.
 * @returns {{ doc: import('yjs').Doc, provider: import('y-websocket').WebsocketProvider }}
 */
export function getConnection() {
  if (!connection) {
    connection = connect();
  }
  return connection;
}

/**
 * Cap `text` to its last `maxWords` words, flagging whether truncation
 * occurred (design D18 — truncate from the start, keep the tail).
 * @param {string} text
 * @param {number} maxWords
 * @returns {{ text: string, truncated: boolean }}
 */
function capToTail(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return { text, truncated: false };
  }
  return { text: words.slice(-maxWords).join(' '), truncated: true };
}

function buildUserMessage(instruction, docText) {
  const { text: docView, truncated } = capToTail(docText, MAX_WORDS);
  const note = truncated
    ? 'Note: the document exceeds 2,000 words; only the last 2,000 words are shown below.\n\n'
    : '';
  return (
    `${note}Current document:\n"""\n${docView}\n"""\n\n` +
    `Instruction: ${instruction}`
  );
}

/**
 * Execute a single tool call and return its JSON-serializable result.
 * @param {import('yjs').Doc} doc
 * @param {{ name: string, arguments: string }} fn
 * @returns {Promise<{ result: any, editedDocument: boolean }>}
 */
async function dispatchTool(doc, fn) {
  let args;
  try {
    args = JSON.parse(fn.arguments || '{}');
  } catch {
    return { result: { ok: false, error: 'malformed tool arguments (invalid JSON)' }, editedDocument: false };
  }

  if (fn.name === 'edit_doc') {
    const result = await editDoc(doc, args.find, args.replace);
    return { result, editedDocument: Boolean(result.ok) };
  }

  if (fn.name === 'search_web') {
    return { result: SEARCH_WEB_STUB_RESPONSE, editedDocument: false };
  }

  return { result: { ok: false, error: `unknown tool: ${fn.name}` }, editedDocument: false };
}

/**
 * Handle one typed instruction end to end: read the live document, send it
 * plus the instruction and conversation history to Groq, dispatch any tool
 * calls, and retry (up to MAX_ATTEMPTS total) until the document changes or
 * attempts are exhausted.
 *
 * @param {string} text
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function handleInstruction(text) {
  const { doc } = getConnection();

  const docText = readDoc(doc);
  history.push({ role: 'user', content: buildUserMessage(text, docText) });

  let documentChanged = false;
  let lastToolError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let completion;
    try {
      completion = await chat([{ role: 'system', content: SYSTEM_PROMPT }, ...history]);
    } catch (err) {
      if (err instanceof RateLimitError) {
        return { ok: false, error: 'rate_limited', message: err.message };
      }
      throw err;
    }

    const message = completion.choices[0].message;
    history.push(message);

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      if (documentChanged) {
        return { ok: true };
      }
      // No tool call, no document change yet — re-prompt once, explicitly
      // requiring a tool call (design D14). This consumes one of the
      // shared MAX_ATTEMPTS attempts, same as a wrong `find` string would.
      history.push({
        role: 'user',
        content:
          'You must call a tool (edit_doc or search_web) to make progress on this instruction. ' +
          'Respond only with a tool call, not plain text.',
      });
      continue;
    }

    for (const toolCall of toolCalls) {
      const { result, editedDocument } = await dispatchTool(doc, toolCall.function);
      if (editedDocument) documentChanged = true;
      if (!editedDocument && result && result.ok === false) lastToolError = result.error;

      history.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    if (documentChanged) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    error: lastToolError
      ? `retries exhausted after ${MAX_ATTEMPTS} attempts: ${lastToolError}`
      : `retries exhausted after ${MAX_ATTEMPTS} attempts`,
  };
}
