<!-- Converted from voice-doc-agent-design-brief.docx; the .docx remains the authored source. -->

# Design Brief - Real-Time Voice + Document Agent

*A document you can talk to*

Build window  15 days
Author  Taimur Ali, CGI Forge
Status  Planning / pre-build

## 1. One-line concept

A research collaborator that lives inside your document. You talk, it listens, and it types what matters into the document in front of you, edits lines on request, looks things up on the web, and talks back. You can cut it off mid-sentence and redirect it the way you would a person.

## 2. What it is, and why it is not a chat sidebar

The usual pattern is a chat box next to your document: you ask the AI something, it answers in the chat, and you copy the answer across yourself. Here the artefact and the conversation are the same object. The agent is inside the document with you. It writes directly into the page, and you can interrupt it mid-thought. That is a different working relationship, not a different interface skin.
The intended feel: a knowledgeable person sitting next to you while you draft, who you can hand the keyboard to and take it back from at any moment.

## 3. How one turn works (the pipeline)

The flow is not "speech to text to speech." There is a brain in the middle, and it produces two kinds of output at once.
You speak. Your voice goes to AssemblyAI, which turns it into text. (speech-to-text)
The brain decides. That text plus the current document goes to Claude. Claude reads both and decides what to do.
Two outputs from one decision: voice back to you via ElevenLabs out your speakers, and edits typed into the shared document you are watching. The edits do not go through ElevenLabs.
If a search is needed, Claude calls Tavily, gets clean results back, and loops to step 2 to write the finding in.
The mental model: AssemblyAI is the ears, Claude is the brain, and there are two mouths, the voice (ElevenLabs) and the document (the typing). ElevenLabs never touches your transcript. It only ever speaks Claude's replies.

## 4. The governing principle

Speak first, work second, deliver third.
Tool calls (search, writing) run in the background and never hold the voice loop open. When you ask a question, the agent says something out loud within about a second ("let me check that") before it goes off to work. If it went silent for eight seconds on every question, the sense of a collaborator collapses. Every decision in this brief exists to protect this one line.

## 5. Core behaviours

Live document editing. The agent edits by finding an exact piece of existing text and replacing it, never by counting character positions (position-counting corrupts the document constantly). Text is inserted a few characters at a time with a small pause, so it reads as a person typing rather than a block appearing.
Web search. When Claude decides it needs current information, the search_web tool calls Tavily. Tavily searches, opens the pages, and returns clean extracted text. Results are capped at three, each truncated to roughly 500 characters, and every snippet carries its source URL so the agent can attribute what it writes. The agent speaks its acknowledgement before the search runs, so there is no silence while it waits.
Interruption (barge-in). The user always wins. The moment you start speaking, the agent's current work is cancelled: it stops typing mid-word and stops talking. The insertion loop checks a cancelled flag between each tiny piece of text, so the stop feels instant. Your new sentence is then handled as a fresh instruction, sent to Claude along with the live document as it actually looks now.
What happens to the interrupted instruction (Option 1). The text already typed stays in the document. The unfinished part is dropped, and the agent does not auto-resume it. The agent keeps a memory of the conversation, so it still knows what it was doing; if you want it finished you say "okay, finish that paragraph" and it picks the thread back up. This is the simplest correct behaviour and it is the chosen approach. A cleanup version (erasing the half-typed fragment on interrupt) is a later polish, only if the leftover text looks bad on screen.
Concurrent human editing. You can type by hand while the agent types. The document is a shared CRDT (Yjs), the same technology that lets two people edit a Google Doc at once, so both sets of edits merge safely with no corruption. If your hand-edit moves text the agent was about to change, its edit tool reports "couldn't find that exact text," and Claude re-reads the live document and retries. That self-correction is what makes concurrent editing safe rather than fragile.

## 6. The stack

