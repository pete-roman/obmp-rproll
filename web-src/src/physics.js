// Dice thrown onto the board, simulated ahead of time and played back.
//
// The page never decides a number: the server does. planThrow() rolls a physically plausible throw of all the dice
// with random outcomes, and finishThrow() then turns each die's markings by one of its solid's rotational
// symmetries so the face that ended up on top carries the server's number. A solid occupies exactly the same space
// under its symmetries, so the motion stays physically right and only the numbers move. That works for the d20,
// the d6 and the d10 shape alike, because each of them can turn any face onto any other.
//
// A die model (d20.json, d6.json, d100.json, d10.json, exported from the Blender models) has faces {value, normal, up, verts},
// corners (the solid's vertices before the bevel) and hull (the bevelled mesh's points), in glTF axes.

import { Quaternion, Vector3 } from 'three';

const DT = 1 / 240;          // physics step
const FRAME = 1 / 60;        // recorded frames
const GRAVITY = 52;          // units/s^2; a d20 on the board is about 2.8 units across
const RESTITUTION_FLOOR = 0.4;
const RESTITUTION_WALL = 0.38;
const RESTITUTION_DICE = 0.3;
const FRICTION = 0.42;
const FRICTION_DICE = 0.25;
const MAX_SECONDS = 4.0;
const SLOP = 0.012;
const ITERATIONS = 8;

// Deterministic random numbers, so a seed replays the same throw (tests and debugging).
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

/** The solid's edges, as pairs of corner indices, from the faces' corner lists. */
function edgesOf(model) {
  const seen = new Set();
  const out = [];
  for (const f of model.faces) {
    for (let i = 0; i < f.verts.length; i++) {
      const a = f.verts[i];
      const b = f.verts[(i + 1) % f.verts.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push([a, b]);
      }
    }
  }
  return out;
}

/**
 * The hull points that can touch anything: for each corner and each edge midpoint of the solid, the bevelled
 * hull's furthest point in that direction. 42 points for a d20, 20 for a d6, 32 for a d10.
 */
export function contactPoints(model) {
  const pts = model.hull.map(v3);
  const cs = model.corners.map(v3);
  const dirs = cs.map((c) => c.clone().normalize());
  // A solid with very many corners (more than 60) would need only those, and be much faster.
  if (cs.length <= 60) for (const [a, b] of edgesOf(model)) dirs.push(cs[a].clone().add(cs[b]).normalize());
  return dirs.map((d) => pts.reduce((best, p) => (p.dot(d) > best.dot(d) ? p : best)).clone());
}

/** What the simulation needs about one die, computed once per model. */
export function bodyOf(model) {
  if (model.__body) return model.__body;
  const points = contactPoints(model);
  const radius = Math.max(...points.map((p) => p.length()));
  // distance from the centre to the faces: the die's "inner" size
  const inner = Math.min(...model.faces.map((f) => v3(model.corners[f.verts[0]]).dot(v3(f.normal))));
  const body = { points, radius, inner, sphere: (radius + inner) / 2 };
  Object.defineProperty(model, '__body', { value: body, enumerable: false });
  return body;
}

/** The face whose normal points most nearly up for orientation q, and how nearly. */
export function topFace(model, q) {
  let best = null;
  let bestDot = -2;
  const n = new Vector3();
  for (const f of model.faces) {
    n.set(f.normal[0], f.normal[1], f.normal[2]).applyQuaternion(q);
    if (n.y > bestDot) {
      bestDot = n.y;
      best = f;
    }
  }
  return { face: best, dot: bestDot };
}

/** Height of the die's centre when it lies flat on the floor in orientation q. */
export function restHeight(points, q) {
  let lowest = Infinity;
  const pw = new Vector3();
  for (const p of points) {
    pw.copy(p).applyQuaternion(q);
    lowest = Math.min(lowest, pw.y);
  }
  return -lowest;
}

/**
 * One throw of several dice from the near rim toward the far half of the board, all at once from one hand.
 * Returns { tracks: [frames per die, [{p, q}] at 60 per second], impacts: [{t, strength, wall}], seconds, settled }.
 */
