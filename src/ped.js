import * as THREE from 'three';
import { box } from './geom.js';
import { BLOCK_W, N_BLOCKS, HALF, PITCH, clamp, damp, wrapAngle, rand, pick, dist2, GRAVITY } from './config.js';

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a86b3c'];
const SHIRTS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#1a535c', '#f7fff7', '#ff9f1c', '#2ec4b6', '#e71d36', '#9b5de5', '#f15bb5', '#00bbf9', '#fee440'];
const PANTS = ['#2b2d42', '#8d99ae', '#3d405b', '#f4f1de', '#264653', '#6d597a', '#b5838d'];
const HAIR = ['#1b1b1b', '#3b2416', '#6f4e37', '#c9a227', '#a53f2b', '#e5e5e5'];

const geos = {};
function g(name, fn) { return geos[name] || (geos[name] = fn()); }

// Blocky low-poly person. Root sits at the feet; `body` tilts when knocked down.
export function buildHuman(colors) {
  const c = colors || { skin: pick(SKIN), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR) };
  const mat = (col) => new THREE.MeshLambertMaterial({ color: col });
  const skin = mat(c.skin), shirt = mat(c.shirt), pants = mat(c.pants), hair = mat(c.hair);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(g('torso', () => box(0.5, 0.62, 0.28)), shirt);
  torso.position.y = 1.22;
  const head = new THREE.Mesh(g('head', () => box(0.26, 0.28, 0.26)), skin);
  head.position.y = 1.71;
  const hairM = new THREE.Mesh(g('hair', () => box(0.28, 0.1, 0.28)), hair);
  hairM.position.y = 1.87;
  const hips = new THREE.Mesh(g('hips', () => box(0.46, 0.16, 0.26)), pants);
  hips.position.y = 0.92;
  body.add(torso, head, hairM, hips);
  const limb = (geoName, w, h, d, m, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(g(geoName, () => { const b = box(w, h, d); b.translate(0, -h / 2, 0); return b; }), m);
    pivot.add(mesh);
    body.add(pivot);
    return { pivot, mesh };
  };
  const legL = limb('leg', 0.2, 0.86, 0.22, pants, 0.12, 0.88);
  const legR = limb('leg', 0.2, 0.86, 0.22, pants, -0.12, 0.88);
  const armL = limb('arm', 0.14, 0.62, 0.16, shirt, 0.33, 1.5);
  const armR = limb('arm', 0.14, 0.62, 0.16, shirt, -0.33, 1.5);
  // hands
  for (const a of [armL, armR]) {
    const h = new THREE.Mesh(g('hand', () => box(0.12, 0.12, 0.12)), skin);
    h.position.y = -0.66;
    a.pivot.add(h);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, legL, legR, armL, armR, head, colors: c };
}

export function animateHuman(h, phase, amp, punch = 0) {
  const s = Math.sin(phase) * amp;
  h.legL.pivot.rotation.x = s * 0.7;
  h.legR.pivot.rotation.x = -s * 0.7;
  h.armL.pivot.rotation.x = -s * 0.6;
  h.armR.pivot.rotation.x = s * 0.6 - punch * 1.6;
  h.body.position.y = Math.abs(Math.cos(phase)) * amp * 0.06;
}

const LOOP_H = BLOCK_W / 2 - 2; // sidewalk centre line offset from block centre
const PERIM = LOOP_H * 8;
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function loopPos(cx, cz, t) {
  t = ((t % PERIM) + PERIM) % PERIM;
  const seg = Math.floor(t / (2 * LOOP_H));
  const u = t - seg * 2 * LOOP_H - LOOP_H;
  if (seg === 0) return [cx + u, cz - LOOP_H];
  if (seg === 1) return [cx + LOOP_H, cz + u];
  if (seg === 2) return [cx - u, cz + LOOP_H];
  return [cx - LOOP_H, cz - u];
}

const tmp = { x: 0, z: 0, nx: 0, nz: 0, hit: false };

