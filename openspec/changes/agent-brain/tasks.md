Work is split into two independently verifiable tracks, the same way
collaborative-document was:

| Track | Owner | Scope | Proved by |
| --- | --- | --- | --- |
| A | **Momina** | Shared config additions, throttled insertion, `search_web` stub, typed-instruction browser UI | Gate A (group 4) — proven without Rumaisa's orchestrator/Groq work |
| B | **Rumaisa** | Groq client, orchestrator, `edit_doc` tool, instruction HTTP endpoint | Gate B (group 8) — proven without Momina's browser UI |
| Joint | **Both** | Integration | Milestone B acceptance (group 9) |

The split follows the same shape as before: the track that owns a shared
interface pushes it early, ahead of the rest of its own track, so the other
track is never blocked waiting on unfinished work — only on a pinned
contract.

---

## Tech stack restrictions

Binding for both tracks.

**New runtime dependency:** `groq-sdk` only. Do not add the generic `openai`
package, `dotenv`, `langchain`, or any other LLM/agent framework. Env vars
load via Node's built-in `--env-file=.env` flag (confirm the installed Node
version supports it — this project is on Node 22, so it does), not a
dependency.

**No HTTP framework.** The instruction endpoint is a single route on Node's
built-in `http` module. Do not add Express, Fastify, or similar for one
route.

**`GROQ_MODEL` lives in `src/config.js`, never hardcoded in `llm-client.js`.**
Same no-literals convention as `ROOM`/`WS_URL`/`FIELD`.

**`GROQ_API_KEY` is never in `src/config.js`, never logged, never committed.**
It is read from `process.env` only. Its absence at startup is a loud,
immediate error — not a silent no-op agent that never edits anything.

**`edit_doc` never touches more than one paragraph.** If the `find` string
crosses a paragraph boundary, return a descriptive error. Do not attempt a
multi-node edit (design D3).

**`edit_doc` re-reads the live document immediately before mutating.** Never
trust the copy of the document the orchestrator sent to Groq at the start of
the turn — it may be stale by the time the tool actually runs (design D3).

**Only insertion is throttled, never deletion.** `edit_doc`'s delete step
(removing the old `find` text) is a single instant `Y.XmlText.delete`; only
the replacement text streams in via `typing.js` (design D5).

**Retry cap is 3 attempts per instruction, shared across all failure
modes** (a wrong `find` string, a missing tool call, anything else) — not 3
per failure mode. On exhaustion, return a clear failure, do not loop further
(design D2).

**Nothing from later phases.** No microphone, AssemblyAI, ElevenLabs,
barge-in/cancellation, real Tavily network call, or position-based document
references ("the second paragraph") in this change. `search_web` is a stub
that returns a fixed response with no network call.

**Never `ydoc.getText(FIELD)`.** Still applies — carried forward from
collaborative-document D1. Every read/write in this change's new code goes
through the existing `readDoc()`/`getXmlFragment(FIELD)` machinery.

---

## Shared contract (pinned — do not renegotiate mid-flight)

- **`src/config.js` additions** (Momina pushes these first, ahead of the
  rest of Track A): `GROQ_MODEL` (string, default `"llama-3.3-70b-versatile"`),
  `INSTRUCTION_PORT` (number, `3001`), `INSTRUCTION_PATH` (string,
  `"/instruction"`).
- **Instruction HTTP contract** (design D4): `POST {INSTRUCTION_PATH}` on
  `INSTRUCTION_PORT`, JSON body `{ "text": string }`. Success:
  `202 { "accepted": true }`, returned before the orchestrator necessarily
  finishes. Errors: `400` for a missing/empty `text`, `500` if the
  orchestrator throws before accepting — both with a JSON `{ "message": string }`
  body. CORS allows `http://localhost:5173`.
- **`src/agent/typing.js` public signatures** (Momina pushes this early,
  Rumaisa's `edit_doc` imports it without waiting for the throttling to be
  tuned): `typeIntoNewParagraph(doc, text, opts)` and
  `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)`, both
  returning a Promise that resolves once every chunk has been inserted.
- **`search_web` tool schema** (Momina pins the shape, Rumaisa's
  `llm-client.js` registers it verbatim): name `search_web`, one required
  string parameter `query`, description stating it is not yet backed by a
  real search. The stub handler returns
  `{ available: false, message: "Web search is not available yet." }`.
- **`edit_doc` tool schema**: name `edit_doc`, required string parameters
  `find` and `replace`.
