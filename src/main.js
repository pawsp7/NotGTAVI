import * as THREE from 'three';
import { World } from './world.js';
import { Sky } from './sky.js';
import { Effects } from './effects.js';
import { AudioSystem } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Player } from './player.js';
import { TrafficManager } from './traffic.js';
import { PedManager } from './ped.js';
import { Wanted } from './wanted.js';
import { Missions } from './missions.js';
import { Pickups } from './pickups.js';
import { CAR_TYPES, updateCarLights } from './car.js';
import { PostFX } from './post.js';
import { Weather, WEATHER_LABEL, nextWeatherMode } from './weather.js';
import { CineCam } from './cinecam.js';
import { WATER_X, PARK_LANE, roadPos, clamp, dist2, fmtMoney, pick } from './config.js';

const SAVE_KEY = 'port-solana-save-v1';
const isTouch = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
const QUALITY = ['low', 'high', 'ultra'];
const QUALITY_LABEL = { low: 'Low', high: 'High', ultra: 'Ultra (cinematic)' };

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (_) { return null; }
}

class Game {
  constructor(canvas, boot) {
    this.canvas = canvas;
    const save = boot && boot.cash != null ? boot : loadSave() || {};
    this.quality = QUALITY.includes(save.quality) ? save.quality : (isTouch ? 'low' : 'ultra');
    this.cash = save.cash ?? 250;
    this.state = 'title';
    this.paused = false;
    this.time = 0;
    this.night = 0;
    this.cars = [];
    this.respawnT = 0;
    this.sprayCd = 0;
    this.stunt = null;
    this.slowT = 0;

    const r = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2400);

    this.world = new World(this);
    this.world.build(r);
    this.weather = new Weather(this);
    this.sky = new Sky(this);
    this.post = new PostFX(this);
    this.effects = new Effects(this);
    this.audio = new AudioSystem(this);
    this.hud = new Hud(this);
    this.input = new Input(canvas);
    this.cameraRig = new CameraRig(this.camera, this);
    this.player = new Player(this);
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.wanted = new Wanted(this);
    this.missions = new Missions(this);
    this.pickups = new Pickups(this);
    this.cine = new CineCam(this);
    this.missions.load(save.mission || 0);
    if (save.weather) this.weather.setMode(save.weather);
    if (save.hour != null) this.sky.hour = save.hour;

    this.headlight = new THREE.SpotLight(0xfff0cf, 0, 55, 0.6, 0.55, 1);
    this.scene.add(this.headlight, this.headlight.target);

