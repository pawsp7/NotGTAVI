import * as THREE from 'three';
import { roadPos, blockCenter, LANE, PARK_LANE, dist2, fmtMoney } from './config.js';

// A glowing column marker with a ground ring.
function makeMarker(color, radius = 3.2, height = 7) {
  const g = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28, 1, true), beamMat);
  beam.position.y = height / 2;
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.82, radius, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.3, 4), new THREE.MeshBasicMaterial({ color }));
  chev.rotation.x = Math.PI;
  chev.position.y = height * 0.55;
  g.add(beam, ring, chev);
  g.userData = { beam, ring, chev, radius };
  return g;
}

// Floating arrow above a target car.
function makeChevron(color) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 4), new THREE.MeshBasicMaterial({ color }));
  m.rotation.x = Math.PI;
  return m;
}

const NICO_LOT = { x: roadPos(7) - PARK_LANE, z: blockCenter(5) + 19.33 };

// Original story missions for the demo. Each mission is a small script with
// start() and update(dt); it sets objective text and a target for the GPS.
const MISSIONS = [
  {
    id: 'first-shift',
    title: 'First Shift',
    reward: 500,
    intro: [
      ['NICO', "Rae! You're late, but you're here. That counts for something."],
      ['NICO', 'A crate of "pool supplies" is waiting at Pier 9 down at the docks.'],
      ['NICO', 'Grab it and get it to Hightower Plaza. Buyer walks if you take all day.'],
      ['RAE', 'Pool supplies. Sure, Nico.'],
    ],
    start(m) {
      this.pickup = { x: roadPos(2) - LANE, z: blockCenter(1) };
      this.drop = { x: roadPos(4) + LANE, z: blockCenter(3) };
      this.phase = 0;
      this.car = null;
    },
    update(m, dt) {
      const p = m.game.player;
      if (this.phase === 0) {
        if (!p.inCar) { m.obj('Get a car. Walk up to one and press F.'); m.setTarget(null); return; }
        this.phase = 1;
      }
      if (this.phase === 1) {
        m.obj('Drive to <b>Pier 9</b> at the docks to collect the crate.');
        m.setTarget(this.pickup, 0xffd23f);
        if (p.inCar && m.near(this.pickup, 5)) {
          this.car = p.car;
          this.phase = 2;
          m.timeLeft = 70;
          m.game.audio.checkpoint();
          m.game.hud.toast('Crate loaded. Clock is running.', 'good');
        }
        return;
      }
      if (this.phase === 2) {
        if (this.car.wrecked || this.car.sinking) return m.fail('The crate went up with the car.');
        if (!p.inCar || p.car !== this.car) { m.obj('Get back in the car with the crate.'); m.setTarget(this.car, 0x5cd3ff); return; }
        m.obj('Deliver the crate to <b>Hightower Plaza</b> downtown.');
        m.setTarget(this.drop, 0xffd23f);
        if (m.timeLeft <= 0) return m.fail('Too slow. The buyer walked.');
        if (m.near(this.drop, 5) && p.car.speed < 12) m.pass();
      }
    },
  },
  {
    id: 'showroom-exit',
    title: 'Showroom Exit',
    reward: 1500,
    intro: [
      ['NICO', 'Solana Motors just put a gold Kestrel GT on the display lot.'],
      ['NICO', 'A collector across the bay already paid for it. He just does not know where it lives yet.'],
      ['RAE', 'Alarms?'],
      ['NICO', 'Loud ones. Lose the cops before you bring it to my lot. Keep the paint pretty.'],
    ],
    start(m) {
      const g = m.game;
      const spots = g.world.showroomSpots;
      const colors = ['#e63946', '#2a9d8f', '#111111'];
      this.extras = [];
      spots.forEach((s, i) => {
        if (i === 1) return;
        const c = g.traffic.spawnCar('kestrel', s.x, s.z, s.heading, colors[i % colors.length]);
        c.mission = true; // keep display cars around for the mission
        this.extras.push(c);
      });
      const s = spots[1];
      this.car = g.traffic.spawnCar('kestrel', s.x, s.z, s.heading, '#d4af37');
      this.car.mission = true;
      this.phase = 0;
      m.chevron(this.car);
    },
    update(m) {
      const g = m.game;
      const p = g.player;
      if (this.car.wrecked || this.car.sinking) return m.fail('The Kestrel is scrap metal now.');
      if (this.phase === 0) {
        m.obj('Steal the gold <b>Kestrel GT</b> from the Solana Motors lot.');
        m.setTarget(this.car, 0x5cd3ff);
        if (p.inCar && p.car === this.car) {
          this.phase = 1;
          g.wanted.setStars(2);
          g.audio.honk(this.car, 1);
          g.hud.toast('Alarm tripped!', 'warn');
          m.chevron(null);
        }
        return;
      }
      if (!p.inCar || p.car !== this.car) {
        m.obj('Get back in the <b>Kestrel GT</b>.');
        m.setTarget(this.car, 0x5cd3ff);
        m.chevron(this.car);
        return;
      }
      m.chevron(null);
      if (g.wanted.stars > 0) {
        m.obj('Lose the cops. Break line of sight, or repaint at a <b>Spray Shack</b>.');
        m.setTarget(null);
        return;
      }
      m.obj("Bring the Kestrel to <b>Nico's lot</b> by the diner.");
      m.setTarget(NICO_LOT, 0xffd23f);
      if (m.near(NICO_LOT, 5) && this.car.speed < 6) {
        const bonus = Math.round(this.car.health) / 100;
        this.rewardOverride = Math.round(this.reward * (0.5 + 0.5 * bonus));
        this.car.mission = false;
        m.pass();
      }
    },
    cleanup(m) {
      for (const c of this.extras || []) c.mission = false;
      if (this.car) this.car.mission = false;
    },
  },
  {
    id: 'sunset-sprint',
    title: 'Sunset Sprint',
    reward: 2500,
    intro: [
      ['NICO', 'Last thing tonight. The Sunset Sprint. Street race, coast road to my door.'],
      ['NICO', 'Thirteen checkpoints. Beat the clock and the pot is yours.'],
      ['RAE', 'Bring something fast?'],
      ['NICO', "Bring something that won't fall apart."],
    ],
    start(m) {
      this.startPos = { x: roadPos(8) - LANE, z: blockCenter(7) };
      const P = [
        [320, 120], [320, -40], [320, -240], [200, -240], [80, -240], [80, -80], [-40, -80],
        [-160, -80], [-160, 40], [-160, 160], [0, 160], [160, 160], [240, 160],
      ];
      // offset each checkpoint onto the travel lane
      this.cps = P.map(([x, z]) => ({ x, z }));
      this.phase = 0;
      this.cp = 0;
    },
    update(m, dt) {
      const g = m.game;
      const p = g.player;
      if (this.phase === 0) {
        if (!p.inCar) { m.obj('Get a car, ideally a fast one, and head to the start line.'); m.setTarget(this.startPos, 0xffd23f); return; }
        m.obj('Drive to the <b>start line</b> on the coast road.');
        m.setTarget(this.startPos, 0xffd23f);
        if (m.near(this.startPos, 6) && p.car.speed < 8) {
          this.phase = 1;
          this.count = 3.2;
          this.raceCar = p.car;
          g.wanted.clear(true);
        }
        return;
      }
      if (this.phase === 1) {
        const c = p.car;
        c.vx = 0; c.vz = 0; c.angVel = 0;
        const n = Math.ceil(this.count - 0.2);
        if (n !== this.lastN) { this.lastN = n; if (n > 0) { g.hud.big(String(n), '', 'count', 0.9); g.audio.blip(660, 0.12, 0.16); } }
        this.count -= dt;
        m.obj('Get ready…');
        m.setTarget(this.cps[0], 0xff4fa3, true);
        if (this.count <= 0.2) {
          this.phase = 2;
          m.timeLeft = 110;
          g.hud.big('GO!', '', 'count', 0.9);
          g.audio.blip(1320, 0.3, 0.18);
        }
        return;
      }
      if (this.raceCar.wrecked || this.raceCar.sinking) return m.fail('You wrecked your ride.');
      if (!p.inCar) return m.fail('You left your car mid-race.');
      if (m.timeLeft <= 0) return m.fail('Out of time.');
      const cp = this.cps[this.cp];
      const last = this.cp === this.cps.length - 1;
      m.obj(`Race through the checkpoints: <b>${this.cp + 1} / ${this.cps.length}</b>${last ? ' — final stretch!' : ''}`);
      m.setTarget(cp, last ? 0x5cff9d : 0xff4fa3, true);
      if (m.near(cp, 9)) {
        this.cp++;
        g.audio.checkpoint();
        if (this.cp >= this.cps.length) {
          this.rewardOverride = this.reward + Math.round(m.timeLeft) * 20;
          m.pass();
        }
      }
    },
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.active = null;
    this.timeLeft = null;
    this.targetPos = null;
    this.marker = makeMarker(0xffd23f);
    this.marker.visible = false;
    game.scene.add(this.marker);
    this.raceRing = this._makeRing();
    this.raceRing.visible = false;
    game.scene.add(this.raceRing);
    this.contact = makeMarker(0xffd23f, 1.6, 5);
    game.scene.add(this.contact);
    this.chev = makeChevron(0x5cd3ff);
    this.chev.visible = false;
    this.chevTarget = null;
    game.scene.add(this.chev);
    this.lines = [];
    this.lineT = 0;
    this.cooldown = 0;
    this.subEl = document.getElementById('subtitle');
  }

  _makeRing() {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.35, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff4fa3 }));
    torus.position.y = 5.5;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.4, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 0.3;
    g.add(torus, beam);
    g.userData = { torus, beam };
    return g;
  }

  get completed() { return this.index >= MISSIONS.length; }
  get list() { return MISSIONS; }

  contactPos() { return this.game.world.places.diner; }

  load(index) { this.index = Math.min(index, MISSIONS.length); }

  obj(html) { this.game.hud.objective(html); }

  near(pos, r) {
    const p = this.game.player;
    return dist2(p.x, p.z, pos.x, pos.z) < r * r;
  }

  setTarget(pos, color, race = false) {
    this.targetPos = pos;
    if (!pos) { this.marker.visible = false; this.raceRing.visible = false; return; }
    const isCar = pos.type !== undefined && pos.mesh;
    if (race) {
      this.marker.visible = false;
      this.raceRing.visible = true;
      this.raceRing.position.set(pos.x, 0, pos.z);
      const c = new THREE.Color(color);
      this.raceRing.userData.torus.material.color.copy(c);
      this.raceRing.userData.beam.material.color.copy(c);
      // face along the road direction toward the player
      const p = this.game.player;
      this.raceRing.rotation.y = Math.atan2(p.x - pos.x, p.z - pos.z);
    } else {
      this.raceRing.visible = false;
      this.marker.visible = !isCar;
      if (!isCar) {
        this.marker.position.set(pos.x, this.game.world.groundHeight(pos.x, pos.z), pos.z);
        for (const k of ['beam', 'ring', 'chev']) this.marker.userData[k].material.color.set(color);
      }
    }
  }

  chevron(car) { this.chevTarget = car; this.chev.visible = !!car; }

  say(lines) { this.lines = lines.slice(); this.lineT = 0; this._nextLine(); }

  _nextLine() {
    const l = this.lines.shift();
    if (!l) { this.subEl.classList.remove('on'); return; }
    this.subEl.innerHTML = `<b>${l[0]}</b> ${l[1]}`;
    this.subEl.classList.add('on');
    this.lineT = Math.max(2.6, l[1].length * 0.055);
  }

  start(i) {
    const def = MISSIONS[i];
    this.active = Object.create(def);
    this.active.rewardOverride = null;
    this.timeLeft = null;
    this.active.start(this);
    this.game.hud.big(def.title.toUpperCase(), 'Mission ' + (i + 1) + ' of ' + MISSIONS.length, 'title', 2.6);
    this.game.audio.jingle('start');
    this.say(def.intro);
  }

  pass() {
    const m = this.active;
    const reward = m.rewardOverride ?? m.reward;
    this.game.cash += reward;
    this.game.hud.big('MISSION PASSED', fmtMoney(reward), 'pass', 4);
    this.game.audio.jingle('pass');
    this._end();
    this.index++;
    this.cooldown = 5;
    this.game.save();
    if (this.completed) {
      setTimeout(() => {
        this.game.hud.big('DEMO COMPLETE', 'Port Solana is yours. Free roam unlocked.', 'title', 6);
        this.say([['NICO', "That's all I've got for now, Rae. Go enjoy the sunset."]]);
      }, 4500);
    }
  }

  fail(reason) {
    if (!this.active) return;
    this.game.hud.big('MISSION FAILED', reason || '', 'fail', 3.5);
    this.game.audio.jingle('fail');
    this._end();
    this.cooldown = 4;
  }

  _end() {
    const m = this.active;
    if (m && m.cleanup) m.cleanup(this);
    this.active = null;
    this.timeLeft = null;
    this.setTarget(null);
    this.chevron(null);
    this.obj('');
    this.game.hud.timer(null);
    this.lines = [];
    this.subEl.classList.remove('on');
  }

  onWantedCleared() {}
  onPlayerDown() { if (this.active) this.fail(this.game.player.dead ? 'You got wasted.' : 'You got busted.'); }

  target() {
    if (this.active) return this.targetPos ? { x: this.targetPos.x, z: this.targetPos.z } : null;
    if (!this.completed) return this.contactPos();
    return null;
  }

  blips() {
    const out = [];
    if (this.active && this.targetPos) {
      out.push({ x: this.targetPos.x, z: this.targetPos.z, type: this.raceRing.visible ? 'checkpoint' : 'mission' });
    } else if (!this.active && !this.completed) {
      const c = this.contactPos();
      out.push({ x: c.x, z: c.z, type: 'contact' });
    }
    return out;
  }

  update(dt) {
    const g = this.game;
    const t = performance.now() / 1000;
    if (this.cooldown > 0) this.cooldown -= dt;
    // dialogue
    if (this.lines.length || this.subEl.classList.contains('on')) {
      this.lineT -= dt;
      if (this.lineT <= 0) this._nextLine();
    }
    // contact marker
    const c = this.contactPos();
    const showContact = !this.active && !this.completed;
    this.contact.visible = showContact;
    if (showContact) {
      this.contact.position.set(c.x, g.world.groundHeight(c.x, c.z), c.z);
      this.contact.userData.chev.position.y = 3 + Math.sin(t * 3) * 0.25;
      this.contact.userData.chev.rotation.y = t * 2;
      this.promptText = null;
      if (this.cooldown <= 0 && this.near(c, 3) && !g.player.dead) {
        if (g.wanted.stars > 0) this.promptText = 'Lose the cops before you see Nico';
        else if (g.player.inCar) this.promptText = 'Get out of the car to talk to Nico';
        else this.start(this.index);
      }
      if (!this.active) this.obj(this.cooldown > 0 ? '' : `Meet <b>Nico</b> at the Moonwake Diner <span class="dim">(yellow N on the map)</span>`);
    } else this.promptText = null;
    if (this.active) {
      if (this.timeLeft != null) {
        this.timeLeft -= dt;
        g.hud.timer(this.timeLeft);
      }
      this.active.update(this, dt);
    }
    // animate markers
    if (this.marker.visible) {
      this.marker.userData.chev.position.y = 4 + Math.sin(t * 3) * 0.3;
      this.marker.userData.chev.rotation.y = t * 2;
      this.marker.userData.beam.material.opacity = 0.22 + 0.1 * Math.sin(t * 4);
    }
    if (this.raceRing.visible) this.raceRing.userData.torus.rotation.y = 0;
    if (this.chev.visible && this.chevTarget) {
      const car = this.chevTarget;
      this.chev.position.set(car.x, car.y + 3.2 + Math.sin(t * 3) * 0.3, car.z);
      this.chev.rotation.y = t * 2;
    }
  }
}
