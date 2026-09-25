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

import { ROOM, WS_URL, FIELD, INSTRUCTION_PORT, INSTRUCTION_PATH, CANCEL_PATH, PTT_KEY_CODE, SEARCH_ACK } from '../config.js';
import { randomUserColor } from '../palette.js';
import { createSpeechInput } from './stt.js';
import { speak, stop as stopSpeaking, onSpeaking } from './tts.js';

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
    //
    // link:false — StarterKit registers @tiptap/extension-link with
    // autolink:true by default. A URL streamed in by the agent (Milestone E,
    // task 35.3) is followed by whitespace like any other text, which would
    // trigger autolink's appendTransaction and wrap it in a link mark on
    // every tab independently. The task calls for plain text, not link
    // parsing, so the extension is disabled outright rather than relying on
    // remote-sync transactions happening not to trigger it.
    StarterKit.configure({ undoRedo: false, link: false }),

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

// ---------------------------------------------------------------- typed instruction (Milestone B)

// This form only reports whether the server *accepted* the instruction. The
// resulting edit (once the agent brain exists — Rumaisa's Track B) arrives
// through the same Yjs sync this page already watches, the same way any
// other participant's edit would — there is no second notification path.
const instructionForm = document.querySelector('#instruction-form');
const instructionInput = document.querySelector('#instruction-input');
const instructionSubmit = document.querySelector('#instruction-submit');
const instructionStatus = document.querySelector('#instruction-status');

const INSTRUCTION_URL = `http://localhost:${INSTRUCTION_PORT}${INSTRUCTION_PATH}`;
const CANCEL_URL = `http://localhost:${INSTRUCTION_PORT}${CANCEL_PATH}`;

// The turnId from the most recently accepted instruction (task 29.1).
let lastTurnId = null;

instructionForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = instructionInput.value.trim();
  if (!text) return;

  instructionSubmit.disabled = true;
  instructionStatus.dataset.state = 'pending';
  instructionStatus.textContent = 'Sending…';

  try {
    const res = await fetch(INSTRUCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `from` is this tab's awareness clientID (design D27) — replies
      // addressed to it are the only ones this tab speaks.
      body: JSON.stringify({ text, from: provider.awareness.clientID }),
    });

    if (res.status === 202) {
      const body = await res.json().catch(() => ({}));
      lastTurnId = body.turnId ?? null;
      instructionInput.value = '';
      instructionStatus.dataset.state = 'sent';
      instructionStatus.textContent = 'Sent';
    } else {
      const body = await res.json().catch(() => ({}));
      instructionStatus.dataset.state = 'error';
      instructionStatus.textContent = body.message || `Error (${res.status})`;
    }
  } catch (err) {
    // The agent process isn't running, or isn't listening yet — surface it,
    // don't fail silently.
    instructionStatus.dataset.state = 'error';
    instructionStatus.textContent = `Could not reach the agent: ${err.message}`;
  } finally {
    instructionSubmit.disabled = false;
  }
});

// ---------------------------------------------------------------- spoken replies (Milestone D)

// The Assistant publishes each reply on its awareness `reply` field (design
// D27). Every tab shows it; only the tab whose clientID matches `to` speaks
// it — otherwise a two-tab demo would speak every reply twice.
const assistantReplyEl = document.querySelector('#assistant-reply');

onSpeaking((speaking) => {
  assistantReplyEl.dataset.state = speaking ? 'speaking' : 'idle';
});

// ---------------------------------------------------------------- search out loud (Milestone E)

// A search has no visible sign it's in flight otherwise — distinct from
// "speaking" (assistant-reply, above) and from the streaming edit itself
// (task 35.2). The reply/lastResult/cancel contract (design D27/D28) is
// reused unchanged; a "search is running" signal isn't part of it, so this
// infers it from the one guaranteed tell: the orchestrator's own fallback
// acknowledgement text (design D35, SEARCH_ACK) arriving on the `reply`
// field. A model that writes its own acknowledgement instead of the canned
// line won't trigger this — there is no field in the pinned reply shape that
// says "a search is about to run" to catch that case.
const agentStatusEl = document.querySelector('#agent-status');

