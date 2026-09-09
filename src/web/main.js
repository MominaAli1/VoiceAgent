/**
 * Browser editor: Tiptap bound to a Y.Doc over a y-websocket connection.
 *
 * This is one participant in the shared document. The server-side participant
 * (src/agent/) is another, and joins the same room as an equal peer.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';

import { ROOM, WS_URL, FIELD } from '../config.js';
import { randomUserColor } from '../palette.js';

// ---------------------------------------------------------------- identity

// Per-tab, not per-browser: sessionStorage means a second tab is a second
// participant, which is what the two-tab test needs. localStorage would make
// both tabs the same person.
const stored = sessionStorage.getItem('participant');
const me = stored
  ? JSON.parse(stored)
  : { name: `Guest ${Math.floor(Math.random() * 900 + 100)}`, color: randomUserColor() };

function saveMe() {
  sessionStorage.setItem('participant', JSON.stringify(me));
}
saveMe();

// ---------------------------------------------------------------- transport

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(WS_URL, ROOM, ydoc);

const statusEl = document.querySelector('#status');
provider.on('status', ({ status }) => {
  statusEl.dataset.state = status;
  statusEl.textContent = status === 'connected' ? `connected · ${ROOM}` : status;
});

provider.once('synced', () => {
  // Mirrors the server participant's diagnostic (design D4). If FIELD is not
  // among these keys, the two sides are addressing different documents.
  console.log('[sync] share keys:', [...ydoc.share.keys()], '| FIELD:', FIELD);
});

// ---------------------------------------------------------------- editor

const editor = new Editor({
  element: document.querySelector('#editor'),
  extensions: [
    // undoRedo:false, NOT history:false — starter-kit v3 has no `history` key,
    // so the old name is silently ignored and leaves ProseMirror history on,
    // which corrupts the shared state. See design.md D2.
    StarterKit.configure({ undoRedo: false }),

    // `field` passed explicitly so both sides are pinned to the same constant
    // rather than relying on the extension's default (design REQ-D1b).
    Collaboration.configure({ document: ydoc, field: FIELD }),

    CollaborationCaret.configure({ provider, user: me }),
  ],
  autofocus: true,
});

// Guard for D2: assert no ProseMirror-native history plugin slipped in. The
// requirement is that none is active, not that a particular key was passed.
const historyish = editor.extensionManager.extensions
  .map((e) => e.name)
  .filter((n) => /^(history|undoRedo)$/i.test(n));
if (historyish.length) {
  console.error(
    '[D2 VIOLATION] ProseMirror history is active:', historyish,
    '— Yjs must own undo. Check StarterKit.configure({ undoRedo: false }).',
  );
} else {
  console.log('[D2 ok] no ProseMirror history plugin active; Yjs owns undo');
}

// ---------------------------------------------------------------- identity UI

const nameEl = document.querySelector('#name');
const swatchEl = document.querySelector('#swatch');

nameEl.value = me.name;
swatchEl.style.background = me.color;

nameEl.addEventListener('input', () => {
  me.name = nameEl.value.trim() || 'Guest';
  saveMe();
  editor.commands.updateUser(me);
});

// ---------------------------------------------------------------- peer list

const peersEl = document.querySelector('#peers');

function renderPeers() {
  const states = [...provider.awareness.getStates().entries()];
  peersEl.replaceChildren(
    ...states
      .filter(([id]) => id !== provider.awareness.clientID)
      .map(([, s]) => s.user)
      .filter(Boolean)
      .map((user) => {
        const el = document.createElement('span');
        el.className = 'peer';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = user.color || 'transparent';
        el.append(dot, document.createTextNode(user.name ?? 'anonymous'));
        return el;
      }),
  );
}

provider.awareness.on('change', renderPeers);
renderPeers();

// Withdraw presence promptly on unload. y-websocket registers its exit handler
// for Node only (`env.isNode && process.on('exit')`) and installs nothing in the
// browser, so without this a closed tab's caret and peer chip linger on other
// clients until the ~30s awareness timeout expires.
window.addEventListener('pagehide', () => {
  provider.awareness.setLocalState(null);
});

// Handy for poking at the document from the browser console.
Object.assign(window, { editor, ydoc, provider, Y });
