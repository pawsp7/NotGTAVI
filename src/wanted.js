import { DriverAI } from './traffic.js';
import { dist2 } from './config.js';

const THRESH = [0, 50, 180, 400, 750, 1200];
const COPS = [0, 2, 3, 5, 6, 8];

// Heat, wanted stars, pursuit spawning, evasion and arrests.
export class Wanted {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.stars = 0;
    this.evadeT = 0;
    this.evading = false;
    this.spawnT = 0;
    this.bustT = 0;
    this.copContactT = 0;
    this.locked = false; // missions can freeze the level
  }

  get starLevel() { return this.stars; }

  add(points, reason) {
    if (this.game.player.dead) return;
    const before = this.stars;
    // crimes near police count double
    let mult = 1;
    for (const c of this.game.cars) {
      if (c.driver === 'cop' && dist2(c.x, c.z, this.game.player.x, this.game.player.z) < 60 * 60) { mult = 2; break; }
    }
    this.heat += points * mult;
    this._recalc();
    if (this.stars > before) {
      this.game.audio.blip(523, 0.12, 0.12);
      if (before === 0) this.game.hud.toast(reason ? `Wanted: ${reason}` : 'The cops are on to you', 'warn');
    }
    this.evadeT = 0;
  }

  setStars(n) {
    this.heat = Math.max(this.heat, THRESH[n] + 1);
    this._recalc();
    this.evadeT = 0;
  }

  _recalc() {
    let s = 0;
    for (let i = 1; i < THRESH.length; i++) if (this.heat >= THRESH[i]) s = i;
    this.stars = Math.min(5, s);
  }

  clear(silent = false) {
    const had = this.stars > 0;
    this.heat = 0;
    this.stars = 0;
    this.evadeT = 0;
    this.evading = false;
    this.bustT = 0;
    for (const c of this.game.cars) {
      if (c.driver === 'cop') {
        c.sirenOn = false;
        if (c.ai) c.ai.mode = 'traffic';
      }
    }
    if (had && !silent) {
      this.game.hud.toast('You lost the cops', 'good');
      this.game.audio.jingle('start');
      this.game.missions.onWantedCleared();
    }
  }

  onCopContact() { this.copContactT = 0.6; }

  update(dt) {
    const g = this.game;
    const p = g.player;
    if (this.stars === 0) { this.evading = false; return; }

    // police presence
    let seen = false;
    let cops = 0;
    let nearest = Infinity;
    for (const c of g.cars) {
      if (c.driver !== 'cop' || c.wrecked) continue;
      cops++;
      const d2 = dist2(c.x, c.z, p.x, p.z);
      nearest = Math.min(nearest, d2);
      if (d2 < 75 * 75 && (d2 < 18 * 18 || g.world.lineOfSight(c.x, c.z, p.x, p.z))) seen = true;
      if (c.ai && c.ai.mode !== 'police') c.ai.mode = 'police';
      c.sirenOn = true;
    }

    // spawn pursuit
    this.spawnT -= dt;
    if (this.spawnT <= 0 && cops < COPS[this.stars]) {
      this.spawnT = 2.2;
      const car = g.traffic.spawnTraffic('patrol', 'police', 70, 150);
      if (car) { car.sirenOn = true; car.ai.cruise = 26; }
    }

    // evasion
    if (seen) {
      this.evadeT = 0;
      this.evading = false;
      if (!this.locked) this.heat += dt * 2.2 * this.stars;
      this._recalc();
    } else {
      this.evadeT += dt;
      this.evading = this.evadeT > 1.2;
      const need = 8 + this.stars * 3.5;
      if (this.evadeT > need) this.clear();
    }

    // arrest
    let closeCop = false;
    for (const c of g.cars) {
      if (c.driver !== 'cop' || c.wrecked) continue;
      const d2 = dist2(c.x, c.z, p.x, p.z);
      if (p.inCar) { if (d2 < 7.5 * 7.5 && c.speed < 6) closeCop = true; }
      else if (d2 < 5.5 * 5.5 && c.speed < 7) closeCop = true;
    }
    if (this.copContactT > 0) { this.copContactT -= dt; closeCop = true; }
    const slow = p.inCar ? p.car.speed < 2.2 : Math.hypot(p.vx, p.vz) < 5 || p.downT > 0;
    if (closeCop && slow) this.bustT += dt;
    else this.bustT = Math.max(0, this.bustT - dt * 1.5);
    const limit = p.inCar ? 2.6 : 1.4;
    if (this.bustT > limit) { this.bustT = 0; g.busted(); }
  }
}
