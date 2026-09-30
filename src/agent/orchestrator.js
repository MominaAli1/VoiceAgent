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
import { SEARCH_ACK, SEARCH_MAX_PER_TURN, ROOM, ROOM_IDLE_MS } from '../config.js';

/** Retry cap per instruction, shared across all failure modes (design D14). */
const MAX_ATTEMPTS = 3;

/** Document cap sent to the model, in words (design D18). */
const MAX_WORDS = 2000;

/**
 * Per-room state (design D41, Milestone F).
 *
 * Before deployment the agent held one connection, one conversation history
 * and one turn for the whole process, because everyone shared one room. A
 * public URL gives each visitor their own room, so one visitor's instruction
 * must never cancel another's or land in another's conversation.
 *
 * @type {Map<string, { connection: object, history: object[], currentTurn: object|null, idleTimer: any }>}
 */
const rooms = new Map();

/**
 * Get (or lazily create) the state for a room, and restart its idle timer.
 * @param {string} [room]
 */
function getRoom(room = ROOM) {
  let state = rooms.get(room);
  if (!state) {
    state = { connection: null, history: [], currentTurn: null, idleTimer: null };
    rooms.set(room, state);
  }
  clearTimeout(state.idleTimer);
  // Without this a public URL accumulates one live connection per visitor,
  // forever (design D41).
  state.idleTimer = setTimeout(() => dropRoom(room), ROOM_IDLE_MS);
  return state;
}

/** Close a room's connection and forget its conversation. */
function dropRoom(room) {
  const state = rooms.get(room);
  if (!state) return;
  clearTimeout(state.idleTimer);
  state.currentTurn?.abort.abort();
  try {
    state.connection?.provider.destroy();
    state.connection?.doc.destroy();
  } catch {
    // Already gone; nothing to clean up.
  }
  rooms.delete(room);
  console.log(`[room] dropped "${room}" after ${ROOM_IDLE_MS / 1000}s idle (${rooms.size} active)`);
}

/** Rooms currently held open, for diagnostics. */
export function activeRooms() {
  return [...rooms.keys()];
}

/**
 * Turns of history kept. Every turn resends the history, so this cannot be
 * unbounded — but it is what the agent remembers of the conversation, and at
 * 6 turns a real back-and-forth ("what do you think" → "try this" → "show me
 * that again") ran off the end mid-discussion. Cheap now that older turns no
 * longer carry a copy of the document (compactHistory).
 */
const MAX_HISTORY_TURNS = 10;

/** Longest a turn waits for a new room's first sync before proceeding anyway. */
const SYNC_WAIT_MS = 5000;

/**
 * Drop the oldest turns, cutting only at a `user` message.
 *
 * Trimming at an arbitrary index would be worse than not trimming: an
 * assistant message carrying `tool_calls` must keep the `tool` messages that
 * answer it, or the API rejects the whole request.
 */
/**
 * Strip the document snapshot out of older turns.
 *
 * Every user message embeds the whole document (buildUserMessage), and every
 * search result is ~1,500 characters of page text. Keeping those verbatim
 * means turn N sends N copies of the document, so turns get slower the longer
 * you use it — measured Sep 29: a search turn that took 5.9 s on a short
 * document took 29 s once a few turns of history had accumulated.
 *
 * Only the current turn needs the live document; older turns just need to
 * record what was asked.
 */
function compactHistory(history) {
  for (const message of history) {
    if (message.role === 'user' && typeof message.content === 'string') {
      const i = message.content.indexOf('Instruction: ');
      if (i !== -1) message.content = message.content.slice(i);
    }
    if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > 200) {
      message.content = `${message.content.slice(0, 200)}… (truncated)`;
    }
  }
}

function trimHistory(history) {
  const userTurnStarts = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'user' && !history[i].tool_call_id) userTurnStarts.push(i);
  }
  if (userTurnStarts.length <= MAX_HISTORY_TURNS) return;
  const cut = userTurnStarts[userTurnStarts.length - MAX_HISTORY_TURNS];
  history.splice(0, cut);
}


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
export function getConnection(room = ROOM) {
  const state = getRoom(room);
  if (!state.connection) {
    state.connection = connect(room);
    // A brand-new room is not synced yet. Editing before the first sync lands
    // on an empty local copy and the change is lost when the real document
    // arrives — measured Sep 29 on a fresh room. Every turn waits for this.
    state.ready = new Promise((resolve) => {
      state.connection.provider.once('synced', resolve);
      setTimeout(resolve, SYNC_WAIT_MS); // never hang a turn on a dead relay
    });
    console.log(`[room] joined "${room}" (${rooms.size} active)`);
  }
  return state.connection;
}