export class Ped {
  constructor(game, block, t) {
    this.game = game;
    this.h = buildHuman();
    this.mesh = this.h.root;
    this.block = block;
    this.t = t;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.speed = rand(1.1, 1.6);
    const [x, z] = loopPos(block.cx, block.cz, t);
    this.x = x; this.z = z; this.y = game.world.groundHeight(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.heading = 0;
    this.state = 'walk';
    this.timer = rand(4, 14);
    this.phase = Math.random() * 6;
    this.downT = 0;
    this.fleeFrom = null;
    this.target = null;
    this.health = 100;
    this.cash = Math.random() < 0.5 ? Math.floor(rand(5, 40)) : 0;
    game.scene.add(this.mesh);
  }

  dispose() { this.game.scene.remove(this.mesh); }

  knock(vx, vz, up = 3) {
    if (this.state === 'down') { this.vx += vx * 0.5; this.vz += vz * 0.5; return; }
    this.state = 'down';
    this.vx = vx; this.vz = vz; this.vy = up;
    this.downT = rand(3.5, 5.5);
    this.spinDir = Math.random() < 0.5 ? 1 : -1;
  }

  scare(x, z, t = 7) {
    if (this.state === 'down') { this.fleeAfter = true; this.fleeFrom = { x, z }; return; }
    this.state = 'flee';
    this.fleeFrom = { x, z };
    this.timer = t;
  }

  update(dt) {
    const world = this.game.world;
    let moveX = 0, moveZ = 0, spd = 0;
    switch (this.state) {
      case 'walk': {
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'idle'; this.timer = rand(1.5, 4); break; }
        const before = this.t;
        this.t += this.dir * this.speed * dt;
        // crossing chance at corners
        const seg = 2 * LOOP_H;
        const cb = Math.floor(before / seg), ca = Math.floor(this.t / seg);
        if (cb !== ca && Math.random() < 0.3) {
          const k = (((this.dir > 0 ? ca : cb) % 4) + 4) % 4;
          this._startCross(k);
          break;
        }
        const [tx, tz] = loopPos(this.block.cx, this.block.cz, this.t);
        moveX = tx - this.x; moveZ = tz - this.z;
        spd = this.speed;
        break;
      }
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'walk'; this.timer = rand(6, 16); if (Math.random() < 0.3) this.dir *= -1; }
        break;
      case 'cross': {
        moveX = this.target.x - this.x; moveZ = this.target.z - this.z;
        spd = this.speed * 1.2;
        if (moveX * moveX + moveZ * moveZ < 0.5) {
          this.block = this.target.block;
          this.t = this.target.t;
          this.state = 'walk';
          this.timer = rand(6, 14);
        }
        break;
      }
      case 'flee': {
        this.timer -= dt;
        const f = this.fleeFrom;
        moveX = this.x - f.x; moveZ = this.z - f.z;
        spd = 4.6;
        if (this.timer <= 0) this._startReturn();
        break;
      }
      case 'return': {
        moveX = this.target.x - this.x; moveZ = this.target.z - this.z;
        spd = 2.2;
        if (moveX * moveX + moveZ * moveZ < 1) { this.state = 'walk'; this.block = this.target.block; this.t = this.target.t; this.timer = rand(5, 10); }
        break;
      }
      case 'down': {
        this.downT -= dt;
        this.vy -= GRAVITY * dt;
        this.y += this.vy * dt;
        const gh = world.groundHeight(this.x, this.z);
        if (this.y < gh) { this.y = gh; this.vy = 0; }
        const fr = this.y <= gh + 0.01 ? Math.pow(0.04, dt) : 1;
        this.vx *= fr; this.vz *= fr;
        this.x += this.vx * dt; this.z += this.vz * dt;
        this.h.body.rotation.x = damp(this.h.body.rotation.x, -Math.PI / 2, 10, dt);
        this.h.body.position.y = 0.15;
        world.resolveCircle(this.x, this.z, 0.35, tmp);
        if (tmp.hit) {
          const vn = this.vx * tmp.nx + this.vz * tmp.nz;
          if (vn < 0) { this.vx -= 1.4 * vn * tmp.nx; this.vz -= 1.4 * vn * tmp.nz; }
        }
        this.x = tmp.x; this.z = tmp.z;
        if (this.downT <= 0) {
          this.h.body.rotation.x = 0;
          this.h.body.position.y = 0;
          this.state = 'flee';
          this.timer = 6;
          if (!this.fleeFrom) this.fleeFrom = { x: this.game.player.x, z: this.game.player.z };
        }
        this._sync();
        return;
      }
    }
    const len = Math.hypot(moveX, moveZ);
    if (len > 0.01 && spd > 0) {
      const step = Math.min(len, spd * dt);
      this.x += (moveX / len) * step;
      this.z += (moveZ / len) * step;
      this.heading = this.heading + wrapAngle(Math.atan2(moveX, moveZ) - this.heading) * Math.min(1, dt * 8);
      this.phase += dt * spd * 3.2;
      animateHuman(this.h, this.phase, spd > 3 ? 1.2 : 0.7);
    } else {
      animateHuman(this.h, 0, 0);
    }
    world.resolveCircle(this.x, this.z, 0.33, tmp);
    this.x = tmp.x; this.z = tmp.z;
    const gh = world.groundHeight(this.x, this.z);
    this.y = damp(this.y, gh, 18, dt);
    this._sync();
  }

  _sync() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
  }

  _startCross(k) {
    const b = this.block;
    const [sx, sz] = CORNER_SIGNS[k];
    const opts = [];
    if (b.i + sx >= 0 && b.i + sx < N_BLOCKS) opts.push({ i: b.i + sx, j: b.j, sign: [-sx, sz] });
    if (b.j + sz >= 0 && b.j + sz < N_BLOCKS) opts.push({ i: b.i, j: b.j + sz, sign: [sx, -sz] });
    if (!opts.length) return;
    const o = pick(opts);
    const nb = this.game.world.pedBlocks.find((p) => p.i === o.i && p.j === o.j);
    if (!nb) return;
    const ck = CORNER_SIGNS.findIndex(([a, c]) => a === o.sign[0] && c === o.sign[1]);
    const t = ck * 2 * LOOP_H;
    const [x, z] = loopPos(nb.cx, nb.cz, t);
    this.state = 'cross';
    this.target = { x, z, block: nb, t };
  }

  _startReturn() {
    const i = clamp(Math.floor((this.x + HALF) / PITCH), 0, N_BLOCKS - 1);
    const j = clamp(Math.floor((this.z + HALF) / PITCH), 0, N_BLOCKS - 1);
    const nb = this.game.world.pedBlocks.find((p) => p.i === i && p.j === j);
    // nearest point on that block's loop
    let best = 0, bd = Infinity;
    for (let t = 0; t < PERIM; t += 4) {
      const [x, z] = loopPos(nb.cx, nb.cz, t);
      const d = dist2(x, z, this.x, this.z);
      if (d < bd) { bd = d; best = t; }
    }
    const [x, z] = loopPos(nb.cx, nb.cz, best);
    this.state = 'return';
    this.target = { x, z, block: nb, t: best };
  }
}