export function simulateThrow(bodies, board, random) {
  const a = board.bowl_a * 0.968;
  const b = board.bowl_b * 0.968;
  const n = bodies.length;

  // The hand: one launch point and direction for all, each die a little apart and a little different.
  const side = (random() - 0.5) * 2;
  const origin = new Vector3(side * a * 0.3, 3.0 + random() * 1.0, b * 0.76);
  const target = new Vector3((random() - 0.5) * a * 0.6, 0, -b * (0.05 + random() * 0.5));
  const dir = target.clone().sub(origin).setY(0).normalize();
  const across = new Vector3(-dir.z, 0, dir.x);
  const speed = 15 + random() * 6;
  const spacing = Math.max(...bodies.map((d) => d.sphere)) * 2.1;

  const dice = bodies.map((body, i) => {
    const slot = i - (n - 1) / 2;
    const x = origin.clone().addScaledVector(across, slot * spacing * 0.75)
      .addScaledVector(dir, (random() - 0.5) * spacing * 0.6);
    x.y += (random() - 0.5) * 0.6;
    const v = dir.clone().multiplyScalar(speed * (0.85 + random() * 0.3))
      .addScaledVector(across, (random() - 0.5) * 3 + slot * 0.6).setY(2 + random() * 3);
    const w = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(24 + random() * 20);
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), random() * Math.PI * 2);
    const invI = 1 / (0.4 * (body.radius * 0.86) ** 2);
    return { body, x, v, w, q, invI, calm: 0, touching: false, xPrev: new Vector3(), qPrev: new Quaternion() };
  });

  const tracks = dice.map((d) => [{ p: d.x.clone(), q: d.q.clone() }]);
  const impacts = [];
  const r = new Vector3();
  const pw = new Vector3();
  const vr = new Vector3();
  const tmp = new Vector3();
  const rn = new Vector3();
  const nn = new Vector3();
  let t = 0;
  let nextFrame = FRAME;
  let lastImpact = -1;
  const hit = (strength, wall) => {
    if (t - lastImpact > 0.05) {
      impacts.push({ t, strength: Math.min(1, strength), wall });
      lastImpact = t;
    }
  };

  // Sequential impulse at one floor or wall contact of die d (r: from its centre to the contact point).
  const solveContact = (d, c, iter) => {
    vr.copy(d.w).cross(c.r).add(d.v);
    const vn = vr.dot(c.n);
    rn.copy(c.r).cross(c.n);
    const kn = 1 + d.invI * rn.lengthSq();
    const e = c.wall ? RESTITUTION_WALL : RESTITUTION_FLOOR;
    const bounce = iter === 0 && vn < -1.2 ? -e * vn : 0;
    let jn = (-vn + bounce) / kn;
    const old = c.jn;
    c.jn = Math.max(0, old + jn);
    jn = c.jn - old;
    if (iter === 0 && -vn > 2.5) hit(-vn / 16, c.wall);
    tmp.copy(c.n).multiplyScalar(jn);
    d.v.add(tmp);
    d.w.addScaledVector(rn.copy(c.r).cross(tmp), d.invI);
    // friction
    vr.copy(d.w).cross(c.r).add(d.v);
    const vt = tmp.copy(vr).addScaledVector(c.n, -vr.dot(c.n));
    const speedT = vt.length();
    if (speedT > 1e-6) {
      const tn = vt.multiplyScalar(1 / speedT);
      rn.copy(c.r).cross(tn);
      const kt = 1 + d.invI * rn.lengthSq();
      const jt = Math.max(-FRICTION * c.jn, Math.min(FRICTION * c.jn, -speedT / kt));
      const J = tn.multiplyScalar(jt);
      d.v.add(J);
      d.w.addScaledVector(rn.copy(c.r).cross(J), d.invI);
    }
  };

  while (t < MAX_SECONDS) {
    // contacts with the floor and the wall, per die
    const contacts = [];
    for (const d of dice) {
      d.xPrev.copy(d.x);
      d.qPrev.copy(d.q);
      d.v.y -= GRAVITY * DT;
      const list = [];
      for (const p of d.body.points) {
        r.copy(p).applyQuaternion(d.q);
        pw.copy(r).add(d.x);
        // Points just above the floor count too (SLOP): a die resting on a face touches with several points at
        // once, and without the margin only the deepest one would, so it would rock.
        if (pw.y < SLOP) list.push({ r: r.clone(), n: new Vector3(0, 1, 0), wall: false, jn: 0 });
        const f = (pw.x / a) ** 2 + (pw.z / b) ** 2;
        if (f > 1) list.push({ r: r.clone(), n: new Vector3(-pw.x / (a * a), 0, -pw.z / (b * b)).normalize(), wall: true, jn: 0 });
      }
      contacts.push(list);
    }
    // dice against dice, as spheres halfway between their inner and outer size
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = dice[i];
        const B = dice[j];
        const rr = A.body.sphere + B.body.sphere;
        const dist = A.x.distanceTo(B.x);
        if (dist < rr && dist > 1e-6) pairs.push({ A, B, n: B.x.clone().sub(A.x).multiplyScalar(1 / dist), jn: 0 });
      }
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      dice.forEach((d, i) => contacts[i].forEach((c) => solveContact(d, c, iter)));
      for (const c of pairs) {
        const { A, B } = c;
        const ra = c.n.clone().multiplyScalar(A.body.sphere);
        const rb = c.n.clone().multiplyScalar(-B.body.sphere);
        const va = A.w.clone().cross(ra).add(A.v);
        const vb = B.w.clone().cross(rb).add(B.v);
        const rel = vb.sub(va);
        const vn = rel.dot(c.n);
        const bounce = iter === 0 && vn < -1.2 ? -RESTITUTION_DICE * vn : 0;
        let jn = (-vn + bounce) / 2;
        const old = c.jn;
        c.jn = Math.max(0, old + jn);
        jn = c.jn - old;
        if (iter === 0 && -vn > 3) hit(-vn / 18, true);
        A.v.addScaledVector(c.n, -jn);
        B.v.addScaledVector(c.n, jn);
        // a little friction between the dice: they hand each other some spin
        const vt = rel.addScaledVector(c.n, -vn);
        const st = vt.length();
        if (st > 1e-6) {
          const jt = Math.min(FRICTION_DICE * c.jn, st / 4);
          const tn = vt.multiplyScalar(1 / st);
          A.v.addScaledVector(tn, jt);
          B.v.addScaledVector(tn, -jt);
          A.w.addScaledVector(nn.copy(ra).cross(tn), jt * A.invI);
          B.w.addScaledVector(nn.copy(rb).cross(tn), -jt * B.invI);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const d = dice[i];
      d.touching = contacts[i].length > 0;
      if (d.touching) {
        // Rolling resistance on wood. A d20 is nearly round, so without it the die rolls on far too long; it grows
        // as the die slows down, which is what makes a real one tip onto a face and stop.
        const slow = d.v.length() < 2.5 ? 5.5 : 2.2;
        d.w.multiplyScalar(1 - slow * DT);
        d.v.multiplyScalar(1 - slow * 0.45 * DT);
      }
      d.x.addScaledVector(d.v, DT);
      const dq = new Quaternion(d.w.x * DT * 0.5, d.w.y * DT * 0.5, d.w.z * DT * 0.5, 0).multiply(d.q);
      d.q.set(d.q.x + dq.x, d.q.y + dq.y, d.q.z + dq.z, d.q.w + dq.w).normalize();

      // push out of the floor and the wall (positions only; velocities were handled above)
      let lowest = 0;
      let wallOut = 0;
      let wallN = null;
      for (const p of d.body.points) {
        r.copy(p).applyQuaternion(d.q);
        pw.copy(r).add(d.x);
        lowest = Math.min(lowest, pw.y);
        const f = (pw.x / a) ** 2 + (pw.z / b) ** 2;
        if (f > 1) {
          const depth = (Math.sqrt(f) - 1) * Math.min(a, b);
          if (depth > wallOut) {
            wallOut = depth;
            wallN = new Vector3(-pw.x / (a * a), 0, -pw.z / (b * b)).normalize();
          }
        }
      }
      if (lowest < 0) d.x.y -= lowest * 0.8;
      if (wallN) d.x.addScaledVector(wallN, wallOut * 0.8);
    }
    for (const c of pairs) {
      const over = c.A.body.sphere + c.B.body.sphere - c.A.x.distanceTo(c.B.x);
      if (over > 0) {
        c.A.x.addScaledVector(c.n, -over * 0.4);
        c.B.x.addScaledVector(c.n, over * 0.4);
      }
    }

    t += DT;
    if (t >= nextFrame) {
      dice.forEach((d, i) => tracks[i].push({ p: d.x.clone(), q: d.q.clone() }));
      nextFrame += FRAME;
    }

    // Calm is measured on how far a die really moved this step: v and w still carry the step's gravity and the
    // contact impulses that cancel it, so they never quite reach zero while it rests.
    let allCalm = true;
    for (const d of dice) {
      const moved = d.x.distanceTo(d.xPrev) / DT;
      const turned = d.q.angleTo(d.qPrev) / DT;
      d.calm = d.touching && moved < 0.1 && turned < 0.15 ? d.calm + DT : 0;
      if (d.calm <= 0.2) allCalm = false;
    }
    if (allCalm) break;
  }
  return { tracks, impacts, seconds: t, settled: dice.every((d) => d.calm > 0.2) };
}

