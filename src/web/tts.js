/**
 * Spoken replies via the browser's built-in `speechSynthesis` (design D26).
 *
 * `TTS_ENGINE` is pinned to `'browser'` for this milestone — no ElevenLabs,
 * no audio library, no key. Chrome truncates and can stall an utterance
 * around ~15s of speech, so reply text is split into sentences (further
 * splitting any sentence over `TTS_MAX_SENTENCE_CHARS`) and spoken one at a
 * time from a queue *this module* drives — never `speechSynthesis`'s own
 * internal queue — which is also what makes `stop()` land almost instantly,
 * between sentences rather than mid-utterance.
 */

import { TTS_MAX_SENTENCE_CHARS } from '../config.js';

let warnedUnsupported = false;
let warnedError = false;

function supported() {
  const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
  if (!ok && !warnedUnsupported) {
    warnedUnsupported = true;
    console.warn('[tts] speechSynthesis is not available in this browser; replies will not be spoken.');
  }
  return ok;
}

/**
 * Split `text` into sentences, then further split any sentence longer than
 * `TTS_MAX_SENTENCE_CHARS` on word boundaries.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  const rough = text.trim().match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [text.trim()];

  const sentences = [];
  for (const raw of rough) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length <= TTS_MAX_SENTENCE_CHARS) {
      sentences.push(sentence);
      continue;
    }

    let piece = '';
    for (const word of sentence.split(/\s+/)) {
      const next = piece ? `${piece} ${word}` : word;
      if (next.length > TTS_MAX_SENTENCE_CHARS && piece) {
        sentences.push(piece);
        piece = word;
      } else {
        piece = next;
      }
    }
    if (piece) sentences.push(piece);
  }
  return sentences;
}

let queue = [];
let speaking = false;
// Bumped by stop() so an in-flight utterance's onend/onerror, which fires
// asynchronously, becomes a no-op instead of resurrecting a stopped queue.
let generation = 0;
let onSpeakingChange = null;

function setSpeaking(next) {
  if (speaking === next) return;
  speaking = next;
  onSpeakingChange?.(speaking);
}

function playNext(myGeneration) {
  if (myGeneration !== generation) return;

  const next = queue.shift();
  if (!next) {
    setSpeaking(false);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(next);
  utterance.onend = () => playNext(myGeneration);
  utterance.onerror = (event) => {
    if (!warnedError) {
      warnedError = true;
      console.warn('[tts] speechSynthesis error (continuing silently):', event.error);
    }
    playNext(myGeneration);
  };

  try {
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    if (!warnedError) {
      warnedError = true;
      console.warn('[tts] speak() failed (continuing silently):', err.message);
    }
    playNext(myGeneration);
  }
}

/**
 * Register a callback fired with `true`/`false` whenever speaking starts or
 * stops — the UI's "speaking" indicator (task 28.4).
 * @param {(speaking: boolean) => void} callback
 */
export function onSpeaking(callback) {
  onSpeakingChange = callback;
}

/**
 * Speak `text`. Appends to whatever is already queued/speaking rather than
 * interrupting it — callers that want to interrupt call `stop()` first
 * (design D31).
 * @param {string} text
 */
export function speak(text) {
  if (!supported() || !text || !text.trim()) return;

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return;

  queue.push(...sentences);
  if (!speaking) {
    setSpeaking(true);
    playNext(generation);
  }
}

/** Stop speaking immediately and clear the queue (design D31 step 1). */
export function stop() {
  generation += 1;
  queue = [];
  if (supported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Best-effort — nothing else to do if cancel() itself throws.
    }
  }
  setSpeaking(false);
}

/** @returns {boolean} whether tts is currently speaking or has text queued */
export function isSpeaking() {
  return speaking;
}
