/**
 * Microphone capture for push-to-talk (design D21).
 *
 * The AudioContext runs at the device's native rate and the worklet does the
 * downsampling, so the rate declared to AssemblyAI is always the rate sent —
 * the brief's "Garbled or empty transcripts" risk.
 */

import workletUrl from './pcm-worklet.js?url';
import { STT_SAMPLE_RATE, STT_FRAME_SAMPLES } from '../config.js';

const FRAME_BYTES = STT_FRAME_SAMPLES * 2;

let mic = null;

/**
 * Start capturing. Resolves once audio is flowing; every frame after that is
 * handed to `onFrame` as an ArrayBuffer of exactly FRAME_BYTES bytes.
 * Calling it again while already capturing is a no-op.
 *
 * Rejects with an Error whose message is fit to show the user when the
 * microphone is blocked or missing.
 *
 * @param {(frame: ArrayBuffer) => void} onFrame
 */
export async function startMic(onFrame) {
  if (mic) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    throw new Error(describeMicError(err));
  }

  const context = new AudioContext();
  await context.audioWorklet.addModule(workletUrl);
  // Created after an await, so the press's user activation may not carry over.
  await context.resume();

  const source = context.createMediaStreamSource(stream);
  // No outputs: nothing is played back, and a node with zero outputs is still
  // pulled by the audio graph without being wired to the destination.
  const worklet = new AudioWorkletNode(context, 'pcm-downsampler', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { targetRate: STT_SAMPLE_RATE, frameSamples: STT_FRAME_SAMPLES },
  });

  let sizeError = false;
  worklet.port.onmessage = ({ data }) => {
    // Task 20.4: a wrong frame size means the declared format is a lie.
    if (data.byteLength !== FRAME_BYTES) {
      if (!sizeError) {
        console.error(`[mic] frame is ${data.byteLength} bytes, expected ${FRAME_BYTES} — audio would be garbled`);
        sizeError = true;
      }
      return;
    }
    onFrame(data);
  };

  source.connect(worklet);
  mic = { stream, context };

  const ratio = context.sampleRate / STT_SAMPLE_RATE;
  console.log(
    `[mic] native ${context.sampleRate} Hz → ${STT_SAMPLE_RATE} Hz (ratio ${ratio.toFixed(4)}), ` +
      `${STT_FRAME_SAMPLES}-sample frames`,
  );
}

/** Release the microphone and audio graph. Safe to call when not capturing. */
export function stopMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((track) => track.stop());
  mic.context.close();
  mic = null;
}

function describeMicError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it in the browser address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found.';
    case 'NotReadableError':
      return 'The microphone is in use by another app.';
    default:
      return `Could not start the microphone: ${err?.message ?? err}`;
  }
}
