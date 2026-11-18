import * as THREE from 'three';
import { BLOCK_W, BEACH_X0, WATER_X, blockCenter, mulberry32, dist2 } from './config.js';

// Spinning cash bundles scattered around town, plus cash dropped by pedestrians.
export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    const geo = new THREE.BoxGeometry(0.7, 0.32, 0.4);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x42e695 });
    this.bandMat = new THREE.MeshBasicMaterial({ color: 0xf4f1de });
    this.geo = geo;
    this.bandGeo = new THREE.BoxGeometry(0.16, 0.34, 0.42);
    this.glowGeo = new THREE.RingGeometry(0.5, 0.75, 20);
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x42e695, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });

    // fixed stash spots: sidewalk corners, beach, parks
    const rng = mulberry32(42);
    const world = game.world;
    for (let k = 0; k < 26; k++) {
      let x, z;
      if (k < 6) { x = BEACH_X0 + 12 + rng() * (WATER_X - BEACH_X0 - 20); z = -300 + rng() * 600; }
      else {
        const b = world.pedBlocks[Math.floor(rng() * world.pedBlocks.length)];
        const h = BLOCK_W / 2 - 1.6;
        const corner = Math.floor(rng() * 4);
        x = b.cx + (corner % 2 ? h : -h) * (0.3 + rng() * 0.7);
        z = b.cz + (corner < 2 ? h : -h);
      }
      this.add(x, z, Math.round((60 + rng() * 190) / 10) * 10, false);
    }
  }

  add(x, z, amount, temporary = true) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.geo, this.mat);
    const band = new THREE.Mesh(this.bandGeo, this.bandMat);
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.8;
    g.add(m, band, glow);
    const y = this.game.world.groundHeight(x, z) + 0.9;
    g.position.set(x, y, z);
    this.game.scene.add(g);
    const it = { x, z, y, amount, mesh: g, temporary, life: temporary ? 30 : Infinity, respawn: 0 };
    this.items.push(it);
    return it;
  }

  blips() {
    const out = [];
    for (const it of this.items) if (it.respawn <= 0 && !it.temporary) out.push({ x: it.x, z: it.z, type: 'cash' });
    return out;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const t = performance.now() / 1000;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.respawn > 0) {
        it.respawn -= dt;
        if (it.respawn <= 0) it.mesh.visible = true;
        continue;
      }
      it.mesh.rotation.y = t * 2.2 + i;
      it.mesh.position.y = it.y + Math.sin(t * 3 + i) * 0.12;
      if (it.temporary) {
        it.life -= dt;
        if (it.life <= 0) { g.scene.remove(it.mesh); this.items.splice(i, 1); continue; }
      }
      const r = p.inCar ? 3.2 : 1.4;
      if (!p.dead && dist2(p.x, p.z, it.x, it.z) < r * r && Math.abs(p.y + 0.8 - it.y) < 3) {
        g.cash += it.amount;
        g.audio.cash();
        g.hud.toast(`+$${it.amount}`, 'cash', 1.6);
        if (it.temporary) { g.scene.remove(it.mesh); this.items.splice(i, 1); }
        else { it.mesh.visible = false; it.respawn = 150; }
      }
    }
  }
}
