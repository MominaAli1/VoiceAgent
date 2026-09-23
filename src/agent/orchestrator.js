/**
 * Orchestrator: turns one typed instruction into (at most) one document
 * edit, via Groq's tool-calling loop.
 *
 * `handleInstruction(text)` was the pinned entry point through Milestone C
 * (shared contract, Milestone B): `(text) => Promise`. It still works
 * exactly that way and is kept for callers (the harness) that only need the
 * eventual result.
 *
 * Milestone D (design D27/D28) needs the turnId synchronously, before the
 * instruction endpoint's HTTP response is sent, and needs a running turn to
 * be cancellable. `startInstruction(text, opts)` is the new entry point for
 * that: it mints the turn and returns `{ turnId, done }` immediately, the
 * turn itself running in the background exactly as before.
 */

import { connect, readDoc, editDoc } from './doc-client.js';
import { chat, SYSTEM_PROMPT, RateLimitError } from './llm-client.js';
import { randomUUID } from 'node:crypto';

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
// persistence.
const history = [];

let connection = null;

/**
 * The one turn currently in flight, or null. Only one at a time (design
 * D28): starting a new turn cancels whatever is here first.
 * @type {{ turnId: string, from: string|null, cancelled: boolean, abort: AbortController } | null}
 */
let currentTurn = null;

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
 * @param {{ cancelled: boolean }} turn - `edit_doc`'s insertion checks
 *   `turn.cancelled` between chunks (design D30).
 * @returns {Promise<{ result: any, editedDocument: boolean }>}
 */
async function dispatchTool(doc, fn, turn) {
  let args;
  try {
    args = JSON.parse(fn.arguments || '{}');
  } catch {
    return { result: { ok: false, error: 'malformed tool arguments (invalid JSON)' }, editedDocument: false };
  }

  if (fn.name === 'edit_doc') {
    const result = await editDoc(doc, args.find, args.replace, { isCancelled: () => turn.cancelled });
    return { result, editedDocument: Boolean(result.ok) };
  }

  if (fn.name === 'search_web') {
    return { result: SEARCH_WEB_STUB_RESPONSE, editedDocument: false };
  }

  return { result: { ok: false, error: `unknown tool: ${fn.name}` }, editedDocument: false };
}

/**
 * Cancel whatever turn is currently running.
 * @returns {boolean} whether there was a running turn to cancel — the
 *   `/cancel` endpoint's `{ cancelled }` body (design D28, task 32.3).
 */
export function cancelCurrentTurn() {
  if (!currentTurn || currentTurn.cancelled) return false;
  currentTurn.cancelled = true;
  currentTurn.abort.abort();
  return true;
}

/**
 * Publish a reply on the Assistant's awareness `reply` field, per the
 * pinned shape (design D27): only the tab whose `clientID` matches `to`
 * speaks it, every tab may display it.
 * @param {import('y-websocket').WebsocketProvider} provider
 * @param {{ turnId: string, from: string|null }} turn
 * @param {string} text
 * @param {boolean} final
 */
function publishReply(provider, turn, text, final) {
  provider.awareness.setLocalStateField('reply', {
    to: turn.from,
    turnId: turn.turnId,
    text,
    final,
    at: Date.now(),
  });
}

/**
 * Start a new instruction: cancel any currently running turn first (design
 * D28 — "the user always wins", enforced here so it holds even if the
 * browser never sends `POST /cancel`), mint a turnId synchronously, and run
 * the Groq tool-calling loop in the background.
 *
 * @param {string} text
 * @param {{ from?: string }} [opts] - `from` is the instructing tab's
 *   awareness clientID (design D27); omit it and the reply is published to
 *   nobody in particular and simply isn't spoken.
 * @returns {{ turnId: string, done: Promise<{ ok: true, spoke?: boolean } | { ok: false, error: string }> }}
 */