Layer
Choice
Role
Editor
Tiptap (ProseMirror)
The document surface; Yjs collaboration is first-class
Shared state
Yjs + y-websocket
Makes the agent a second editor in the same document for free
Speech-to-text
AssemblyAI streaming
Lowest real-time error rate; built-in turn detection
Brain
Claude with tool use
Reliable structured tool calls (edit + search)
Web search
Tavily API
Returns clean, LLM-ready extracted text, made for agents
Text-to-speech
ElevenLabs streaming
Strong voice, low first-byte; browser voice as fallback
Server
Node, single process
Yjs is JS-native; avoids a Python/JS bridge

Why not AssemblyAI's bundled Voice Agent product. It glues listening, thinking, and speaking into one sealed pipe. That is fine for a plain talking bot, but this agent must reach into the document and edit it mid-turn, and the bundled version does not expose that seam. Wiring the pieces yourself means you own the gap between transcript and brain, which is where all the interesting behaviour lives.

## 7. Architecture and data flow

BROWSER                          SERVER (single Node process)
=======                          ============================

[ Tiptap editor ]                [ ORCHESTRATOR ]
      ^                                 |
      |  Yjs ops (CRDT)                 |
      v                                 |
[ Y.Doc ] <-- y-websocket --------> [ Y.Doc mirror ]
  human client                       agent client
                                          |
[ mic ] -- PCM16 16kHz --------> [ AssemblyAI streaming STT ]
                                          |
                                     final transcript
                                          v
                                  [ Claude, tool use ]
                                     |            |
                                  edit_doc   search_web (Tavily)
                                     |            |
                                     v            v
                                Y.Doc mirror   result -> re-prompt
                                                   |
[ speaker ] <-- audio frames ----------------  ElevenLabs TTS

The agent's Y.Doc lives server-side, connected to the same room as the browser. Edits applied server-side propagate to the browser automatically through the CRDT, and Claude gets a plain-text view of the document for each prompt.

## 8. Latency budgets

Three live loops run at once with different budgets. Conflating them is the main way this build fails.
Loop
Budget
Must never block on
Speech to partial transcript
under 300 ms
anything at all
Speech to final transcript
under 700 ms after key-up
LLM, tools
Agent to first spoken word
under 1 s
web search, doc write
Agent to doc-edit stream
starts under 1.5 s, runs 1-3 s
the voice loop
Web search to result
3-10 s
nothing (fully async)

## 9. MVP scope and the three simplifications

Three shortcuts keep the first version buildable. Take all three.
Push-to-talk. Hold a key to speak; everything spoken while held is an instruction, nothing else is listened to. This removes the "is this an instruction or am I thinking out loud" problem entirely. Always-on listening can come later.
Document cap of about 2,000 words. Send the whole document to Claude every turn. At the cap this is roughly 2,700 tokens per turn, well within limits across a full session. Do not build retrieval for the MVP.
Find-and-replace edits, not position offsets. More robust, and the model is already good at it.

## 10. Fifteen-day build plan

The order is chosen so each layer is provable before the next lands. Build the document first, with no audio, so every later bug is clearly in the audio or agent path, not the document.
Day 0 - Setup
Accounts and keys (AssemblyAI, Anthropic, Tavily, ElevenLabs). Init Node project and git. Install the stack. Run the y-websocket dev server and confirm it starts.
Gate:  the dev server runs on :1234.
Days 1-3 - The collaborative document
Tiptap + Yjs with history disabled. Two browser tabs edit one doc and see each other's cursors. Server-side Node Y.Doc client joins the same room and appends text both tabs see.
Gate:  two tabs plus server all edit one doc, cursors visible.
Days 4-6 - The agent brain, typed not spoken
Orchestrator module holding state (history, pending, speaking, cancelled). Claude called with system prompt plus the live document each turn. edit_doc tool (exact find/replace, descriptive errors, three-retry cap). Throttled insertion so text types in like a person. search_web as a stub for now. Drive it all from a temporary text box.
Gate:  a typed instruction visibly rewrites the document. This alone is a real demo.
Days 7-9 - Hearing you (speech in)
AudioWorklet downsampling mic audio to 16kHz PCM16, echo cancellation on. Push-to-talk. AssemblyAI streaming socket. Partial transcripts as ghost text; final transcript to the orchestrator. Test with speakers, not headphones.
Gate:  hold key, speak, release, final transcript in console under a second.
Days 10-11 - Talking back and interruption
ElevenLabs streaming (browser voice wired first as fallback behind a flag). Speak text blocks first, fire-and-forget. Barge-in: a key press while speaking cancels TTS and flushes the browser audio buffer, then begins capture.
Gate:  cutting the agent off mid-sentence works cleanly; voice and edit both stop.
Days 12-13 - Search out loud and polish
Replace the stub with Tavily. Cap three results, truncate, return source URLs. Spoken acknowledgement before the search runs. Speak the finding in one sentence and write the fuller version plus source into the doc. Test typing while the agent writes.
Gate:  factual question, acknowledgement within a second, written in with source within ten.
Days 14-15 - Rehearse and demo insurance
Fixture document that resets on one keystroke. Text-input fallback feeding the same path. 60-second backup screen recording. Full test checklist. 90-second script rehearsed to five clean runs in a row.
Gate:  five identical clean runs, one-key reset between them.
Cut list if you fall behind: drop ElevenLabs (browser voice demos fine) and any long-document retrieval. Neither changes what judges see. Anything after the interruption work is an amplifier, not the concept.

