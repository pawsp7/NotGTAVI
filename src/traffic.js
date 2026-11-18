import { Car, TRAFFIC_MIX } from './car.js';
import {
  N_BLOCKS, LANE, HALF, PITCH, roadPos, clamp, wrapAngle, rand, pick, dist2,
} from './config.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inGrid = (i, j) => i >= 0 && j >= 0 && i <= N_BLOCKS && j <= N_BLOCKS;

// Lane-following driver. Plans a route node by node on the road grid and
// steers toward a look-ahead point on the right-hand lane.
export class DriverAI {
  constructor(game, car, mode = 'traffic') {
    this.game = game;
    this.car = car;
    this.mode = mode;
    this.cruise = rand(10, 14);
    this.nodes = [];
    this.segStart = { x: 0, z: 0 };
    this.stuckT = 0;
    this.reverseT = 0;
    this.scanT = Math.random() * 0.2;
    this.gap = Infinity;
    this.waitT = 0;
    this.hornCooldown = 0;
    this.target = { x: car.x, z: car.z };
    this.direct = false;
  }

  // Place on a segment from node a toward node b at fraction f.
  placeOn(a, b, f) {
    const dx = Math.sign(b.i - a.i), dz = Math.sign(b.j - a.j);
    const ax = roadPos(a.i), az = roadPos(a.j);
    const rx = -dz, rz = dx;
    this.nodes = [a, b];
    this.nodes.push(this._choose(a, b));
    this.nodes.push(this._choose(b, this.nodes[2]));
    this.segStart = { x: ax + rx * LANE, z: az + rz * LANE };
    const c = this.car;
    c.x = ax + dx * PITCH * f + rx * LANE;
    c.z = az + dz * PITCH * f + rz * LANE;
    c.heading = Math.atan2(dx, dz);
    c.y = this.game.world.groundHeight(c.x, c.z);
    c.syncMesh(0);
  }

  replan() {
    const c = this.car;
    const i = clamp(Math.round((c.x + HALF) / PITCH), 0, N_BLOCKS);
    const j = clamp(Math.round((c.z + HALF) / PITCH), 0, N_BLOCKS);
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let best = null, bd = -2;
    for (const [dx, dz] of DIRS) {
      if (!inGrid(i + dx, j + dz)) continue;
      let d = dx * fx + dz * fz;
      if (this.mode === 'police') d += this._towardScore(i + dx, j + dz) * 0.5;
      if (d > bd) { bd = d; best = [dx, dz]; }
    }
    const a = { i, j }, b = { i: i + best[0], j: j + best[1] };
    this.nodes = [a, b];
    this.nodes.push(this._choose(a, b));
    this.nodes.push(this._choose(b, this.nodes[2]));
    const rx = -best[1], rz = best[0];
    this.segStart = { x: roadPos(i) + rx * LANE, z: roadPos(j) + rz * LANE };
  }

  _towardScore(i, j) {
    const p = this.game.player;
    const ti = (p.x + HALF) / PITCH, tj = (p.z + HALF) / PITCH;
    return -(Math.abs(ti - i) + Math.abs(tj - j)) / N_BLOCKS;
  }

  _choose(prev, node) {
    const inX = Math.sign(node.i - prev.i), inZ = Math.sign(node.j - prev.j);
    const opts = [];
    for (const [dx, dz] of DIRS) {
      if (dx === -inX && dz === -inZ) continue;
      if (!inGrid(node.i + dx, node.j + dz)) continue;
      const straight = dx === inX && dz === inZ;
      let w = straight ? 2 : 1;
      if (this.mode === 'police') {
        const sc = this._towardScore(node.i + dx, node.j + dz);
        w = Math.exp(sc * 40) + 0.01;
      }
      opts.push({ i: node.i + dx, j: node.j + dz, w });
    }
    if (!opts.length) return { i: prev.i, j: prev.j };
    let total = 0;
    for (const o of opts) total += o.w;
    let r = Math.random() * total;
    for (const o of opts) { r -= o.w; if (r <= 0) return o; }
    return opts[opts.length - 1];
  }

  _corner(prev, node, next) {
    const d1x = Math.sign(node.i - prev.i), d1z = Math.sign(node.j - prev.j);
    const d2x = Math.sign(next.i - node.i), d2z = Math.sign(next.j - node.j);
    let x = roadPos(node.i) - d1z * LANE, z = roadPos(node.j) + d1x * LANE;
    if (d1x !== d2x || d1z !== d2z) { x += -d2z * LANE; z += d2x * LANE; }
    return { x, z };
  }