/** Rotate a die's last frames so it lies exactly flat on its face and touches the floor. Returns the top face. */
function settle(frames, model, points) {
  const last = frames[frames.length - 1];
  const { face } = topFace(model, last.q);
  const nrm = v3(face.normal).applyQuaternion(last.q);
  const fix = new Quaternion().setFromUnitVectors(nrm, new Vector3(0, 1, 0));
  const q = fix.multiply(last.q.clone()).normalize();
  const p = last.p.clone().setY(restHeight(points, q));
  const blend = Math.min(12, frames.length - 1);
  const start = frames.length - 1 - blend;
  for (let i = 1; i <= blend; i++) {
    const k = i / blend;
    const f = frames[start + i];
    f.q = f.q.clone().slerp(q, k * k);
    f.p = f.p.clone().lerp(p, k * k);
  }
  return face;
}

/**
 * Rotations of the solid that take the face carrying `from` onto the face carrying `to`: from the frame
 * (normal, toward one corner of the face) to the frame of each corner of the other face, kept if every corner of
 * the solid lands on a corner.
 */
export function symmetriesTaking(model, from, to) {
  const fa = model.faces.find((f) => f.value === from);
  const fb = model.faces.find((f) => f.value === to);
  const cs = model.corners.map(v3);
  const frame = (n, c) => {
    const u = c.clone().addScaledVector(n, -c.dot(n)).normalize();
    return [n, u, n.clone().cross(u)];
  };
  const out = [];
  const [bn, bu, bv] = frame(v3(fb.normal), cs[fb.verts[0]]);
  for (const ia of fa.verts) {
    const [an, au, av] = frame(v3(fa.normal), cs[ia]);
    // S maps the b-frame onto the a-frame: S = A * B^T, as a quaternion via its matrix.
    const m = [
      an.x * bn.x + au.x * bu.x + av.x * bv.x, an.x * bn.y + au.x * bu.y + av.x * bv.y, an.x * bn.z + au.x * bu.z + av.x * bv.z,
      an.y * bn.x + au.y * bu.x + av.y * bv.x, an.y * bn.y + au.y * bu.y + av.y * bv.y, an.y * bn.z + au.y * bu.z + av.y * bv.z,
      an.z * bn.x + au.z * bu.x + av.z * bv.x, an.z * bn.y + au.z * bu.y + av.z * bv.y, an.z * bn.z + au.z * bu.z + av.z * bv.z,
    ];
    const q = quatFromMatrix(m);
    const ok = cs.every((c) => {
      const moved = c.clone().applyQuaternion(q);
      return cs.some((d) => d.distanceToSquared(moved) < 1e-4);
    });
    if (ok) out.push(q);
  }
  return out;
}

