import { buildHuman, animateHuman } from './ped.js';
import { clamp, damp, wrapAngle, GRAVITY } from './config.js';

const tmp = { x: 0, z: 0, nx: 0, nz: 0, hit: false };

// The player character, Rae. On foot or behind the wheel.
export class Player {
  constructor(game) {
    this.game = game;
    this.h = buildHuman({ skin: '#c68642', shirt: '#ff7f50', pants: '#f4f1de', hair: '#1b1b1b' });
    // a little teal cap so Rae stands out in a crowd
    this.mesh = this.h.root;
    game.scene.add(this.mesh);
    this.x = 0; this.z = 0; this.y = 0; this.vy = 0;
    this.vx = 0; this.vz = 0;
    this.heading = 0;
    this.health = 100;
    this.inCar = false;
    this.car = null;
    this.lastCar = null;
    this.phase = 0;
    this.punchT = 0;
    this.punchCd = 0;
    this.downT = 0;
    this.hurtT = 0;
    this.grounded = true;
    this.dead = false;
  }

  spawn(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.y = this.game.world.groundHeight(x, z);
    this.vx = this.vz = this.vy = 0;
    this.health = 100;
    this.downT = 0;
    this.dead = false;
    this.h.body.rotation.set(0, 0, 0);
    this.mesh.visible = true;
    this.inCar = false;
    this.car = null;
  }

  velocity() {
    if (this.inCar) return { x: this.car.vx, z: this.car.vz };
    return { x: this.vx, z: this.vz };
  }

