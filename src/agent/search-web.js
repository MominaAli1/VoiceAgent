/**
 * search_web tool — Tavily-backed search (Milestone E, design D33/D37/D38).
 *
 * A plain `fetch` to Tavily's search endpoint, no SDK (the standing
 * no-new-dependencies rule). Never throws and never rejects — every failure
 * mode (missing key, HTTP error, throttling, timeout, a cancelled turn, a
 * malformed body) degrades to `{ available: false, message }`, the same
 * shape Milestone B's stub returned, so a search failure never fails the
 * turn and never produces an unsourced fact (design D38).
 *
 * This is the *only* place `search_web`'s schema and handler are defined
 * (design D34) — `llm-client.js` imports `SEARCH_WEB_SCHEMA` into its
 * `TOOLS` array, and `orchestrator.js` imports and calls `searchWeb()`.
 * Neither keeps its own copy.
 */

import { TAVILY_URL, SEARCH_MAX_RESULTS, SEARCH_SNIPPET_CHARS, SEARCH_TIMEOUT_MS } from '../config.js';

/** OpenAI-compatible tool schema, as passed in the `tools` array to Groq. */
export const SEARCH_WEB_SCHEMA = {
  type: 'function',
  function: {
    name: 'search_web',
    description:
      'Search the web for current information that is not already in the ' +
      'document. Returns up to a few results, each with a title, a URL and ' +
      'a short excerpt. Any fact written into the document from a result ' +
      "must carry that result's URL as its source.",
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

/**
 * True at startup if `TAVILY_API_KEY` is present — used only to decide
 * whether to log the one-time startup warning (design D38, task 37.5).
 * @returns {boolean}
 */
export function hasTavilyKey() {
  return Boolean(process.env.TAVILY_API_KEY);
}

/**
 * Truncate `text` to at most `maxChars`, cutting at the last word boundary
 * before the limit and appending an ellipsis, so the model is never handed
 * a half-word (design D37). Text already at or under the limit is returned
 * unchanged.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * Search the web via Tavily. Pinned signature (design D33, Milestone E
 * shared contract) — never throws, never rejects.
 *
 * @param {{ query: string }} args
 * @param {{ signal?: AbortSignal }} [opts] - the turn's `AbortSignal`
 *   (design D28); combined with an internal `SEARCH_TIMEOUT_MS` timeout, so
 *   a barge-in or a hung request can't strand a turn (design D33)
 * @returns {Promise<
 *   { available: true, results: Array<{ title: string, url: string, content: string }> } |
 *   { available: false, message: string }
 * >}
 */
export async function searchWeb(args, opts = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    // Same shape and wording as Milestone B's stub (design D38) — the agent
    // says it cannot check, exactly as it does today.
    return { available: false, message: 'Web search is not configured.' };
  }

  const query = args?.query;
  if (typeof query !== 'string' || !query.trim()) {
    return { available: false, message: 'Search query was empty.' };
  }

  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])
    : AbortSignal.timeout(SEARCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: SEARCH_MAX_RESULTS,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal,
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return { available: false, message: 'Search timed out.' };
    }
    if (err.name === 'AbortError') {
      return { available: false, message: 'Search was cancelled.' };
    }
    return { available: false, message: `Search request failed: ${err.message}` };
  }

  // Any HTTP error, including Tavily's throttling/plan-limit statuses
  // (429/432/433) — one generic message, never the raw status handed to the
  // model (design D38).
  if (!res.ok) {
    return { available: false, message: `Search failed (${res.status}).` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { available: false, message: 'Search returned a malformed response.' };
  }

  if (!body || !Array.isArray(body.results)) {
    return { available: false, message: 'Search returned a malformed response.' };
  }

  const results = body.results.slice(0, SEARCH_MAX_RESULTS).map((result) => ({
    title: typeof result.title === 'string' ? result.title : '',
    url: typeof result.url === 'string' ? result.url : '',
    content: truncateAtWordBoundary(
      typeof result.content === 'string' ? result.content : '',
      SEARCH_SNIPPET_CHARS,
    ),
  }));

  return { available: true, results };
}
