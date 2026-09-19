# Voice Doc Agent

A real-time voice + document agent: a document you can talk to.

## Overview

This project implements a collaborative document editor where a server-side agent can read and write to the document alongside browser-based users. The agent joins the same Yjs room as the browser clients, enabling real-time collaboration.

## Tech Stack

- **Editor:** Tiptap (ProseMirror) with Yjs collaboration
- **Shared State:** Yjs + y-websocket
- **Server:** Node.js single process
- **Build Tool:** Vite

## Getting Started

### Prerequisites

- Node.js (v20.6 or higher)
- npm
- A free Groq API key
- A free AssemblyAI API key (for speaking instructions; optional — typing works without it)
- A microphone, and Chrome or Edge

### Installation

```bash
npm install
```

### API key setup

1. Get a free Groq key at https://console.groq.com/keys
2. Get a free AssemblyAI key from the **API Keys** page of your AssemblyAI dashboard (https://www.assemblyai.com/dashboard)
3. Copy the template and paste each key after its `=`:
   ```bash
   cp .env.example .env
   ```
4. Never commit `.env`. It's already in `.gitignore`. Each person uses their own keys.

The AssemblyAI key stays on the agent process. The browser never sees it: it asks
the agent for a short-lived pass at `/stt-token` instead. Without the key, the agent
prints a warning at startup, typed instructions still work, and pressing to talk
shows "ASSEMBLYAI_API_KEY is not set on the agent process".

### Running the Application

The application consists of three processes that must be started in this order:

1. **WebSocket Relay** (port 1234)
   ```bash
   npm run dev:ws
   ```

2. **Web Browser Client** (Vite dev server)
   ```bash
   npm run dev:web
   ```
   The editor will be available at: http://localhost:5173

3. **Server-side Agent**
   ```bash
   npm run dev:agent
   ```
   The agent also accepts typed instructions at http://localhost:3001/instruction —
   use the instruction box at the bottom of the editor page.

### Important: Start Order

You must start the processes in this exact order:
1. WebSocket Relay (`npm run dev:ws`)
2. Web Browser Client (`npm run dev:web`)
3. Server-side Agent (`npm run dev:agent`)

The agent needs the relay to be running to connect. The browser client will automatically reconnect if the relay starts later.

### Speaking an instruction

1. Open http://localhost:5173 in Chrome or Edge and allow the microphone when asked.
2. **Hold Right Ctrl** (or hold the **Hold to talk** button) and say an instruction that
   refers to text in the document, e.g. *"change rough draft to final draft"*.
3. **Let go.** Your words appear faintly while you speak, turn solid when you release,
   and are sent to the agent exactly like a typed instruction. The status next to
   **Send** shows **Done**, or a red message if the agent couldn't make the edit.

Things to know:

- **The first press takes ~3 s** to connect before your words appear; keep talking,
  nothing is lost. Later presses reuse the connection and are much faster.
- **The connection closes after 60 s without a press**, to save AssemblyAI credit.
  The next press reconnects on its own.
- **Test with speakers, not headphones.** Echo cancellation is on, and speakers are
  the setup that proves the microphone doesn't pick up other audio.
- **The browser pane inside some tools blocks microphones.** Use a normal Chrome or
  Edge window.

To check speech without a browser or microphone, stream a recorded clip through the
same path (the agent must be running):

```bash
node --env-file=.env src/agent/stt-harness.js fixtures/change-rough-draft.wav
```

Add `--submit` to send the transcript to the agent as an instruction.

## Configuration

All configuration is centralized in `src/config.js`:

- `ROOM`: The Yjs room name all participants join
- `WS_URL`: WebSocket relay URL (`ws://localhost:1234`)
- `FIELD`: The Yjs share key for the document (must match Tiptap's Collaboration `field` option)

### Critical: FIELD Matching

The `FIELD` constant must match the `field` option in Tiptap's Collaboration extension. A mismatch will cause:

- `readDoc()` returns empty string with no error
- Agent text never appears in the browser editor
- Share-key log line shows the key but `readDoc()` returns empty

**First troubleshooting step:** Check the share-key diagnostic line in the agent's output on sync.

## Architecture

### Browser Client
- Tiptap editor with Yjs collaboration
- Real-time editing with multiple participants
- Caret and selection visibility for all participants
- Push-to-talk speech input: the microphone streams straight to AssemblyAI using a short-lived pass from the agent

### Server-side Agent
- Joins the same Yjs room as browser clients
- Can read document content via `readDoc()`
- Edits the document from typed or spoken instructions via Groq (`edit_doc` tool)
- Hands the browser short-lived AssemblyAI passes at `/stt-token`, so the API key never leaves the server
- Appears as "Assistant" participant with a teal caret

### Verification Harness
- `src/agent/seed-harness.js` - Test harness for verifying room and transport
- Seeds fixture text for testing
- Can run independently of browser clients

## API Reference

### `src/agent/doc-client.js`

- `connect()`: Create Y.Doc and WebsocketProvider, join room
- `readDoc(doc)`: Read document content as plain text
- `appendText(doc, text)`: Append text as new paragraph

### `src/agent/seed-harness.js`

- `createHarness()`: Create test harness
- `seedDocument(doc, paragraphs)`: Seed document with fixture text
- `readDoc(doc)`: Read document content

## Troubleshooting

### Agent text not appearing in editor
1. Check that `FIELD` matches Tiptap's Collaboration `field` option
2. Verify share-key diagnostic line shows the key
3. Ensure both browser and agent are connected to the same room

### Empty `readDoc()` with no error
- This indicates a field mismatch between browser and agent
- Check that both use the same `FIELD` constant from `src/config.js`

### Pressing to talk doesn't work
- Red "ASSEMBLYAI_API_KEY is not set…": add the key to `.env` and restart the agent
- "Microphone access is blocked…": allow the microphone in the browser's address bar
- "Could not reach the agent for a speech token…": start the agent (`npm run dev:agent`)
- "Didn't catch that": nothing was heard — check the right microphone is selected

### Connection issues
- Verify WebSocket relay is running on port 1234
- Check that `WS_URL` uses `localhost` (not `127.0.0.1`)
- Ensure no firewall blocking port 1234

## Development

### Project Structure

```
src/
├── config.js              # Shared configuration constants
├── palette.js             # Participant colours
├── stt-protocol.js        # AssemblyAI streaming messages, shared by browser and harness
├── web/
│   ├── main.js            # Editor page: collaboration, instruction box, push-to-talk
│   ├── stt.js             # Speech session: pass, AssemblyAI socket, one instruction per press
│   ├── mic.js             # Microphone capture
│   └── pcm-worklet.js     # Converts mic audio to 16 kHz PCM16
└── agent/
    ├── index.js           # Entry point for dev:agent (/instruction and /stt-token)
    ├── orchestrator.js    # Instruction → Groq → tools loop
    ├── llm-client.js      # Groq client and tool schemas
    ├── doc-client.js      # Server-side participant: readDoc, editDoc
    ├── typing.js          # Types agent edits in a few characters at a time
    ├── stt-token.js       # Gets short-lived AssemblyAI passes
    ├── stt-harness.js     # Streams a WAV fixture through the speech path
    └── seed-harness.js    # Verification harness
```

### npm Scripts

- `dev:ws`: Start WebSocket relay on port 1234
- `dev:web`: Start Vite dev server for browser client
- `dev:agent`: Start server-side agent

## License

MIT