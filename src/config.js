/**
 * Single source of truth for the collaboration connection.
 *
 * Both the browser editor and the server-side participant import from here.
 * Do not restate any of these values as a literal anywhere else — a room-name
 * or field-name typo produces two participants that each work perfectly in
 * isolation and simply never see each other, with no error to point at.
 */

/**
 * Read a deployment setting (design D40, Milestone F).
 *
 * The same module is imported by the browser and by Node, so it checks both:
 * Vite replaces `import.meta.env.VITE_*` at build time; Node reads
 * `process.env`. With neither set, every value falls back to the localhost
 * default it had before deployment existed, so local development is unchanged.
 */
function env(key) {
  const fromNode = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const fromVite = import.meta.env?.[`VITE_${key}`];
  return fromNode || fromVite || undefined;
}

/** Default room, used when no `?room=` is given (local development, harness). */
export const ROOM = env('ROOM') ?? 'voice-doc-agent';

/**
 * The y-websocket relay. Started by `npm run dev:ws`.
 *
 * The relay binds the IPv6 loopback only (`[::1]:1234`). The `ws` npm module
 * resolves `localhost` to `127.0.0.1` (IPv4) on some systems, which causes
 * ECONNREFUSED. Use the IPv6 literal `[::1]` to ensure a reliable connection.
 */
export const WS_URL = env('WS_URL') ?? 'ws://[::1]:1234';

/**
 * Base URL of the agent's HTTP endpoints (design D40).
 *
 * In production the agent sits behind https on port 443, not 3001, so the
 * browser builds its URLs from this rather than from INSTRUCTION_PORT.
 */
export const AGENT_URL = env('AGENT_URL') ?? 'http://localhost:3001';

/** Page origin the agent accepts cross-origin requests from (design D40). */
export const CORS_ORIGIN = env('CORS_ORIGIN') ?? 'http://localhost:5173';

/** Drop a room's connection, turn state and history after this long idle (design D41). */
export const ROOM_IDLE_MS = Number(env('ROOM_IDLE_MS') ?? 600000);

/** Per-IP speech passes per minute — matches AssemblyAI's own free-plan limit (design D42). */
export const RATE_LIMIT_TOKENS_PER_MIN = Number(env('RATE_LIMIT_TOKENS_PER_MIN') ?? 5);

/** Per-IP instructions per minute (design D42). */
export const RATE_LIMIT_INSTRUCTIONS_PER_MIN = Number(env('RATE_LIMIT_INSTRUCTIONS_PER_MIN') ?? 10);

/** Per-IP requests per day across both routes (design D42). */
export const RATE_LIMIT_DAILY = Number(env('RATE_LIMIT_DAILY') ?? 200);

/**
 * The Yjs share key holding the document.
 *
 * MUST match the `field` option of @tiptap/extension-collaboration. Verified
 * against the installed v3.31.3, whose default is "default" and which binds
 * via `document.getXmlFragment(field)`.
 *
 * That share key therefore holds a Y.XmlFragment, NOT a Y.Text:
 *
 *   - `ydoc.getText(FIELD)` returns an empty string with NO error, and then
 *     permanently poisons the key — a later `getXmlFragment(FIELD)` on the
 *     same Y.Doc throws "already been defined with a different constructor".
 *   - Always read and write through `ydoc.getXmlFragment(FIELD)`.
 *
 * If the agent's text never appears in the editor, this constant is the first
 * thing to check. See openspec/changes/collaborative-document/design.md — D1.
 */
export const FIELD = 'default';

/**
 * --- Milestone B additions ---
 *
 * Pinned by the shared contract in openspec/changes/collaborative-document/tasks.md
 * so Track B (Rumaisa) is never blocked waiting on the rest of Track A. These
 * three values are the contract handoff only; Momina's remaining Track A work
 * (typed-instruction UI, `search_web` stub wiring, `.env.example`, Gate A) is
 * separate and unaffected by this file.
 */

/**
 * The Groq model `llm-client.js` calls. Must stay in sync with whatever
 * model `llm-client.js` actually calls — never hardcode a model string
 * there, import it from here instead.
 */
export const GROQ_MODEL = 'openai/gpt-oss-120b';

/**
 * Port the agent process's instruction HTTP endpoint listens on. Separate
 * from both the relay (1234) and Vite (5173). See design.md D16.
 */
export const INSTRUCTION_PORT = 3001;

/** Path of the instruction HTTP endpoint. See design.md D16. */
export const INSTRUCTION_PATH = '/instruction';