function quatFromMatrix(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return new Quaternion(x, y, z, w).normalize();
}

/** How good a landing is: 0 is clean (every die flat, inside the bowl, not lying on another die, sensible length). */
function landingFaults(sim, models, bodies, board) {
  const many = models.length >= 4;
  let faults = sim.settled ? 0 : 3;
  if (sim.seconds < 1.3 || sim.seconds > (many ? 3.6 : 3.2)) faults += 2;
  const limit = many ? 0.8 : models.length > 1 ? 0.74 : 0.68;
  sim.tracks.forEach((track, i) => {
    const end = track[track.length - 1];
    if (topFace(models[i], end.q).dot < 0.97) faults++;
    if (Math.hypot(end.p.x / board.bowl_a, end.p.z / board.bowl_b) > limit) faults++;
    if (end.p.y > restHeight(bodies[i].points, end.q) + 0.15) faults += 2; // resting on another die
  });
  return faults;
}

/**
 * A throw of `models` (one per die on the board) that ends on `values`: planThrow() simulates until a clean landing
 * and needs no numbers, so the page can start the throw while it waits for the server; finishThrow() then picks a
 * symmetry per die that puts its value where its landed face is. The returned tracks already include them.
 */
export function throwFor(values, models, board, seed) {
  return finishThrow(planThrow(models, board, seed), values, models);
}