- **Orchestrator entry point**: `orchestrator.handleInstruction(text)`,
  returning a Promise. This is the signature Days 7-9's speech input is
  expected to call unchanged — keeping it stable is the point of pinning it
  here.

---

## 1. Momina — Shared config and contract handoff

- [ ] 1.1 Add `GROQ_MODEL`, `INSTRUCTION_PORT`, `INSTRUCTION_PATH` to `src/config.js` exactly as pinned above, with a comment noting `GROQ_MODEL` must stay in sync with whatever model `llm-client.js` actually calls
- [ ] 1.2 Commit and push these additions ahead of the rest of Track A — this unblocks Rumaisa's `llm-client.js` and HTTP endpoint work
- [ ] 1.3 Add `.env.example` with a `GROQ_API_KEY=` placeholder line (the real key is never committed; `.env` is already gitignored)

## 2. Momina — Throttled insertion

- [ ] 2.1 Create `src/agent/typing.js` implementing `typeIntoNewParagraph(doc, text, opts)` and `typeIntoParagraph(doc, paragraphIndex, offset, text, opts)` per design D5 — default chunk size 3 characters, default delay 35ms, both overridable via `opts`
- [ ] 2.2 Each chunk is inserted as its own `Y.XmlText` insert (its own Yjs transaction), so remote peers see text arrive incrementally, not as one write
- [ ] 2.3 Push this ahead of the rest of Track A too — `edit_doc` (Track B) imports it directly

## 3. Momina — `search_web` stub and typed-instruction UI

- [ ] 3.1 Implement the `search_web` stub handler and its tool schema exactly as pinned in the shared contract
- [ ] 3.2 Add a text input and submit control to the existing editor page (`index.html` / `src/web/main.js`)
- [ ] 3.3 On submit, `fetch(POST)` to `INSTRUCTION_PORT`/`INSTRUCTION_PATH` with `{ text }`; on `202`, clear the input and show a brief "sent" acknowledgement; on `400`/`500`, show the error message rather than failing silently
- [ ] 3.4 The UI does not wait for the edit to appear — it only reflects the HTTP accept/reject; the actual edit is observed the same way any other participant's edit is, through the existing Yjs sync already built in collaborative-document

## 4. Momina — Gate A (verifiable without any of Rumaisa's work)

- [ ] 4.1 Prove `typing.js` directly against the running relay with a standalone Node script (no browser, no Groq, no orchestrator) — two Node clients watching the same room converge on identical text after a throttled multi-chunk insert, with intermediate partial states observable mid-stream
- [ ] 4.2 Prove the `search_web` stub by calling its handler directly with a sample query and checking the fixed response shape
- [ ] 4.3 Prove the browser UI sends the right request by pointing it at a minimal mock HTTP server written just for this gate (a few lines, not the real orchestrator) that asserts method, path, and body shape, and returns `202`
- [ ] 4.4 Prove the UI's error handling by pointing the mock server at a `400`/`500` response and confirming the error is visible, not swallowed

## 5. Rumaisa — Groq client

- [ ] 5.1 Create `src/agent/llm-client.js` using `groq-sdk`, calling `GROQ_MODEL` from `src/config.js`, never a hardcoded model string
- [ ] 5.2 Register the `edit_doc` and `search_web` tool schemas exactly as pinned in the shared contract (the `search_web` schema must match Momina's stub verbatim, or the tool-dispatch loop breaks on a valid call)
- [ ] 5.3 System prompt states the document is authoritative and that `find` in any `edit_doc` call must match it exactly, verbatim
- [ ] 5.4 Throw a clear, named error at startup if `GROQ_API_KEY` is unset — do not let a missing key surface later as an agent that silently never edits anything
- [ ] 5.5 Surface a rate-limit response as its own distinct error type, not folded into the generic tool-call-failure retry path (design D2)

## 6. Rumaisa — `edit_doc` tool

- [ ] 6.1 Extend `src/agent/doc-client.js` with `editDoc(doc, find, replace)`: locate `find` within exactly one paragraph's plain text (walking the fragment the same way `readDoc()` does); if not found in exactly one paragraph, return a descriptive error (`not found` / `found N times, ambiguous` / `spans multiple paragraphs`) rather than guessing
- [ ] 6.2 Re-read the live fragment inside the same synchronous pass that performs the mutation — never trust a copy read earlier in the turn (design D3)
- [ ] 6.3 Delete the matched range as a single instant `Y.XmlText.delete`, then call Momina's `typeIntoParagraph` to stream the replacement in (design D5) — do not write the replacement in one instant insert
- [ ] 6.4 Assert (throw, do not silently truncate) if the target paragraph is ever found to contain more than one text-bearing child, per the formatting note in design D3
- [ ] 6.5 Grep for any `edit_doc` code path that indexes by character offset into the whole document rather than within one paragraph's own text — confirm none exists (design D3's core invariant)

