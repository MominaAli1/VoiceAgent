# Milestone A — Collaborative Document

## Why

The brief's fifteen-day plan deliberately builds the document layer first, with no audio and no LLM, "so every later bug is clearly in the audio or agent path, not the document." Right now the repository holds only a LICENSE, so there is nothing to build that later work onto.

This change delivers Day 0 (setup) and Days 1-3 (the collaborative document) and stops there. It establishes the one thing every later phase depends on: a shared Yjs document that a browser editor and a server-side Node process both edit as equal participants. Proving that seam now is what makes the orchestrator, the STT path, and the TTS path debuggable later.

## What Changes

- **Project setup.** Initialise the Node project (`npm init`) and git; install `yjs`, `y-websocket`, `y-prosemirror`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, and `ws`. Add a package.json script that runs the stock `npx y-websocket` dev server on port 1234. We do not write our own relay server.
- **Browser editor page.** A page with an `#editor` element mounting a Tiptap editor bound to a `Y.Doc` through a `WebsocketProvider`, with per-user named cursors rendered via the collaboration-cursor extension. StarterKit runs with `history: false`.
- **Server-side participant.** A Node client that joins the *same* room as a second peer, publishes awareness (name `"Assistant"`, a distinct colour), exposes `readDoc()` returning the document as plain text, and can append text that both browser tabs see.
- **Shared configuration.** Room name, websocket URL, and the Yjs field name live in exactly one module imported by both browser and server.
- **README.** Exact commands to run the websocket server, serve the browser page, and run the server client.

Explicitly out of scope for this change: microphone capture, AssemblyAI, Claude, Tavily, ElevenLabs, the orchestrator, the `edit_doc` tool, and throttled typing. No audio, no LLM, no voice code.

### One correction to the stated approach

The brief and the change request both specify that the server client reads the document via `ydoc.getText(FIELD)`. Against the installed packages this is wrong, and it fails silently rather than loudly:

`@tiptap/extension-collaboration@3.31.3` binds the editor to `document.getXmlFragment(field)` with `field` defaulting to `"default"`. That share key therefore holds a `Y.XmlFragment`, not a `Y.Text`. Calling `ydoc.getText("default")` on the synced document returns an **empty string** with no error, and writing through it inserts a bare text node at the fragment root — outside any paragraph, which is invalid ProseMirror content. It also permanently poisons the key: a later `getXmlFragment("default")` on the same `Y.Doc` throws `Type with the name default has already been defined with a different constructor`.

This change keeps the intent of the constraint — one `FIELD` constant, share keys logged, treated as the first suspect — but reads and writes through `getXmlFragment(FIELD)`, with `readDoc()` walking the fragment to plain text. See design.md for the verification transcript.

## Capabilities

### New Capabilities

- `collaborative-document`: the shared document surface — the browser editor, the Yjs transport and room configuration, presence and named cursors, and the server-side participant's read and append operations.
- `project-setup`: the runnable skeleton — dependency set, the y-websocket dev server script, and the documented commands to bring all three processes up.

### Modified Capabilities

None. This is the first change in the repository; there are no existing specs.

## Impact

- **New dependencies:** `yjs`, `y-websocket`, `y-prosemirror`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, `ws`, plus a dev-time static server and a bundler for the browser page.
- **New code:** shared config module, browser editor entry point and HTML page, server-side Yjs client module, README.
- **No existing code affected** — the repository contains only a LICENSE.
- **Downstream:** Days 4-6 (the orchestrator) will import `readDoc()` and the append path from the server client established here. The `FIELD` correction above is load-bearing for that work; getting it wrong is the brief's own first-listed risk ("Agent text never appears in editor").

---

# Milestone B — Agent Brain

## Why

The brief's fifteen-day plan builds the agent's reasoning on top of the document layer once that layer is provable on its own: "Days 4-6 - The agent brain, typed not spoken." Milestone A delivered exactly the foundation this depends on — a shared Yjs document, a server-side participant that can already `connect()`, `readDoc()`, and `appendText()` as a peer named `Assistant`. That participant currently does nothing intelligent: `dev:agent` hardcodes one marker line. This change replaces that hardcoded append with a real decision-maker — an LLM that reads the live document, decides what to change, and edits it through a safe, retryable tool, still driven by a typed instruction rather than a voice one.

The gate is unchanged from the brief: **a typed instruction visibly rewrites the document.**

### Deviation from the brief: Groq instead of Anthropic