  update(dt, depth = 0) {
    const c = this.car;
    const game = this.game;
    const [n0, n1, n2, n3] = this.nodes;
    const B = this._corner(n0, n1, n2);
    const C = this._corner(n1, n2, n3);
    const A = this.segStart;
    let sx = B.x - A.x, sz = B.z - A.z;
    const segLen = Math.hypot(sx, sz) || 1;
    sx /= segLen; sz /= segLen;
    let tx = C.x - B.x, tz = C.z - B.z;
    const len2 = Math.hypot(tx, tz) || 1;
    tx /= len2; tz /= len2;
    const px = c.x - A.x, pz = c.z - A.z;
    const s = px * sx + pz * sz;
    const lat = Math.abs(-px * sz + pz * sx);

    // advance to the next segment
    if (depth < 3 && (s >= segLen || ((c.x - B.x) * tx + (c.z - B.z) * tz > 1.0 && dist2(c.x, c.z, B.x, B.z) < 200))) {
      this.segStart = B;
      this.nodes.shift();
      this.nodes.push(this._choose(this.nodes[1], this.nodes[2]));
      return this.update(dt, depth + 1);
    }
    if (lat > 30 || s < -30) { this.replan(); return; }

    const speed = c.speed;
    const look = 5 + speed * 0.55;
    let gx, gz;
    if (s + look <= segLen) { gx = A.x + sx * (s + look); gz = A.z + sz * (s + look); }
    else {
      const rem = Math.min(s + look - segLen, len2);
      gx = B.x + tx * rem; gz = B.z + tz * rem;
    }

    let targetSpeed = this.mode === 'police' ? c.type.maxSpeed * 0.62 : this.cruise;
    const turning = Math.abs(sx * tx + sz * tz) < 0.5;
    const toCorner = segLen - s;
    if (turning && toCorner < 22) targetSpeed = Math.min(targetSpeed, (this.mode === 'police' ? 10 : 6.5) + toCorner * 0.3);

    // direct pursuit for police
    this.direct = false;
    if (this.mode === 'police') {
      const p = game.player;
      const d2 = dist2(c.x, c.z, p.x, p.z);
      if (d2 < 45 * 45 && game.world.lineOfSight(c.x, c.z, p.x, p.z)) {
        this.direct = true;
        const pv = p.velocity();
        const ps = Math.hypot(pv.x, pv.z);
        const d = Math.sqrt(d2);
        gx = p.x + pv.x * 0.45;
        gz = p.z + pv.z * 0.45;
        if (ps < 3.5) {
          // suspect is slow: pull up close and stop to make the arrest
          targetSpeed = Math.min(c.type.maxSpeed * 0.8, Math.max(0, (d - (p.inCar ? 6.5 : 4.5)) * 0.9));
        } else {
          targetSpeed = Math.min(c.type.maxSpeed * 0.95, ps + 4 + d * 0.35);
        }
      }
    }
    this.target.x = gx; this.target.z = gz;

    // obstacle scan (staggered)
    this.scanT -= dt;
    if (this.scanT <= 0 && dt > 0) {
      this.scanT = 0.12;
      this.gap = this._scan();
    }
    const brakeGap = this.mode === 'police' ? 2.5 : 4.5;
    if (this.gap < 18 && !(this.direct && this.gap > 2)) {
      targetSpeed = Math.min(targetSpeed, Math.max(0, (this.gap - brakeGap) * 0.9));
    }
    // yield at intersections
    if (this.mode === 'traffic' && toCorner < 16 && toCorner > 4 && this._intersectionBusy(n1)) targetSpeed = 0;

    // steering
    let desired = Math.atan2(gx - c.x, gz - c.z);
    let diff = wrapAngle(desired - c.heading);
    let steer = clamp(-diff * 2.4, -1, 1);
    let throttle = clamp((targetSpeed - c.vF) * 0.35, -1, 1);
    if (targetSpeed < 0.5 && c.vF < 0.6) throttle = 0;

    // stuck recovery
    if (dt > 0) {
      if (this.reverseT > 0) {
        this.reverseT -= dt;
        throttle = -0.8;
        steer = -steer;
      } else if (throttle > 0.25 && speed < 0.8) {
        this.stuckT += dt;
        if (this.stuckT > (this.mode === 'police' ? 1.2 : 2.2)) { this.reverseT = 1.3; this.stuckT = 0; }
      } else this.stuckT = Math.max(0, this.stuckT - dt);
      // honk when blocked for a while
      this.hornCooldown -= dt;
      if (this.gap < 7 && speed < 1 && this.mode === 'traffic') {
        this.waitT += dt;
        if (this.waitT > 4 && this.hornCooldown <= 0 && dist2(c.x, c.z, game.player.x, game.player.z) < 40 * 40) {
          game.audio.honk(c, 0.35);
          this.hornCooldown = 3 + Math.random() * 4;
        }
        if (this.waitT > 9) { this.reverseT = 1.6; this.waitT = 0; }
      } else this.waitT = 0;
    }

    c.input.throttle = throttle;
    c.input.steer = steer;
    c.input.handbrake = false;
  }