// The throw is planned when End is pressed, on the page's only thread, so it gets a time budget: a few simulations
// for a crowded board, dozens for one die. With four dice or more one small fault is fine (a die leaning on
// another is laid flat by settle() anyway); one die must land clean.
const PLAN_BUDGET_MS = 140;

export function planThrow(models, board, seed) {
  const bodies = models.map(bodyOf);
  const random = rng(seed);
  let best = null;
  let bestFaults = Infinity;
  const good = models.length >= 4 ? 1 : 0;
  const start = performance.now();
  let attempt = 0;
  for (; attempt < 36 && bestFaults > good && (attempt < 2 || performance.now() - start < PLAN_BUDGET_MS); attempt++) {
    const sim = simulateThrow(bodies, board, random);
    const faults = landingFaults(sim, models, bodies, board);
    if (faults < bestFaults) {
      best = sim;
      bestFaults = faults;
    }
  }
  const landed = best.tracks.map((frames, i) => settle(frames, models[i], bodies[i].points));
  return { sim: best, landed, random, starts: best.tracks.map((tr) => tr[0]), faults: bestFaults, attempts: attempt };
}

/**
 * The turns that make a planned throw end on `values` (one per die), and the throw with them applied.
 * Every die (d6, d10, d20 and the ten-sided d100) uses a symmetry of its solid, so nothing but the numbers moves.
 * A solid without such symmetries would be turned so the wanted face sits where the landed one was, and its last
 * frames lifted or lowered so it ends exactly on the floor.
 */
export function finishThrow(plan, values, models) {
  const tracks = plan.sim.tracks.map((frames, i) => {
    const model = models[i];
    const options = symmetriesTaking(model, plan.landed[i].value, values[i]);
    let s = options[Math.floor(plan.random() * options.length)];
    if (!s) {
      const from = v3(model.faces.find((f) => f.value === values[i]).normal).normalize();
      const to = v3(plan.landed[i].normal).normalize();
      if (from.dot(to) < -0.999) {
        // opposite faces: setFromUnitVectors is unstable this close to 180 degrees, so turn half around explicitly
        const axis = Math.abs(from.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
        axis.addScaledVector(from, -axis.dot(from)).normalize();
        s = new Quaternion().setFromAxisAngle(axis, Math.PI);
        s.premultiply(new Quaternion().setFromUnitVectors(from.clone().applyQuaternion(s), to));
      } else {
        s = new Quaternion().setFromUnitVectors(from, to);
      }
    }
    if (!options.length) {
      // The turn about the face's normal is free here, so pick the one that leaves the number upright for the
      // camera (it looks along -z): an upside-down 68 reads as 89.
      const end = frames[frames.length - 1].q;
      const want = model.faces.find((f) => f.value === values[i]);
      const u = v3(want.up).applyQuaternion(end.clone().multiply(s));
      const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(u.x, -u.z));
      s = end.clone().invert().multiply(twist).multiply(end).multiply(s);
    }
    const out = frames.map((f) => ({ p: f.p, q: f.q.clone().multiply(s) }));
    if (!options.length) {
      const points = bodyOf(model).points;
      const last = out[out.length - 1];
      const dy = restHeight(points, last.q) - last.p.y;
      const n = Math.min(20, out.length - 1);
      for (let k = 1; k <= n; k++) {
        const f = out[out.length - 1 - n + k];
        f.p = f.p.clone();
        f.p.y += dy * (k / n);
      }
    }
    return out;
  });
  const landed = tracks.map((tr, i) => topFace(models[i], tr[tr.length - 1].q).face.value);
  const frames = Math.max(...tracks.map((tr) => tr.length));
  return { tracks, impacts: plan.sim.impacts, seconds: frames / 60, landed };
}