The brief specifies Claude as the brain (section 6, "reliable structured tool calls"). This project has no paid Anthropic API key. **Groq** is used instead — a free-tier, OpenAI-compatible chat-completions API with native tool/function-calling support. The default model is `llama-3.3-70b-versatile`, chosen for the most reliable multi-step tool-calling among Groq's free-tier catalog; it is a config value, not a hardcoded assumption, so it can be swapped without touching orchestrator logic.

This is not a drop-in-equivalent substitution and the risk is real, not cosmetic: Groq's free-tier models are measurably less reliable than Claude at exactly the two things this milestone depends on — calling a tool when one is required, and producing a `find` string that exists verbatim in the document rather than a paraphrase or a hallucinated near-match. The brief's own `edit_doc` design (descriptive errors, a 3-retry cap, re-reading the live document on retry) already exists to absorb this class of failure for a different reason (concurrent human edits moving the target text); it now also has to absorb a weaker model's mistakes, and design.md (D14) records that this will surface as more retries in practice than the brief anticipated with Claude.

The API key is supplied via a `GROQ_API_KEY` environment variable, loaded from a local `.env` file that is not committed (see Impact). Setup instructions for obtaining and placing the key belong in the README, not in code.

## What Changes

- **Orchestrator module** (`src/agent/orchestrator.js`). A single entry point, `handleInstruction(instruction)`, that: reads the live document (capped at ~2,000 words, the brief's own cap — no retrieval), sends it plus the instruction and conversation history to Groq with the `edit_doc` and `search_web` tool schemas attached, executes whichever tool call comes back, and loops back to Groq with the tool result until Groq responds with no further tool call. Conversation history is kept in memory for the life of the process; there is no "speaking" or "cancelled" state in this module — those belong to the voice milestone and are not built here, matching this project's standing rule against building ahead of the current phase.
- **Groq client wrapper** (`src/agent/llm-client.js`). Wraps the Groq chat-completions + tools call: model, system prompt (states the document is authoritative and the `find` string in any `edit_doc` call must match it exactly), the two tool schemas, and the request/response shape the orchestrator consumes. `GROQ_MODEL` lives in `src/config.js` alongside the room/websocket/field constants; `GROQ_API_KEY` stays in `.env`, never in `src/config.js`, never logged.
- **`edit_doc` tool** (extends `src/agent/doc-client.js`). Exact find-and-replace against the shared `Y.XmlFragment`, restricted for this milestone to matches within a single paragraph (see design.md D15 for why). Re-checks the live document for the `find` string immediately before mutating — not the copy the LLM reasoned over — and returns a descriptive, structured error ("not found" / "found N times, ambiguous") rather than guessing, so the orchestrator can retry with a corrected instruction up to 3 times.
- **Throttled insertion** (`src/agent/typing.js`). New text — from `edit_doc`'s replacement and from appends — is inserted a few characters at a time with a short delay between chunks, so it reads as typed rather than pasted. Deletion (the "find" side of an edit) happens as a single CRDT delete; only insertion is throttled, matching the brief's wording ("text is inserted a few characters at a time").
- **`search_web` stub.** Registered in the tool schema and dispatched by the orchestrator like a real tool, but its handler returns a fixed "web search is not available yet" result with no network call. Exercises the full tool-dispatch loop now so wiring in Tavily later is a handler swap, not a new code path.
- **Typed-instruction UI.** A text input and submit control added to the existing editor page (`index.html` / `src/web/main.js`). Submitting POSTs the instruction to a small HTTP endpoint the agent process now exposes; the response is just an acknowledgement, because the actual edit arrives through the Yjs document the browser is already watching, the same way any other participant's edit would.
- **Agent process gains an HTTP listener.** `src/agent/index.js` (the `dev:agent` entry point) now also starts a minimal HTTP server (`POST /instruction`) alongside its existing Yjs connection, so the browser has a channel to hand it a typed instruction. Port and URL are pinned in `src/config.js` next to the existing connection constants.

Explicitly out of scope for this change: microphone capture, AssemblyAI, ElevenLabs, barge-in/interruption, a real Tavily-backed `search_web`, and position-based references ("the second paragraph"). No audio code, no voice code.

## Capabilities

### New Capabilities

- `agent-brain`: the LLM-driven decision loop — the orchestrator's turn handling, the Groq tool-use call, the `edit_doc` and `search_web` tool contracts, throttled insertion, and the typed-instruction entry point that triggers a turn.

### Modified Capabilities

None. The browser editor page changes at the file level — `index.html` and
`src/web/main.js` gain a new control — but `collaborative-document`'s own
requirements (presence, cursors, undo, `readDoc()`/`appendText()`) are
unchanged by this. The new control's behavior is specified under
`agent-brain` below, since what it does is trigger the agent brain, not
change the document surface itself.

## Impact

- **New dependencies:** a Groq/OpenAI-compatible client SDK (`groq-sdk` — see design.md D13), and a means of loading `.env` (Node's built-in `--env-file` support, no new dependency needed). No HTTP framework needed beyond Node's built-in `http` module for a single-route listener.
- **New configuration:** `GROQ_API_KEY` (secret, `.env`, gitignored, never committed), `GROQ_MODEL` and the instruction-endpoint host/port (both in `src/config.js`, following the existing no-literals convention).
- **New code:** `src/agent/orchestrator.js`, `src/agent/llm-client.js`, `src/agent/typing.js`, an extension to `src/agent/doc-client.js` for `edit_doc`, an HTTP listener added to `src/agent/index.js`, and a text-input control added to the browser editor page.
- **Existing code affected:** `src/agent/doc-client.js` (new export), `src/agent/index.js` (gains the HTTP listener alongside its existing Yjs connection and drops the hardcoded marker-line append in favour of the orchestrator loop), `index.html`/`src/web/main.js` (new input control), `src/config.js` (new constants), README (new setup step for `GROQ_API_KEY`, new run-time behavior to document).
- **Downstream:** Days 7-9 (speech in) will replace the typed-instruction UI's text input with a transcript from AssemblyAI, but is expected to call the *same* `orchestrator.handleInstruction(instruction)` entry point pinned here — keeping that signature stable is what makes this change's work reusable rather than throwaway.

# Milestone C — Hearing You (Speech In)

## Why

The brief's plan: "Days 7-9 - Hearing you (speech in)." Milestone B proved the
agent brain against a typed instruction, and Milestone B's own proposal
anticipated exactly this step — speech in "will replace the typed-instruction
UI's text input with a transcript from AssemblyAI, but is expected to call the
*same* entry point." This change builds that transcript path and nothing
after it: the agent still answers only through the document, not a voice.

The gate is the brief's: **hold a key, speak, release, final transcript in
the console under a second** — and, because Milestone B is already in place,
that transcript then rewrites the document exactly as a typed instruction
does.

This path is AssemblyAI's **Realtime Speech-to-Text API** with our own
orchestration, not its bundled Voice Agent API. The brief rules the bundled
product out explicitly: the agent must reach into the document mid-turn, and
"you own the gap between transcript and brain." The account's free plan
($150 credit, 333 streaming hours at list price) covers development and
rehearsal many times over.

## What Changes

- **Microphone capture** (`src/web/mic.js`, `src/web/pcm-worklet.js`).
  `getUserMedia` with echo cancellation, noise suppression and auto gain on.
  An `AudioWorklet` downsamples from the device's native rate to 16 kHz mono
  and emits little-endian PCM16 in fixed 50 ms frames (800 samples, 1,600
  bytes) — the format AssemblyAI's streaming socket declares.
- **Browser streaming client** (`src/web/stt.js`). Fetches a short-lived
  token from the agent process, opens AssemblyAI's v3 streaming WebSocket
  directly from the browser, sends audio only while push-to-talk is held,
  sends `ForceEndpoint` on release, assembles the final utterance, and
  terminates the session after a short idle window (design D20).
- **Push-to-talk and ghost text** (`index.html`, `src/web/main.js`). Holding
  the push-to-talk key (or an on-screen hold button) captures speech; partial
  transcripts render as faint ghost text in a transcript strip above the
  instruction bar — never inside the shared document. On release, the final
  transcript is shown solid and submitted through the existing
  `POST /instruction` contract, unchanged.
- **Token endpoint on the agent process** (`src/agent/index.js`).
  `GET /stt-token` exchanges the server-side `ASSEMBLYAI_API_KEY` for a
  temporary streaming token. The permanent key never reaches the browser.
- **Shared streaming protocol module** (`src/stt-protocol.js`). Pure functions
  used by both the browser client and a Node test harness: build the socket
  URL, parse server messages, and assemble one utterance from `Turn`
  messages. One implementation, proven twice.
- **Node streaming harness** (`src/agent/stt-harness.js`). Streams a WAV
  fixture to AssemblyAI at real-time pace using a token from the endpoint,
  prints every message, and can optionally submit the result to
  `/instruction` — proving the speech path with no browser and no microphone.
- **Milestone B carry-over.** The `search_web` stub is not being called for
  factual questions (the model answers from memory and writes it into the
  document); tasks 15.5 and 18.5 were never run. These close before Milestone
  C's joint acceptance so a voice bug is never confused with a brain bug.

Explicitly out of scope: text-to-speech (browser voice or ElevenLabs),
barge-in/interruption, `speaking`/`cancelled` orchestrator state, always-on
listening, real Tavily search, and AssemblyAI's Voice Agent API or LLM
Gateway. The agent does not talk back in this change.

## Capabilities

### New Capabilities

- `speech-input`: push-to-talk microphone capture, the 16 kHz PCM16 audio
  pipeline, the streaming transcription session and its lifecycle, partial
  transcripts as ghost text, and delivery of the final transcript to the
  existing instruction entry point.

### Modified Capabilities

None. `agent-brain`'s instruction contract is reused verbatim; a spoken
instruction is indistinguishable from a typed one once it reaches
`POST /instruction`.

## Impact

- **New dependencies:** none. The browser uses the native `WebSocket`,
  `AudioWorklet` and `getUserMedia`; the harness uses the existing `ws`
  package and Node's built-in `fetch`.
- **New configuration:** `ASSEMBLYAI_API_KEY` (secret, `.env`, gitignored,
  never committed, never logged). `STT_*` and push-to-talk constants in
  `src/config.js`.
- **New code:** `src/stt-protocol.js`, `src/web/mic.js`,
  `src/web/pcm-worklet.js`, `src/web/stt.js`, `src/agent/stt-harness.js`, a
  WAV fixture under `fixtures/`.
- **Existing code affected:** `src/agent/index.js` (new `GET /stt-token`
  route), `index.html` / `src/web/main.js` / `src/web/editor.css` (transcript
  strip, push-to-talk control), `src/config.js`, `.env.example`, README.
- **Cost:** streaming is billed on how long the WebSocket stays open, not on
  audio sent. The session lifecycle in design D20 exists to keep that close
  to time actually spent speaking.
- **Downstream:** Days 10-11 (talking back, barge-in) will add a `speaking`
  state and make a push-to-talk press cancel speech first. Keeping key-down
  handling in one place in `stt.js` is what makes that a small change.

# Milestone D — Talking Back and Interruption

## Why

The brief's plan: "Days 10-11 - Talking back and interruption." Milestone C
made the agent hear you; it still answers only by editing the document, in
silence. This change gives it a voice and, more importantly, gives you the
ability to cut it off.

The gate is the brief's: **cutting the agent off mid-sentence works cleanly;
voice and edit both stop.**

Interruption is the point of this milestone, not the voice. The brief's
governing rule is "the user always wins": the moment you press to talk, the
agent stops speaking, stops typing, and treats what you say next as a fresh
instruction against the document as it actually looks now.

### Two problems this also fixes

- **The agent's words are currently thrown away.** When Groq replies in plain
  text rather than calling a tool — which is exactly what task 25.4's prompt
  asks it to do for a factual question it cannot verify — the orchestrator
  re-prompts it with "You must call a tool", burns its attempts, and returns
  `retries exhausted`. The user sees a red failure and never sees the actual
  answer. Giving replies somewhere to go (a voice, and the transcript strip)
  turns that from a bug into the feature it was meant to be.
- **Nothing can be stopped once started.** Neither the Groq request nor
  `typing.js`'s insertion loop can be cancelled, so a wrong 40-word edit types
  itself out to the end while you watch.

### Deviation from the brief: browser voice, not ElevenLabs

The brief picks ElevenLabs streaming, with "browser voice wired first as a
fallback behind a flag". This change ships **only** the browser's built-in
`speechSynthesis` voice, behind that flag (`TTS_ENGINE`), and leaves
ElevenLabs unbuilt.

Reasons: it needs no account, no key and no credit; it cannot be streamed to
the browser without either shipping a key or proxying audio through the agent;
and the brief's own cut list says "drop ElevenLabs (browser voice demos fine)"
is the first thing to cut when time is short. With nine days to the deadline
and Milestones E and F unstarted, this is that moment. `TTS_ENGINE` exists so
adding ElevenLabs later is a new module, not a rewrite.

## What Changes

- **Spoken replies** (`src/web/tts.js`). The browser speaks the agent's reply
  text with `speechSynthesis`, split into sentences so long replies are not
  truncated, and can stop instantly.
- **A reply channel.** The agent publishes each reply on its existing
  awareness state (`reply`), addressed to the tab that sent the instruction,
  so only that tab speaks. Same mechanism as Milestone B's `lastResult`, no
  new transport.
- **The orchestrator gains a turn, with state** (`src/agent/orchestrator.js`).
  One turn at a time, holding `speaking`/`cancelled` state; a plain-text reply
  from Groq now ends the turn as an answer instead of being re-prompted away;
  reply text is published as soon as it arrives, before tools run, so the
  agent speaks before it works rather than after.
- **Cancellation, end to end.** A new `POST /cancel` route; an abort signal on
  the in-flight Groq request; and a cancel check between chunks in
  `typing.js`, so insertion stops within one chunk.
- **Barge-in in the browser.** Pressing push-to-talk while the agent is
  speaking cancels speech first, then tells the agent to cancel its turn, then
  starts capturing — in that order, so the audio stops immediately rather than
  after a round trip.
- **Carry-over from Milestone C.** Open the speech session when the page
  loads rather than on the first press, so the first press is fast (task 27.1).

Explicitly out of scope: ElevenLabs, always-on listening, resuming an
interrupted instruction automatically (the brief's Option 1: what is typed
stays, the rest is dropped), erasing a half-typed fragment on interrupt, and
real Tavily search.

## Capabilities

### New Capabilities

- `voice-reply`: the agent's spoken reply — how reply text is produced,
  addressed and spoken — and interruption: what a push-to-talk press cancels,
  how fast, and what the document is left looking like.

### Modified Capabilities

- `agent-brain`: a turn may now end with a spoken answer and no document
  change, where today a plain-text reply is re-prompted and eventually
  reported as a failure. A turn can also be cancelled mid-flight.

## Impact

- **New dependencies:** none. `speechSynthesis` is built into the browser;
  cancellation uses `AbortController`.
- **New configuration:** `TTS_ENGINE`, `CANCEL_PATH`, and the sentence-split
  and cancel-check constants, all in `src/config.js`.
- **New code:** `src/web/tts.js`; a `POST /cancel` route in
  `src/agent/index.js`; turn state and reply publishing in
  `src/agent/orchestrator.js`; a cancel token in `src/agent/typing.js`.
- **Existing code affected:** `src/web/stt.js` (barge-in on key-down, session
  pre-warm), `src/web/main.js` (speak replies, "speaking" indicator),
  `src/agent/llm-client.js` (system prompt asks for a short spoken line; abort
  signal), README.
- **Downstream:** Days 12-13 (Tavily) depends on this milestone's "speak
  before the tool runs" path — the brief's "the agent speaks its
  acknowledgement before the search runs, so there is no silence while it
  waits" is exactly the mechanism built here.

# Milestone E — Search Out Loud

## Why

The brief's plan: "Days 12-13 - Search out loud and polish." It is also beat
three of the 90-second demo: *"Find the current figure for X and add it."* →
*"Let me check that,"* then the agent speaks the finding while writing it in.

Everything that beat needs is already built except the search itself:
Milestone B gave the agent a `search_web` tool it can call, and Milestone D
gave it a voice that can acknowledge before a tool runs. This change replaces
the placeholder handler with a real **Tavily** call, and makes what comes back
land in the document with a source attached.

The gate is the brief's: **a factual question gets an acknowledgement within a
second and the finding written in, with its source, within ten.**

## What Changes

- **Tavily-backed `search_web`** (`src/agent/search-web.js`). A plain `fetch`
  to Tavily's search endpoint: at most 3 results, each trimmed to ~500
  characters, each carrying its title and source URL. No SDK.
- **One definition of each tool, not three.** Today `search_web`'s schema
  exists in `search-web.js` *and* `llm-client.js`, its behaviour lives in
  `orchestrator.js`, and `search-web.js` is imported by nothing — so editing
  the file named after the feature changes nothing. This change makes
  `search-web.js` the only definition and has the other two import it.
- **An acknowledgement that is guaranteed, not hoped for.** The orchestrator
  already publishes the model's own words before running a tool (D29). When a
  search call arrives with no words attached, it publishes a fixed line ("Let
  me look that up.") instead, so the brief's "speaks before the search runs"
  holds even when the model says nothing.
- **A way to add a paragraph.** `edit_doc` can only replace existing text, so
  the agent currently cannot write a finding into a document that does not
  already contain something to replace. A new `append_doc` tool appends a
  paragraph through the same throttled, cancellable typing path.
- **Sourcing rules.** Anything written from a search must carry a URL that
  came back from that search. The system prompt states it; the tool result
  carries the URLs; the acceptance checks look for them.
- **Polish.** The brief's "test typing while the agent writes" and the
  concurrent-edit checks that Milestone D left open.

Explicitly out of scope: ElevenLabs, a fixture-reset key, the demo recording
(all Milestone F), always-on listening, and retrieval over long documents.

## Capabilities

### New Capabilities

- `web-search`: the search tool's contract, what it returns, the spoken
  acknowledgement that precedes it, and the rule that written facts carry
  their source.

### Modified Capabilities

- `agent-brain`: gains `append_doc`, and `search_web` stops being a stub.

## Impact

- **New dependencies:** none. Tavily is one `fetch`.
- **New configuration:** `TAVILY_API_KEY` (secret, `.env`, optional),
  `TAVILY_URL`, `SEARCH_MAX_RESULTS`, `SEARCH_SNIPPET_CHARS`,
  `SEARCH_TIMEOUT_MS`, `SEARCH_MAX_PER_TURN`, `SEARCH_ACK` in `src/config.js`.
- **New code:** a real handler in `src/agent/search-web.js`; `append_doc` in
  `src/agent/doc-client.js` and the tool schema; search flow in
  `src/agent/orchestrator.js`; a "searching" state in the browser.
- **Existing code affected:** `src/agent/llm-client.js` (imports the shared
  schemas, prompt gains the sourcing rule), `src/agent/orchestrator.js`,
  `src/web/main.js` and `editor.css`, `.env.example`, README.
- **Cost:** Tavily's free tier is 1,000 credits a month; a basic search is 1
  credit. Rehearsal will use tens, not hundreds.
- **Downstream:** Milestone F rehearses this as demo beat three.

# Milestone F — Live Deployment

## Why

The submission is a complete project with a **live URL judges can open and
test**, so the app has to leave `localhost`. Nothing in the system is built
for that yet: the relay, the agent and the allowed page origin are hard-wired
to `localhost`, the microphone will not work off `https`, every visitor lands
in the *same* document as the demo, and any visitor spends the team's Groq,
AssemblyAI and Tavily credit.

This milestone is scheduled **in parallel with Milestone E, not after it**.
With the deadline close, an unknown found on the first deploy is far more
expensive than one found on the last day.

## What Changes

- **Addresses become configuration.** `src/config.js` keeps being the single
  source of truth, but reads the relay URL, the agent's base URL and the
  allowed page origin from the environment, falling back to today's localhost
  values so local development is unchanged.
- **A room per visitor.** The room name comes from the page URL
  (`?room=<id>`), generated on first visit if absent. The agent no longer
  joins one fixed room at startup: it joins a visitor's room on demand, keeps
  one connection, turn state and conversation history **per room**, and drops
  a room's connection after an idle period.
- **Three services on Render:** the built editor page as a static site, the
  stock y-websocket relay, and the agent. Both Node services bind Render's
  `PORT`.
- **Rate limits on the agent's routes,** because every visitor spends the
  team's credit: per-IP limits on `/stt-token` and `/instruction`, plus a
  daily ceiling, returning `429` with a message the page shows.
- **A fixture document per room,** seeded by the agent when it joins an empty
  room, so a judge landing on a fresh URL sees something to edit rather than a
  blank page — and so a relay restart, which wipes memory, is survivable.

Explicitly out of scope: persistence beyond the relay's memory, accounts or
login, a custom domain, the PWA, and any paid hosting tier.

## Capabilities

### New Capabilities

- `deployment`: what the live service must do — reachable over `https`/`wss`,
  a private document per visitor, the team's credentials never reaching the
  browser, and spending bounded per visitor.

### Modified Capabilities

- `collaborative-document`: the room is per visitor rather than one constant.
- `agent-brain`: turn state and conversation history are per room.

## Impact

- **New dependencies:** none. Rate limiting is a small in-memory counter; no
  framework.
- **New configuration:** `WS_URL`, `AGENT_URL` and `CORS_ORIGIN` from the
  environment (with localhost defaults); `PORT` on both Node services;
  `RATE_LIMIT_*`; the three API keys as Render environment variables.
- **New code:** per-room connection/turn/history handling in the agent, room
  selection in the browser, a rate limiter, a fixture seed, and Render service
  definitions.
- **Risk this carries:** free Render services sleep when idle and take
  ~30-60 s to wake. The demo plan must include waking them beforehand.
- **Downstream:** Milestone G (rehearsal) rehearses against the live URL, not
  `localhost`.