  _scan() {
    const c = this.car;
    const g = this.game;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const rx = -fz, rz = fx;
    let gap = Infinity;
    const half = c.type.len / 2;
    const test = (ox, oz, oHalf, oWid) => {
      const dx = ox - c.x, dz = oz - c.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > 24) return;
      const lat = Math.abs(dx * rx + dz * rz);
      if (lat > c.type.wid / 2 + oWid + 0.3) return;
      const gg = along - half - oHalf;
      if (gg < gap) gap = gg;
    };
    for (const o of g.cars) {
      if (o === c) continue;
      if (Math.abs(o.x - c.x) > 26 || Math.abs(o.z - c.z) > 26) continue;
      if (this.mode === 'police' && o.driver === 'player') continue;
      test(o.x, o.z, o.type.len / 2, o.type.wid / 2);
    }
    for (const p of g.peds.list) {
      if (Math.abs(p.x - c.x) > 18 || Math.abs(p.z - c.z) > 18) continue;
      test(p.x, p.z, 0.4, 0.5);
    }
    const pl = g.player;
    if (!pl.inCar && this.mode !== 'police') test(pl.x, pl.z, 0.4, 0.5);
    return gap;
  }

  _intersectionBusy(node) {
    const nx = roadPos(node.i), nz = roadPos(node.j);
    const c = this.car;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    for (const o of this.game.cars) {
      if (o === this.car) continue;
      if (Math.abs(o.x - nx) > 7.5 || Math.abs(o.z - nz) > 7.5) continue;
      const sp = o.speed;
      if (sp < 0.5) continue;
      const d = (o.vx * fx + o.vz * fz) / sp;
      if (Math.abs(d) < 0.6) return true;
    }
    return false;
  }
}

