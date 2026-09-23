/**
 * Push-to-talk speech input: microphone → AssemblyAI streaming → one
 * instruction per press.
 *
 * The browser talks to AssemblyAI directly with a temporary token from the
 * agent process; the permanent key never reaches this file (design D19). One
 * session is reused across presses and terminated after STT_IDLE_CLOSE_MS
 * with no press (design D20). Every end-of-turn inside a press becomes one
 * instruction (design D23).
 */

import { startMic, stopMic } from './mic.js';
import {
  buildStreamUrl,
  parseServerMessage,
  latestTurns,
  assembleUtterance,
  FORCE_ENDPOINT,
  TERMINATE,
} from '../stt-protocol.js';
import {
  INSTRUCTION_PORT,
  STT_TOKEN_PATH,
  STT_SAMPLE_RATE,
  STT_FRAME_SAMPLES,
  STT_IDLE_CLOSE_MS,
  STT_FINAL_WAIT_MS,
} from '../config.js';

const TOKEN_URL = `http://localhost:${INSTRUCTION_PORT}${STT_TOKEN_PATH}`;

const FRAME_MS = (STT_FRAME_SAMPLES / STT_SAMPLE_RATE) * 1000;

// Frames held while the session connects are capped at 5 s (design D20).
const MAX_PENDING_FRAMES = Math.ceil(5000 / FRAME_MS);

// If every turn in the press has already ended when the key comes up (the
// speaker paused before releasing), ForceEndpoint may have nothing to end and
// send nothing back. Wait only briefly for a new turn instead of the full
// STT_FINAL_WAIT_MS, so a pause before release doesn't cost the latency budget.
const ENDED_GRACE_MS = 500;

/**
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onPartial  ghost text for the current press ('' at press start)
 * @param {(text: string) => void} handlers.onFinal    the press's instruction ('' if nothing was heard)
 * @param {(message: string) => void} handlers.onError a user-facing reason the press failed
 */
