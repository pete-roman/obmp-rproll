// RpRoll dice board: the board, the dice the player picked (1 to 5 of d6, d10, d20, d100) in their set, and the throw.
// The numbers always come from the game (DiceTray.cs, from the server); this page only plays them. See bridge.js
// for how it talks to the game.

import {
  ACESFilmicToneMapping, CircleGeometry, Clock, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, Quaternion, Scene, ShadowMaterial, Source,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import d6json from '../assets/dice/d6.json';
import d10json from '../assets/dice/d10.json';
import d20json from '../assets/dice/d20.json';
import d100json from '../assets/dice/d100.json';
import boardInfo from '../assets/board.json';
import { bodyOf, finishThrow, planThrow, restHeight, topFace } from './physics.js';
import { DIE_SCALE, KINDS, MAX_DICE, SHOWN, describe, notation, physicalDice, scaleModel, total } from './dice.js';
import * as Tray from './tray.js';
import { SETS, DEFAULT_SET, byId } from './sets.js';
import { connect } from './bridge.js';
import { Sound } from './sound.js';

const log = (...a) => console.info('[RpRoll]', ...a);
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SET_KEY = 'rproll.set';
const THEME_KEY = 'rproll.theme';
const PICK_KEY = 'rproll.tray';
const WINDUP_MIN = 0.22;     // seconds the dice are lifted before they fly, however fast the server answers
const REPLAY_MAX_AGE = 4000; // ms: an older result (page reloaded) is shown at rest, not thrown again
const MODELS = {
  d6: scaleModel(d6json, DIE_SCALE), d10: scaleModel(d10json, DIE_SCALE),
  d20: scaleModel(d20json, DIE_SCALE), d100: scaleModel(d100json, DIE_SCALE),
};

// The test in test/browser.mjs reads what landed from here.
const probe = { throws: 0, last: null };
window.__rproll = probe;

// ---------------------------------------------------------------------------------------------------------------
// assets: each one is a script (assets/<name>.js) calling RPROLL_ASSET(name, payload). Scripts load from readym://,
// http:// and file:// alike, which fetch() may not. The geometry of each kind of die (die-<kind>) comes once; a set
// (assets/<set>.js) only brings its textures.

const assetWaiters = {};
window.RPROLL_ASSET = (name, payload) => {
  (assetWaiters[name] || []).forEach((w) => w.resolve(payload));
  delete assetWaiters[name];
};
function loadAsset(name) {
  return new Promise((resolve, reject) => {
    (assetWaiters[name] = assetWaiters[name] || []).push({ resolve, reject });
    if (assetWaiters[name].length > 1) return;
    const s = document.createElement('script');
    s.src = `assets/${name}.js`;
    s.onerror = () => {
      (assetWaiters[name] || []).forEach((w) => w.reject(new Error('could not load ' + s.src)));
      delete assetWaiters[name];
    };
    document.head.appendChild(s);
  });
}
function bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const gltf = new GLTFLoader();
const parseGlb = (b64) => new Promise((resolve, reject) => gltf.parse(bytes(b64).buffer, '', resolve, reject));
// decoded the way GLTFLoader decodes, so a swapped texture looks exactly like one the loader made
const bitmap = (b64) => createImageBitmap(new Blob([bytes(b64)], { type: 'image/webp' }), { colorSpaceConversion: 'none' });

// ---------------------------------------------------------------------------------------------------------------
// scene

const canvas = $('view');
let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  fatal('This browser cannot draw the dice (WebGL is not available).', e);
  throw e;
}
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
log(`WebGL ${renderer.capabilities.isWebGL2 ? '2' : '1'} ok, renderer: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'hidden'}`);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const scene = new Scene();
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new PerspectiveCamera(30, 1, 0.5, 200);
const LOOK = new Vector3(0, 0.0, 0.35);

