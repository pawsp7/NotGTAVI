import * as THREE from 'three';
import { mergeColored, box, cyl } from './geom.js';
import { clamp, damp, GRAVITY, WATER_X } from './config.js';

// Original vehicle line-up for Port Solana.
export const CAR_TYPES = {
  breeze: {
    name: 'Breeze', shape: 'compact', len: 3.9, wid: 1.8, wheelR: 0.33, maxSpeed: 38, accel: 11, brake: 24, grip: 15,
    mass: 1000, steer: 0.62, durability: 0.9,
    colors: ['#ff8fab', '#7bdff2', '#f6e05e', '#b8f2a6', '#ffffff', '#c3aed6'],
  },
  sundial: {
    name: 'Sundial', shape: 'sedan', len: 4.6, wid: 1.9, wheelR: 0.35, maxSpeed: 44, accel: 12, brake: 26, grip: 15.5,
    mass: 1300, steer: 0.58, durability: 1,
    colors: ['#3d5a80', '#98c1d9', '#ee6c4d', '#293241', '#e0e0e0', '#7d8491', '#5b8e7d'],
  },
  kestrel: {
    name: 'Kestrel GT', shape: 'sports', len: 4.5, wid: 2.0, wheelR: 0.34, maxSpeed: 62, accel: 18, brake: 32, grip: 19,
    mass: 1250, steer: 0.6, durability: 0.85,
    colors: ['#e63946', '#ffb703', '#2a9d8f', '#111111', '#f1faee'],
  },
  cabby: {
    name: 'Cabby', shape: 'sedan', len: 4.7, wid: 1.9, wheelR: 0.35, maxSpeed: 43, accel: 12, brake: 26, grip: 15,
    mass: 1350, steer: 0.58, durability: 1.1, taxi: true,
    colors: ['#ffc300'],
  },
  hauler: {
    name: 'Hauler', shape: 'van', len: 5.3, wid: 2.1, wheelR: 0.4, maxSpeed: 34, accel: 8, brake: 20, grip: 12.5,
    mass: 2100, steer: 0.55, durability: 1.5,
    colors: ['#f1f1f1', '#d8d0c0', '#5f7a8a', '#9d4b3a'],
  },
  dune: {
    name: 'Dune Runner', shape: 'pickup', len: 5.0, wid: 2.0, wheelR: 0.42, maxSpeed: 42, accel: 12, brake: 24, grip: 14,
    mass: 1800, steer: 0.56, durability: 1.4,
    colors: ['#bc6c25', '#606c38', '#283618', '#dda15e', '#9b2226'],
  },
  patrol: {
    name: 'Patrol', shape: 'sedan', len: 4.8, wid: 1.95, wheelR: 0.36, maxSpeed: 54, accel: 16, brake: 30, grip: 18,
    mass: 1450, steer: 0.6, durability: 1.6, police: true,
    colors: ['#16181d'],
  },
};

export const TRAFFIC_MIX = ['breeze', 'breeze', 'sundial', 'sundial', 'sundial', 'cabby', 'hauler', 'dune', 'kestrel'];

const shared = {};
function sharedMats() {
  if (shared.ready) return shared;
  shared.detail = new THREE.MeshLambertMaterial({ vertexColors: true });
  shared.charred = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
  shared.wheel = new THREE.MeshLambertMaterial({ vertexColors: true });
  shared.head = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  shared.tailOff = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  shared.tailOn = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  shared.red = new THREE.MeshBasicMaterial({ color: 0xff2030 });
  shared.blue = new THREE.MeshBasicMaterial({ color: 0x2050ff });
  shared.off = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
  shared.taxiSign = new THREE.MeshBasicMaterial({ color: 0xfff1a6 });
  shared.ready = true;
  return shared;
}
export function carMaterials() { return sharedMats(); }

