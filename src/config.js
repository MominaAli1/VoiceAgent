/**
 * Single source of truth for the collaboration connection.
 *
 * Both the browser editor and the server-side participant import from here.
 * Do not restate any of these values as a literal anywhere else — a room-name
 * or field-name typo produces two participants that each work perfectly in
 * isolation and simply never see each other, with no error to point at.
 */

/** The y-websocket room every participant joins. */
export const ROOM = 'voice-doc-agent';

/**
 * The y-websocket relay. Started by `npm run dev:ws`.
 *
 * The relay binds the IPv6 loopback only (`[::1]:1234`). The `ws` npm module
 * resolves `localhost` to `127.0.0.1` (IPv4) on some systems, which causes
 * ECONNREFUSED. Use the IPv6 literal `[::1]` to ensure a reliable connection.
 */
export const WS_URL = 'ws://[::1]:1234';

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
