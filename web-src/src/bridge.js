// Talking to the game. In game, ReadyM's CEF bridge supplies window.readym and DiceTray.cs pushes the whole board
// state as one JSON message (RpRollState), again a few times after every change. The page sends back the dice pick
// (RpRollDice), Space (RpRollThrow), K (RpRollChat) and Escape (RpRollClose); the state carries what the game will
// throw, so a pick that got lost is sent again.
//
// In a normal browser there is no readym, so a mock plays the game's, chat's and the server's part: the preview
// controls throw random or chosen numbers, Home and Space work on the page, K opens a stand-in chat whose /roll and
// /board behave like the server's.

import { KINDS, MAX_DICE } from './tray.js';
import { FACES } from './dice.js';

export function connect(onState) {
  const real = typeof window.readym === 'object' && window.readym !== null;
  if (real) return gameBridge(onState);
  return mockBridge(onState);
}

function gameBridge(onState) {
  const r = window.readym;
  const handler = (json) => {
    try {
      onState(JSON.parse(json));
    } catch (e) {
      console.error('[RpRoll] bad state message', e);
    }
  };
  try {
    if (typeof r.onRpRollState === 'function') r.onRpRollState(handler);
    else r.on('RpRollState', handler);
  } catch (e) {
    console.error('[RpRoll] could not listen for RpRollState', e);
  }
  const send = (name, ...args) => {
    try {
      r['send' + name](...args);
    } catch (e) {
      console.warn('[RpRoll] send' + name + ' did not go through', e);
    }
  };
  return {
    mock: false,
    ready: () => send('RpRollReady'),
    seen: (seq) => send('RpRollSeen', seq),
    chooseSet: (id) => send('RpRollSet', id),
    chooseDice: (p) => send('RpRollDice', p.d6, p.d10, p.d20, p.d100),
    throwDice: () => send('RpRollThrow'),
    openChat: () => send('RpRollChat'),
    close: () => send('RpRollClose'),
  };
}

const rollFace = (k) => FACES[k][Math.floor(Math.random() * FACES[k].length)];

/** The server's /roll grammar (RollNotation.cs): "" , "d20", "2d10", "1d20+2d6"; d6/d10/d20/d100, up to 5 dice. */
export function parseRoll(args) {
  const text = args.trim();
  const counts = { d6: 0, d10: 0, d20: 0, d100: 0 };
  if (!text) return { counts: null };
  for (const part of text.split('+')) {
    const term = part.trim();
    if (/^\d+$/.test(term)) return { error: "Modifiers like +3 aren't supported yet." };
    const m = /^(\d*)d(6|10|20|100)$/i.exec(term);
    if (!m) return { error: "Can't roll that. Use d6, d10, d20 or d100, e.g. /roll 1d20+2d6 (max 5 dice)." };
    const n = m[1] === '' ? 1 : Number(m[1]);
    if (n < 1) return { error: "Can't roll that." };
    counts[`d${m[2]}`] += n;
  }
  if (KINDS.reduce((s, k) => s + counts[k], 0) > MAX_DICE) return { error: 'Too many dice. Up to 5 per roll.' };
  return { counts };
}

