/**
 * search_web tool — stub for Milestone B.
 *
 * Registered in the tool schema and dispatched by the orchestrator like a
 * real tool, so the tool-dispatch loop is exercised end to end now, but the
 * handler makes no network call. Wiring in Tavily later (a future milestone)
 * is a handler swap, not a new code path.
 *
 * The schema below is pinned in tasks.md's shared contract — Rumaisa's
 * llm-client.js (Track B, not built yet) registers it with Groq verbatim.
 */

/** OpenAI-compatible tool schema, as passed in the `tools` array to Groq. */
export const SEARCH_WEB_SCHEMA = {
  type: 'function',
  function: {
    name: 'search_web',
    description:
      'Search the web for current information. NOT YET IMPLEMENTED — always ' +
      'returns a fixed "not available" response with no network call. ' +
      'Present so the tool-calling loop can be exercised for search-shaped ' +
      'instructions ahead of a real search backend landing in a later phase.',
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
 * The search_web tool handler. Always returns the same fixed response —
 * exact shape pinned in tasks.md's shared contract.
 *
 * @param {{ query: string }} _args
 * @returns {{ available: false, message: string }}
 */
export function searchWeb(_args) {
  return { available: false, message: 'Web search is not available yet.' };
}