## 7. Rumaisa — Orchestrator and instruction endpoint

- [ ] 7.1 Create `src/agent/orchestrator.js` exporting `handleInstruction(text)` exactly as pinned in the shared contract: reads the live document via `readDoc()`, applies the ~2,000-word cap from the tail of the document if exceeded (design D6, with the truncation noted in the prompt when it fires), sends it plus instruction and conversation history to Groq
- [ ] 7.2 Tool-dispatch loop: on a tool call, execute it (`edit_doc` or the `search_web` stub) and feed the result back to Groq; on no tool call and no document change yet, re-prompt once explicitly requiring a tool call; cap total attempts at 3 (design D2)
- [ ] 7.3 Keep conversation history in memory for the life of the process — no persistence, no `speaking`/`cancelled` state (those are out of scope per the tech stack restrictions)
- [ ] 7.4 Add the HTTP listener to `src/agent/index.js`: `POST /instruction` per the pinned contract, wired to `orchestrator.handleInstruction()`, responding `202` before the orchestrator necessarily finishes
- [ ] 7.5 Remove Milestone A's hardcoded `"Appended by Assistant"` marker-line append from `dev:agent`'s startup — replace it with the orchestrator loop as the only source of document edits from the agent process; note this explicitly as a behavior change from collaborative-document's `dev:agent`

## 8. Rumaisa — Gate B (verifiable without any of Momina's work)

Run the relay and the agent process. No browser involved; use `curl`/`fetch`
directly against the instruction endpoint, and the seed harness from
collaborative-document to set up fixture documents.

- [ ] 8.1 A well-formed instruction against a seeded document (e.g. "change 'rough draft' to 'final draft'") results in exactly the matched paragraph changing, verified by a subsequent `readDoc()`
- [ ] 8.2 An instruction whose implied `find` text does not exist verbatim in the seeded document triggers at least one retry, and after 3 failed attempts returns a clear failure rather than looping or corrupting the document
- [ ] 8.3 A factual/search-shaped instruction exercises the `search_web` stub path without hanging or erroring the whole turn
- [ ] 8.4 Starting the agent process with `GROQ_API_KEY` unset fails immediately and loudly, before accepting any instruction
- [ ] 8.5 `POST /instruction` with a missing `text` field returns `400`; a valid request returns `202` before the tool-dispatch loop necessarily completes

## 9. Joint — Milestone B acceptance

Both tracks merged. Run all three processes (relay, web, agent — the agent
now also listening on `INSTRUCTION_PORT`) together. Verified by running the
system, not by inspection.

- [ ] 9.1 Typing an instruction into the browser's new input and submitting it results in the document visibly rewriting, with the new text streaming in character by character rather than appearing instantly
- [ ] 9.2 A second browser tab, not the one the instruction was typed into, sees the same live streaming edit
- [ ] 9.3 An instruction referencing text that does not exist verbatim in the document results in a visible, non-corrupting failure after retries are exhausted — not a silently wrong edit and not a hang
- [ ] 9.4 A factual-question-shaped instruction exercises the `search_web` stub and the agent still responds sensibly (e.g. acknowledges it cannot search yet) rather than hanging or erroring the whole turn
- [ ] 9.5 Typing by hand in a tab while the agent is mid-edit produces no corruption and no lost characters — re-verifying collaborative-document's concurrent-edit guarantee still holds with throttled multi-chunk agent inserts in the mix
- [ ] 9.6 The document cap (design D6) does not need to be exercised for this gate to pass, but if tested, a document over ~2,000 words still produces a sensible edit against the tail of the document, not an error
- [ ] 9.7 No `"Appended by Assistant"` marker line appears anywhere — the only agent-driven changes are ones traceable to a real typed instruction
- [ ] 9.8 README updated with the `GROQ_API_KEY` setup step (where to get a free key, where the `.env` file goes) and the instruction endpoint's existence/port; followed from a clean checkout, it reaches "type an instruction, watch it rewrite the document live"
