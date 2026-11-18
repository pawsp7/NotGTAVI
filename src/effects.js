import * as THREE from 'three';
import { smokeTexture } from './textures.js';
import { rand } from './config.js';

// GPU point particles with per-particle size, colour and alpha.
class ParticleSystem {
  constructor(scene, max, additive) {
    this.max = max;
    this.p = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: smokeTexture() }, scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, drag = 1, gravity = 0) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x, y, z, vx, vy, vz, life, max: life, size, grow, r, g, b, a, drag, gravity });
  }

  update(dt) {
    const list = this.p;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.gravity * dt;
      const d = Math.pow(q.drag, dt);
      q.vx *= d; q.vy *= d; q.vz *= d;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.gravity && q.y < 0.05) { q.y = 0.05; q.vy *= -0.3; }
      q.size += q.grow * dt;
      list[n++] = q;
    }
    list.length = n;
    for (let i = 0; i < n; i++) {
      const q = list[i];
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.col[i * 3] = q.r; this.col[i * 3 + 1] = q.g; this.col[i * 3 + 2] = q.b;
      this.size[i] = q.size;
      const t = q.life / q.max;
      this.alpha[i] = q.a * Math.min(1, t * 2.5);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha']) geo.attributes[k].needsUpdate = true;
  }
}

// Tyre marks: a ring buffer of thin quads on the road.
class SkidMarks {
  constructor(scene, max = 700) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.mesh.frustumCulled = false;
    this.count = 0;
    scene.add(this.mesh);
  }
  add(ax, az, bx, bz, y, w = 0.13) {
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz);
    if (l < 0.05 || l > 3) return;
    const nx = (-dz / l) * w, nz = (dx / l) * w;
    const o = this.i * 18;
    const P = this.pos;
    const yy = y + 0.035;
    const v = [ax - nx, az - nz, ax + nx, az + nz, bx - nx, bz - nz, bx - nx, bz - nz, ax + nx, az + nz, bx + nx, bz + nz];
    for (let k = 0; k < 6; k++) { P[o + k * 3] = v[k * 2]; P[o + k * 3 + 1] = yy; P[o + k * 3 + 2] = v[k * 2 + 1]; }
    this.i = (this.i + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, this.count * 6);
    geo.attributes.position.needsUpdate = true;
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.smoke = new ParticleSystem(scene, 500, false);
    this.fire = new ParticleSystem(scene, 400, true);
    this.skids = new SkidMarks(scene);
    this.flash = new THREE.PointLight(0xffa040, 0, 40, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.lastWheel = new Map();
  }

  explosion(x, y, z) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(2, 9);
      this.fire.emit(x, y + 0.8, z, Math.cos(a) * s, rand(2, 10), Math.sin(a) * s, rand(0.5, 1.1), rand(1.5, 3), 3, 1, rand(0.4, 0.7), 0.1, 1, 0.3);
    }
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1, 5);
      this.smoke.emit(x, y + 1, z, Math.cos(a) * s, rand(1.5, 5), Math.sin(a) * s, rand(1.8, 3.4), rand(2, 3.5), 2.5, 0.12, 0.11, 0.1, 0.8, 0.5);
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(6, 16);
      this.fire.emit(x, y + 1, z, Math.cos(a) * s, rand(4, 12), Math.sin(a) * s, rand(0.6, 1.4), 0.25, 0, 1, 0.8, 0.3, 1, 0.9, 20);
    }
    this.flash.position.set(x, y + 2, z);
    this.flash.intensity = 60;
    this.flashT = 0.5;
  }

  sparks(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(2, 7);
      this.fire.emit(x, y, z, Math.cos(a) * s, rand(1, 5), Math.sin(a) * s, rand(0.25, 0.6), 0.18, 0, 1, 0.85, 0.4, 1, 0.9, 18);
    }
  }

  splash(x, z) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1, 5);
      this.smoke.emit(x, 0.3, z, Math.cos(a) * s, rand(3, 8), Math.sin(a) * s, rand(0.6, 1.3), rand(0.6, 1.2), 1, 0.85, 0.95, 1, 0.9, 0.8, 16);
    }
  }

  dust(x, y, z) {
    this.smoke.emit(x, y + 0.2, z, rand(-0.5, 0.5), rand(0.3, 1), rand(-0.5, 0.5), rand(0.8, 1.4), 0.8, 1.6, 0.75, 0.75, 0.75, 0.35, 0.6);
  }

  // Per-car continuous effects: tyre smoke, skid marks, damage smoke and fire.
  carFx(car, dt) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const rx = -fz, rz = fx;
    const t = car.type;
    if (car.grounded && !car.sinking) {
      const sliding = car.slip > 3.2 || (car.input.handbrake && Math.abs(car.vF) > 5) || (car.input.throttle > 0.9 && car.vF < 6 && car.vF > 0.5 && car.type.accel > 15);
      const back = -(t.len / 2 - t.wheelR - 0.35);
      for (const s of [-1, 1]) {
        const wx = car.x + fx * back + rx * s * (t.wid / 2 - 0.15);
        const wz = car.z + fz * back + rz * s * (t.wid / 2 - 0.15);
        const key = car;
        let prev = this.lastWheel.get(key);
        if (!prev) { prev = [null, null]; this.lastWheel.set(key, prev); }
        const idx = s < 0 ? 0 : 1;
        if (sliding && prev[idx]) {
          this.skids.add(prev[idx][0], prev[idx][1], wx, wz, car.y);
          if (Math.random() < dt * 25) this.smoke.emit(wx, car.y + 0.2, wz, rand(-0.5, 0.5), rand(0.4, 1.2), rand(-0.5, 0.5), rand(0.8, 1.5), 0.9, 2.2, 0.85, 0.85, 0.88, 0.45, 0.6);
        }
        prev[idx] = sliding ? [wx, wz] : null;
      }
    }
    if (car.health < 35 && !car.sinking) {
      const fxp = car.x + fx * (t.len / 2 - 0.6), fzp = car.z + fz * (t.len / 2 - 0.6);
      const dark = car.health < 20 ? 0.18 : 0.55;
      if (Math.random() < dt * (car.wrecked ? 12 : 18)) this.smoke.emit(fxp, car.y + 1.1, fzp, rand(-0.3, 0.3), rand(1.2, 2.4), rand(-0.3, 0.3), rand(1.4, 2.4), 0.9, 2.4, dark, dark, dark, 0.6, 0.7);
      if (car.burning > 0 || (car.wrecked && car.age % 30 < 12)) {
        if (Math.random() < dt * 40) this.fire.emit(fxp + rand(-0.4, 0.4), car.y + 1.0, fzp + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(0.35, 0.7), rand(0.7, 1.3), -0.6, 1, rand(0.35, 0.6), 0.08, 1, 0.8);
      }
    }
  }

  forget(car) { this.lastWheel.delete(car); }

  update(dt) {
    this.smoke.update(dt);
    this.fire.update(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = Math.max(0, this.flashT / 0.5) * 60;
    } else this.flash.intensity = 0;
  }
}
