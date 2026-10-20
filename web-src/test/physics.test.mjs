// node test/physics.test.mjs  -- every die lands on the server's number, flat, on the floor, inside the bowl, in a
// sensible time: every value of the d6, d10, d20 and d100 (10 to 100), and mixed throws of 5 dice.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { restHeight, symmetriesTaking, throwFor, topFace, bodyOf } from '../src/physics.js';
import { DIE_SCALE, FACES, scaleModel, physicalDice } from '../src/dice.js';

const here = new URL('..', import.meta.url);
const load = (k) => scaleModel(JSON.parse(readFileSync(new URL(`assets/dice/${k}.json`, here), 'utf8')), DIE_SCALE);
const models = { d6: load('d6'), d10: load('d10'), d20: load('d20'), d100: load('d100') };
const board = JSON.parse(readFileSync(new URL('assets/board.json', here), 'utf8'));

let failures = 0;
const fail = (msg) => { failures++; if (failures < 30) console.log('FAIL', msg); };

// The faces carry exactly what the server rolls: 1..sides, and 10, 20 ... 100 on the d100.
for (const kind of Object.keys(FACES)) {
  const values = models[kind].faces.map((f) => f.value).sort((a, b) => a - b);
  if (values.join() !== FACES[kind].join()) fail(`${kind}: faces are not ${FACES[kind].join(',')}`);
}
// Every die can turn any face onto any other.
for (const kind of Object.keys(FACES)) {
  const m = models[kind];
  const values = m.faces.map((f) => f.value);
  for (const a of values) for (const b of values) {
    if (symmetriesTaking(m, a, b).length < 1) fail(`${kind}: no symmetry ${a}->${b}`);
  }
}

function check(label, dice, seed) {
  const ms = dice.map((d) => models[d.kind]);
  const t0 = performance.now();
  const t = throwFor(dice.map((d) => d.value), ms, board, seed);
  const ms_ = performance.now() - t0;
  t.tracks.forEach((track, i) => {
    const end = track[track.length - 1];
    const top = topFace(ms[i], end.q);
    if (top.face.value !== dice[i].value || t.landed[i] !== dice[i].value) fail(`${label} seed ${seed}: die ${i} ${dice[i].kind} landed ${top.face.value}, not ${dice[i].value}`);
    if (top.dot < 0.9999) fail(`${label} seed ${seed}: die ${i} not flat (${top.dot.toFixed(4)})`);
    const rho = Math.hypot(end.p.x / board.bowl_a, end.p.z / board.bowl_b);
    if (rho > 0.97) fail(`${label} seed ${seed}: die ${i} in the wall (rho ${rho.toFixed(2)})`);
    if (Math.abs(end.p.y - restHeight(bodyOf(ms[i]).points, end.q)) > 1e-3) fail(`${label} seed ${seed}: die ${i} not on the floor`);
    for (const f of track) if (!Number.isFinite(f.p.x + f.p.y + f.p.z + f.q.w)) { fail(`${label}: NaN`); break; }
  });
  return { seconds: t.seconds, ms: ms_ };
}

const stats = {};
const note = (k, r) => { (stats[k] = stats[k] || []).push(r); };
let seed = 1;
const one = (kind) => ({ d6: 0, d10: 0, d20: 0, d100: 0, [kind]: 1 });
for (const [kind, reps] of [['d6', 6], ['d10', 5], ['d20', 4], ['d100', 5]]) {
  for (const v of FACES[kind]) {
    for (let k = 0; k < reps; k++) note(`1 ${kind}`, check(`${kind}=${v}`, physicalDice(one(kind), [v]), seed++));
  }
}
const random = (kind) => FACES[kind][Math.floor(Math.random() * FACES[kind].length)];
for (const counts of [{ d6: 1, d10: 1, d20: 1, d100: 0 }, { d6: 5, d10: 0, d20: 0, d100: 0 }, { d6: 0, d10: 5, d20: 0, d100: 0 },
  { d6: 0, d10: 0, d20: 5, d100: 0 }, { d6: 0, d10: 0, d20: 0, d100: 5 }, { d6: 1, d10: 1, d20: 1, d100: 2 }]) {
  for (let k = 0; k < 12; k++) {
    const values = [];
    for (const kind of ['d6', 'd10', 'd20', 'd100']) for (let n = 0; n < counts[kind]; n++) values.push(random(kind));
    const label = Object.entries(counts).filter(([, n]) => n).map(([kd, n]) => `${n}${kd}`).join('+');
    note(label, check(label, physicalDice(counts, values), seed++));
  }
}
for (const [k, rows] of Object.entries(stats)) {
  const s = rows.map((r) => r.seconds).sort((a, b) => a - b);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${k.padEnd(18)} ${String(rows.length).padStart(3)} throws, ${s[0].toFixed(2)} to ${s[s.length - 1].toFixed(2)} s (median ${s[s.length >> 1].toFixed(2)}), planned in median ${ms[ms.length >> 1].toFixed(0)} ms, worst ${ms[ms.length - 1].toFixed(0)} ms`);
  if (s[s.length - 1] > 4.05) fail(`${k}: a throw took too long`);
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