  hurt(amount) {
    if (this.dead) return;
    this.health -= amount;
    this.hurtT = 0;
    this.game.hud.flashDamage();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.game.wasted();
    }
  }

  knock(vx, vz, up) {
    if (this.inCar) return;
    this.downT = 2.2;
    this.vx = vx; this.vz = vz; this.vy = up;
  }

  nearestCar(maxExtra = 2.2) {
    let best = null, bd = Infinity;
    for (const c of this.game.cars) {
      if (c.wrecked || c.sinking) continue;
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d < c.type.len / 2 + maxExtra && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  enterCar(car) {
    const g = this.game;
    if (car.driver === 'npc' || car.driver === 'cop') {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const lx = car.x + fz * (car.type.wid / 2 + 0.8), lz = car.z - fx * (car.type.wid / 2 + 0.8);
      g.peds.spawnAt(lx, lz, { x: car.x, z: car.z });
      g.onCarjack(car);
    }
    if (car.spot) { car.spot.car = null; car.spot = null; }
    car.ai = null;
    car.driver = 'player';
    car.sirenOn = false;
    this.inCar = true;
    this.car = car;
    this.mesh.visible = false;
    g.audio.door();
    g.onEnterCar(car);
  }

  exitCar() {
    const car = this.car;
    const g = this.game;
    if (car.speed > 9 && !car.wrecked && !car.burning) {
      g.hud.toast('Slow down to get out', 'info');
      return;
    }
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    // left side is the driver door
    const side = car.type.wid / 2 + 0.7;
    let ex = car.x + fz * side, ez = car.z - fx * side;
    if (g.world.raycast(car.x, 1, car.z, ex, 1, ez) < 1) { ex = car.x - fz * side; ez = car.z + fx * side; }
    car.driver = null;
    car.input.throttle = 0; car.input.steer = 0; car.input.handbrake = true;
    this.lastCar = car;
    this.inCar = false;
    this.car = null;
    this.x = ex; this.z = ez;
    this.y = g.world.groundHeight(ex, ez);
    this.heading = car.heading + Math.PI / 2;
    this.vx = this.vz = 0;
    this.mesh.visible = true;
    g.audio.door();
    g.onExitCar(car);
  }

  update(dt, input) {
    const g = this.game;
    if (this.dead) return;
    this.hurtT += dt;
    if (this.hurtT > 8 && this.health < 100) this.health = Math.min(100, this.health + dt * 3);

    if (this.inCar) {
      const c = this.car;
      if (!c.wrecked) {
        c.input.throttle = input.throttle;
        c.input.steer = input.steer;
        c.input.handbrake = input.handbrake;
      }
      this.x = c.x; this.z = c.z; this.y = c.y;
      if (input.pressed('enter')) this.exitCar();
      if (input.pressed('horn')) g.audio.honk(c, 1);
      return;
    }

    const world = g.world;
    // knocked down
    if (this.downT > 0) {
      this.downT -= dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      const gh = world.groundHeight(this.x, this.z);
      if (this.y < gh) { this.y = gh; this.vy = 0; }
      const fr = this.y <= gh + 0.01 ? Math.pow(0.03, dt) : 1;
      this.vx *= fr; this.vz *= fr;
      this.x += this.vx * dt; this.z += this.vz * dt;
      world.resolveCircle(this.x, this.z, 0.35, tmp);
      this.x = tmp.x; this.z = tmp.z;
      this.h.body.rotation.x = damp(this.h.body.rotation.x, this.downT > 0.5 ? -Math.PI / 2 : 0, 10, dt);
      this._sync();
      return;
    }
    this.h.body.rotation.x = damp(this.h.body.rotation.x, 0, 12, dt);

    // movement relative to the camera
    const yaw = g.cameraRig.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = -fz, rz = fx;
    let mx = input.moveX, my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    let dx = fx * my + rx * mx, dz = fz * my + rz * mx;
    const dl = Math.hypot(dx, dz);
    const running = input.sprint || mag > 0.92 && input.touch;
    const speed = (running ? 7.6 : 4.2) * mag;
    let tvx = 0, tvz = 0;
    if (dl > 0.01) {
      tvx = (dx / dl) * speed; tvz = (dz / dl) * speed;
      const th = Math.atan2(dx, dz);
      this.heading += wrapAngle(th - this.heading) * Math.min(1, dt * 12);
    }
    const accel = this.grounded ? 14 : 3;
    this.vx = damp(this.vx, tvx, accel, dt);
    this.vz = damp(this.vz, tvz, accel, dt);
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // jump & gravity
    const gh = world.groundHeight(this.x, this.z);
    if (this.grounded && input.pressed('jump')) { this.vy = 6.8; this.grounded = false; g.audio.blip(220, 0.05, 0.06); }
    if (!this.grounded || this.y > gh + 0.3) {
      this.grounded = false;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= gh) { this.y = gh; this.vy = 0; this.grounded = true; }
    } else {
      this.y = damp(this.y, gh, 20, dt);
      this.grounded = true;
    }

    // collisions: world, then cars
    world.resolveCircle(this.x, this.z, 0.35, tmp);
    this.x = tmp.x; this.z = tmp.z;
    this._pushOutOfCars();

    // punch
    this.punchCd -= dt;
    if (input.pressed('attack') && this.punchCd <= 0) {
      this.punchCd = 0.45;
      this.punchT = 0.3;
      this._punch();
    }
    if (this.punchT > 0) this.punchT -= dt;

    // enter vehicles
    if (input.pressed('enter')) {
      const car = this.nearestCar();
      if (car) this.enterCar(car);
    }

    const sp = Math.hypot(this.vx, this.vz);
    this.phase += dt * sp * 2.6;
    animateHuman(this.h, this.phase, clamp(sp / 4.2, 0, 1.3), this.punchT > 0 ? Math.sin((this.punchT / 0.3) * Math.PI) : 0);
    if (!this.grounded) { this.h.legL.pivot.rotation.x = 0.5; this.h.legR.pivot.rotation.x = -0.3; }
    this._sync();
  }

  _punch() {
    const g = this.game;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    g.audio.whoosh();
    for (const p of g.peds.list) {
      if (p.state === 'down') continue;
      const dx = p.x - this.x, dz = p.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || (dx * fx + dz * fz) / (d || 1) < 0.4) continue;
      p.knock(fx * 4, fz * 4, 2.5);
      g.onPedPunched(p);
      return;
    }
  }

  _pushOutOfCars() {
    for (const c of this.game.cars) {
      const dx = this.x - c.x, dz = this.z - c.z;
      if (dx * dx + dz * dz > 25) continue;
      if (this.y > c.y + 1.4) continue;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const rx = -fz, rz = fx;
      const lz = dx * fx + dz * fz, lx = dx * rx + dz * rz;
      const hl = c.type.len / 2 + 0.35, hw = c.type.wid / 2 + 0.35;
      if (Math.abs(lz) >= hl || Math.abs(lx) >= hw) continue;
      // hit by a moving car?
      const sp = c.speed;
      if (sp > 5 && c.driver !== 'player') {
        this.knock(c.vx * 0.8 + rx * Math.sign(lx) * 2, c.vz * 0.8 + rz * Math.sign(lx) * 2, 3 + sp * 0.15);
        this.hurt(sp * 2.2);
        this.game.audio.thud(0.8);
        if (c.driver === 'cop') this.game.wanted.onCopContact();
        return;
      }
      const px = hl - Math.abs(lz), pxl = hw - Math.abs(lx);
      if (px < pxl) { const s = Math.sign(lz) * px; this.x += fx * s; this.z += fz * s; }
      else { const s = Math.sign(lx) * pxl; this.x += rx * s; this.z += rz * s; }
    }
  }

  _sync() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
  }
}
