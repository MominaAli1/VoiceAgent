/**
 * Participant colours, shared by the browser editor and the server participant.
 *
 * Colours MUST be 6-digit hex. @tiptap/extension-collaboration-caret validates
 * with /^#[0-9a-fA-F]{6}$/ and silently falls back to `transparent` for anything
 * else — named colours and 3-digit hex render an invisible caret and no
 * selection highlight, with no error.
 */

/** Colours handed to human participants. */
export const USER_COLORS = [
  '#e5484d', // red
  '#0090ff', // blue
  '#30a46c', // green
  '#f76b15', // orange
  '#8e4ec6', // purple
  '#e93d82', // pink
];

/** Reserved for the server-side participant. Never handed to a human. */
export const ASSISTANT_COLOR = '#12a594'; // teal

/** Pick a human colour at random, never the reserved one. */
export function randomUserColor() {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}