export function startInstruction(text, opts = {}) {
  cancelCurrentTurn();

  const turn = {
    turnId: randomUUID(),
    from: opts.from ?? null,
    cancelled: false,
    abort: new AbortController(),
  };
  currentTurn = turn;

  return { turnId: turn.turnId, done: runTurn(turn, text) };
}

/**
 * Milestone B/C's pinned entry point, kept for callers (the harness) that
 * only need the eventual result: `(text) => Promise`.
 * @param {string} text
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function handleInstruction(text) {
  return startInstruction(text).done;
}

/**
 * Run one turn end to end: read the live document, send it plus the
 * instruction and conversation history to Groq, dispatch any tool calls,
 * and retry (up to MAX_ATTEMPTS total) until the document changes, the
 * model answers in plain text, the turn is cancelled, or attempts are
 * exhausted.
 *
 * @param {{ turnId: string, from: string|null, cancelled: boolean, abort: AbortController }} turn
 * @param {string} text
 * @returns {Promise<{ ok: true, spoke?: boolean } | { ok: false, error: string }>}
 */
async function runTurn(turn, text) {
  const { doc, provider } = getConnection();

  const docText = readDoc(doc);
  history.push({ role: 'user', content: buildUserMessage(text, docText) });

  let documentChanged = false;
  let lastToolError = null;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (turn.cancelled) break;

      let completion;
      try {
        completion = await chat([{ role: 'system', content: SYSTEM_PROMPT }, ...history], {
          signal: turn.abort.signal,
        });
      } catch (err) {
        // Cancelling aborts the in-flight request (design D28/D30); that
        // rejection is expected and is not a failure.
        if (turn.cancelled) break;
        if (err instanceof RateLimitError) {
          return { ok: false, error: 'rate_limited', message: err.message };
        }
        throw err;
      }

      const message = completion.choices[0].message;
      history.push(message);

      const toolCalls = message.tool_calls ?? [];
      const content = (message.content ?? '').trim();

      if (toolCalls.length === 0) {
        // Design D29: a plain-text reply with content ends the turn as an
        // answer — it is spoken, not treated as a failure to call a tool.
        if (content) {
          publishReply(provider, turn, content, true);
          return { ok: true, spoke: true };
        }
        if (documentChanged) {
          return { ok: true };
        }
        // No tool call, no content, no document change yet — re-prompt
        // once, explicitly requiring a tool call (design D14). This
        // consumes one of the shared MAX_ATTEMPTS attempts, same as a
        // wrong `find` string would.
        history.push({
          role: 'user',
          content:
            'You must call a tool (edit_doc or search_web) to make progress on this instruction. ' +
            'Respond only with a tool call, not plain text.',
        });
        continue;
      }

      // Design D29/D27: content alongside tool calls is spoken immediately,
      // fire-and-forget, while the tool(s) run — the brief's "speak text
      // blocks first".
      if (content) {
        publishReply(provider, turn, content, false);
      }

      for (const toolCall of toolCalls) {
        if (turn.cancelled) break;
        const { result, editedDocument } = await dispatchTool(doc, toolCall.function, turn);
        if (editedDocument) documentChanged = true;
        if (!editedDocument && result && result.ok === false) lastToolError = result.error;

        history.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      if (turn.cancelled) break;

      if (documentChanged) {
        return { ok: true };
      }
    }
  } finally {
    if (currentTurn === turn) currentTurn = null;
  }

  if (turn.cancelled) {
    // Design D28: conversation history keeps the cancelled turn plus this
    // note, so "finish that paragraph" has something to refer to.
    history.push({ role: 'system', content: '[interrupted by the user]' });
    return { ok: false, error: 'cancelled' };
  }

  return {
    ok: false,
    error: lastToolError
      ? `retries exhausted after ${MAX_ATTEMPTS} attempts: ${lastToolError}`
      : `retries exhausted after ${MAX_ATTEMPTS} attempts`,
  };
}