/** Resolve once a room's first sync has landed (or the wait expires). */
export async function roomReady(room = ROOM) {
  getConnection(room);
  await rooms.get(room)?.ready;
}

/**
 * Cancel the currently running turn, if any (design D28).
 * @returns {{ cancelled: boolean }}
 */
export function cancelCurrentTurn(room = ROOM) {
  const state = rooms.get(room);
  if (!state?.currentTurn) {
    return { cancelled: false };
  }
  state.currentTurn.cancelled = true;
  state.currentTurn.abort.abort();
  return { cancelled: true };
}

/**
 * Get the current turn state (for diagnostics).
 * @returns {typeof currentTurn}
 */
export function getCurrentTurn(room = ROOM) {
  return rooms.get(room)?.currentTurn ?? null;
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
  const { from = null, provider: providedProvider, turnId: providedTurnId, room = ROOM } = opts;
  // Per-room (design D41): this visitor's document, conversation and turn.
  const { doc, provider: roomProvider } = getConnection(room);
  const provider = providedProvider ?? roomProvider;
  const state = getRoom(room);
  const history = state.history;

  // Wait for the room's first sync, or an edit on a fresh room is applied to
  // an empty copy and lost.
  await roomReady(room);

  // Cancel any running turn *in this room* before starting a new one
  // (design D28). Another room's turn is none of this instruction's business.
  if (state.currentTurn) {
    cancelCurrentTurn(room);
    // Give the cancelled turn a moment to clean up.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const turnId = providedTurnId || `turn-${++turnCounter}`;
  const abort = new AbortController();

  const currentTurn = { turnId, from, abort, cancelled: false };
  state.currentTurn = currentTurn;

  // Design D35/task 38.3: the guaranteed search acknowledgement only fires if
  // nothing — not the model's own words, not an earlier ack — has been
  // published yet this turn. Declared here, alongside publishReply(), because
  // publishReply() writes to it; declaring it inside the turn body put it out
  // of scope and made the first search_web call throw a ReferenceError.
  let publishedThisTurn = false;

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
    // Compact *before* pushing, so the new turn keeps its full document view
    // and every older one loses its stale copy.
    compactHistory(history);
    history.push({ role: 'user', content: buildUserMessage(text, docText) });
    trimHistory(history);

    let documentChanged = false;
    let lastToolError = null;
    // Design D37/task 38.4: search_web is capped per turn, across all
    // attempts, not just within one.
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
          // Show the human-readable reason, not the error code: the user can
          // act on "try again in 7s" and can do nothing with "rate_limited".
          publishResult(false, err.message);
          return { ok: false, error: err.message, turnId };
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

        // No tool call, no content, no document change yet — nudge once
        // (design D14). Since Milestone D the agent is also allowed to just
        // talk, so this asks for *something*: demanding a tool call here
        // made it try to edit when the person was only thinking out loud.
        history.push({
          role: 'user',
          content:
            'You replied with nothing at all. Say one short sentence back: either what you are about to ' +
            'do (and call the matching tool), or a question asking what they meant if the request was ' +
            'too short to act on.',
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

    // Out of attempts. If the model never managed a usable tool call, that is
    // usually a request too short to act on ("key figures", "type down") — so
    // ask, out loud, instead of showing the user a developer's error string.
    if (!lastToolError) {
      publishReply("Sorry — I didn't catch what you'd like me to do. Could you say that again?", true);
      publishResult(true);
      return { ok: true, turnId };
    }

    const error = `retries exhausted after ${MAX_ATTEMPTS} attempts: ${lastToolError}`;
    publishResult(false, error);
    return { ok: false, error, turnId };
  } finally {
    // Clear the room's turn if this one is still the active turn.
    if (state.currentTurn && state.currentTurn.turnId === turnId) {
      state.currentTurn = null;
    }
  }
}
