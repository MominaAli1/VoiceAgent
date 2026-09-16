## Why

The brief's fifteen-day plan builds the agent's reasoning on top of the document layer once that layer is provable on its own: "Days 4-6 - The agent brain, typed not spoken." The collaborative-document change delivered exactly the foundation this depends on — a shared Yjs document, a server-side participant that can already `connect()`, `readDoc()`, and `appendText()` as a peer named `Assistant`. That participant currently does nothing intelligent: `dev:agent` hardcodes one marker line. This change replaces that hardcoded append with a real decision-maker — an LLM that reads the live document, decides what to change, and edits it through a safe, retryable tool, still driven by a typed instruction rather than a voice one.

The gate is unchanged from the brief: **a typed instruction visibly rewrites the document.**

### Deviation from the brief: Groq instead of Anthropic

The brief specifies Claude as the brain (section 6, "reliable structured tool calls"). This project has no paid Anthropic API key. **Groq** is used instead — a free-tier, OpenAI-compatible chat-completions API with native tool/function-calling support. The default model is `llama-3.3-70b-versatile`, chosen for the most reliable multi-step tool-calling among Groq's free-tier catalog; it is a config value, not a hardcoded assumption, so it can be swapped without touching orchestrator logic.

This is not a drop-in-equivalent substitution and the risk is real, not cosmetic: Groq's free-tier models are measurably less reliable than Claude at exactly the two things this milestone depends on — calling a tool when one is required, and producing a `find` string that exists verbatim in the document rather than a paraphrase or a hallucinated near-match. The brief's own `edit_doc` design (descriptive errors, a 3-retry cap, re-reading the live document on retry) already exists to absorb this class of failure for a different reason (concurrent human edits moving the target text); it now also has to absorb a weaker model's mistakes, and design.md records that this will surface as more retries in practice than the brief anticipated with Claude.

The API key is supplied via a `GROQ_API_KEY` environment variable, loaded from a local `.env` file that is not committed (see Impact). Setup instructions for obtaining and placing the key belong in the README, not in code.

## What Changes

- **Orchestrator module** (`src/agent/orchestrator.js`). A single entry point, `handleInstruction(instruction)`, that: reads the live document (capped at ~2,000 words, the brief's own cap — no retrieval), sends it plus the instruction and conversation history to Groq with the `edit_doc` and `search_web` tool schemas attached, executes whichever tool call comes back, and loops back to Groq with the tool result until Groq responds with no further tool call. Conversation history is kept in memory for the life of the process; there is no "speaking" or "cancelled" state in this module — those belong to the voice milestone and are not built here, matching this project's standing rule against building ahead of the current phase.
- **Groq client wrapper** (`src/agent/llm-client.js`). Wraps the Groq chat-completions + tools call: model, system prompt (states the document is authoritative and the `find` string in any `edit_doc` call must match it exactly), the two tool schemas, and the request/response shape the orchestrator consumes. `GROQ_MODEL` lives in `src/config.js` alongside the room/websocket/field constants; `GROQ_API_KEY` stays in `.env`, never in `src/config.js`, never logged.
- **`edit_doc` tool** (extends `src/agent/doc-client.js`). Exact find-and-replace against the shared `Y.XmlFragment`, restricted for this milestone to matches within a single paragraph (see design.md for why). Re-checks the live document for the `find` string immediately before mutating — not the copy the LLM reasoned over — and returns a descriptive, structured error ("not found" / "found N times, ambiguous") rather than guessing, so the orchestrator can retry with a corrected instruction up to 3 times.
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

- **New dependencies:** a Groq/OpenAI-compatible client SDK (`groq-sdk` or `openai` pointed at Groq's base URL — pick one in design.md), and a means of loading `.env` (`dotenv` or Node's built-in `--env-file` support, whichever the installed Node version supports without an extra package). No HTTP framework needed beyond Node's built-in `http` module for a single-route listener.
- **New configuration:** `GROQ_API_KEY` (secret, `.env`, gitignored, never committed), `GROQ_MODEL` and the instruction-endpoint host/port (both in `src/config.js`, following the existing no-literals convention).
- **New code:** `src/agent/orchestrator.js`, `src/agent/llm-client.js`, `src/agent/typing.js`, an extension to `src/agent/doc-client.js` for `edit_doc`, an HTTP listener added to `src/agent/index.js`, and a text-input control added to the browser editor page.
- **Existing code affected:** `src/agent/doc-client.js` (new export), `src/agent/index.js` (gains the HTTP listener alongside its existing Yjs connection and drops the hardcoded marker-line append in favour of the orchestrator loop), `index.html`/`src/web/main.js` (new input control), `src/config.js` (new constants), README (new setup step for `GROQ_API_KEY`, new run-time behavior to document).
- **Downstream:** Days 7-9 (speech in) will replace the typed-instruction UI's text input with a transcript from AssemblyAI, but is expected to call the *same* `orchestrator.handleInstruction(instruction)` entry point pinned here — keeping that signature stable is what makes this change's work reusable rather than throwaway.
