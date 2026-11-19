import * as THREE from 'three';
import { clamp, damp, rand, pick, dist2 } from './config.js';

const CAR_SHOTS = ['chase', 'side', 'roadside', 'drone', 'front', 'wheel', 'roadside', 'chase'];
const FOOT_SHOTS = ['orbit', 'hero', 'orbit'];
const TITLE_SHOTS = ['drone', 'roadside', 'chase', 'drone', 'roadside'];

// Film-style camera director: picks a shot, holds it for a few seconds, then hard-cuts.
// Used for the attract mode on the title screen and the in-game cinematic camera (V).
export class CineCam {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.shot = null;
    this.t = 0;
    this.dur = 5;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fixed = new THREE.Vector3();
    this.side = 1;
    this.orbit = 0;
    this.blockedT = 0;
    this.subjectCar = null;
    this.last = null;
  }

  wantsLetterbox() { return this.active || this.game.state === 'title'; }

  toggle() {
    this.active = !this.active;
    this.shot = null;
    this.game.hud.setCinematic(this.active);
    if (!this.active) { this.game.cameraRig.snapBehind(); this.game.cameraRig.pivot.set(this.game.player.x, this.game.player.y + 1.6, this.game.player.z); }
    return this.active;
  }

  // What we are filming: the player's car, Rae on foot, or (title screen) a passing car.
  _subject() {
    const g = this.game;
    if (g.state === 'title') {
      let c = this.subjectCar;
      if (!c || !g.cars.includes(c) || dist2(c.x, c.z, g.player.x, g.player.z) > 170 * 170 || c.speed < 1) {
        let best = null, bd = Infinity;
        for (const o of g.cars) {
          if (!o.ai || o.speed < 4) continue;
          const d = dist2(o.x, o.z, g.player.x, g.player.z);
          if (d < bd) { bd = d; best = o; }
        }
        if (best !== c) { this.subjectCar = best; this.shot = null; }
        c = best;
      }
      if (c) return { car: c, x: c.x, y: c.y, z: c.z, h: c.heading, vx: c.vx, vz: c.vz, speed: c.speed };
      const p = g.player;
      return { x: p.x, y: p.y, z: p.z, h: p.heading, vx: 0, vz: 0, speed: 0 };
    }
    const p = g.player;
    if (p.inCar) { const c = p.car; return { car: c, x: c.x, y: c.y, z: c.z, h: c.heading, vx: c.vx, vz: c.vz, speed: c.speed }; }
    return { x: p.x, y: p.y, z: p.z, h: p.heading, vx: p.vx, vz: p.vz, speed: Math.hypot(p.vx, p.vz) };
  }

  _start(s) {
    const list = this.game.state === 'title' ? TITLE_SHOTS : s.car ? CAR_SHOTS : FOOT_SHOTS;
    let shot = pick(list);
    if (shot === this.last) shot = pick(list);
    if (shot === 'roadside' && s.speed < 6) shot = 'side';
    this.shot = shot;
    this.last = shot;
    this.t = 0;
    this.dur = rand(4, 7);
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.orbit = Math.random() * Math.PI * 2;
    this.blockedT = 0;
    const fx = Math.sin(s.h), fz = Math.cos(s.h);
    if (shot === 'roadside') {
      const vl = Math.hypot(s.vx, s.vz) || 1;
      const dx = s.vx / vl, dz = s.vz / vl;
      const ahead = clamp(s.speed * 2.6, 26, 70);
      const rx = -dz, rz = dx;
      const x = s.x + dx * ahead + rx * this.side * 7, z = s.z + dz * ahead + rz * this.side * 7;
      this.fixed.set(x, this.game.world.groundHeight(x, z) + rand(0.7, 1.6), z);
      this.dur = 8;
    }
    this._place(s, 0, true);
  }

  _place(s, dt, snap) {
    const g = this.game;
    const fx = Math.sin(s.h), fz = Math.cos(s.h);
    const rx = -fz, rz = fx;
    const L = s.car ? s.car.type.len : 1;
    let px, py, pz, lx, ly, lz, fov, lag = 7;
    switch (this.shot) {
      case 'chase':
        px = s.x - fx * (L + 4.5) + rx * 0.9; py = s.y + 1.25; pz = s.z - fz * (L + 4.5) + rz * 0.9;
        lx = s.x + fx * 5; ly = s.y + 0.9; lz = s.z + fz * 5; fov = 52; lag = 5;
        break;
      case 'side':
        px = s.x + rx * this.side * (L + 3.5) + fx * 1.5; py = s.y + 0.85; pz = s.z + rz * this.side * (L + 3.5) + fz * 1.5;
        lx = s.x + fx * 0.8; ly = s.y + 0.7; lz = s.z + fz * 0.8; fov = 36; lag = 9;
        break;
      case 'wheel':
        px = s.x + rx * this.side * (s.car ? s.car.type.wid / 2 + 0.9 : 1.2) - fx * (L * 0.2); py = s.y + 0.4; pz = s.z + rz * this.side * (s.car ? s.car.type.wid / 2 + 0.9 : 1.2) - fz * (L * 0.2);
        lx = s.x + fx * 9; ly = s.y + 0.5; lz = s.z + fz * 9; fov = 72; lag = 30;
        break;
      case 'front':
        px = s.x + fx * (L + 3.5) + rx * 0.6; py = s.y + 0.75; pz = s.z + fz * (L + 3.5) + rz * 0.6;
        lx = s.x; ly = s.y + 0.8; lz = s.z; fov = 48; lag = 9;
        break;
      case 'drone': {
        this.orbit += dt * 0.12;
        const r = 16;
        px = s.x + Math.sin(this.orbit) * r - fx * 6; py = s.y + 11; pz = s.z + Math.cos(this.orbit) * r - fz * 6;
        lx = s.x + fx * 4; ly = s.y; lz = s.z + fz * 4; fov = 46; lag = 4;
        break;
      }
      case 'roadside': {
        px = this.fixed.x; py = this.fixed.y; pz = this.fixed.z;
        lx = s.x; ly = s.y + 0.8; lz = s.z;
        const d = Math.sqrt(dist2(px, pz, s.x, s.z));
        fov = clamp(d * 0.9, 22, 58); lag = 100;
        if (this.t > 1.5 && d > 75) this.t = this.dur; // car has gone, cut
        break;
      }
      case 'hero': {
        px = s.x + fx * 3.2 + rx * 1.1; py = s.y + 0.55; pz = s.z + fz * 3.2 + rz * 1.1;
        lx = s.x; ly = s.y + 1.4; lz = s.z; fov = 50; lag = 6;
        break;
      }
      case 'orbit':
      default: {
        this.orbit += dt * 0.25;
        const r = s.car ? 9 : 4.6;
        px = s.x + Math.sin(this.orbit) * r; py = s.y + (s.car ? 2.2 : 1.6); pz = s.z + Math.cos(this.orbit) * r;
        lx = s.x; ly = s.y + (s.car ? 0.8 : 1.3); lz = s.z; fov = 45; lag = 6;
      }
    }
    // keep out of walls (except the fixed roadside camera, which cuts instead)
    if (this.shot !== 'roadside') {
      const t = g.world.raycast(lx, ly + 0.4, lz, px, py, pz);
      if (t < 1) {
        const tt = Math.max(0.15, t - 0.05);
        px = lx + (px - lx) * tt; py = (ly + 0.4) + (py - ly - 0.4) * tt; pz = lz + (pz - lz) * tt;
      }
    } else if (g.world.raycast(px, py, pz, lx, ly, lz) < 0.98) {
      this.blockedT += dt;
      if (this.blockedT > 0.35) this.t = this.dur;
    } else this.blockedT = 0;
    py = Math.max(py, g.world.groundHeight(px, pz) + 0.25);
    if (snap) { this.pos.set(px, py, pz); this.look.set(lx, ly, lz); }
    else {
      const k = 1 - Math.exp(-lag * dt);
      this.pos.x += (px - this.pos.x) * k; this.pos.y += (py - this.pos.y) * k; this.pos.z += (pz - this.pos.z) * k;
      const kl = 1 - Math.exp(-14 * dt);
      this.look.x += (lx - this.look.x) * kl; this.look.y += (ly - this.look.y) * kl; this.look.z += (lz - this.look.z) * kl;
    }
    const cam = g.camera;
    cam.fov = snap ? fov : damp(cam.fov, fov, 3, dt);
    cam.updateProjectionMatrix();
  }

  update(dt) {
    const s = this._subject();
    if (!this.shot) this._start(s);
    this.t += dt;
    if (this.t >= this.dur) this._start(s);
    this._place(s, dt, false);
    const cam = this.game.camera;
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    // keep the minimap and spawner oriented with what we see
    this.game.cameraRig.yaw = Math.atan2(this.pos.x - this.look.x, this.pos.z - this.look.z);
  }
}
