// node test/throw-stats.mjs  -- what the planned throws look like: length, travel, bounces, wall hits, how many
// attempts the plan needed and how long it took, for a few tray picks.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { planThrow } from '../src/physics.js';
import { DIE_SCALE, notation, physicalDice, scaleModel } from '../src/dice.js';

const here = new URL('..', import.meta.url);
const load = (k) => scaleModel(JSON.parse(readFileSync(new URL(`assets/dice/${k}.json`, here), 'utf8')), DIE_SCALE);
const models = { d20: load('d20'), d6: load('d6'), d100: load('d100'), d10: load('d10') };
const board = JSON.parse(readFileSync(new URL('assets/board.json', here), 'utf8'));

for (const counts of [{ d20: 1, d6: 0, d100: 0 }, { d20: 0, d6: 1, d100: 0 }, { d20: 0, d6: 0, d100: 1 },
  { d20: 1, d6: 2, d100: 0 }, { d20: 0, d6: 5, d100: 0 }, { d20: 0, d6: 0, d100: 5 }]) {
  const ms = physicalDice(counts).map((d) => models[d.kind]);
  const rows = [];
  for (let seed = 1; seed <= 60; seed++) {
    const t0 = performance.now();
    const plan = planThrow(ms, board, seed);
    const time = performance.now() - t0;
    const track = plan.sim.tracks[0];
    let travel = 0;
    for (let i = 1; i < track.length; i++) travel += Math.hypot(track[i].p.x - track[i - 1].p.x, track[i].p.z - track[i - 1].p.z);
    rows.push({ s: track.length / 60, travel, walls: plan.sim.impacts.filter((i) => i.wall).length,
      floors: plan.sim.impacts.filter((i) => !i.wall).length, attempts: plan.attempts, faults: plan.faults, time });
  }
  const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[rows.length >> 1];
  const max = (k) => Math.max(...rows.map((r) => r[k]));
  console.log(`${notation(counts).padEnd(8)} ${med('s').toFixed(2)} s, travel ${med('travel').toFixed(1)}, ` +
    `floor hits ${med('floors')}, wall or dice hits ${med('walls')}, attempts ${med('attempts')} (max ${max('attempts')}), ` +
    `plan ${med('time').toFixed(0)} ms (max ${max('time').toFixed(0)}), with a fault ${rows.filter((r) => r.faults > 0).length}/60`);
}