    const st = this.world.places.start;
    this.player.spawn(st.x, st.z, st.heading);
    this.cameraRig.snapBehind();
    // a car waiting at the kerb outside the diner
    const starter = this.traffic.spawnCar('sundial', roadPos(7) - PARK_LANE, st.z - 2, 0, '#ff7f50');
    starter.age = 2;
    this.setQuality(this.quality, true);
    for (let i = 0; i < 10; i++) this.traffic.spawnTraffic(null, 'traffic', 30, 160);
    for (let i = 0; i < 14; i++) this.peds.spawnNear(8, 90);

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.touch && !this._ignoreUnlock) this.pause(true);
      this._ignoreUnlock = false;
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(true); });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this._bindUi();
    this.last = performance.now();
    this.frameAvg = 16;
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- settings / save ----------
  setQuality(q, silent) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'ultra' ? 2 : q === 'high' ? 1.25 : 1));
    this.sky.setQuality(q);
    this.traffic.setQuality(q === 'low' ? 'low' : 'high');
    this.peds.setQuality(q === 'low' ? 'low' : 'high');
    this.weather.setQuality(q);
    this.post.setQuality(q);
    this.resize();
    this.slowT = 0;
    const btn = document.getElementById('qualityBtn');
    if (btn) btn.textContent = `Graphics: ${QUALITY_LABEL[q]}`;
    if (!silent) this.save();
  }

  saveData() {
    return { cash: Math.round(this.cash), mission: this.missions.index, quality: this.quality, hour: this.sky.hour, weather: this.weather.mode };
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.saveData())); } catch (_) { /* storage blocked */ }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.resize();
  }

  // ---------- UI ----------
  _bindUi() {
    const $ = (id) => document.getElementById(id);
    $('playBtn').addEventListener('click', () => this.begin());
    $('resumeBtn').addEventListener('click', () => this.resume());
    $('qualityBtn').addEventListener('click', () => this.setQuality(QUALITY[(QUALITY.indexOf(this.quality) + 1) % QUALITY.length]));
    const wb = $('weatherBtn');
    wb.textContent = `Weather: ${WEATHER_LABEL[this.weather.mode]}`;
    wb.addEventListener('click', () => {
      this.weather.setMode(nextWeatherMode(this.weather.mode));
      wb.textContent = `Weather: ${WEATHER_LABEL[this.weather.mode]}`;
      this.save();
    });
    $('cineBtn').addEventListener('click', () => { this.resume(); this.toggleCine(); });
    $('musicBtn').addEventListener('click', () => {
      const on = this.audio.musicVolume > 0;
      this.audio.setVolumes(on ? 0 : 0.32, this.audio.sfxVolume);
      $('musicBtn').textContent = `Radio volume: ${on ? 'Off' : 'On'}`;
    });
    $('resetBtn').addEventListener('click', () => {
      const b = $('resetBtn');
      if (b.dataset.armed) {
        try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* ignore */ }
        this.cash = 250;
        if (this.missions.active) this.missions.fail('Progress reset.');
        this.missions.load(0);
        this.wanted.clear(true);
        b.textContent = 'Progress reset';
        delete b.dataset.armed;
      } else {
        b.dataset.armed = '1';
        b.textContent = 'Click again to reset progress';
      }
    });
    $('mapClose').addEventListener('click', () => this.closeMap());
    if (isTouch) {
      document.body.classList.add('touch');
      $('touchMap').addEventListener('click', () => (this.state === 'map' ? this.closeMap() : this.openMap()));
      $('touchPause').addEventListener('click', () => this.pause(true));
      $('touchRadio').addEventListener('click', () => this._radio());
      $('touchCine').addEventListener('click', () => this.toggleCine());
    }
    const progress = $('titleProgress');
    if (progress) progress.textContent = this.missions.index > 0 ? `Saved game: ${this.missions.index} of ${this.missions.list.length} jobs done, ${fmtMoney(this.cash)}` : '';
    $('playBtn').textContent = this.missions.index > 0 ? 'Continue' : 'Play';
  }

  toggleCine() {
    if (this.state !== 'playing') return;
    const on = this.cine.toggle();
    this.hud.toast(on ? 'Cinematic camera on. Press V to return.' : 'Cinematic camera off', 'info', 2.2);
  }

  begin() {
    this.audio.init();
    this.cine.shot = null;
    document.getElementById('title').hidden = true;
    document.getElementById('hud').hidden = false;
    if (isTouch) this.input.setupTouch(document.getElementById('touch'));
    else this.input.requestLock();
    this.state = 'playing';
    this.cameraRig.snapBehind();
    this.hud.toast(isTouch ? 'Left stick to move. Drag the right side to look.' : 'WASD to move, mouse to look, F to get in a car.', 'info', 5);
  }

  pause(show) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.paused = true;
    document.getElementById('pause').hidden = !show;
    this.save();
  }

  resume() {
    document.getElementById('pause').hidden = true;
    this.state = 'playing';
    this.paused = false;
    this.audio.init();
    this.input.requestLock();
    this.last = performance.now();
  }

  openMap() {
    if (this.state !== 'playing') return;
    this.state = 'map';
    this.paused = true;
    this._ignoreUnlock = true;
    this.input.exitLock();
    this.hud.toggleMap(true);
  }

  closeMap() {
    this.hud.toggleMap(false);
    this.state = 'playing';
    this.paused = false;
    this.input.requestLock();
    this.last = performance.now();
  }

  _radio() {
    if (!this.player.inCar) return;
    this.audio.nextStation();
    this.hud.showRadio(this.audio.stationName, this.audio.stationGenre);
  }

  // ---------- events from systems ----------
  onCarImpact(car, impact, x, z, other) {
    this.audio.crash(impact, x, z);
    if (impact > 8) this.effects.sparks(x, car.y + 0.6, z, Math.min(20, Math.round(impact)));
    const pc = this.player.inCar ? this.player.car : null;
    if (pc && (car === pc || other === pc)) {
      this.cameraRig.shake(Math.min(0.9, impact / 22));
      const victim = car === pc ? other : car;
      if (victim) {
        victim.lastPlayerHit = this.time;
        // only the player's fault if the player was driving into the other car
        const tx = victim.x - pc.x, tz = victim.z - pc.z;
        const atFault = (pc.vx * tx + pc.vz * tz) / (Math.hypot(tx, tz) || 1) > 5;
        if (victim.driver === 'cop' && impact > 5 && atFault && this.time - (this._ramT || 0) > 1.5) {
          this._ramT = this.time;
          this.wanted.add(60, 'Ramming a patrol car');
        }
        else if (victim.driver === 'npc' && impact > 9 && Math.random() < 0.5) this.audio.honk(victim, 0.8);
      }
    }
    if (impact > 10) this.peds.panic(x, z, 16);
  }

  onCarExploded(car) {
    const g = this;
    this.effects.explosion(car.x, car.y, car.z);
    this.audio.explosion(car.x, car.z);
    const pd = Math.sqrt(dist2(car.x, car.z, this.camera.position.x, this.camera.position.z));
    this.cameraRig.shake(clamp(1.2 - pd / 60, 0, 1.2));
    for (const o of this.cars) {
      if (o === car) continue;
      const d = Math.sqrt(dist2(o.x, o.z, car.x, car.z));
      if (d < 8) {
        o.damage(55 * (1 - d / 8));
        const k = (1 - d / 8) * 8 / (o.mass / 1300);
        o.vx += ((o.x - car.x) / (d || 1)) * k; o.vz += ((o.z - car.z) / (d || 1)) * k;
        if (o.spot) { o.spot.car = null; o.spot = null; }
      }
    }
    for (const p of this.peds.list) {
      const d = Math.sqrt(dist2(p.x, p.z, car.x, car.z));
      if (d < 10) p.knock(((p.x - car.x) / (d || 1)) * 7, ((p.z - car.z) / (d || 1)) * 7, 5);
    }
    this.peds.panic(car.x, car.z, 40);
    const pl = this.player;
    if (pl.inCar && pl.car === car) pl.hurt(999);
    else if (!pl.inCar) {
      const d = Math.sqrt(dist2(pl.x, pl.z, car.x, car.z));
      if (d < 8) { pl.knock(((pl.x - car.x) / (d || 1)) * 8, ((pl.z - car.z) / (d || 1)) * 8, 5); pl.hurt(85 * (1 - d / 8)); }
    }
    const byPlayer = car === pl.lastCar || (car.lastPlayerHit && this.time - car.lastPlayerHit < 12);
    if (byPlayer && !pl.dead) this.wanted.add(car.driver === 'cop' || car.typeKey === 'patrol' ? 160 : 90, 'Arson & wreckage');
    if (car.driver === 'npc' || car.driver === 'cop') {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const p = g.peds.spawnAt(car.x + fz * 2.5, car.z - fx * 2.5, { x: car.x, z: car.z });
      p.downT = 4;
    }
    if (car.driver !== 'player') car.driver = null;
  }

  onCarLanded() {}

  onCarSplash(car) {
    this.effects.splash(car.x, car.z);
    this.audio.splash(car.x, car.z);
    car.health = Math.min(car.health, 5);
    car.ai = null;
    if (this.player.inCar && this.player.car === car) {
      this.hud.toast('Your ride is sinking. Swim back to the beach!', 'warn');
      setTimeout(() => {
        const p = this.player;
        if (p.inCar && p.car === car) {
          car.driver = null;
          p.inCar = false; p.car = null; p.lastCar = null;
          p.mesh.visible = true;
          p.spawnKeepHealth(WATER_X - 4, car.z, -Math.PI / 2);
          this.cameraRig.snapBehind();
        }
      }, 1300);
    }
  }

  onPedHit(ped, car, speed) {
    this.audio.thud(clamp(speed / 20, 0.3, 1));
    if (car.driver === 'player') {
      this.wanted.add(35, 'Hit and run');
      this.cameraRig.shake(0.15);
    }
    this.peds.panic(ped.x, ped.z, 20);
    this._dropCash(ped);
  }

  onPedPunched(ped) {
    this.audio.thud(0.5);
    this.wanted.add(18, 'Assault');
    this.peds.panic(ped.x, ped.z, 14);
    this._dropCash(ped);
  }

  _dropCash(ped) {
    if (ped.cash > 0 && Math.random() < 0.7) { this.pickups.add(ped.x, ped.z, ped.cash); ped.cash = 0; }
  }

  onCarjack(car) {
    if (car.driver === 'cop') this.wanted.add(220, 'Stealing a patrol car');
    else this.wanted.add(30, 'Carjacking');
    this.peds.panic(car.x, car.z, 14);
  }

  onEnterCar(car) {
    if (this.audio.station < this.audio.stations.length) this.hud.showRadio(this.audio.stationName, this.audio.stationGenre);
    this.cameraRig.lookT = 0;
  }

  onExitCar() {}

  wasted() {
    if (this.respawnT > 0) return;
    this.hud.big('WASTED', 'Solana General will patch you up', 'fail', 3.6);
    this.audio.jingle('wasted');
    this.missions.onPlayerDown();
    this.respawnT = 3.8;
    this.respawnAt = 'hospital';
    this.input.enabled = false;
  }

  busted() {
    if (this.respawnT > 0 || this.player.dead) return;
    this.hud.big('BUSTED', 'A night in Precinct 4 and a fine', 'fail', 3.6);
    this.audio.jingle('fail');
    this.player.dead = true;
    if (this.player.inCar) { this.player.car.input.throttle = 0; this.player.car.input.handbrake = true; }
    this.missions.onPlayerDown();
    this.respawnT = 3.8;
    this.respawnAt = 'precinct';
    this.input.enabled = false;
  }

  _respawn() {
    const pl = this.player;
    const place = this.world.places[this.respawnAt];
    if (pl.inCar) { pl.car.driver = null; pl.lastCar = pl.car; }
    const fee = this.respawnAt === 'hospital' ? 100 : 150;
    const paid = Math.min(this.cash, fee);
    this.cash -= paid;
    this.wanted.clear(true);
    pl.spawn(place.x, place.z, place.heading);
    this.cameraRig.snapBehind();
    this.input.enabled = true;
    this.hud.toast(`${place.name}: -${fmtMoney(paid)}`, 'info');
    // send pursuers back to normal duty
    for (const c of this.cars) if (c.driver === 'cop' && c.ai) c.ai.mode = 'traffic';
    this.save();
  }

  _spray(dt) {
    const pl = this.player;
    this.sprayCd -= dt;
    if (!pl.inCar) return null;
    const c = pl.car;
    for (const s of this.world.sprays) {
      if (Math.abs(c.x - s.x) < 4 && Math.abs(c.z - s.z) < 5.5) {
        if (this.sprayCd > 0) return null;
        if (c.speed > 3) return 'Spray Shack: stop inside for a respray ($150)';
        if (this.cash < 150) return 'Spray Shack: a respray costs $150';
        this.cash -= 150;
        this.sprayCd = 8;
        const colors = CAR_TYPES[c.typeKey].colors.filter((k) => k !== c.color);
        c.repaint(pick(colors.length ? colors : ['#5cff9d', '#ff4fa3', '#33e6ff']));
        c.health = 100; c.burning = 0;
        const hadStars = this.wanted.stars > 0;
        this.wanted.clear(true);
        this.hud.fade(true);
        setTimeout(() => this.hud.fade(false), 700);
        this.audio.blip(330, 0.3, 0.1);
        this.hud.toast(hadStars ? 'Fresh paint. The cops lost your description.' : 'Fresh paint, good as new.', 'good');
        if (hadStars) this.missions.onWantedCleared();
        return null;
      }
    }
    return null;
  }

  _stunts(dt) {
    const pl = this.player;
    if (!pl.inCar) { this.stunt = null; return; }
    const c = pl.car;
    if (!c.grounded && !c.sinking) {
      if (!this.stunt) this.stunt = { t: 0, x: c.x, z: c.z, car: c };
      this.stunt.t += dt;
    } else if (this.stunt) {
      const s = this.stunt;
      this.stunt = null;
      if (s.car === c && s.t > 0.85 && !c.wrecked) {
        const d = Math.sqrt(dist2(s.x, s.z, c.x, c.z));
        const bonus = Math.round((s.t * 90 + d * 4) / 10) * 10;
        this.cash += bonus;
        this.hud.big('STUNT BONUS', `${fmtMoney(bonus)} · ${d.toFixed(0)} m · ${s.t.toFixed(1)} s air`, 'stunt', 2.4);
        this.audio.cash();
      }
    }
  }

  _prompt() {
    const pl = this.player;
    let text = this.missions.promptText;
    const key = (k) => (isTouch ? `<kbd>${k === 'F' ? 'CAR' : k}</kbd>` : `<kbd>${k}</kbd>`);
    if (!text && !pl.inCar && !pl.dead) {
      const c = pl.nearestCar();
      if (c) text = `${key('F')} ${c.driver === 'npc' || c.driver === 'cop' ? 'Steal' : 'Get in'} ${c.type.name}`;
    }
    const spray = this._spray(this._dt || 0);
    if (!text && spray) text = spray;
    this.hud.prompt(text);
  }

  // ---------- main loop ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt < 0.25) this.frameAvg = this.frameAvg * 0.97 + dt * 1000 * 0.03;
    dt = Math.min(dt, 0.05);
    this._dt = dt;

    if (this.state === 'playing' || this.state === 'title') this.step(dt);
    else if (this.state === 'map') {
      if (this.input.pressed('map') || this.input.pressed('pause')) this.closeMap();
      this.audio.update(dt);
    } else if (this.state === 'paused') {
      this.audio.update(dt);
    }
    this.input.endFrame();
    this.post.update(dt);
    this.post.render();
  }

  step(dt) {
    const pl = this.player;
    const inp = this.input;
    this.time += dt;
    const playing = this.state === 'playing';
    inp.sample(dt, pl.inCar);
    if (playing) {
      if (inp.pressed('pause')) { this.pause(true); return; }
      if (inp.pressed('map')) { this.openMap(); return; }
      if (inp.pressed('radio')) this._radio();
      if (inp.pressed('cine')) this.toggleCine();
      if (this.respawnT <= 0) pl.update(dt, inp);
      else if (pl.inCar) { pl.car.input.throttle = 0; pl.car.input.steer = 0; pl.car.input.handbrake = true; }
    }
    const steps = dt > 1 / 45 ? 2 : 1;
    for (let i = 0; i < steps; i++) this.traffic.update(dt / steps);
    if (pl.inCar) { pl.x = pl.car.x; pl.z = pl.car.z; pl.y = pl.car.y; }
    this.peds.update(dt);
    if (playing) {
      this.wanted.update(dt);
      this.missions.update(dt);
      this.pickups.update(dt);
      this._stunts(dt);
      this._prompt();
    }
    // continuous car effects near the camera
    const cam = this.camera.position;
    for (const c of this.cars) if (dist2(c.x, c.z, cam.x, cam.z) < 120 * 120) this.effects.carFx(c, dt);
    this.effects.update(dt);

    this.weather.update(dt);
    this.sky.update(dt, new THREE.Vector3(pl.x, 0, pl.z));
    this.night = this.sky.night;
    const hdr = this.post.enabled ? 1 : 0.35;
    this.world.update(dt, this.time, this.night, this.weather.wet, hdr);
    this._headlight();
    this._beams();

    if (playing && !this.cine.active) this.cameraRig.update(dt, inp);
    else this.cine.update(dt);
    this.audio.update(dt);
    if (playing) this.hud.update(dt);

    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT < 0.6) this.hud.fade(true);
      if (this.respawnT <= 0) { this._respawn(); setTimeout(() => this.hud.fade(false), 250); }
    }

    // automatic quality fallback on slow devices: ultra -> high -> low
    if (playing && this.quality !== 'low' && this.time > 8) {
      if (this.frameAvg > 36) this.slowT += dt; else this.slowT = Math.max(0, this.slowT - dt);
      if (this.slowT > 4) {
        const q = this.quality === 'ultra' ? 'high' : 'low';
        this.setQuality(q);
        this.hud.toast(`Switched to ${QUALITY_LABEL[q].toLowerCase()} graphics for a smoother frame rate`, 'info');
      }
    }
  }

  // Night-time light beams in front of nearby cars, more visible in rain.
  _beams() {
    const on = this.night > 0.2 && this.quality !== 'low';
    const op = on ? this.night * (0.06 + this.weather.rain * 0.12) : 0;
    updateCarLights(this.night, op, this.post.enabled ? 1 : 0.35);
    const cam = this.camera.position;
    for (const c of this.cars) {
      c.beam.visible = on && !c.wrecked && !c.sinking && (c.driver || c.ai) && dist2(c.x, c.z, cam.x, cam.z) < 110 * 110;
    }
  }

  _headlight() {
    const pl = this.player;
    const h = this.headlight;
    if (pl.inCar && this.night > 0.15 && !pl.car.wrecked) {
      const c = pl.car;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      h.position.set(c.x + fx * 2, c.y + 1.1, c.z + fz * 2);
      h.target.position.set(c.x + fx * 22, c.y, c.z + fz * 22);
      h.intensity = this.night * 28;
    } else h.intensity = 0;
  }
}

// Player helper used when climbing out of the sea.
Player.prototype.spawnKeepHealth = function (x, z, heading) {
  const hp = this.health;
  this.spawn(x, z, heading);
  this.health = hp;
};

function start(data) {
  const canvas = document.getElementById('game');
  let game;
  try {
    game = new Game(canvas, data);
  } catch (err) {
    const el = document.getElementById('bootError');
    if (el) { el.hidden = false; el.querySelector('code').textContent = String(err && err.message || err); }
    console.error(err);
    return;
  }
  window.__portSolana = game;
  document.getElementById('loading').hidden = true;
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try { window.claude.hot.snapshot(() => game.saveData()); } catch (_) { /* optional */ }
  }
}

// Signs are painted with the HUD font, so give the web fonts a moment to arrive first.
function whenFontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wait = Promise.all([
    document.fonts.load('700 64px "Barlow Condensed"'),
    document.fonts.load('400 64px "Monoton"'),
  ]).catch(() => {});
  return Promise.race([wait, new Promise((r) => setTimeout(r, 2500))]);
}

const hot = typeof window !== 'undefined' ? window.claude?.hot : null;
whenFontsReady().then(() => {
  if (hot?.ready) hot.ready(start);
  else start(hot?.data ?? null);
});
