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

- Node.js (v18 or higher)
- npm

### Installation

```bash
npm install
```

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

### Important: Start Order

You must start the processes in this exact order:
1. WebSocket Relay (`npm run dev:ws`)
2. Web Browser Client (`npm run dev:web`)
3. Server-side Agent (`npm run dev:agent`)

The agent needs the relay to be running to connect. The browser client will automatically reconnect if the relay starts later.

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

### Server-side Agent
- Joins the same Yjs room as browser clients
- Can read document content via `readDoc()`
- Can append text via `appendText()`
- Appears as "Assistant" participant with purple caret

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

### Connection issues
- Verify WebSocket relay is running on port 1234
- Check that `WS_URL` uses `localhost` (not `127.0.0.1`)
- Ensure no firewall blocking port 1234

## Development

### Project Structure

```
src/
├── config.js              # Shared configuration constants
└── agent/
    ├── index.js           # Entry point for dev:agent
    ├── doc-client.js      # Server-side participant implementation
    └── seed-harness.js    # Verification harness
```

### npm Scripts

- `dev:ws`: Start WebSocket relay on port 1234
- `dev:web`: Start Vite dev server for browser client
- `dev:agent`: Start server-side agent

## License

MIT