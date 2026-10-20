// What is in the tray, and the rules for changing it (the d20 is sacred):
// - The tray is never empty. It opens with one d20 that is a placeholder.
// - The first die the player adds replaces the placeholder, whatever its kind: 1 on a fresh tray gives one d6,
//   3 gives one (now real) d20.
// - 5 clears the tray back to one placeholder d20; so does removing the last die any other way.
// - Up to MAX_DICE dice; one more is refused and nothing changes.
// Pure functions on plain objects, so test/tray.test.mjs can check every rule without a browser.

export const KINDS = ['d6', 'd10', 'd20', 'd100'];
export const MAX_DICE = 5;

// The number keys while the board is open: 1 to 4 add a die, 5 clears.
export const KEY_KINDS = { 1: 'd6', 2: 'd10', 3: 'd20', 4: 'd100' };

export const fresh = () => ({ d6: 0, d10: 0, d20: 1, d100: 0, placeholder: true });

export const total = (t) => KINDS.reduce((s, k) => s + (t[k] || 0), 0);

export const counts = (t) => ({ d6: t.d6, d10: t.d10, d20: t.d20, d100: t.d100 });

/** One more `kind`. Returns { tray, refused } and never changes `t` itself. */
export function add(t, kind) {
  if (!KINDS.includes(kind)) return { tray: t, refused: false };
  if (t.placeholder) return { tray: { d6: 0, d10: 0, d20: 0, d100: 0, [kind]: 1, placeholder: false }, refused: false };
  if (total(t) >= MAX_DICE) return { tray: t, refused: true };
  return { tray: { ...t, [kind]: t[kind] + 1 }, refused: false };
}

/** One less `kind`; an empty tray becomes a fresh one. Removing the placeholder leaves the placeholder. */
export function remove(t, kind) {
  if (t.placeholder || !KINDS.includes(kind) || t[kind] < 1) return t;
  const next = { ...t, [kind]: t[kind] - 1 };
  return total(next) === 0 ? fresh() : next;
}

export const clear = () => fresh();

/** A tray the game or /roll set: counts as given (checked), no placeholder. Invalid input gives null. */
export function fromCounts(c) {
  const t = { d6: c.d6 | 0, d10: c.d10 | 0, d20: c.d20 | 0, d100: c.d100 | 0, placeholder: false };
  if (KINDS.some((k) => t[k] < 0) || total(t) < 1 || total(t) > MAX_DICE) return null;
  return t;
}

/** A stored tray (localStorage), or null if it isn't one. */
export function parse(json) {
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object') return null;
    const t = fromCounts(p);
    if (!t) return null;
    t.placeholder = p.placeholder === true && total(t) === 1 && t.d20 === 1;
    return t;
  } catch {
    return null;
  }
}
