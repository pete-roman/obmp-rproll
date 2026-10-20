// What a roll looks like on the board. The server rolls d6, d10, d20 and d100; every die is one die on the board
// (the d100 is ten-sided, numbered 10 to 100). Counts and values are always in the tray's order: d6, d10, d20, d100.

import { KINDS, MAX_DICE, total } from './tray.js';

export { KINDS, MAX_DICE, total };

// The dice are drawn (and simulated) larger than real ones on this board, so the numbers read.
export const DIE_SCALE = 1.45;

export function scaleModel(model, s) {
  const sc = (p) => p.map((c) => c * s);
  return { ...model, hull: model.hull.map(sc), corners: model.corners.map(sc), radius: model.radius * s };
}

/**
 * The dice on the board for a roll: counts {d6, d10, d20, d100} and the server's values in the same order (values
 * may be missing while the throw waits for the server). Each entry: {kind (model and type), value, group}.
 */
export function physicalDice(counts, values = []) {
  const out = [];
  let i = 0;
  for (const kind of KINDS) {
    for (let k = 0; k < (counts[kind] || 0); k++, i++) out.push({ kind, value: values[i], group: i, type: kind });
  }
  return out;
}

/** "2d6 + 1d20", in the tray's order. */
export function notation(counts) {
  return KINDS.filter((k) => counts[k] > 0).map((k) => `${counts[k]}${k}`).join(' + ');
}

/** The ribbon and history text, the same shape as the chat line: "1d6 + 1d20: d6 [3], d20 [14] = 17". */
export function describe(counts, values) {
  const parts = [];
  let i = 0;
  for (const k of KINDS) for (let n = 0; n < (counts[k] || 0); n++) parts.push({ type: k, value: values[i++] });
  return { notation: notation(counts), parts, sum: values.reduce((s, v) => s + v, 0) };
}

/** Every face of each die: 1 to 6, 1 to 10, 1 to 20, and 10, 20 ... 100 on the d100. */
const upTo = (n, step = 1) => Array.from({ length: n }, (_, i) => (i + 1) * step);
export const FACES = { d6: upTo(6), d10: upTo(10), d20: upTo(20), d100: upTo(10, 10) };

/** The highest face, shown while the dice wait in the tray. */
export const SHOWN = { d6: 6, d10: 10, d20: 20, d100: 100 };