function mockBridge(onState) {
  const COOLDOWN = 1500;
  const state = {
    seq: 0, open: true, set: 'imperial',
    pick: { d6: 0, d10: 0, d20: 1, d100: 0, fromServer: 0 },
    roll: { id: 0, state: 'none', dice: { d6: 0, d10: 0, d20: 0, d100: 0 }, values: [], reason: '', ageMs: 0 },
  };
  let changedAt = performance.now();
  let lastRoll = -Infinity;
  const options = { latency: 60, refuse: false, losePicks: false };
  const chatLog = [];
  const listeners = [];

  const push = () => {
    const copy = JSON.parse(JSON.stringify(state));
    copy.roll.ageMs = Math.round(performance.now() - changedAt);
    setTimeout(() => onState(copy), 0);
  };
  const change = (fn) => {
    fn();
    state.seq++;
    changedAt = performance.now();
    push();
  };
  // like DiceTray.cs: resend a few times after a change
  const resend = () => [250, 750, 2000].forEach((ms) => setTimeout(push, ms));
  const say = (line) => { chatLog.push(line); listeners.forEach((f) => f(line)); };

  const api = {
    mock: true,
    options,
    chatLog,
    onChat: (f) => listeners.push(f),
    ready: () => push(),
    seen: () => {},
    chooseSet: (id) => { state.set = id; },
    chooseDice: (p) => {
      if (options.losePicks) return; // as if the message never reached the game
      const sum = KINDS.reduce((s, k) => s + p[k], 0);
      if (sum < 1 || sum > MAX_DICE) return;
      change(() => { state.pick = { d6: p.d6, d10: p.d10, d20: p.d20, d100: p.d100, fromServer: state.pick.fromServer }; });
    },
    openChat: () => {}, // the page's stand-in chat opens itself; in game the game does it
    close: () => change(() => { state.open = false; }),
    toggle: () => change(() => { state.open = !state.open; }),
    // first: 1 to sides to force the first die, or undefined for fair random dice (like the server)
    throwDice: (first) => {
      if (state.roll.state === 'pending') return;
      const id = state.roll.id + 1;
      const dice = { d6: state.pick.d6, d10: state.pick.d10, d20: state.pick.d20, d100: state.pick.d100 };
      change(() => {
        state.open = true;
        state.roll = { id, state: 'pending', dice, values: [], reason: '', ageMs: 0 };
      });
      setTimeout(() => {
        const now = performance.now();
        const refuse = (reason) => change(() => { state.roll = { ...state.roll, state: 'refused', reason }; });
        if (options.refuse) return refuse('The server said no (preview).');
        if (now - lastRoll < COOLDOWN) return refuse('The dice are still rolling.');
        lastRoll = now;
        const values = [];
        for (const k of KINDS) for (let n = 0; n < dice[k]; n++) values.push(rollFace(k));
        if (FACES[KINDS.find((k) => dice[k] > 0)].includes(first)) values[0] = first;
        change(() => { state.roll = { ...state.roll, state: 'rolled', values }; });
        resend();
        const parts = [];
        let i = 0;
        for (const k of KINDS) for (let n = 0; n < dice[k]; n++) parts.push(`${k} [${values[i++]}]`);
        const asked = KINDS.filter((k) => dice[k]).map((k) => `${dice[k]}${k}`).join(' + ');
        say(`Pete rolled ${asked}: ${parts.join(', ')} = ${values.reduce((s, v) => s + v, 0)}`);
      }, options.latency);
    },
    // The stand-in chat's commands, as the server handles them (RollCommand.cs).
    command: (line) => {
      const m = /^\/(\w+)\s*(.*)$/.exec(line.trim());
      if (!m) { say(`Pete: ${line}`); return; }
      const [, name, args] = m;
      if (name === 'board') { api.toggle(); return; }
      if (name !== 'roll') { say(`Unknown command /${name}.`); return; }
      const parsed = parseRoll(args);
      if (parsed.error) { say(parsed.error); return; }
      if (!state.open) {
        // board closed: a chat line only
        const c = parsed.counts || { d6: 0, d10: 0, d20: 1, d100: 0 };
        const values = [];
        for (const k of KINDS) for (let n = 0; n < c[k]; n++) values.push(rollFace(k));
        say(`Pete rolled ${KINDS.filter((k) => c[k]).map((k) => `${c[k]}${k}`).join(' + ')}: ${values.join(', ')} = ${values.reduce((s, v) => s + v, 0)}`);
        return;
      }
      if (parsed.counts) {
        change(() => { state.pick = { ...parsed.counts, fromServer: state.pick.fromServer + 1 }; });
      }
      api.throwDice();
    },
  };
  push();
  return api;
}