// Spawns and recycles traffic and parked cars around the player, and resolves car-vs-car contacts.
export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.targetTraffic = 20;
    this.targetParked = 16;
    this.spawnT = 0;
  }

  setQuality(q) {
    this.targetTraffic = q === 'high' ? 22 : 13;
    this.targetParked = q === 'high' ? 18 : 10;
  }

  spawnCar(typeKey, x, z, heading, color) {
    const car = new Car(this.game, typeKey, x, z, heading, color);
    this.game.cars.push(car);
    return car;
  }

  removeCar(car) {
    const cars = this.game.cars;
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    if (car.spot) car.spot.car = null;
    car.dispose();
  }

  // Random road segment at a distance from the player, preferably out of view.
  findRoadSpawn(minD, maxD, preferBehind = true) {
    const g = this.game;
    const px = g.player.x, pz = g.player.z;
    const cam = g.cameraRig;
    const cfx = Math.sin(cam.yaw + Math.PI), cfz = Math.cos(cam.yaw + Math.PI);
    for (let tries = 0; tries < 24; tries++) {
      const i = Math.floor(Math.random() * (N_BLOCKS + 1));
      const j = Math.floor(Math.random() * (N_BLOCKS + 1));
      const [dx, dz] = pick(DIRS);
      if (!inGrid(i + dx, j + dz)) continue;
      const f = rand(0.25, 0.75);
      const x = roadPos(i) + dx * PITCH * f - dz * LANE, z = roadPos(j) + dz * PITCH * f + dx * LANE;
      const d = Math.hypot(x - px, z - pz);
      if (d < minD || d > maxD) continue;
      if (preferBehind && tries < 16) {
        const dot = ((x - px) * cfx + (z - pz) * cfz) / d;
        if (dot > 0.35 && d < 160) continue;
      }
      let clear = true;
      for (const o of g.cars) if (dist2(o.x, o.z, x, z) < 100) { clear = false; break; }
      if (!clear) continue;
      return { a: { i, j }, b: { i: i + dx, j: j + dz }, f };
    }
    return null;
  }

  spawnTraffic(typeKey, mode = 'traffic', minD = 90, maxD = 190) {
    const sp = this.findRoadSpawn(minD, maxD);
    if (!sp) return null;
    const car = this.spawnCar(typeKey || pick(TRAFFIC_MIX), 0, 0, 0);
    car.driver = mode === 'police' ? 'cop' : 'npc';
    car.ai = new DriverAI(this.game, car, mode);
    car.ai.placeOn(sp.a, sp.b, sp.f);
    const sp0 = car.ai.cruise * 0.8;
    car.vx = Math.sin(car.heading) * sp0;
    car.vz = Math.cos(car.heading) * sp0;
    return car;
  }

  update(dt) {
    const g = this.game;
    const px = g.player.x, pz = g.player.z;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.35;
      let traffic = 0, parked = 0;
      for (const c of g.cars) {
        if (c.driver === 'npc' && c.ai) traffic++;
        if (c.spot) parked++;
      }
      if (traffic < this.targetTraffic) this.spawnTraffic(null, 'traffic', traffic < this.targetTraffic / 2 ? 50 : 90);
      if (parked < this.targetParked) this._spawnParked();
      // recycle
      for (let k = g.cars.length - 1; k >= 0; k--) {
        const c = g.cars[k];
        if (c.driver === 'player' || c.mission) continue;
        const d2 = dist2(c.x, c.z, px, pz);
        let limit = 230;
        if (c === g.player.lastCar) limit = 320;
        if (c.spot) limit = 190;
        if (c.wrecked) limit = 140;
        if (c.driver === 'cop' && g.wanted.stars > 0) limit = 320;
        if (d2 > limit * limit) this.removeCar(c);
      }
    }

    for (const c of g.cars) {
      if (c.ai) c.ai.update(dt);
      else if (c.driver !== 'player') { c.input.throttle = 0; c.input.steer = 0; c.input.handbrake = true; }
      // parked, motionless cars skip physics
      if (!c.ai && c.driver !== 'player' && c.speed < 0.02 && c.grounded && !c.burning && !c.sinking && c.age > 1) {
        c.vx = c.vz = 0; c.angVel = 0;
        continue;
      }
      c.update(dt);
    }
    this._collideCars();
  }

  _spawnParked() {
    const g = this.game;
    const px = g.player.x, pz = g.player.z;
    const spots = g.world.parkingSpots;
    for (let tries = 0; tries < 12; tries++) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      if (s.car) continue;
      const d2 = dist2(s.x, s.z, px, pz);
      if (d2 > 150 * 150 || d2 < 35 * 35) continue;
      let clear = true;
      for (const o of g.cars) if (dist2(o.x, o.z, s.x, s.z) < 36) { clear = false; break; }
      if (!clear) continue;
      const car = this.spawnCar(pick(TRAFFIC_MIX), s.x, s.z, s.heading);
      car.spot = s;
      s.car = car;
      return car;
    }
    return null;
  }

  _collideCars() {
    const cars = this.game.cars;
    const n = cars.length;
    for (let a = 0; a < n; a++) {
      const A = cars[a];
      for (let b = a + 1; b < n; b++) {
        const Bc = cars[b];
        const rr = A.boundR + Bc.boundR;
        const dx = A.x - Bc.x, dz = A.z - Bc.z;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (Math.abs(A.y - Bc.y) > 1.6) continue;
        this._pair(A, Bc);
      }
    }
  }

  _pair(A, B) {
    const afx = Math.sin(A.heading), afz = Math.cos(A.heading);
    const bfx = Math.sin(B.heading), bfz = Math.cos(B.heading);
    for (let i = -1; i <= 1; i += 2) {
      const ax = A.x + afx * A.offset * i, az = A.z + afz * A.offset * i;
      for (let j = -1; j <= 1; j += 2) {
        const bx = B.x + bfx * B.offset * j, bz = B.z + bfz * B.offset * j;
        const dx = ax - bx, dz = az - bz;
        const rr = A.radius + B.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const overlap = rr - d;
        const ma = A.mass, mb = B.mass;
        const fa = A.wrecked && B.wrecked ? 0.5 : mb / (ma + mb);
        A.x += nx * overlap * fa; A.z += nz * overlap * fa;
        B.x -= nx * overlap * (1 - fa); B.z -= nz * overlap * (1 - fa);
        const rvx = A.vx - B.vx, rvz = A.vz - B.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const e = 0.2;
          const J = (-(1 + e) * vn) / (1 / ma + 1 / mb);
          A.vx += (J / ma) * nx; A.vz += (J / ma) * nz;
          B.vx -= (J / mb) * nx; B.vz -= (J / mb) * nz;
          const oax = afx * A.offset * i, oaz = afz * A.offset * i;
          const obx = bfx * B.offset * j, obz = bfz * B.offset * j;
          A.angVel += ((oax * nz - oaz * nx) * J) / (ma * 4);
          B.angVel -= ((obx * nz - obz * nx) * J) / (mb * 4);
          const impact = -vn;
          // wake parked cars so they roll
          if (impact > 4) {
            A.damage((impact - 4) * 1.6 * (mb / (ma + mb)) * 2, 'car');
            B.damage((impact - 4) * 1.6 * (ma / (ma + mb)) * 2, 'car');
            this.game.onCarImpact(A, impact, (ax + bx) / 2, (az + bz) / 2, B);
          }
          if (A.spot) { A.spot.car = null; A.spot = null; }
          if (B.spot) { B.spot.car = null; B.spot = null; }
        }
        return;
      }
    }
  }
}
