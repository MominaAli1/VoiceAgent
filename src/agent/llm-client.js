/**
 * Groq chat-completions client for the orchestrator.
 *
 * Wraps `groq-sdk`, registers the three tool schemas the orchestrator can
 * dispatch (`edit_doc`, `append_doc` and `search_web`), and surfaces a
 * rate-limit response as its own distinct error type rather than folding it
 * into the generic tool-call-failure retry path (design D14).
 */

import Groq from 'groq-sdk';
import { GROQ_MODEL } from '../config.js';
import { SEARCH_WEB_SCHEMA } from './search-web.js';

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
 * `append_doc` tool schema, pinned by the shared contract (design D36):
 * name `append_doc`, one required string parameter `text`. Appends a new
 * paragraph rather than replacing existing text — `edit_doc` cannot add
 * something to a document that has nothing matching to replace.
 */
export const APPEND_DOC_TOOL = {
  type: 'function',
  function: {
    name: 'append_doc',
    description:
      'Append a new paragraph to the end of the document. Use this to add ' +
      'something new (e.g. a finding from search_web) — use edit_doc instead ' +
      'when replacing text that already exists in the document.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The paragraph text to append.',
        },
      },
      required: ['text'],
    },
  },
};

/**
 * `search_web`'s schema lives in `search-web.js` — the single source of
 * truth for both its schema and its handler (design D34). Imported here,
 * not redefined, so there is exactly one definition in the codebase.
 */
export const TOOLS = [EDIT_DOC_TOOL, APPEND_DOC_TOOL, SEARCH_WEB_SCHEMA];

export const SYSTEM_PROMPT =
  'You are a document-editing assistant. The document text you are shown is ' +
  'authoritative and reflects the live state at the start of this turn.\n\n' +
  'You have two ways to change the document, and they are not ' +
  'interchangeable. Use edit_doc to replace text that already exists: the ' +
  '`find` argument must match the document exactly, verbatim, character for ' +
  'character, including punctuation and capitalization — do not paraphrase ' +
  'or summarize the text you are trying to match. Use append_doc to add ' +
  'something new to the end of the document — a finding from search_web, ' +
  'for instance — when there is no existing text to replace. If you are not ' +
  'making a change, you must still respond, but no document change will ' +
  'occur unless you call edit_doc or append_doc.\n\n' +
  'If the instruction asks you to add, verify, or rely on a specific fact, ' +
  'statistic, date, price, score, or other real-world/current information ' +
  'that is not already present verbatim in the document, you must call ' +
  'search_web with an appropriate query first — never answer a factual ' +
  'question from your own memory. Any fact you write into the document from ' +
  'a search result must carry that result\'s URL as its source, appended ' +
  'inline with append_doc — never invent a URL and never write a fact with ' +
  'no source. If search_web reports `{ available: false }`, do not guess, ' +
  'estimate, or invent the fact and do not call edit_doc or append_doc with ' +
  'a fabricated value; instead respond in plain text saying you cannot ' +
  'verify that information right now, and make no document change.\n\n' +
  'When you respond, include a short spoken sentence in your content field ' +
  '— what you are about to do (e.g. "Let me check that for you.") or the ' +
  'answer to a factual question. This sentence is read aloud, so keep it to ' +
  'one short, natural spoken sentence; if you are writing a finding into the ' +
  'document, the written paragraph is the fuller version — the source URL ' +
  'belongs in what you write, not in what you say. Always still call the ' +
  'appropriate tool when the instruction implies a document change.';

/**
 * Send a chat-completion request to Groq with the pinned tool schemas
 * registered.
 *
 * @param {Array<{role: string, content?: string, tool_calls?: any[], tool_call_id?: string, name?: string}>} messages
 * @param {{ signal?: AbortSignal }} [opts] - `signal` aborts an in-flight
 *   request when the turn is cancelled (design D28/D30); the resulting
 *   rejection is the caller's to interpret as a cancellation, not a failure.
 *   Passed as the SDK's second (request-options) argument — `groq-sdk`'s
 *   `create(body, options)` only honors `signal` there, not inside `body`.
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