/**
 * --- Milestone C additions (speech in) ---
 *
 * Pinned by the Milestone C shared contract in
 * openspec/changes/collaborative-document/tasks.md.
 */

/** Token route on the agent's existing HTTP server (INSTRUCTION_PORT). Design D19. */
export const STT_TOKEN_PATH = '/stt-token';

/** AssemblyAI v3 streaming socket; the browser connects here directly. Design D19. */
export const STT_WS_URL = 'wss://streaming.assemblyai.com/v3/ws';

/** Sample rate declared to AssemblyAI and produced by the worklet. Design D21. */
export const STT_SAMPLE_RATE = 16000;

/** Samples per audio frame: 800 at 16 kHz is 50 ms, the API's minimum. Design D21. */
export const STT_FRAME_SAMPLES = 800;

/** Streaming model; swap for 'universal-streaming-english' if latency needs it. Design D20 risks. */
export const STT_SPEECH_MODEL = 'universal-3-5-pro';

/** Close the session after this long with no push-to-talk press. Design D20. */
export const STT_IDLE_CLOSE_MS = 60000;

/** Server-side safety net if the tab dies without sending Terminate. Design D20. */
export const STT_SERVER_IDLE_TIMEOUT_S = 120;

/** Longest wait for the final turn after key-up before falling back to the partial. Design D23. */
export const STT_FINAL_WAIT_MS = 1500;

/** Push-to-talk key, matched on KeyboardEvent.code. Design D22. */
export const PTT_KEY_CODE = 'ControlRight';

/**
 * --- Milestone D additions (talking back and interruption) ---
 *
 * Pinned by the Milestone D shared contract in
 * openspec/changes/collaborative-document/tasks.md.
 */

/**
 * Which TTS backend speaks replies. Only `'browser'` is implemented this
 * milestone — the browser's built-in `speechSynthesis`, no ElevenLabs, no
 * key, no audio proxy (design D26). The flag exists so ElevenLabs can be
 * added later as a new module rather than a rewrite.
 */
export const TTS_ENGINE = 'browser';

/** Cancel-current-turn route on the agent's existing HTTP server (INSTRUCTION_PORT). Design D28. */
export const CANCEL_PATH = '/cancel';

/**
 * Longest a single spoken utterance is allowed to be, in characters. Chrome
 * truncates/stalls utterances around 15s of speech; replies are split into
 * sentences no longer than this so nothing is cut off (design D26).
 */
export const TTS_MAX_SENTENCE_CHARS = 180;

/**
 * --- Milestone E additions (search out loud) ---
 *
 * Pinned by the Milestone E shared contract in
 * openspec/changes/collaborative-document/tasks.md.
 */

/** Tavily's search endpoint — one plain `fetch`, no SDK (design D33). */
export const TAVILY_URL = 'https://api.tavily.com/search';

/** Results per search, per the brief; also Tavily's request `max_results` (design D33/D37). */
export const SEARCH_MAX_RESULTS = 3;

/** Each result's `content` is truncated to this many characters, at a word boundary (design D37). */
export const SEARCH_SNIPPET_CHARS = 500;

/** Longest a single Tavily request may take before the turn treats it as failed (design D33). */
export const SEARCH_TIMEOUT_MS = 10000;

/** Cap on `search_web` calls per turn, so a model that dislikes its results can't spend the whole turn searching (design D37). */
export const SEARCH_MAX_PER_TURN = 2;

/**
 * Fallback spoken acknowledgement, published by the orchestrator itself if
 * the model calls `search_web` without saying anything first — guarantees
 * the brief's "speaks before the search runs" even when the model doesn't
 * (design D35). The model's own words win when present; this is the floor.
 */
export const SEARCH_ACK = 'Let me look that up.';

/**
 * Spoken the instant a voice instruction is submitted, from the browser, so
 * the user hears something in ~0.1 s instead of waiting ~2-3 s for the model's
 * first round trip to decide what to do. Measured Sep 29: without it, the
 * first sound on a search turn landed 2-3 s after the user stopped speaking.
 */
export const INSTANT_ACK = 'On it.';

/**
 * Whether a brand-new room gets two starter paragraphs (design D44).
 *
 * Off by default: a blank page is the right start when you are actually
 * writing something. Turn it on for the public demo (`SEED_NEW_ROOMS=true`)
 * so a judge opening a fresh link has text to instruct the agent about.
 */
export const SEED_NEW_ROOMS = (env('SEED_NEW_ROOMS') ?? 'false') === 'true';