export function createSpeechInput({ onPartial, onFinal, onError }) {
  let session = null; // { ws, ready, closed, openedAt }
  let pending = []; // frames captured before the session's Begin
  let press = null; // the press being held or awaiting its final turn
  let lastTurnOrder = -1; // highest turn_order owned by a finished press
  let idleTimer = null;

  // ------------------------------------------------------------ session

  function openSession() {
    const s = { ws: null, ready: false, closed: false, openedAt: performance.now() };
    session = s;
    pending = [];
    // turn_order restarts at 0 in every session; stale numbering from a
    // previous session would make this session's first turns look "late".
    lastTurnOrder = -1;

    (async () => {
      let res;
      try {
        res = await fetch(TOKEN_URL, { cache: 'no-store' });
      } catch (err) {
        return failSession(s, `Could not reach the agent for a speech token: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) {
        return failSession(s, body.message || `Speech token request failed (${res.status})`);
      }
      if (s.closed) return;

      const ws = new WebSocket(buildStreamUrl(body.token));
      ws.binaryType = 'arraybuffer';
      s.ws = ws;
      ws.onmessage = (event) => handleMessage(s, event.data);
      ws.onclose = (event) => {
        if (s.closed) return;
        failSession(s, `Speech session closed unexpectedly (${event.code}${event.reason ? ` ${event.reason}` : ''})`);
      };
    })();
  }

  function failSession(s, message) {
    s.closed = true;
    if (s.ws && s.ws.readyState <= WebSocket.OPEN) s.ws.close();
    if (session === s) {
      session = null;
      pending = [];
    }
    if (press) abortPress(press, message);
    else console.warn('[stt]', message);
  }

  function closeSession(reason) {
    clearTimeout(idleTimer);
    const s = session;
    if (s) {
      s.closed = true;
      session = null;
      pending = [];
      // Terminate is what stops billing (design D20). A socket still
      // connecting can only be closed.
      if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(TERMINATE);
      else s.ws?.close();
      console.log(`[stt] session closed: ${reason}`);
    }
    stopMic();
  }

  function scheduleIdleClose() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => closeSession(`idle ${STT_IDLE_CLOSE_MS / 1000} s`), STT_IDLE_CLOSE_MS);
  }

  function handleMessage(s, data) {
    const message = parseServerMessage(data);
    if (!message || s.closed) return;

    if (message.type === 'Begin') {
      s.ready = true;
      console.log(`[stt] session ready in ${Math.round(performance.now() - s.openedAt)} ms`);
      for (const frame of pending) s.ws.send(frame);
      pending = [];
      if (press?.released && !press.forcedAt) forceEndpoint(press);
      return;
    }

    if (message.type === 'Termination') {
      console.log(`[stt] terminated: ${message.session_duration_seconds} s session, ${message.audio_duration_seconds} s audio`);
      return;
    }

    if (message.type !== 'Turn' || !press) return;
    // A late message for a turn an earlier press already claimed.
    if (message.turn_order <= lastTurnOrder) return;

    const p = press;
    p.turns.push(message);
    if (p.firstPartialMs === undefined && message.transcript) {
      p.firstPartialMs = performance.now() - p.startedAt;
    }
    onPartial(displayText(p.turns));

    if (!p.forcedAt) return;
    const lastOrder = Math.max(...p.turns.map((turn) => turn.turn_order));
    if (message.end_of_turn && message.turn_order >= lastOrder) {
      finishPress(p, false);
    } else if (!message.end_of_turn) {
      // A turn is still in progress: allow the full wait, measured from release.
      armFinalTimer(p, STT_FINAL_WAIT_MS - (performance.now() - p.forcedAt));
    }
  }

  // ------------------------------------------------------------ press

  function handleFrame(frame) {
    if (!press || press.released) return; // audio is gated, not the socket
    const s = session;
    if (s?.ready && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(frame);
      return;
    }
    pending.push(frame);
    if (pending.length > MAX_PENDING_FRAMES) {
      abortPress(press, 'The speech service took too long to connect. Try again.');
    }
  }

  function startPress() {
    if (press && !press.released) return;
    if (press) finishPress(press, true); // pressed again while the last one was finishing
    clearTimeout(idleTimer);

    const p = { turns: [], startedAt: performance.now(), released: false };
    press = p;
    onPartial('');

    if (!session) openSession();
    startMic(handleFrame).catch((err) => {
      abortPress(p, err.message);
      // No microphone means no audio is coming: don't keep a billed session open.
      closeSession('microphone unavailable');
    });
  }

  function endPress() {
    const p = press;
    if (!p || p.released) return;
    p.released = true;
    p.releasedAt = performance.now();
    // If the session isn't ready yet, Begin flushes the buffered audio and
    // forces the endpoint itself.
    if (session?.ready) forceEndpoint(p);
  }

  function forceEndpoint(p) {
    p.forcedAt = performance.now();
    session.ws.send(FORCE_ENDPOINT);
    const turns = latestTurns(p.turns);
    const allEnded = turns.length > 0 && turns.every((turn) => turn.end_of_turn);
    armFinalTimer(p, allEnded ? Math.min(ENDED_GRACE_MS, STT_FINAL_WAIT_MS) : STT_FINAL_WAIT_MS);
  }

  function armFinalTimer(p, ms) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => finishPress(p, true), Math.max(0, ms));
  }

  function finishPress(p, timedOut) {
    if (p.done) return;
    p.done = true;
    clearTimeout(p.timer);
    if (press === p) press = null;

    const turns = latestTurns(p.turns);
    for (const turn of turns) lastTurnOrder = Math.max(lastTurnOrder, turn.turn_order);

    let text = assembleUtterance(p.turns);
    const tail = turns.at(-1);
    if (timedOut && tail && !tail.end_of_turn && tail.transcript.trim()) {
      // Design D23: a slightly unformatted instruction beats a dropped one.
      console.warn(`[stt] no final turn within ${STT_FINAL_WAIT_MS} ms of release; using the latest partial`);
      text = [text, tail.transcript.trim()].filter(Boolean).join(' ');
    }

    // Task 21.5: the numbers Gate B and joint acceptance read off.
    const firstPartial = p.firstPartialMs === undefined ? 'none' : `${Math.round(p.firstPartialMs)} ms`;
    const toFinal = p.releasedAt === undefined ? 'n/a' : `${Math.round(performance.now() - p.releasedAt)} ms`;
    console.log(
      `[stt] press: key-down→first partial ${firstPartial}, key-up→final ${toFinal}` +
        `${timedOut ? ' (timed out)' : ''}, ${text.length} chars`,
    );

    onFinal(text);
    scheduleIdleClose();
  }

  function abortPress(p, message) {
    if (p.done) return;
    p.done = true;
    clearTimeout(p.timer);
    if (press === p) press = null;
    pending = [];
    onError(message);
    scheduleIdleClose();
  }

  // Same hook the editor uses to withdraw presence (design D10).
  window.addEventListener('pagehide', () => closeSession('page hidden'));

  // Design D32: open the session on page load rather than waiting for the
  // first press, so a cold press doesn't pay the ~2.5-2.8s of setup latency
  // measured in Milestone C. The idle timer closes it the same as any other
  // session if nobody presses. The microphone itself is untouched here — no
  // permission prompt, no recording indicator — until the first press.
  openSession();
  scheduleIdleClose();

  return { startPress, endPress };
}

function displayText(turns) {
  return latestTurns(turns)
    .map((turn) => turn.transcript.trim())
    .filter(Boolean)
    .join(' ');
}
