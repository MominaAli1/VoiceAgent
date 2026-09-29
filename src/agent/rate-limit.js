/**
 * Per-visitor spending limits for the public deployment (design D42).
 *
 * Every visitor spends the team's Groq, AssemblyAI and Tavily credit, so a
 * runaway loop or a bored visitor can take the demo down. These counters are
 * in memory: they reset when the service restarts, and they are per instance.
 * That is deliberate — they exist to bound accidental spending, not to stop a
 * determined attacker, and a hackathon deployment has neither a database nor a
 * reason to add one.
 *
 * `/cancel` is never limited: stopping the agent must always work.
 */

import {
  RATE_LIMIT_TOKENS_PER_MIN,
  RATE_LIMIT_INSTRUCTIONS_PER_MIN,
  RATE_LIMIT_DAILY,
} from '../config.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** @type {Map<string, { minute: Map<string, number[]>, day: number[] }>} */
const visitors = new Map();

/**
 * The visitor's address. Behind a host like Render the socket address is the
 * proxy's, so the forwarded header is the real one; its first entry is the
 * client.
 * @param {import('node:http').IncomingMessage} req
 */
export function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function prune(times, window, now) {
  while (times.length && now - times[0] > window) times.shift();
}

/**
 * Record a request and say whether it is allowed.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {'token'|'instruction'} kind
 * @returns {{ allowed: true } | { allowed: false, message: string }}
 */
export function checkRateLimit(req, kind) {
  const key = clientKey(req);
  const now = Date.now();

  let visitor = visitors.get(key);
  if (!visitor) {
    visitor = { minute: new Map(), day: [] };
    visitors.set(key, visitor);
  }

  prune(visitor.day, DAY, now);
  if (visitor.day.length >= RATE_LIMIT_DAILY) {
    return { allowed: false, message: 'Daily limit reached for this demo. Try again tomorrow.' };
  }

  const perMinute = kind === 'token' ? RATE_LIMIT_TOKENS_PER_MIN : RATE_LIMIT_INSTRUCTIONS_PER_MIN;
  const times = visitor.minute.get(kind) ?? [];
  prune(times, MINUTE, now);
  if (times.length >= perMinute) {
    const waitS = Math.ceil((MINUTE - (now - times[0])) / 1000);
    return {
      allowed: false,
      message: kind === 'token'
        ? `Too many speech requests. Wait ${waitS}s and try again.`
        : `Too many instructions. Wait ${waitS}s and try again.`,
    };
  }

  times.push(now);
  visitor.minute.set(kind, times);
  visitor.day.push(now);

  // Keep the map from growing without bound on a long-lived instance.
  if (visitors.size > 5000) {
    for (const [k, v] of visitors) {
      prune(v.day, DAY, now);
      if (!v.day.length) visitors.delete(k);
    }
  }

  return { allowed: true };
}
