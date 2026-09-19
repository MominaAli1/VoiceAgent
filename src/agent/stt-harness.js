/**
 * Node-only streaming harness for Milestone C (task 25.1/25.2).
 *
 * Proves the AssemblyAI path end to end with no browser and no microphone:
 * reads a 16 kHz mono PCM16 WAV fixture, gets a token from the agent's own
 * `STT_TOKEN_PATH`, opens the same streaming socket the browser would (via
 * the shared `src/stt-protocol.js`), streams it at real-time pace in
 * `STT_FRAME_SAMPLES`-sample frames, force-ends the turn, terminates the
 * session, and prints every parsed server message with a timestamp.
 *
 * Usage:
 *   node --env-file=.env src/agent/stt-harness.js <fixture.wav> [--submit]
 *
 * Requires the agent's HTTP server to be running (`npm run dev:agent`) so
 * this can hit STT_TOKEN_PATH for a token, and (with --submit) POST the
 * assembled instruction to INSTRUCTION_PATH.
 */

import fs from 'node:fs';
import { WebSocket } from 'ws';
import {
  buildStreamUrl,
  parseServerMessage,
  assembleUtterance,
  FORCE_ENDPOINT,
  TERMINATE,
} from '../stt-protocol.js';
import { INSTRUCTION_PORT, STT_TOKEN_PATH, INSTRUCTION_PATH, STT_SAMPLE_RATE, STT_FRAME_SAMPLES } from '../config.js';

const TOKEN_URL = `http://localhost:${INSTRUCTION_PORT}${STT_TOKEN_PATH}`;
const INSTRUCTION_URL = `http://localhost:${INSTRUCTION_PORT}${INSTRUCTION_PATH}`;
const FRAME_BYTES = STT_FRAME_SAMPLES * 2; // Int16 little-endian
const FRAME_MS = (STT_FRAME_SAMPLES / STT_SAMPLE_RATE) * 1000;

/**
 * Read a WAV file's PCM samples, checking it is 16-bit mono at
 * STT_SAMPLE_RATE before handing back the raw data past the header.
 *
 * Does a minimal RIFF/WAVE parse: walks chunks looking for `fmt ` and
 * `data` rather than assuming a fixed 44-byte header, since some WAV
 * writers add extra chunks (e.g. `LIST`) before `data`.
 *
 * @param {string} path
 * @returns {Buffer} raw PCM16LE sample data
 */
export function readWavPcm16(path) {
  const buf = fs.readFileSync(path);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (chunkId === 'data') {
      data = buf.subarray(body, body + chunkSize);
    }

    offset = body + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (!fmt) throw new Error(`${path}: no fmt chunk found`);
  if (!data) throw new Error(`${path}: no data chunk found`);

  if (fmt.audioFormat !== 1) {
    throw new Error(`${path}: expected PCM (audioFormat=1), got ${fmt.audioFormat}`);
  }
  if (fmt.numChannels !== 1) {
    throw new Error(`${path}: expected mono, got ${fmt.numChannels} channels`);
  }
  if (fmt.sampleRate !== STT_SAMPLE_RATE) {
    throw new Error(`${path}: expected ${STT_SAMPLE_RATE} Hz, got ${fmt.sampleRate} Hz`);
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`${path}: expected 16-bit samples, got ${fmt.bitsPerSample}-bit`);
  }

  return data;
}

/** Split raw PCM16LE data into fixed STT_FRAME_SAMPLES-sample frames (last frame zero-padded). */
export function frameify(pcm) {
  const frames = [];
  for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
    const chunk = pcm.subarray(i, i + FRAME_BYTES);
    if (chunk.length === FRAME_BYTES) {
      frames.push(chunk);
    } else {
      const padded = Buffer.alloc(FRAME_BYTES);
      chunk.copy(padded);
      frames.push(padded);
    }
  }
  return frames;
}

function log(t0, ...args) {
  console.log(`[+${(performance.now() - t0).toFixed(0)}ms]`, ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchToken() {
  const res = await fetch(TOKEN_URL, { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `token request failed (${res.status})`);
  return body.token;
}

async function submitInstruction(text) {
  const res = await fetch(INSTRUCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/**
 * Run the harness against one WAV fixture.
 * @param {string} wavPath
 * @param {{ submit?: boolean }} [opts]
 * @returns {Promise<{ turns: object[], finalText: string }>}
 */
export async function runHarness(wavPath, opts = {}) {
  const t0 = performance.now();
  const pcm = readWavPcm16(wavPath);
  const frames = frameify(pcm);
  log(t0, `loaded ${wavPath}: ${pcm.length} bytes, ${frames.length} frames (${(frames.length * FRAME_MS / 1000).toFixed(2)}s)`);

  const token = await fetchToken();
  log(t0, 'got streaming token');

  const ws = new WebSocket(buildStreamUrl(token));
  ws.binaryType = 'nodebuffer';

  const turns = [];
  let began = false;

  await new Promise((resolve, reject) => {
    ws.on('open', () => log(t0, 'socket open'));
    ws.on('error', reject);
    ws.on('message', (data) => {
      const message = parseServerMessage(data.toString());
      if (!message) return;
      log(t0, message.type, JSON.stringify(message));
      if (message.type === 'Begin') began = true;
      if (message.type === 'Turn') turns.push(message);
      if (message.type === 'Termination') resolve();
    });

    (async () => {
      // Wait for Begin before sending audio (mirrors the browser buffering
      // real frames captured before Begin — here we just wait, since the
      // whole file is already in memory).
      while (!began) await sleep(20);
      log(t0, 'streaming frames at real-time pace...');
      for (const frame of frames) {
        ws.send(frame);
        await sleep(FRAME_MS);
      }
      log(t0, 'sending ForceEndpoint');
      ws.send(FORCE_ENDPOINT);
      // Give the server a moment to emit the final end_of_turn before we
      // terminate the session out from under it.
      await sleep(1500);
      log(t0, 'sending Terminate');
      ws.send(TERMINATE);
    })().catch(reject);
  });

  ws.close();

  const finalText = assembleUtterance(turns);
  log(t0, `assembled instruction: ${JSON.stringify(finalText)}`);

  if (opts.submit) {
    if (!finalText) {
      log(t0, '--submit given but transcript is empty; not submitting');
    } else {
      const { status, body } = await submitInstruction(finalText);
      log(t0, `POST ${INSTRUCTION_PATH} -> ${status}`, JSON.stringify(body));
    }
  }

  return { turns, finalText };
}

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('stt-harness.js') ||
  process.argv[1].endsWith('stt-harness')
);

if (isMainModule) {
  const args = process.argv.slice(2);
  const submit = args.includes('--submit');
  const wavPath = args.find((a) => !a.startsWith('--'));

  if (!wavPath) {
    console.error('Usage: node --env-file=.env src/agent/stt-harness.js <fixture.wav> [--submit]');
    process.exit(1);
  }

  runHarness(wavPath, { submit })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('stt-harness failed:', err);
      process.exit(1);
    });
}