## 11. Test checklist

Speak a tightening instruction: the correct passage changes, nothing else moves.
Speak an append instruction: text lands at the end, streams in visibly.
Ask a factual question: acknowledgement within a second, finding within ten.
Interrupt mid-sentence: audio stops inside 200 ms, new instruction is honoured.
Interrupt mid-edit: insertion halts, document is not left mid-word in a broken state.
Type in the editor while the agent writes: no corruption, no lost characters.
Give a deliberately ambiguous instruction: it acts rather than stalling.
Reference something by position ("the second paragraph"): resolves correctly.
Run with speakers rather than headphones: no self-transcription loop.
Reset the fixture and repeat: identical behaviour.

## 12. Demo plan (90 seconds)

Time
You do
Audience sees
0:00
Doc holds two rough paragraphs
A normal document
0:10
"Tighten the second paragraph."
Agent cursor appears, text rewrites in place
0:35
"Find the current figure for X and add it."
"Let me check that," then it speaks the finding while writing it in
1:10
Interrupt mid-sentence, redirect
It stops cleanly and follows the new instruction
1:25
One line on what is real vs stubbed
Credibility

Beat three is the one people remember, because interruption is the thing that separates a real voice pipeline from a demo video.
Be honest about the split. State plainly which parts are AssemblyAI (transcription, turn detection), which is Claude (reasoning, tool calls), which is Tavily (search), and which you wrote yourself (orchestration, CRDT integration, the throttled typing effect). The orchestration is the genuinely interesting engineering, and judges can tell when a submission overstates what a sponsor API does.

## 13. Risks and hard problems

Problem
Mitigation
Agent text never appears in editor
Y field name mismatch; log the doc keys and match Tiptap's field
Agent transcribes itself in a loop
echoCancellation on; test with speakers, not headphones
Long silence after every question
Speak text blocks before running tools, never after
Edits land as one instant blob
Reduce chunk size and delay until it looks like fast human typing
Interruption does not stop audio
Send stop, and clear the browser audio buffer client-side
Garbled or empty transcripts
AudioContext rate must equal the declared sample rate
Undo corrupts the document
Disable ProseMirror's own history; Yjs owns undo

## 14. Cost model

A hackathon build and rehearsals cost a few dollars total. Streaming STT is roughly $0.45 per audio hour (about $4.50 across ten hours of development audio). Claude turns are a few dollars. ElevenLabs bills per character, pennies to a couple of dollars across all rehearsals. Tavily's free tier of 1,000 credits a month covers the whole project. Push-to-talk is also a cost control: you only pay for audio while the key is held, not for an always-open microphone.

## 15. Out of scope for now

Intent classification to retire push-to-talk, retrieval for long documents, multi-user with the agent as a shared participant, and agent-initiated suggestions when it notices something while you work. All are natural next steps once the core loop is solid, and none belong in the 15-day build.