function setSearching(searching) {
  agentStatusEl.dataset.state = searching ? 'searching' : 'idle';
}

// The Assistant publishes each instruction's outcome as `lastResult`, and
// each reply as `reply`, on the same awareness state — one scan per change
// event covers both. A cancelled turn is not a failure; it shows "Stopped"
// (task 29.4).
let lastResultAt = 0;
let lastReplyAt = 0;
provider.awareness.on('change', () => {
  for (const [, state] of provider.awareness.getStates()) {
    const result = state.lastResult;
    if (result && result.at > lastResultAt) {
      lastResultAt = result.at;
      setSearching(false); // the turn ended or was cancelled either way (task 35.2)
      if (result.error === 'cancelled') {
        instructionStatus.dataset.state = 'stopped';
        instructionStatus.textContent = 'Stopped';
      } else {
        instructionStatus.dataset.state = result.ok ? 'sent' : 'error';
        instructionStatus.textContent = result.ok ? 'Done' : `Couldn't do that: ${result.error}`;
      }
    }

    const reply = state.reply;
    if (reply && reply.at > lastReplyAt) {
      lastReplyAt = reply.at;
      assistantReplyEl.textContent = reply.text;
      if (reply.to === provider.awareness.clientID) {
        speak(reply.text);
      }
      setSearching(reply.text === SEARCH_ACK);
    }
  }
});

// ---------------------------------------------------------------- push-to-talk (Milestone C)

// Holding Right Ctrl or the mic button speaks an instruction. Partials show as
// ghost text outside the document (design D24); the final transcript goes
// through the typed-instruction form above, unchanged, so its outcome is
// reported the same way.
const transcriptEl = document.querySelector('#transcript');
const pttButton = document.querySelector('#ptt-button');

function showTranscript(state, text) {
  transcriptEl.dataset.state = state;
  transcriptEl.textContent = text;
}

const speech = createSpeechInput({
  onPartial: (text) => showTranscript('partial', text || 'Listening…'),
  onFinal: (text) => {
    if (!text) {
      showTranscript('empty', "Didn't catch that");
      return;
    }
    showTranscript('final', text);
    instructionInput.value = text;
    instructionForm.requestSubmit();
  },
  onError: (message) => showTranscript('error', message),
});

function pressStart() {
  pttButton.dataset.active = 'true';
  // Barge-in order (design D31): stop the voice first (local, instant), then
  // fire-and-forget the cancel request — it must not delay capture, and a
  // lost /cancel costs nothing since the next instruction cancels the old
  // turn server-side anyway (design D28) — then the existing press path.
  stopSpeaking();
  // Clear the searching indicator the same way — immediately, client-side,
  // without waiting for the server's lastResult to confirm the cancel
  // (task 36.3).
  setSearching(false);
  fetch(CANCEL_URL, { method: 'POST' }).catch(() => {});
  speech.startPress();
}

function pressEnd() {
  delete pttButton.dataset.active;
  speech.endPress();
}

// Matched on `code`, so it's layout-independent; Ctrl alone types nothing (design D22).
window.addEventListener('keydown', (event) => {
  if (event.code !== PTT_KEY_CODE) return;
  if (!event.repeat) pressStart();
});
window.addEventListener('keyup', (event) => {
  if (event.code === PTT_KEY_CODE) pressEnd();
});
// Alt-tabbing away mid-press would otherwise never deliver the keyup.
window.addEventListener('blur', pressEnd);

pttButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  pttButton.setPointerCapture(event.pointerId);
  pressStart();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  pttButton.addEventListener(type, pressEnd);
}

// Handy for poking at the document from the browser console.
Object.assign(window, { editor, ydoc, provider, Y });
