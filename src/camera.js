import * as THREE from 'three';
import { clamp, damp, wrapAngle } from './config.js';

// Third-person orbit camera. Follows Rae on foot; trails behind the car when
// driving and swings back behind it a moment after you stop moving the mouse.
export class CameraRig {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.yaw = Math.PI;
    this.pitch = 0.28;
    this.dist = 5.5;
    this.lookT = 0;
    this.pivot = new THREE.Vector3();
    this.shakeAmt = 0;
    this.far = false;
    this.sens = 0.0026;
  }

  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  snapBehind() {
    const p = this.game.player;
    const h = p.inCar ? p.car.heading : p.heading;
    this.yaw = h + Math.PI;
    this.lookT = 0;
  }

  update(dt, input) {
    const g = this.game;
    const p = g.player;
    if (input.pressed('camera')) this.far = !this.far;
    const lx = input.lookX, ly = input.lookY;
    if (lx || ly) this.lookT = 1.6;
    this.yaw -= lx * this.sens;
    this.pitch = clamp(this.pitch + ly * this.sens, -0.25, 1.15);
    this.lookT -= dt;

    let tx, ty, tz, wantDist;
    if (p.inCar) {
      const c = p.car;
      tx = c.x; ty = c.y + 1.4 + (c.type.shape === 'van' ? 0.5 : 0); tz = c.z;
      const sp = c.speed;
      wantDist = (c.type.len * 1.45 + 3.2) + sp * 0.07 + (this.far ? 5 : 0);
      if (this.lookT <= 0 && sp > 1.5) {
        // follow travel direction (so reversing does not spin the camera)
        let h = c.heading;
        if (c.vF < -2) h = Math.atan2(c.vx, c.vz);
        const desired = h + Math.PI;
        this.yaw += wrapAngle(desired - this.yaw) * (1 - Math.exp(-3.2 * dt));
        this.pitch = damp(this.pitch, 0.2, 2.5, dt);
      }
      const fov = clamp(62 + sp * 0.32, 62, 80);
      this.camera.fov = damp(this.camera.fov, fov, 3, dt);
    } else {
      tx = p.x; ty = p.y + 1.65; tz = p.z;
      wantDist = this.far ? 8.5 : 5.2;
      this.camera.fov = damp(this.camera.fov, 60, 4, dt);
    }
    this.camera.updateProjectionMatrix();
    this.dist = damp(this.dist, wantDist, 4, dt);
    const k = 1 - Math.exp(-(p.inCar ? 14 : 18) * dt);
    this.pivot.x += (tx - this.pivot.x) * k;
    this.pivot.y += (ty - this.pivot.y) * k;
    this.pivot.z += (tz - this.pivot.z) * k;
    if (this.pivot.distanceToSquared(new THREE.Vector3(tx, ty, tz)) > 400) this.pivot.set(tx, ty, tz);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let cx = this.pivot.x + Math.sin(this.yaw) * cp * this.dist;
    let cy = this.pivot.y + sp * this.dist;
    let cz = this.pivot.z + Math.cos(this.yaw) * cp * this.dist;
    // keep the camera out of buildings
    const t = g.world.raycast(this.pivot.x, this.pivot.y, this.pivot.z, cx, cy, cz);
    if (t < 1) {
      const tt = Math.max(0.12, t - 0.06);
      cx = this.pivot.x + (cx - this.pivot.x) * tt;
      cy = this.pivot.y + (cy - this.pivot.y) * tt;
      cz = this.pivot.z + (cz - this.pivot.z) * tt;
    }
    cy = Math.max(cy, g.world.groundHeight(cx, cz) + 0.35);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.35;
      cx += (Math.random() - 0.5) * s; cy += (Math.random() - 0.5) * s; cz += (Math.random() - 0.5) * s;
      this.shakeAmt *= Math.exp(-6 * dt);
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.pivot.x, this.pivot.y + (p.inCar ? 0.2 : 0), this.pivot.z);
  }
}