// Light from where the board's top-down render was lit (board.py "key"), so dice and board agree.
const key = new DirectionalLight(0xfff1dc, 2.4);
key.position.set(-9, 26, -9).multiplyScalar(0.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 50 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 4;
scene.add(key);
scene.add(new HemisphereLight(0xfff4e2, 0x3a2a1c, 0.55));

// The board's lighting is baked into its texture, so it is drawn unlit; this catches the dice's shadows on it.
// A dark brown shadow: plain black at this opacity turns the warm wood grey.
const shadowCatcher = new Mesh(new CircleGeometry(1, 96), new ShadowMaterial({ color: 0x2a1406, opacity: 0.55 }));
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.scale.set(boardInfo.bowl_a * 1.02, boardInfo.bowl_b * 1.02, 1);
shadowCatcher.position.y = 0.012;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// Another mod's roll (MESOL's traits) shows as a small board in the bottom right of that mod's page (body.present).
let presentMode = false;
let presentReason = '';

/** `n` different sets at random (all 12 are in the pool); a set repeats only past 12 dice. */
function randomSets(n) {
  const pool = SETS.map((s) => s.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

function resize() {
  // The canvas fills the window, or the small frame while showing another mod's roll (style.css sizes it).
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Fit the board (about 20 units across, 10.3 from the centre to the bark) between the panels, under the ribbon and
  // above the throw button. halfH is half the visible height at the board, in board units.
  const panel = presentMode ? 0 : Math.min(Math.max(250, w * 0.21), 440) + w * 0.016;
  const usableW = Math.max(200, w - 2 * panel - 40) / w;
  const usableH = presentMode ? 1.02 : 0.78; // a trait roll's small board: the board fills its tray
  const tilt = (30 * Math.PI) / 180;                           // from straight down
  const halfH = Math.max(10.4 / (camera.aspect * usableW), (10.4 * Math.cos(tilt) + 0.6) / usableH);
  const dist = halfH / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(0, Math.cos(tilt) * dist, Math.sin(tilt) * dist + LOOK.z);
  camera.lookAt(LOOK.x, LOOK.y - 0.15, LOOK.z + 0.2);
  // In MESOL's tray the board and dice sit a little high: the picture moves up by 8% of the tray, same size.
  if (presentMode) camera.setViewOffset(w, h, 0, h * 0.08, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  placeTags();
  requestRender();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------------------------------------------
// dice models: geometry per kind, textures per set

const templates = {};   // kind -> Promise<Mesh>
const setTextures = {}; // set -> Promise<{kind -> textures}>

function template(kind) {
  if (!templates[kind]) {
    templates[kind] = loadAsset('die-' + kind).then(parseGlb).then((g) => {
      let mesh = null;
      g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      return mesh;
    });
  }
  return templates[kind];
}

function texturesOf(set) {
  if (!setTextures[set]) {
    setTextures[set] = loadAsset(set).then(async (kinds) => {
      const out = {};
      for (const [kind, maps] of Object.entries(kinds)) {
        out[kind] = {};
        for (const [name, b64] of Object.entries(maps)) out[kind][name] = await bitmap(b64);
      }
      return out;
    });
  }
  return setTextures[set];
}

/** A new die of `kind` in `set`: the template's mesh and material with the set's pictures swapped in. */
async function makeDie(kind, set) {
  const [mesh, tex] = await Promise.all([template(kind), texturesOf(set)]);
  const maps = tex[kind];
  const m = mesh.material.clone();
  // A clone shares the template's Source (the picture itself), so each swapped texture needs a Source of its own,
  // or every die of this kind would show whichever set was loaded last.
  const swap = (t, img) => {
    const c = t.clone();
    c.source = new Source(img);
    c.needsUpdate = true;
    return c;
  };
  m.map = swap(mesh.material.map, maps.color);
  const orm = swap(mesh.material.roughnessMap, maps.orm); // roughness in G, metalness in B, one picture
  m.roughnessMap = orm;
  m.metalnessMap = orm;
  m.normalMap = swap(mesh.material.normalMap, maps.nrm);
  if (maps.emit) {
    const e = swap(mesh.material.map, maps.emit);
    m.emissiveMap = e;
    m.emissive = new Color(1, 1, 1);
    m.emissiveIntensity = 1;
  } else {
    m.emissiveMap = null;
    m.emissive = new Color(0, 0, 0);
  }
  m.envMapIntensity = 1.0;
  const die = new Mesh(mesh.geometry, m);
  die.userData = { set, color: maps.color }; // for the test: which picture this die should show
  die.castShadow = true;
  die.scale.setScalar(DIE_SCALE);
  return die;
}

// ---------------------------------------------------------------------------------------------------------------
// the dice on the board

const UP = new Vector3(0, 1, 0);
let board = []; // [{kind, model, body, mesh, p, q, info}] one per physical die, in physicalDice() order
let boardKey = '';

// Resting with `value` on top, its marking reading upright from the camera, centred at x, z.
function restingPose(model, value, x, z, yaw = 0) {
  const face = model.faces.find((f) => f.value === value) || model.faces[model.faces.length - 1];
  const q = new Quaternion().setFromUnitVectors(new Vector3(...face.normal), UP);
  const up = new Vector3(...face.up).applyQuaternion(q).setY(0).normalize();
  q.premultiply(new Quaternion().setFromAxisAngle(UP, -Math.atan2(up.x, -up.z) + yaw));
  return { p: new Vector3(x, restHeight(bodyOf(model).points, q), z), q };
}

// The picked dice laid out in a row in the middle of the board, showing their highest face.
function idleLayout(dice) {
  const gap = 2.9;
  return dice.map((d, i) => {
    const x = (i - (dice.length - 1) / 2) * gap;
    return restingPose(MODELS[d.kind], d.value ?? SHOWN[d.kind], x, 0.6, (i % 2 ? 1 : -1) * 0.12);
  });
}

/**
 * Make the board hold exactly `dice` (kinds and set); keeps meshes when nothing changed. `sets` gives each die its
 * own set (another mod's roll); without it every die wears the player's set.
 */
async function setBoardDice(dice, poses, sets = null) {
  const setOf = (i) => (sets ? sets[i] : currentSet);
  const keyNow = dice.map((d, i) => `${setOf(i)}:${d.kind}`).join(',');
  if (keyNow !== boardKey) {
    const meshes = await Promise.all(dice.map((d, i) => makeDie(d.kind, setOf(i))));
    board.forEach((b) => scene.remove(b.mesh));
    board = dice.map((d, i) => ({ ...d, set: setOf(i), model: MODELS[d.kind], body: bodyOf(MODELS[d.kind]), mesh: meshes[i] }));
    board.forEach((b) => scene.add(b.mesh));
    boardKey = keyNow;
  }
  if (poses) board.forEach((b, i) => applyPose(b, poses[i].p, poses[i].q));
  requestRender();
}

function applyPose(b, p, q) {
  b.p = p.clone();
  b.q = q.clone();
  b.mesh.position.copy(p);
  b.mesh.quaternion.copy(q);
}

// ---------------------------------------------------------------------------------------------------------------
// value tags over the dice once they land; a d100 pair shares one

function placeTags() {
  const el = $('tags');
  if (!tagData.length) {
    el.innerHTML = '';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (el.children.length !== tagData.length) {
    el.innerHTML = '';
    tagData.forEach((t) => {
      const d = document.createElement('div');
      d.className = 'tag ' + t.kind;
      d.textContent = t.text;
      el.appendChild(d);
    });
  }
  tagData.forEach((t, i) => {
    const members = board.filter((b) => b.group === t.group);
    if (!members.length) return;
    const at = members.reduce((s, b) => s.add(b.p), new Vector3()).multiplyScalar(1 / members.length);
    at.y += members[0].body.radius * 1.15;
    at.project(camera);
    const node = el.children[i];
    node.style.left = `${rect.left + ((at.x + 1) / 2) * w}px`;
    node.style.top = `${rect.top + ((1 - at.y) / 2) * h}px`;
    node.classList.add('on');
  });
}
let tagData = [];
function showTags(groups) {
  tagData = groups;
  $('tags').innerHTML = '';
  placeTags();
}

// ---------------------------------------------------------------------------------------------------------------
// the throw: idle -> windup (asked the server) -> flight (numbers known) -> rest

const sound = new Sound();
const anim = { phase: 'idle', id: 0, t: 0, counts: null, values: null, plan: null, throwData: null, from: null, valueAt: 0 };

async function startWindup(id, counts) {
  anim.phase = 'loading';
  anim.id = id;
  anim.counts = counts;
  anim.values = null;
  anim.throwData = null;
  showTags([]);
  $('throw').classList.add('busy');
  banner(presentMode && presentReason ? `Rolling for ${esc(presentReason)}...` : 'Throwing...', '');
  const dice = physicalDice(counts);
  // another mod's roll: every die in a different set, picked at random, so each throw looks new
  await setBoardDice(dice, board.length === dice.length ? null : idleLayout(dice), presentMode ? randomSets(dice.length) : null);
  if (anim.id !== id) return;
  anim.from = board.map((b) => ({ p: b.p.clone(), q: b.q.clone() }));
  // The flight does not depend on the numbers, so it is simulated now and every die lifts to exactly where it will
  // leave from. The numbers only pick the symmetries, when they arrive (valuesArrived).
  const t0 = performance.now();
  anim.plan = planThrow(board.map((b) => b.model), boardInfo, (Math.random() * 2 ** 31) | 0);
  log(`throw #${id} (${notation(counts)}): ${(anim.plan.sim.tracks[0].length / 60).toFixed(2)} s simulated in ` +
    `${(performance.now() - t0).toFixed(0)} ms, ${anim.plan.attempts} attempt(s), waiting for the numbers`);
  anim.t = 0;
  anim.phase = 'windup';
  if (anim.values) valuesArrived(id, anim.values);
  requestRender();
}

function valuesArrived(id, values) {
  if (anim.id !== id || anim.throwData) return;
  anim.values = values;
  if (anim.phase !== 'windup') return; // still loading the dice: startWindup picks the values up
  anim.valueAt = anim.t;
  const dice = physicalDice(anim.counts, values);
  anim.dice = dice;
  anim.throwData = finishThrow(anim.plan, dice.map((d) => d.value), board.map((b) => b.model));
  const bad = anim.throwData.landed.filter((v, i) => v !== dice[i].value);
  if (bad.length) console.error('[RpRoll] throw ended on', anim.throwData.landed, 'not', dice.map((d) => d.value));
  log(`throw #${id}: ${values.join(', ')}`);
}

function refused(id, reason) {
  if (anim.id !== id) return;
  anim.phase = 'settle-back';
  anim.t = 0;
  anim.from = board.map((b) => ({ p: b.p.clone(), q: b.q.clone() }));
  anim.to = idleLayout(board);
  $('throw').classList.remove('busy');
  banner(reason || 'No roll.', 'warn');
  requestRender();
}

async function showAtRest(counts, values) {
  anim.phase = 'idle';
  const dice = physicalDice(counts, values);
  await setBoardDice(dice, idleLayout(dice));
  landedText(counts, values, false);
}

const tmpQ = new Quaternion();
const spinAxis = new Vector3(0.3, 1, 0.2).normalize();
function step(dt) {
  if (anim.phase === 'windup') {
    anim.t += dt;
    // Lift to where the throw leaves from and spin up, as if shaken in a hand; hold there until the numbers are known.
    const lift = Math.min(1, anim.t / WINDUP_MIN);
    const e = 1 - (1 - lift) ** 3;
    // Once the numbers are known, turn into the flight's first frame (with their symmetries) so the dice leave
    // without a jump: over the end of the lift, or over 0.12 s if the numbers came late. Until then they spin.
    let blend = 0;
    if (anim.throwData) {
      const from = Math.max(WINDUP_MIN * 0.45, anim.valueAt);
      const to = Math.max(WINDUP_MIN, anim.valueAt + 0.12);
      blend = Math.max(0, Math.min(1, (anim.t - from) / (to - from)));
    }
    board.forEach((b, i) => {
      const start = anim.plan.starts[i];
      const p = anim.from[i].p.clone().lerp(start.p, e);
      p.y += Math.sin(anim.t * 11 + i) * 0.05 * lift;
      tmpQ.setFromAxisAngle(spinAxis, anim.t * (18 + i * 2) * e);
      let q = anim.from[i].q.clone().premultiply(tmpQ);
      if (anim.throwData) q = q.slerp(anim.throwData.tracks[i][0].q, blend * blend * (3 - 2 * blend));
      applyPose(b, p, q);
    });
    if (anim.throwData && blend >= 1) {
      anim.phase = 'flight';
      anim.t = 0;
      anim.impactIndex = 0;
      return;
    }
    if (anim.t > 6) refused(anim.id, 'No answer from the server.');
    return;
  }
  if (anim.phase === 'flight') {
    anim.t += dt;
    const { tracks, impacts } = anim.throwData;
    while (anim.impactIndex < impacts.length && impacts[anim.impactIndex].t <= anim.t) {
      const hit = impacts[anim.impactIndex++];
      sound.hit(hit.strength, hit.wall);
    }
    const f = anim.t * 60;
    let done = true;
    board.forEach((b, i) => {
      const frames = tracks[i];
      if (f >= frames.length - 1) {
        const last = frames[frames.length - 1];
        applyPose(b, last.p, last.q);
        return;
      }
      done = false;
      const k = f - Math.floor(f);
      const a = frames[Math.floor(f)];
      const c = frames[Math.floor(f) + 1];
      applyPose(b, a.p.clone().lerp(c.p, k), a.q.clone().slerp(c.q, k));
    });
    if (done) landed();
    return;
  }
  if (anim.phase === 'settle-back') {
    anim.t += dt;
    const k = Math.min(1, anim.t / 0.35);
    const e = k * k * (3 - 2 * k);
    board.forEach((b, i) => applyPose(b, anim.from[i].p.clone().lerp(anim.to[i].p, e), anim.from[i].q.clone().slerp(anim.to[i].q, e)));
    if (k >= 1) anim.phase = 'idle';
    return;
  }
  if (anim.phase === 'landed') {
    anim.t += dt;
    if (anim.t > 0.6) anim.phase = 'idle';
  }
}

function landed() {
  anim.phase = 'landed';
  anim.t = 0;
  $('throw').classList.remove('busy');
  probe.throws++;
  probe.last = {
    counts: anim.counts, values: anim.values,
    expected: anim.dice.map((d) => d.value),
    landed: board.map((b) => topFace(b.model, b.q).face.value),
    // every die wears its own picture of the current set
    texturesOk: board.every((b) => b.mesh.userData.set === (b.set || currentSet) && b.mesh.material.map.source.data === b.mesh.userData.color),
    sets: board.map((b) => b.set || currentSet),
  };
  landedText(anim.counts, anim.values, true);
  addRecent(anim.counts, anim.values);
}

function landedText(counts, values, fresh) {
  const { notation: n, parts, sum } = describe(counts, values);
  const single = parts.length === 1;
  const crit = single && parts[0].type === 'd20' && parts[0].value === 20;
  const fumble = single && parts[0].type === 'd20' && parts[0].value === 1;
  if (presentMode && presentReason) {
    banner(`${esc(presentReason)}: ${n} = <b>${sum}</b>`, '', fresh);
  } else if (single) {
    const note = crit ? '<span class="note">natural 20</span>' : fumble ? '<span class="note">natural 1</span>' : '';
    banner(`You rolled ${n === '1d20' ? '' : n + ': '}<b>${sum}</b>${note}`, crit ? 'crit' : fumble ? 'fumble' : '', fresh);
  } else {
    const list = parts.map((p) => `${p.type} [${p.value}]`).join(', ');
    banner(`You rolled ${n}: ${list} = <b>${sum}</b>`, '', fresh);
  }
  if (fresh && (crit || fumble)) sound.flourish(crit);
  showTags(parts.map((p, i) => ({
    group: i, text: String(p.value),
    kind: p.type === 'd20' && p.value === 20 ? 'crit' : p.type === 'd20' && p.value === 1 ? 'fumble' : '',
  })));
}

// ---------------------------------------------------------------------------------------------------------------
// render loop: only while something moves or the tray just changed, so a closed tray costs nothing

let needsRender = true;
let loopRunning = false;
const clock = new Clock();
function requestRender() {
  needsRender = true;
  if (!loopRunning) {
    loopRunning = true;
    clock.getDelta();
    requestAnimationFrame(frame);
  }
}
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const moving = anim.phase === 'windup' || anim.phase === 'flight' || anim.phase === 'settle-back' || anim.phase === 'landed';
  if (moving) step(dt);
  if (needsRender || moving) {
    renderer.render(scene, camera);
    needsRender = false;
  }
  if (moving || needsRender) {
    requestAnimationFrame(frame);
  } else {
    loopRunning = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the player's pick: which dice and which set. Kept by the page; the dice are also sent to the game, which throws
// them. The tray rules (the placeholder d20, 1-4 add, 5 clears, never empty, up to 5) are in tray.js.

let currentSet = DEFAULT_SET;
let tray = Tray.fresh();
let cursor = 2;              // the highlighted die tile (d20)
let pickSentAt = 0;
let serverPicks = -1;        // DiceTray's count of /roll requests that set the tray; each one is adopted once

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* the game keeps a copy, see DiceTray.cs */ } },
};
// light (paper) or dark; V switches, the page remembers it like the set
function setTheme(name, fromUser) {
  document.body.dataset.theme = name === 'dark' ? 'dark' : 'light';
  $('theme-state').textContent = document.body.dataset.theme;
  if (fromUser) storage.set(THEME_KEY, document.body.dataset.theme);
}
function storedSet() {
  const s = storage.get(SET_KEY);
  return byId(s) ? s : null;
}

async function useSet(id, fromUser) {
  if (!byId(id)) id = DEFAULT_SET;
  currentSet = id;
  renderPicker();
  if (fromUser) {
    storage.set(SET_KEY, id);
    bridge.chooseSet(id);
  }
  const tile = document.querySelector(`.set[data-id="${id}"]`);
  tile?.classList.add('loading');
  try {
    // keep the dice where they are (a landed throw stays readable); a first load lays out the tray
    if (board.length) {
      await setBoardDice(board, board.map((b) => ({ p: b.p, q: b.q })));
    } else {
      const dice = physicalDice(Tray.counts(tray));
      await setBoardDice(dice, idleLayout(dice));
    }
  } catch (e) {
    console.error('[RpRoll] could not load set', id, e);
    if (id !== DEFAULT_SET) useSet(DEFAULT_SET, false);
  } finally {
    tile?.classList.remove('loading');
  }
}

function setTray(next, fromUser) {
  tray = next;
  renderPicker();
  storage.set(PICK_KEY, JSON.stringify(tray));
  if (fromUser) sendPick();
  if (anim.phase === 'idle' || anim.phase === 'landed') {
    const dice = physicalDice(Tray.counts(tray));
    showTags([]);
    setBoardDice(dice, idleLayout(dice));
  }
}
// The game confirms a pick by sending its state back with it (DiceTray.OnRpRollDice). Until it has, the pick is
// sent again every second for a while: after a lost message the game has no reason to send anything.
let gamePick = null;
let pickTimer = 0;
const samePick = (a, b) => !!a && !!b && KINDS.every((k) => a[k] === b[k]);
function sendPick(tries = 10) {
  pickSentAt = performance.now();
  bridge.chooseDice(Tray.counts(tray));
  clearTimeout(pickTimer);
  if (tries > 1) pickTimer = setTimeout(() => { if (!samePick(gamePick, Tray.counts(tray))) sendPick(tries - 1); }, 1000);
}

function addDie(kind) {
  const { tray: next, refused } = Tray.add(tray, kind);
  if (refused) return flash('Up to 5 dice per throw.');
  setTray(next, true);
}
function removeDie(kind) {
  setTray(Tray.remove(tray, kind), true);
}
function clearTray() {
  setTray(Tray.clear(), true);
}
function flash(text) {
  $('count').textContent = text;
  $('count').classList.add('warn');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => renderPicker(), 1400);
}

function renderPicker() {
  const s = byId(currentSet);
  document.querySelectorAll('.set').forEach((el) => el.classList.toggle('on', el.dataset.id === currentSet));
  $('set-name').textContent = s.name;
  $('set-text').textContent = s.text;
  $('set-portrait').src = `icons/${currentSet}-d20.webp`;
  document.querySelectorAll('.tile').forEach((el, i) => {
    const k = el.dataset.kind;
    el.classList.toggle('used', tray[k] > 0 && !tray.placeholder);
    el.classList.toggle('placeholder', tray.placeholder && k === 'd20');
    el.classList.toggle('cursor', i === cursor);
    el.querySelector('.badge').textContent = String(tray[k]);
    el.querySelector('img').src = `icons/${currentSet}-${k}.webp`;
  });
  $('notation').textContent = notation(Tray.counts(tray));
  $('count').textContent = tray.placeholder ? 'the d20 waits for your pick' : `${total(tray)} of ${MAX_DICE} dice`;
  $('count').classList.remove('warn');
  $('tray-capacity').style.width = `${total(tray) / MAX_DICE * 100}%`;
}

function buildPicker() {
  const grid = $('sets');
  for (const s of SETS) {
    const el = document.createElement('div');
    el.className = 'set';
    el.dataset.id = s.id;
    el.title = s.name;
    const img = document.createElement('img');
    img.src = `icons/${s.id}-d20.webp`;
    img.alt = s.name;
    el.appendChild(img);
    el.addEventListener('click', () => { sound.wake(); focusSection('sets'); useSet(s.id, true); });
    grid.appendChild(el);
  }
  document.querySelectorAll('.tile').forEach((el, i) => {
    el.addEventListener('click', () => {
      sound.wake();
      focusSection('dice');
      cursor = i;
      addDie(el.dataset.kind); // the preview's mouse: a click adds that die
    });
  });
}

function focusSection(name) {
  document.body.dataset.focus = name;
}

function moveSet(dx, dy) {
  const i = SETS.findIndex((s) => s.id === currentSet);
  const cols = 6;
  const r = (Math.floor(i / cols) + dy + 2) % 2;
  const c = (i % cols + dx + cols) % cols;
  useSet(SETS[r * cols + c].id, true);
}

// ---------------------------------------------------------------------------------------------------------------
// ribbon and recent rolls

function banner(html, kind, pop = false) {
  const el = $('banner');
  $('banner-text').innerHTML = html;
  el.className = kind || '';
  if (pop) {
    void el.offsetWidth;
    el.classList.add('pop');
  }
}

const recent = [];
function addRecent(counts, values) {
  const { notation: n, parts, sum } = describe(counts, values);
  const single = parts.length === 1 && parts[0].type === 'd20';
  recent.unshift({ n, sum, crit: single && sum === 20, fumble: single && sum === 1, at: new Date(), set: byId(currentSet).name });
  recent.length = Math.min(recent.length, 8);
  const list = $('recent');
  list.innerHTML = '';
  for (const r of recent) {
    const li = document.createElement('li');
    if (r.crit) li.className = 'crit';
    if (r.fumble) li.className = 'fumble';
    const t = r.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    li.innerHTML = `<span>${r.n} <span class="when">${r.set} · ${t}</span></span><span>${r.sum}</span>`;
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// state from the game

let lastSeq = -1;
let open = false;

function onState(s) {
  if (typeof s !== 'object' || !s) return;
  const fresh = s.seq !== lastSeq;
  lastSeq = Math.max(lastSeq, s.seq);
  bridge.seen(s.seq);

  if (s.open !== open) {
    open = s.open;
    document.body.classList.toggle('closed', !open);
    if (open) requestRender();
  }
  const present = !!(s.present && s.present.on) && !open;
  presentReason = (s.present && s.present.reason) || '';
  if (present !== presentMode) {
    presentMode = present;
    document.body.classList.toggle('present', present);
    resize();
    if (!present) {
      // back to the player's own dice and set for the next time the board opens
      const dice = physicalDice(Tray.counts(tray));
      setBoardDice(dice, idleLayout(dice)).catch((e) => console.error('[RpRoll] could not reset the board', e));
      showTags([]);
    }
  }
  // The page keeps the set (localStorage). Without storage it takes the game's copy, or the default.
  if (!storedSet() && s.set && s.set !== currentSet && byId(s.set)) useSet(s.set, false);
  if (s.pick) {
    gamePick = s.pick;
    // /roll 2d10 with the board open: the game put those dice in the tray. Adopt that once.
    const fromServer = s.pick.fromServer | 0;
    if (serverPicks < 0) serverPicks = fromServer;
    if (fromServer > serverPicks) {
      serverPicks = fromServer;
      const next = Tray.fromCounts(s.pick);
      if (next) setTray(next, false);
    } else if (!samePick(s.pick, Tray.counts(tray)) && performance.now() - pickSentAt > 800) {
      // the game throws its copy of the pick; if that is not ours, our last message got lost: send it again
      sendPick();
    }
  }

  const r = s.roll || {};
  if (!fresh && r.id === anim.id && anim.phase !== 'windup' && anim.phase !== 'loading') return;
  if (r.id > anim.id) {
    if (r.state === 'pending') {
      startWindup(r.id, r.dice);
    } else if (r.state === 'rolled') {
      if (r.ageMs < REPLAY_MAX_AGE) {
        startWindup(r.id, r.dice);
        valuesArrived(r.id, r.values);
      } else {
        anim.id = r.id;
        showAtRest(r.dice, r.values);
      }
    } else if (r.state === 'refused') {
      anim.id = r.id;
      if (r.ageMs < 5000) banner(r.reason || 'No roll.', 'warn');
    }
  } else if (r.id === anim.id) {
    if (r.state === 'rolled' && (anim.phase === 'windup' || anim.phase === 'loading')) valuesArrived(r.id, r.values);
    if (r.state === 'refused' && (anim.phase === 'windup' || anim.phase === 'loading')) refused(r.id, r.reason);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// keys. In game this page only gets the keyboard while the board is open, and then the game gets none (DiceTray.cs
// puts it in UI-only input), so Space and 1-5 can't jump or fire a quick key. Home is the game's (it reaches
// DiceTray.cs even now); here it only works in the browser preview. While chat is open, chat has the keyboard.

function onKey(e) {
  sound.wake();
  if (chatOpen()) return; // the preview's stand-in chat: typing is typing, never a board action
  if (bridge.mock && e.key === 'Home') {
    bridge.toggle();
    e.preventDefault();
    return;
  }
  if (!open) return; // a closed board does nothing (in game it doesn't even get the keys)
  const section = document.body.dataset.focus;
  const kind = KINDS[cursor];
  switch (e.key) {
    case ' ': case 'Spacebar': bridge.throwDice(); break;
    case '1': case '2': case '3': case '4': addDie(Tray.KEY_KINDS[e.key]); break;
    case '5': clearTray(); break;
    case 'Tab': focusSection(section === 'dice' ? 'sets' : 'dice'); break;
    // dice are rows: up and down walk them (wrapping D100 to D6), right adds one of that die, left takes one away.
    // sets are a 6 x 2 grid: all four arrows move in it.
    case 'ArrowUp':
      if (section === 'dice') { cursor = (cursor + KINDS.length - 1) % KINDS.length; renderPicker(); } else moveSet(0, -1);
      break;
    case 'ArrowDown':
      if (section === 'dice') { cursor = (cursor + 1) % KINDS.length; renderPicker(); } else moveSet(0, 1);
      break;
    case 'ArrowRight': case '+': case '=':
      if (section === 'dice') addDie(kind); else moveSet(1, 0);
      break;
    case 'ArrowLeft': case '-':
      if (section === 'dice') removeDie(kind); else moveSet(-1, 0);
      break;
    case 'k': case 'K': openChat(); break;
    case 'm': case 'M': $('sound-state').textContent = sound.toggle() ? 'off' : 'on'; break;
    case 'v': case 'V': setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark', true); break;
    case 'Escape': bridge.close(); break;
    default: return;
  }
  e.preventDefault();
}

// In game K asks the game, which opens ReadyM's chat and gives the keyboard back to the board when chat closes. In
// the preview a stand-in chat bar does the same.
function openChat() {
  if (!bridge.mock) {
    bridge.openChat();
    return;
  }
  $('chat').hidden = false;
  $('chat-entry').value = '';
  $('chat-entry').focus();
}
const chatOpen = () => bridge.mock && !$('chat').hidden;

// ---------------------------------------------------------------------------------------------------------------
// preview controls (normal browser only)

function setupMock() {
  $('mock').hidden = false;
  const sel = $('mock-value');
  for (let v = 1; v <= 100; v++) sel.add(new Option(String(v), String(v), v === 20, v === 20));
  $('mock').addEventListener('click', (e) => {
    const what = e.target.dataset?.mock;
    if (!what) return;
    sound.wake();
    if (what === 'random') bridge.throwDice();
    if (what === 'forced') bridge.throwDice(Number(sel.value));
    if (what === 'toggle') bridge.toggle();
    if (what === 'chat') openChat();
  });
  $('mock-slow').addEventListener('change', (e) => { bridge.options.latency = e.target.checked ? 900 : 60; });
  $('mock-refuse').addEventListener('change', (e) => { bridge.options.refuse = e.target.checked; });
  $('mock-lose').addEventListener('change', (e) => { bridge.options.losePicks = e.target.checked; });
  $('throw').addEventListener('click', () => { sound.wake(); bridge.throwDice(); });
  // the stand-in chat: K (on the board, or the preview button) opens it, Enter sends, Escape closes
  const entry = $('chat-entry');
  const lines = $('chat-lines');
  bridge.onChat((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    lines.appendChild(li);
    while (lines.children.length > 6) lines.firstChild.remove();
  });
  entry.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      $('chat').hidden = true;
      entry.blur();
      e.preventDefault();
    }
    if (e.key === 'Enter') {
      const text = entry.value.trim();
      entry.value = '';
      $('chat').hidden = true;
      entry.blur();
      if (text) bridge.command(text);
      e.preventDefault();
    }
  });
  window.addEventListener('keydown', (e) => {
    // with the board closed K still opens chat, as in game
    if (!open && !chatOpen() && (e.key === 'k' || e.key === 'K')) {
      openChat();
      e.preventDefault();
    }
  });
  document.body.classList.add('preview');
  log('No game bridge: running the browser preview.');
}

function fatal(text, error) {
  console.error('[RpRoll]', text, error);
  const el = $('fatal');
  el.textContent = text;
  el.hidden = false;
}

// ---------------------------------------------------------------------------------------------------------------
// start

let bridge = { mock: false, ready() {}, seen() {}, chooseSet() {}, chooseDice() {}, throwDice() {}, openChat() {}, close() {}, lostFocus() {} };

// In game a mouse click hands the keyboard to the game (UI-only input) and the board seems to hang. While the board is
// open and has lost the keyboard, ask DiceTray.cs for it back (not while chat has it).
window.addEventListener('blur', () => { if (open && !bridge.mock) bridge.lostFocus(); });
setInterval(() => { if (open && !bridge.mock && !document.hasFocus()) bridge.lostFocus(); }, 500);

async function start() {
  setTheme(storage.get(THEME_KEY), false);
  buildPicker();
  resize();
  try {
    const b = await loadAsset('board').then(parseGlb);
    b.scene.traverse((o) => {
      if (o.isMesh) o.material = new MeshBasicMaterial({ map: o.material.map, color: new Color(1, 1, 1) });
    });
    scene.add(b.scene);
  } catch (e) {
    fatal('The board did not load.', e);
  }
  tray = Tray.parse(storage.get(PICK_KEY)) || Tray.fresh();
  currentSet = storedSet() || DEFAULT_SET;
  await useSet(currentSet, false);
  document.body.classList.remove('loading');
  requestRender();
  bridge = connect(onState);
  if (bridge.mock) window.__rprollMock = bridge; // test/browser.mjs drives the stand-in server from here
  if (bridge.mock) setupMock();
  window.addEventListener('keydown', onKey);
  bridge.ready();
  sendPick();
  log('Dice board ready.');
}

start();
