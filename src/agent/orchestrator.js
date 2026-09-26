/**
 * Orchestrator: turns one typed instruction into (at most) one document
 * edit, via Groq's tool-calling loop.
 *
 * `handleInstruction(text, opts)` is the pinned entry point (shared contract,
 * Milestone B) — Days 7-9's speech input is expected to call this
 * unchanged, so its signature stays exactly `(text, opts?) => Promise`.
 *
 * Milestone D additions: turn state (one turn at a time), cancellation
 * via AbortController, and reply publishing on awareness.
 */

import { connect, readDoc, editDoc, appendDoc } from './doc-client.js';
import { chat, SYSTEM_PROMPT, RateLimitError } from './llm-client.js';
import { searchWeb } from './search-web.js';
import { SEARCH_ACK, SEARCH_MAX_PER_TURN } from '../config.js';

/** Retry cap per instruction, shared across all failure modes (design D14). */
const MAX_ATTEMPTS = 3;

/** Document cap sent to the model, in words (design D18). */
const MAX_WORDS = 2000;

// In-memory conversation history for the life of the process.
const history = [];

let connection = null;

/**
 * Current turn state (design D28). Only one turn runs at a time.
 * A new instruction cancels the running turn before starting.
 * @type {{ turnId: string, from: number|null, abort: AbortController, cancelled: boolean } | null}
 */
let currentTurn = null;

/** Monotonic turn counter for generating unique turnIds. */
let turnCounter = 0;

/**
 * Generate the next turnId. Exported so index.js can peek at it for the
 * 202 response body.
 * @returns {string}
 */
export function nextTurnId() {
  return `turn-${turnCounter + 1}`;
}

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
 * Cancel the currently running turn, if any (design D28).
 * @returns {{ cancelled: boolean }}
 */
export function cancelCurrentTurn() {
  if (!currentTurn) {
    return { cancelled: false };
  }
  currentTurn.cancelled = true;
  currentTurn.abort.abort();
  return { cancelled: true };
}

/**
 * Get the current turn state (for diagnostics).
 * @returns {typeof currentTurn}
 */
