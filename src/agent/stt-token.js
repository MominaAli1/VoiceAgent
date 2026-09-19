/**
 * AssemblyAI temporary streaming token, minted server-side so the permanent
 * `ASSEMBLYAI_API_KEY` never reaches the browser (design D19).
 *
 * Token endpoint contract (design.md, the streaming-model facts section):
 *   GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=N
 *   header: authorization: <API key>
 *   optional query: max_session_duration_seconds
 *   response: { token, expires_in_seconds }
 *
 * The shared contract (tasks.md, Milestone C) pins the values the server
 * requests with: expires_in_seconds=60, max_session_duration_seconds=3600.
 */

const ASSEMBLYAI_TOKEN_URL = 'https://streaming.assemblyai.com/v3/token';

/** Thrown when ASSEMBLYAI_API_KEY is unset. Non-fatal at startup (design D25) — callers turn this into a 503. */
export class MissingAssemblyAiKeyError extends Error {
  constructor() {
    super('ASSEMBLYAI_API_KEY is not set on the agent process');
    this.name = 'MissingAssemblyAiKeyError';
  }
}

/** Thrown when AssemblyAI rejects the token request. Callers turn this into a 502. */
export class AssemblyAiTokenError extends Error {
  constructor(status, detail) {
    super(`AssemblyAI token request failed (${status})${detail ? `: ${detail}` : ''}`);
    this.name = 'AssemblyAiTokenError';
    this.status = status;
  }
}

/**
 * Request a short-lived streaming token from AssemblyAI.
 *
 * Never logs `process.env.ASSEMBLYAI_API_KEY` or the returned token (design
 * D25) — callers must uphold the same rule with whatever this returns.
 *
 * @returns {Promise<{ token: string }>}
 * @throws {MissingAssemblyAiKeyError} if the key is unset
 * @throws {AssemblyAiTokenError} if AssemblyAI rejects the request
 */
export async function fetchStreamingToken() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new MissingAssemblyAiKeyError();
  }

  const url = new URL(ASSEMBLYAI_TOKEN_URL);
  url.searchParams.set('expires_in_seconds', '60');
  url.searchParams.set('max_session_duration_seconds', '3600');

  let res;
  try {
    res = await fetch(url, {
      headers: { authorization: apiKey },
    });
  } catch (err) {
    throw new AssemblyAiTokenError('network', err.message);
  }

  if (!res.ok) {
    // Read the body for our own server log only — never forwarded to the
    // client response (which gets the generic 502 message), and the key
    // itself is never in this body since it was only sent as a header.
    const detail = await res.text().catch(() => '');
    throw new AssemblyAiTokenError(res.status, detail.slice(0, 200));
  }

  const body = await res.json();
  if (!body || typeof body.token !== 'string') {
    throw new AssemblyAiTokenError(res.status, 'response missing "token" field');
  }

  return { token: body.token };
}

/** True at startup if ASSEMBLYAI_API_KEY is present — used only to decide whether to log the D25 warning. */
export function hasAssemblyAiKey() {
  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}