export class PedManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.target = 30;
    this.spawnT = 0;
  }

  setQuality(q) { this.target = q === 'high' ? 32 : 16; }

  spawnNear(minD, maxD) {
    const g = this.game;
    const blocks = g.world.pedBlocks;
    for (let tries = 0; tries < 10; tries++) {
      const b = blocks[Math.floor(Math.random() * blocks.length)];
      const t = Math.random() * PERIM;
      const [x, z] = loopPos(b.cx, b.cz, t);
      const d2 = dist2(x, z, g.player.x, g.player.z);
      if (d2 < minD * minD || d2 > maxD * maxD) continue;
      const p = new Ped(g, b, t);
      this.list.push(p);
      return p;
    }
    return null;
  }

  // A driver pulled out of their car.
  spawnAt(x, z, fleeFrom) {
    const g = this.game;
    const i = clamp(Math.floor((x + HALF) / PITCH), 0, N_BLOCKS - 1);
    const j = clamp(Math.floor((z + HALF) / PITCH), 0, N_BLOCKS - 1);
    const b = g.world.pedBlocks.find((p) => p.i === i && p.j === j);
    const p = new Ped(g, b, 0);
    p.x = x; p.z = z; p.y = g.world.groundHeight(x, z);
    p.cash = Math.floor(rand(10, 60));
    this.list.push(p);
    p.knock((x - fleeFrom.x) * 1.2, (z - fleeFrom.z) * 1.2, 2);
    p.downT = 1.2;
    p.fleeFrom = fleeFrom;
    return p;
  }

  remove(p) {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    p.dispose();
  }

  // scare everybody near a point
  panic(x, z, r) {
    for (const p of this.list) if (dist2(p.x, p.z, x, z) < r * r) p.scare(x, z, rand(5, 9));
  }

  update(dt) {
    const g = this.game;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.3;
      if (this.list.length < this.target) this.spawnNear(this.list.length < this.target / 2 ? 30 : 60, 115);
      for (let k = this.list.length - 1; k >= 0; k--) {
        const p = this.list[k];
        if (dist2(p.x, p.z, g.player.x, g.player.z) > 150 * 150) this.remove(p);
      }
    }
    for (const p of this.list) p.update(dt);
    this._carHits();
  }

  _carHits() {
    const g = this.game;
    for (const c of g.cars) {
      const sp = c.speed;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const rx = -fz, rz = fx;
      const hl = c.type.len / 2 + 0.3, hw = c.type.wid / 2 + 0.3;
      for (const p of this.list) {
        const dx = p.x - c.x, dz = p.z - c.z;
        if (dx * dx + dz * dz > 16) continue;
        if (p.y > c.y + 1.6) continue;
        const lz = dx * fx + dz * fz, lx = dx * rx + dz * rz;
        if (Math.abs(lz) > hl || Math.abs(lx) > hw) continue;
        if (sp > 3.5 && p.state !== 'down') {
          p.knock(c.vx * 0.9 + rx * Math.sign(lx) * 2, c.vz * 0.9 + rz * Math.sign(lx) * 2, 2 + sp * 0.18);
          g.onPedHit(p, c, sp);
        } else {
          // push aside
          const push = hw - Math.abs(lx) + 0.02;
          p.x += rx * Math.sign(lx || 1) * push;
          p.z += rz * Math.sign(lx || 1) * push;
        }
      }
    }
  }
}