export function getCurrentTurn() {
  return currentTurn;
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
 * @param {{ isCancelled?: () => boolean, signal?: AbortSignal }} [opts]
 *   `isCancelled` threads into `edit_doc`/`append_doc`'s throttled insertion
 *   (design D30); `signal` is the turn's `AbortSignal`, passed to
 *   `search_web` so a barge-in drops an in-flight search (design D28/D33).
 * @returns {Promise<{ result: any, editedDocument: boolean }>}
 */
async function dispatchTool(doc, fn, opts = {}) {
  let args;
  try {
    args = JSON.parse(fn.arguments || '{}');
  } catch {
    return { result: { ok: false, error: 'malformed tool arguments (invalid JSON)' }, editedDocument: false };
  }

  if (fn.name === 'edit_doc') {
    const result = await editDoc(doc, args.find, args.replace, {
      isCancelled: opts.isCancelled,
    });
    return { result, editedDocument: Boolean(result.ok) };
  }

  if (fn.name === 'append_doc') {
    const result = await appendDoc(doc, args.text, {
      isCancelled: opts.isCancelled,
    });
    return { result, editedDocument: Boolean(result.ok) };
  }

  if (fn.name === 'search_web') {
    const result = await searchWeb(args, { signal: opts.signal });
    return { result, editedDocument: false };
  }

  return { result: { ok: false, error: `unknown tool: ${fn.name}` }, editedDocument: false };
}

/**
 * Handle one typed instruction end to end: read the live document, send it
 * plus the instruction and conversation history to Groq, dispatch any tool
 * calls, and retry (up to MAX_ATTEMPTS total) until the document changes or
 * attempts are exhausted.
 *
 * Milestone D: a new instruction cancels any running turn first. Replies
 * are published on the Assistant's awareness state so the browser can
 * speak them.
 *
 * @param {string} text
 * @param {{ from?: number|null, provider?: import('y-websocket').WebsocketProvider, turnId?: string }} [opts]
 * @returns {Promise<{ ok: true, turnId: string } | { ok: false, error: string, turnId: string }>}
 */
export async function handleInstruction(text, opts = {}) {
  const { from = null, provider, turnId: providedTurnId } = opts;
  const { doc } = getConnection();

  // Cancel any running turn before starting a new one (design D28).
  if (currentTurn) {
    cancelCurrentTurn();
    // Give the cancelled turn a moment to clean up.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const turnId = providedTurnId || `turn-${++turnCounter}`;
  const abort = new AbortController();

  currentTurn = { turnId, from, abort, cancelled: false };

  /**
   * Publish a reply on the Assistant's awareness state (design D27).
   * @param {string} replyText
   * @param {boolean} finalReply
   */
  function publishReply(replyText, finalReply) {
    publishedThisTurn = true;
    if (provider && from != null) {
      provider.awareness.setLocalStateField('reply', {
        to: from,
        turnId,
        text: replyText,
        final: finalReply,
        at: Date.now(),
      });
    }
  }

  /**
   * Publish lastResult on awareness (design D28).
   */
  function publishResult(ok, error = null) {
    if (provider) {
      provider.awareness.setLocalStateField('lastResult', {
        text,
        ok,
        error,
        at: Date.now(),
      });
    }
  }

  try {
    const docText = readDoc(doc);
    history.push({ role: 'user', content: buildUserMessage(text, docText) });

    let documentChanged = false;
    let lastToolError = null;
    // Design D35/task 38.3: the guaranteed search acknowledgement only fires
    // if nothing — not the model's own words, not an earlier ack — has been
    // published yet this turn. Design D37/task 38.4: search_web is capped
    // per turn, across all attempts, not just within one.
    let publishedThisTurn = false;
    let searchCallCount = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Check if cancelled before each attempt.
      if (currentTurn.cancelled) {
        history.push({ role: 'assistant', content: '[interrupted by the user]' });
        publishResult(false, 'cancelled');
        return { ok: false, error: 'cancelled', turnId };
      }

      let completion;
      try {
        completion = await chat(
          [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
          { signal: abort.signal },
        );
      } catch (err) {
        if (err instanceof RateLimitError) {
          publishResult(false, 'rate_limited');
          return { ok: false, error: 'rate_limited', message: err.message, turnId };
        }
        // Abort errors are cancellation, not failure (design D28).
        if (err.name === 'AbortError' || abort.signal.aborted) {
          history.push({ role: 'assistant', content: '[interrupted by the user]' });
          publishResult(false, 'cancelled');
          return { ok: false, error: 'cancelled', turnId };
        }
        throw err;
      }

      const message = completion.choices[0].message;
      history.push(message);

      const toolCalls = message.tool_calls ?? [];

      // Design D29: a plain-text reply with content and no tool call ends
      // the turn as an answer (spoken reply). Only an empty reply without
      // tool calls triggers the "you must call a tool" re-prompt.
      if (toolCalls.length === 0) {
        if (documentChanged) {
          publishResult(true);
          return { ok: true, turnId };
        }

        // If the model replied with content (a spoken-style answer),
        // publish it as a reply and end the turn successfully (design D29).
        if (message.content && message.content.trim()) {
          publishReply(message.content.trim(), true);
          publishResult(true);
          return { ok: true, turnId };
        }

        // No tool call, no content, no document change yet — re-prompt
        // once, explicitly requiring a tool call (design D14).
        history.push({
          role: 'user',
          content:
            'You must call a tool (edit_doc, append_doc or search_web) to make progress on this instruction. ' +
            'Respond only with a tool call, not plain text.',
        });
        continue;
      }

      // Design D29: if the model returns content alongside tool calls,
      // publish the content immediately as a non-final reply before
      // executing the tools.
      if (message.content && message.content.trim()) {
        publishReply(message.content.trim(), false);
      }

      for (const toolCall of toolCalls) {
        // Check cancellation before each tool call.
        if (currentTurn.cancelled) {
          history.push({ role: 'assistant', content: '[interrupted by the user]' });
          publishResult(false, 'cancelled');
          return { ok: false, error: 'cancelled', turnId };
        }

        if (toolCall.function.name === 'search_web') {
          // Guaranteed acknowledgement (design D35): the model's own words
          // (published above, if any) win; this is the floor, not the
          // default.
          if (!publishedThisTurn) {
            publishReply(SEARCH_ACK, false);
          }

          // Per-turn search cap (design D37) — checked before the request
          // goes out, not after, so a capped call costs no latency and no
          // Tavily credit.
          if (searchCallCount >= SEARCH_MAX_PER_TURN) {
            history.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ available: false, message: 'Search limit reached for this turn.' }),
            });
            continue;
          }
          searchCallCount += 1;
        }

        const { result, editedDocument } = await dispatchTool(doc, toolCall.function, {
          isCancelled: () => currentTurn.cancelled,
          signal: abort.signal,
        });
        if (editedDocument) documentChanged = true;
        if (!editedDocument && result && result.ok === false) lastToolError = result.error;

        history.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      if (documentChanged) {
        publishResult(true);
        return { ok: true, turnId };
      }
    }

    const error = lastToolError
      ? `retries exhausted after ${MAX_ATTEMPTS} attempts: ${lastToolError}`
      : `retries exhausted after ${MAX_ATTEMPTS} attempts`;
    publishResult(false, error);
    return { ok: false, error, turnId };
  } finally {
    // Clear currentTurn if this turn is still the active one.
    if (currentTurn && currentTurn.turnId === turnId) {
      currentTurn = null;
    }
  }
}
