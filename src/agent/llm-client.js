/**
 * Groq chat-completions client for the orchestrator.
 *
 * Wraps `groq-sdk`, registers the two tool schemas the orchestrator can
 * dispatch (`edit_doc` and `search_web`), and surfaces a rate-limit
 * response as its own distinct error type rather than folding it into the
 * generic tool-call-failure retry path (design D14).
 */

import Groq from 'groq-sdk';
import { GROQ_MODEL } from '../config.js';

/**
 * Thrown at import/startup time if GROQ_API_KEY is unset. A missing key
 * must fail loudly and immediately — not surface later as an agent that
 * silently never edits anything.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'GROQ_API_KEY is not set. Export it or add it to .env and run with ' +
        '`node --env-file=.env`. The agent process refuses to start without it.',
    );
    this.name = 'MissingApiKeyError';
  }
}

/** Distinct error type for a Groq rate-limit response (design D14). */
export class RateLimitError extends Error {
  constructor(cause) {
    super('Groq rate limit exceeded. This instruction was not retried automatically.');
    this.name = 'RateLimitError';
    this.cause = cause;
  }
}

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new MissingApiKeyError();
}

const client = new Groq({ apiKey });

/**
 * `edit_doc` tool schema, pinned by the shared contract: name `edit_doc`,
 * required string parameters `find` and `replace`.
 */
export const EDIT_DOC_TOOL = {
  type: 'function',
  function: {
    name: 'edit_doc',
    description:
      'Replace an exact, verbatim substring of the document with new text. ' +
      '`find` must match the live document exactly, character for character, ' +
      'and must be entirely within a single paragraph — it cannot span a ' +
      'paragraph break. If `find` is not found, or is found more than once, ' +
      'or spans multiple paragraphs, the tool returns a descriptive error ' +
      'instead of guessing.',
    parameters: {
      type: 'object',
      properties: {
        find: {
          type: 'string',
          description: 'Exact, verbatim text to locate in the document, within a single paragraph.',
        },
        replace: {
          type: 'string',
          description: 'Text to replace it with.',
        },
      },
      required: ['find', 'replace'],
    },
  },
};

/**
 * `search_web` tool schema. Pinned by Momina's Milestone B contract (task
 * 12.1) and registered verbatim here so the tool-dispatch loop does not
 * break on a valid call — name, the single required `query` parameter, and
 * the "not yet backed by a real search" description must match her stub
 * exactly.
 */
export const SEARCH_WEB_TOOL = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Search the web for information. Not yet backed by a real search.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.',
        },
      },
      required: ['query'],
    },
  },
};

export const TOOLS = [EDIT_DOC_TOOL, SEARCH_WEB_TOOL];

export const SYSTEM_PROMPT =
  'You are a document-editing assistant. The document text you are shown is ' +
  'authoritative and reflects the live state at the start of this turn. ' +
  'When you call edit_doc, the `find` argument must match the document ' +
  'exactly, verbatim, character for character, including punctuation and ' +
  'capitalization — do not paraphrase or summarize the text you are trying ' +
  'to match. If you are not making an edit, you must still respond, but no ' +
  'document change will occur unless you call edit_doc.\n\n' +
  'If the instruction asks you to add, verify, or rely on a specific fact, ' +
  'statistic, date, price, score, or other real-world/current information ' +
  'that is not already present verbatim in the document, you must call ' +
  'search_web with an appropriate query before calling edit_doc — never ' +
  'answer a factual question from your own memory. search_web is not yet ' +
  'backed by a real search and will report `{ available: false }`; when it ' +
  'does, do not guess, estimate, or invent the fact and do not call ' +
  'edit_doc with a fabricated value. Instead respond in plain text saying ' +
  'you cannot verify that information yet because web search is not ' +
  'available, and make no document change.\n\n' +
  'Every reply is read aloud to the user, so always include a short, ' +
  'single spoken sentence in your message content: what you are about to ' +
  'do (when calling a tool) or your answer (when not). Write it to be ' +
  'heard, not read — brief and natural. A spoken sentence is never a ' +
  'substitute for calling a tool: still call edit_doc or search_web ' +
  'whenever the instruction implies a document change.';

/**
 * Send a chat-completion request to Groq with the pinned tool schemas
 * registered.
 *
 * @param {Array<{role: string, content?: string, tool_calls?: any[], tool_call_id?: string, name?: string}>} messages
 * @param {{ signal?: AbortSignal }} [opts] - `signal` aborts an in-flight
 *   request when the turn is cancelled (design D28/D30); the resulting
 *   rejection is the caller's to interpret as a cancellation, not a failure.
 * @returns {Promise<import('groq-sdk').Groq.Chat.Completions.ChatCompletion>}
 * @throws {RateLimitError} if Groq responds with a rate-limit error
 */
export async function chat(messages, opts = {}) {
  try {
    return await client.chat.completions.create(
      { model: GROQ_MODEL, messages, tools: TOOLS },
      { signal: opts.signal },
    );
  } catch (err) {
    if (err instanceof Groq.RateLimitError) {
      throw new RateLimitError(err);
    }
    throw err;
  }
}