const geoCache = new Map();
function buildGeometry(type) {
  if (geoCache.has(type)) return geoCache.get(type);
  const t = CAR_TYPES[type];
  const L = t.len, W = t.wid, r = t.wheelR;
  const paint = [];
  const detail = [];
  const heads = [];
  const tails = [];
  const glass = '#2b4258';
  const dark = '#22252b';
  const clear = r * 0.55;
  let bodyH = 0.62, cabH = 0.6, cabLen = L * 0.48, cabZ = -L * 0.04, cabW = W * 0.86, bodyTop;

  if (t.shape === 'sports') { bodyH = 0.5; cabH = 0.46; cabLen = L * 0.4; cabZ = -L * 0.08; cabW = W * 0.8; }
  if (t.shape === 'compact') { bodyH = 0.62; cabH = 0.68; cabLen = L * 0.56; cabZ = -L * 0.06; }
  if (t.shape === 'van') { bodyH = 0.95; cabH = 0.95; cabLen = L * 0.78; cabZ = -L * 0.08; cabW = W * 0.96; }
  if (t.shape === 'pickup') { bodyH = 0.75; cabH = 0.66; cabLen = L * 0.3; cabZ = L * 0.1; }
  bodyTop = clear + bodyH;

  paint.push({ geo: box(W, bodyH, L), pos: [0, clear + bodyH / 2, 0], color: '#ffffff' });
  // hood and trunk wedges
  if (t.shape === 'sports') {
    paint.push({ geo: box(W * 0.96, 0.12, L * 0.3), pos: [0, bodyTop + 0.03, L * 0.3], rot: [0.08, 0, 0], color: '#ffffff' });
    paint.push({ geo: box(W * 0.9, 0.08, 0.35), pos: [0, bodyTop + 0.38, -L / 2 + 0.25], color: '#ffffff' }); // spoiler wing
    detail.push({ geo: box(0.08, 0.36, 0.08), pos: [W * 0.32, bodyTop + 0.18, -L / 2 + 0.25], color: dark });
    detail.push({ geo: box(0.08, 0.36, 0.08), pos: [-W * 0.32, bodyTop + 0.18, -L / 2 + 0.25], color: dark });
  }
  // cabin glass + painted roof and pillars
  detail.push({ geo: box(cabW, cabH, cabLen), pos: [0, bodyTop + cabH / 2, cabZ], color: glass });
  paint.push({ geo: box(cabW + 0.04, 0.08, cabLen * 0.92), pos: [0, bodyTop + cabH + 0.02, cabZ], color: '#ffffff' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    paint.push({ geo: box(0.1, cabH, 0.14), pos: [sx * (cabW / 2 + 0.01), bodyTop + cabH / 2, cabZ + sz * (cabLen / 2 - 0.07)], color: '#ffffff' });
  }
  if (t.shape === 'pickup') {
    // bed walls
    const bedLen = L * 0.42, bedZ = -L / 2 + bedLen / 2 + 0.1;
    detail.push({ geo: box(W * 0.9, 0.05, bedLen), pos: [0, bodyTop + 0.01, bedZ], color: '#2a2a2a' });
    paint.push({ geo: box(0.1, 0.45, bedLen), pos: [W / 2 - 0.05, bodyTop + 0.22, bedZ], color: '#ffffff' });
    paint.push({ geo: box(0.1, 0.45, bedLen), pos: [-W / 2 + 0.05, bodyTop + 0.22, bedZ], color: '#ffffff' });
    paint.push({ geo: box(W, 0.45, 0.1), pos: [0, bodyTop + 0.22, -L / 2 + 0.1], color: '#ffffff' });
  }
  // bumpers, grille, mirrors, plate, arches
  detail.push({ geo: box(W + 0.04, 0.22, 0.2), pos: [0, clear + 0.12, L / 2], color: dark });
  detail.push({ geo: box(W + 0.04, 0.22, 0.2), pos: [0, clear + 0.12, -L / 2], color: dark });
  detail.push({ geo: box(W * 0.5, 0.16, 0.05), pos: [0, clear + bodyH * 0.55, L / 2 + 0.01], color: '#0f1114' });
  detail.push({ geo: box(0.5, 0.14, 0.03), pos: [0, clear + 0.28, -L / 2 - 0.11], color: '#e8e4d8' });
  for (const sx of [-1, 1]) detail.push({ geo: box(0.22, 0.12, 0.1), pos: [sx * (W / 2 + 0.08), bodyTop + 0.12, cabZ + cabLen / 2 - 0.1], color: dark });
  // lights
  for (const sx of [-1, 1]) {
    heads.push({ geo: box(W * 0.2, 0.12, 0.06), pos: [sx * W * 0.33, clear + bodyH * 0.65, L / 2 + 0.02], color: '#ffffff' });
    tails.push({ geo: box(W * 0.22, 0.12, 0.06), pos: [sx * W * 0.33, clear + bodyH * 0.65, -L / 2 - 0.02], color: '#ffffff' });
  }
  const out = {
    paint: mergeColored(paint),
    detail: mergeColored(detail),
    heads: mergeColored(heads),
    tails: mergeColored(tails),
    bodyTop, cabH, cabZ, clear, cabLen,
  };
  geoCache.set(type, out);
  return out;
}

let wheelGeo = null;
function getWheelGeo() {
  if (wheelGeo) return wheelGeo;
  const tyre = cyl(1, 1, 0.3, 14);
  tyre.rotateZ(Math.PI / 2);
  const hub = cyl(0.55, 0.55, 0.32, 10);
  hub.rotateZ(Math.PI / 2);
  const spoke = box(0.33, 0.12, 1.5);
  wheelGeo = mergeColored([
    { geo: tyre, color: '#17181b' },
    { geo: hub, color: '#a9adb3' },
    { geo: spoke, color: '#6d7177', pos: [0, 0, 0] },
  ]);
  return wheelGeo;
}

const tmpOut = { x: 0, z: 0, nx: 0, nz: 0, hit: false };

export class Car {
  constructor(game, typeKey, x, z, heading, color) {
    this.game = game;
    this.typeKey = typeKey;
    this.type = CAR_TYPES[typeKey];
    const t = this.type;
    this.x = x; this.z = z; this.y = game.world.groundHeight(x, z);
    this.heading = heading;
    this.vx = 0; this.vz = 0; this.vy = 0; this.angVel = 0;
    this.vF = 0; this.vR = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    this.steerVis = 0;
    this.health = 100;
    this.wrecked = false;
    this.burning = 0;
    this.sinking = false;
    this.driver = null; // 'player' | 'npc' | 'cop' | null
    this.ai = null;
    this.mass = t.mass;
    this.radius = t.wid / 2 + 0.05;
    this.offset = t.len / 2 - t.wid / 2;
    this.boundR = t.len / 2 + 0.6;
    this.grounded = true;
    this.airTime = 0;
    this.slip = 0;
    this.lastImpact = 0;
    this.sirenOn = false;
    this.mission = null;
    this.color = color || t.colors[Math.floor(Math.random() * t.colors.length)];
    this.age = 0;
    this._buildMesh();
  }

  _buildMesh() {
    const g = buildGeometry(this.typeKey);
    const m = sharedMats();
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.mesh.add(this.body);
    this.paintMat = new THREE.MeshLambertMaterial({ color: this.color });
    this.paintMesh = new THREE.Mesh(g.paint, this.paintMat);
    this.paintMesh.castShadow = true;
    this.detailMesh = new THREE.Mesh(g.detail, m.detail);
    this.detailMesh.castShadow = true;
    this.headMesh = new THREE.Mesh(g.heads, m.head);
    this.tailMesh = new THREE.Mesh(g.tails, m.tailOff);
    this.body.add(this.paintMesh, this.detailMesh, this.headMesh, this.tailMesh);
    if (this.type.police) {
      // white doors
      const doors = new THREE.Mesh(box(this.type.wid + 0.02, 0.4, this.type.len * 0.45), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
      doors.position.set(0, g.clear + 0.36, 0);
      this.body.add(doors);
      const top = g.bodyTop + g.cabH + 0.12;
      this.lightL = new THREE.Mesh(box(0.55, 0.14, 0.26), m.red);
      this.lightR = new THREE.Mesh(box(0.55, 0.14, 0.26), m.blue);
      this.lightL.position.set(0.3, top, g.cabZ);
      this.lightR.position.set(-0.3, top, g.cabZ);
      this.body.add(this.lightL, this.lightR);
    }
    if (this.type.taxi) {
      const sign = new THREE.Mesh(box(0.7, 0.22, 0.3), m.taxiSign);
      sign.position.set(0, g.bodyTop + g.cabH + 0.17, g.cabZ);
      this.body.add(sign);
      const check = new THREE.Mesh(box(this.type.wid + 0.02, 0.12, this.type.len * 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      check.position.set(0, g.clear + this.type.wid * 0.18, 0);
      this.body.add(check);
    }
    // wheels
    const t = this.type;
    const wg = getWheelGeo();
    this.wheels = [];
    this.frontPivots = [];
    const wx = t.wid / 2 - 0.12, wz = t.len / 2 - t.wheelR - 0.35;
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const w = new THREE.Mesh(wg, sharedMats().wheel);
      w.scale.set(1, t.wheelR, t.wheelR);
      w.castShadow = true;
      if (sz > 0) {
        const p = new THREE.Group();
        p.position.set(sx * wx, t.wheelR, sz * wz);
        p.add(w);
        this.mesh.add(p);
        this.frontPivots.push(p);
      } else {
        w.position.set(sx * wx, t.wheelR, sz * wz);
        this.mesh.add(w);
      }
      this.wheels.push(w);
    }
    this.geoInfo = g;
    this.syncMesh(0);
    this.game.scene.add(this.mesh);
  }

  repaint(color) {
    this.color = color;
    this.paintMat.color.set(color);
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.paintMat.dispose();
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwdX() { return Math.sin(this.heading); }
  get fwdZ() { return Math.cos(this.heading); }

  damage(amount, cause) {
    if (this.wrecked) return;
    // the player's ride is a little tougher so chases last
    this.health -= (amount / this.type.durability) * (this.driver === 'player' ? 0.65 : 1);
    if (this.health <= 12 && !this.burning) {
      this.burning = 4.5;
      if (this.driver === 'player') this.game.hud.toast('Your car is on fire. Get out!', 'warn');
    }
  }

  explode() {
    if (this.wrecked) return;
    this.wrecked = true;
    this.burning = 0;
    this.health = 0;
    this.paintMat.color.set(0x2b2b2b);
    this.detailMesh.material = sharedMats().charred;
    this.headMesh.visible = false;
    this.tailMesh.material = sharedMats().off;
    if (this.lightL) { this.lightL.material = sharedMats().off; this.lightR.material = sharedMats().off; }
    this.vy = 6;
    this.grounded = false;
    this.ai = null;
    this.sirenOn = false;
    this.game.onCarExploded(this);
  }

  // Physics step. Collisions with other cars are handled by the vehicle manager.
  update(dt) {
    const t = this.type;
    const world = this.game.world;
    this.age += dt;
    let { throttle, steer, handbrake } = this.input;
    if (this.wrecked || this.sinking) { throttle = 0; steer = 0; handbrake = true; }

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx; // right vector
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    const ground = world.groundHeight(this.x, this.z);
    const ramp = world.rampAt ? world.rampAt(this.x, this.z) : null;

    if (this.grounded) {
      // engine & brakes
      if (throttle > 0) {
        if (vF < -0.5) vF += t.brake * throttle * dt;
        else {
          const k = vF / t.maxSpeed;
          vF += t.accel * throttle * Math.max(0.05, 1 - k * k) * dt;
        }
      } else if (throttle < 0) {
        if (vF > 0.5) vF += t.brake * throttle * dt;
        else if (vF > -12) vF += t.accel * 0.6 * throttle * dt;
      } else {
        // engine braking / rolling resistance
        const rr = 1.6 * dt;
        vF = Math.abs(vF) < rr ? 0 : vF - Math.sign(vF) * rr;
      }
      vF -= vF * Math.abs(vF) * 0.0012 * dt; // aero drag
      if (handbrake) {
        const hb = 9 * dt;
        vF = Math.abs(vF) < hb ? 0 : vF - Math.sign(vF) * hb;
      }

      // lateral tyre friction (Coulomb-style so hard turns slide)
      const maxLat = (handbrake ? 4.5 : t.grip) * dt;
      const before = vR;
      vR = Math.abs(vR) <= maxLat ? 0 : vR - Math.sign(vR) * maxLat;
      this.slip = Math.abs(before);

      // steering: kinematic bicycle model, reduced at speed
      const sAngle = steer * t.steer / (1 + Math.abs(vF) / 28);
      const wheelbase = t.len * 0.62;
      let yaw = -(vF / wheelbase) * Math.tan(sAngle);
      if (handbrake && Math.abs(vF) > 4) yaw *= 1.6;
      this.angVel = damp(this.angVel, yaw, handbrake ? 5 : 12, dt);
      this.airTime = 0;
    } else {
      this.angVel *= Math.pow(0.6, dt);
      this.airTime += dt;
    }

    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.vF = vF; this.vR = vR;
    this.heading += this.angVel * dt;

    // integrate
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // vertical
    const g2 = world.groundHeight(this.x, this.z);
    if (this.grounded) {
      if (ramp) {
        // climbing a ramp: carry vertical speed so the car launches off the lip
        const along = this.vx * ramp.dx + this.vz * ramp.dz;
        this.vy = Math.max(0, along * (ramp.h / ramp.len));
      } else this.vy = 0;
      if (g2 < this.y - 0.25) {
        this.grounded = false; // drove off a ledge / ramp lip
      } else this.y = g2;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= g2) {
        if (this.vy < -9) this.damage((-this.vy - 9) * 3, 'landing');
        if (this.vy < -4) this.game.onCarLanded(this, -this.vy);
        this.y = g2;
        this.vy = 0;
        this.grounded = true;
      }
    }

    // static collisions (two circles along the body)
    this._collideStatic(fx, fz);

    // water
    if (world.inWater(this.x) && !this.sinking) {
      this.sinking = true;
      this.game.onCarSplash(this);
    }
    if (this.sinking) {
      this.vx *= Math.pow(0.2, dt);
      this.vz *= Math.pow(0.2, dt);
      this.y = Math.max(this.y - dt * 0.8, -2.2);
    }

    // fire
    if (this.burning > 0 && !this.wrecked) {
      this.burning -= dt;
      if (this.burning <= 0) this.explode();
    }

    // lights
    const braking = (throttle < 0 && vF > 0.5) || handbrake;
    if (!this.wrecked) this.tailMesh.material = braking ? sharedMats().tailOn : sharedMats().tailOff;
    if (this.lightL && this.sirenOn) {
      const ph = Math.floor(this.age * 8) % 2;
      this.lightL.material = ph ? sharedMats().red : sharedMats().off;
      this.lightR.material = ph ? sharedMats().off : sharedMats().blue;
    } else if (this.lightL && !this.wrecked) {
      this.lightL.material = sharedMats().off;
      this.lightR.material = sharedMats().off;
    }

    this.syncMesh(dt);
  }

  _collideStatic(fx, fz) {
    const world = this.game.world;
    const r = this.radius;
    for (let s = -1; s <= 1; s += 2) {
      const ox = fx * this.offset * s, oz = fz * this.offset * s;
      const cx = this.x + ox, cz = this.z + oz;
      // skip walls lower than the car while airborne over them
      world.resolveCircle(cx, cz, r, tmpOut);
      if (!tmpOut.hit) continue;
      this.x += tmpOut.x - cx;
      this.z += tmpOut.z - cz;
      const nx = tmpOut.nx, nz = tmpOut.nz;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const impact = -vn;
        const e = 0.25;
        this.vx -= (1 + e) * vn * nx;
        this.vz -= (1 + e) * vn * nz;
        // scrape friction
        this.vx *= 0.94; this.vz *= 0.94;
        // spin from off-centre hit
        const torque = (ox * nz - oz * nx) * impact;
        this.angVel += torque * 0.12;
        if (impact > 6) {
          this.damage((impact - 6) * 2.2, 'wall');
          this.game.onCarImpact(this, impact, cx - nx * r, cz - nz * r, null);
        }
      }
    }
  }

  syncMesh(dt) {
    const t = this.type;
    this.mesh.position.set(this.x, this.y, this.z);
    let pitch = 0;
    const ramp = this.game.world.rampAt ? this.game.world.rampAt(this.x, this.z) : null;
    if (ramp && this.grounded) {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      pitch = -Math.atan((ramp.h / ramp.len) * (fx * ramp.dx + fz * ramp.dz));
    } else if (!this.grounded) {
      pitch = clamp(-Math.atan2(this.vy, Math.max(4, Math.abs(this.vF))) * 0.7, -0.5, 0.5);
    }
    this.pitchVis = dt ? damp(this.pitchVis || 0, pitch, 10, dt) : pitch;
    const roll = clamp(this.vF * this.angVel * 0.01, -0.07, 0.07);
    this.rollVis = dt ? damp(this.rollVis || 0, roll, 6, dt) : 0;
    this.mesh.rotation.set(this.pitchVis, this.heading, 0);
    this.body.rotation.z = this.rollVis;
    // wheels
    const spin = (this.vF * (dt || 0)) / t.wheelR;
    for (const w of this.wheels) w.rotation.x += spin;
    this.steerVis = dt ? damp(this.steerVis, -this.input.steer * t.steer * 0.8, 12, dt) : 0;
    for (const p of this.frontPivots) p.rotation.y = this.steerVis;
  }
}
