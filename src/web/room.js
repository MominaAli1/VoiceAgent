/**
 * The room this visitor is editing (design D41, Milestone F).
 *
 * The room name comes from the page URL (`?room=<id>`). A visitor arriving
 * without one gets a fresh id, written back into the URL, so they land in
 * their own document rather than in everyone else's. Sharing the URL is how
 * two people deliberately end up in the same document.
 *
 * With no `?room=` and no rewrite possible, this falls back to the configured
 * default, so local development and the harness behave exactly as before.
 */

import { ROOM } from '../config.js';

const PARAM = 'room';
const ID_LENGTH = 10;

function generateId() {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  // Base36 keeps it short, URL-safe and easy to read aloud.
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
}

function resolveRoom() {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get(PARAM);
  if (existing) return existing;

  const id = generateId();
  url.searchParams.set(PARAM, id);
  // replaceState, not assign: no reload, and the back button is untouched.
  window.history.replaceState({}, '', url);
  return id;
}

export const ROOM_ID = typeof window === 'undefined' ? ROOM : resolveRoom();

/** The shareable link for this room — two people on it edit the same document. */
export function roomLink() {
  return window.location.href;
}
