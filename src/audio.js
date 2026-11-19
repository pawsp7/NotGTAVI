import { clamp, dist2 } from './config.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Procedural radio. Each station is a short original loop built from a chord
// progression, a bass pattern, an arpeggio and a drum pattern.
const STATIONS = [
  {
    name: 'SOLANA FM 88.4', genre: 'synthwave', bpm: 104,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
    bass: [0, 0, 12, 0, 0, 12, 0, 7],
    arp: [0, 1, 2, 1, 2, 3, 2, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    lead: 'sawtooth', pad: 'triangle',
  },
  {
    name: 'CORAL WAVES 101.7', genre: 'beach lo-fi', bpm: 80,
    chords: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 67]], // Dmaj7 Bm7 Gmaj7 A7
    bass: [0, -1, 0, 7, -1, 0, 12, -1],
    arp: [0, 2, 1, 3, 2, 1, 0, 2],
    kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    lead: 'sine', pad: 'sine',
  },
  {
    name: 'BASSLINE 94.2', genre: 'club', bpm: 124,
    chords: [[50, 53, 57], [50, 53, 57], [46, 50, 53], [48, 52, 55]], // Dm Dm Bb C
    bass: [0, 12, 0, 12, 0, 12, 0, 12],
    arp: [0, 2, 1, 2, 0, 2, 1, 2],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    lead: 'square', pad: 'sawtooth',
  },
];

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.station = 0; // index into STATIONS, or STATIONS.length for off
    this.musicVolume = 0.32;
    this.sfxVolume = 1;
    this.step = 0;
    this.nextTime = 0;
    this.radioOn = false;
  }

  get stations() { return STATIONS; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (_) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVolume; this.sfx.connect(this.comp);
    this.music = c.createGain(); this.music.gain.value = 0; this.music.connect(this.comp);
    // noise buffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine
    this.eng1 = c.createOscillator(); this.eng1.type = 'sawtooth';
    this.eng2 = c.createOscillator(); this.eng2.type = 'square';
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    this.eng1.connect(this.engF); this.eng2.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.sfx);
    this.eng1.start(); this.eng2.start();
    // tyre screech + road rumble
    this.scrSrc = this._loopNoise();
    this.scrF = c.createBiquadFilter(); this.scrF.type = 'bandpass'; this.scrF.frequency.value = 1700; this.scrF.Q.value = 5;
    this.scrG = c.createGain(); this.scrG.gain.value = 0;
    this.scrSrc.connect(this.scrF); this.scrF.connect(this.scrG); this.scrG.connect(this.sfx);
    this.roadSrc = this._loopNoise();
    this.roadF = c.createBiquadFilter(); this.roadF.type = 'lowpass'; this.roadF.frequency.value = 320;
    this.roadG = c.createGain(); this.roadG.gain.value = 0;
    this.roadSrc.connect(this.roadF); this.roadF.connect(this.roadG); this.roadG.connect(this.sfx);
    // siren
    this.sir = c.createOscillator(); this.sir.type = 'square';
    this.sirF = c.createBiquadFilter(); this.sirF.type = 'lowpass'; this.sirF.frequency.value = 2200;
    this.sirG = c.createGain(); this.sirG.gain.value = 0;
    this.sir.connect(this.sirF); this.sirF.connect(this.sirG); this.sirG.connect(this.sfx);
    this.sir.start();
    // waves on the beach
    this.waveSrc = this._loopNoise();
    this.waveF = c.createBiquadFilter(); this.waveF.type = 'lowpass'; this.waveF.frequency.value = 500;
    this.waveG = c.createGain(); this.waveG.gain.value = 0;
    this.waveSrc.connect(this.waveF); this.waveF.connect(this.waveG); this.waveG.connect(this.sfx);
    // rain hiss
    this.rainSrc = this._loopNoise();
    this.rainF = c.createBiquadFilter(); this.rainF.type = 'bandpass'; this.rainF.frequency.value = 3200; this.rainF.Q.value = 0.6;
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    this.rainSrc.connect(this.rainF); this.rainF.connect(this.rainG); this.rainG.connect(this.sfx);
    this.nextTime = c.currentTime + 0.1;
  }

  _loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start();
    return s;
  }

  setVolumes(music, sfx) {
    this.musicVolume = music; this.sfxVolume = sfx;
    if (this.sfx) this.sfx.gain.value = sfx;
  }

  get stationName() { return this.station < STATIONS.length ? STATIONS[this.station].name : 'RADIO OFF'; }
  get stationGenre() { return this.station < STATIONS.length ? STATIONS[this.station].genre : ''; }

  nextStation() {
    this.station = (this.station + 1) % (STATIONS.length + 1);
    this.step = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.05;
    return this.stationName;
  }

  _att(x, z, range = 90) {
    const p = this.game.camera.position;
    const d = Math.sqrt(dist2(x, z, p.x, p.z));
    return clamp(1 - d / range, 0, 1);
  }

  _env(g, t, a, peak, dur, rel = 0.05) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  }

  _tone(t, freq, dur, type, vol, dest, attack = 0.01, filter = 0) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = c.createGain();
    let node = o;
    if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(dest || this.sfx);
    this._env(g, t, attack, vol, dur, Math.min(0.2, dur * 0.4));
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  _noise(t, dur, vol, type = 'lowpass', freq = 1000, dest, q = 1) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    this._env(g, t, 0.005, vol, dur, dur * 0.8);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return { s, f, g };
  }

  // ---- one-shots ----
  honk(car, vol = 1) {
    if (!this.ctx) return;
    const a = this._att(car.x, car.z, 80) * vol;
    if (a <= 0.01) return;
    const t = this.ctx.currentTime;
    const base = car.type.shape === 'van' ? 330 : car.type.shape === 'sports' ? 520 : 420;
    this._tone(t, base, 0.38, 'square', 0.07 * a, null, 0.01, 1800);
    this._tone(t, base * 1.26, 0.38, 'square', 0.06 * a, null, 0.01, 1800);
  }
  crash(intensity, x, z) {
    if (!this.ctx) return;
    const a = this._att(x, z, 110);
    if (a <= 0.01) return;
    const t = this.ctx.currentTime;
    const v = clamp(intensity / 20, 0.15, 1) * a;
    this._noise(t, 0.35, 0.5 * v, 'lowpass', 1400);
    this._noise(t, 0.12, 0.35 * v, 'highpass', 3000);
    this._tone(t, 70, 0.25, 'sine', 0.5 * v);
  }
  thud(v = 0.6) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 90, 0.18, 'sine', 0.5 * v);
    this._noise(t, 0.12, 0.25 * v, 'lowpass', 600);
  }
  explosion(x, z) {
    if (!this.ctx) return;
    const a = Math.max(0.15, this._att(x, z, 220));
    const t = this.ctx.currentTime;
    const n = this._noise(t, 1.6, 0.9 * a, 'lowpass', 2400);
    n.f.frequency.setValueAtTime(2400, t);
    n.f.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    const o = this._tone(t, 60, 1.1, 'sine', 0.8 * a);
    o.frequency.exponentialRampToValueAtTime(28, t + 1);
  }
  door() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.08, 0.3, 'bandpass', 900, null, 2);
    this._tone(t + 0.02, 140, 0.08, 'sine', 0.25);
  }
  blip(freq = 880, dur = 0.08, vol = 0.12) {
    if (!this.ctx) return;
    this._tone(this.ctx.currentTime, freq, dur, 'sine', vol);
  }
  whoosh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this._noise(t, 0.18, 0.18, 'bandpass', 600, null, 1.5);
    n.f.frequency.setValueAtTime(400, t);
    n.f.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
  }
  cash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 1318, 0.09, 'triangle', 0.14);
    this._tone(t + 0.08, 1760, 0.16, 'triangle', 0.14);
  }
  splash(x, z) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const a = Math.max(0.2, this._att(x, z, 120));
    this._noise(t, 0.9, 0.6 * a, 'lowpass', 1600);
  }
  thunder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this._noise(t, 3.2, 0.7, 'lowpass', 900);
    n.f.frequency.setValueAtTime(900, t);
    n.f.frequency.exponentialRampToValueAtTime(90, t + 3);
    const o = this._tone(t, 48, 2.4, 'sine', 0.5);
    o.frequency.exponentialRampToValueAtTime(30, t + 2.2);
  }
  checkpoint() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 988, 0.1, 'square', 0.06, null, 0.005, 3000);
    this._tone(t + 0.09, 1318, 0.18, 'square', 0.06, null, 0.005, 3000);
  }
  jingle(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const seqs = {
      pass: [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [88, 0.52]],
      start: [[67, 0], [72, 0.14], [79, 0.28]],
      fail: [[64, 0], [60, 0.18], [55, 0.36], [52, 0.6]],
      wasted: [[52, 0], [47, 0.3], [40, 0.6]],
    };
    for (const [m, dt] of seqs[kind] || []) {
      this._tone(t + dt, mtof(m), 0.35, 'triangle', 0.16, null, 0.01);
      this._tone(t + dt, mtof(m - 12), 0.35, 'sine', 0.1, null, 0.01);
    }
  }

  // ---- music scheduler ----
  _schedule() {
    const c = this.ctx;
    const st = STATIONS[this.station];
    if (!st) return;
    const stepDur = 60 / st.bpm / 4;
    while (this.nextTime < c.currentTime + 0.15) {
      const t = this.nextTime;
      const s = this.step;
      const bar = Math.floor(s / 16) % st.chords.length;
      const chord = st.chords[bar];
      const i16 = s % 16;
      const m = this.music;
      if (st.kick[i16]) {
        const o = this._tone(t, 140, 0.22, 'sine', 0.9, m, 0.002);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      }
      if (st.snare[i16]) { this._noise(t, 0.16, 0.35, 'highpass', 1600, m); this._tone(t, 190, 0.08, 'triangle', 0.2, m); }
      if (st.hat[i16]) this._noise(t, 0.035, st.genre === 'beach lo-fi' ? 0.07 : 0.12, 'highpass', 7500, m);
      if (i16 % 2 === 0) {
        const b = st.bass[(i16 / 2) % st.bass.length];
        if (b >= 0) this._tone(t, mtof(chord[0] - 24 + b), stepDur * 1.8, st.genre === 'club' ? 'sawtooth' : 'triangle', 0.28, m, 0.005, 700);
      }
      const ai = st.arp[i16 % st.arp.length];
      if (st.genre !== 'beach lo-fi' || i16 % 2 === 0) {
        const note = chord[ai % chord.length] + (ai >= chord.length ? 12 : 0) + 12;
        this._tone(t, mtof(note), stepDur * 0.9, st.lead, st.lead === 'sine' ? 0.09 : 0.045, m, 0.004, 2600);
      }
      if (i16 === 0) for (const n of chord) this._tone(t, mtof(n), stepDur * 16, st.pad, 0.035, m, 0.4, 1200);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  update(dt) {
    const c = this.ctx;
    if (!c) return;
    const g = this.game;
    const now = c.currentTime;
    const p = g.player;
    const car = p.inCar ? p.car : null;
    const paused = g.paused;

    // engine
    if (car && !paused && !car.wrecked) {
      const t = car.type;
      const s = Math.abs(car.vF) / t.maxSpeed;
      const gears = 5;
      const gear = Math.min(gears - 1, Math.floor(s * gears));
      const frac = s * gears - gear;
      const rpm = car.speed < 0.5 ? 0.18 + Math.max(0, car.input.throttle) * 0.25 : 0.25 + frac * 0.75;
      const base = t.shape === 'sports' ? 62 : t.shape === 'van' || t.shape === 'pickup' ? 38 : 48;
      const f = base + rpm * base * 2.2;
      this.eng1.frequency.setTargetAtTime(f, now, 0.05);
      this.eng2.frequency.setTargetAtTime(f * 0.5, now, 0.05);
      this.engF.frequency.setTargetAtTime(400 + rpm * 1600 + Math.max(0, car.input.throttle) * 600, now, 0.08);
      this.engG.gain.setTargetAtTime(0.05 + Math.max(0, car.input.throttle) * 0.07, now, 0.08);
      const slide = car.grounded ? clamp((car.slip - 3) / 8, 0, 1) : 0;
      this.scrG.gain.setTargetAtTime(slide * 0.12, now, 0.05);
      this.roadG.gain.setTargetAtTime(car.grounded ? clamp(car.speed / 50, 0, 1) * 0.12 : 0, now, 0.1);
    } else {
      this.engG.gain.setTargetAtTime(0, now, 0.1);
      this.scrG.gain.setTargetAtTime(0, now, 0.05);
      this.roadG.gain.setTargetAtTime(0, now, 0.1);
    }

    // sirens: loudest nearby cop
    let best = 0;
    for (const o of g.cars) {
      if (!o.sirenOn) continue;
      best = Math.max(best, this._att(o.x, o.z, 160));
    }
    const wail = 760 + 380 * Math.sin(now * Math.PI * 1.1);
    this.sir.frequency.setTargetAtTime(wail, now, 0.03);
    this.sirG.gain.setTargetAtTime(paused ? 0 : best * best * 0.06, now, 0.1);

    // surf
    const shore = clamp(1 - Math.abs(g.camera.position.x - 404) / 90, 0, 1);
    const swell = 0.5 + 0.5 * Math.sin(now * 0.9);
    this.waveG.gain.setTargetAtTime(paused ? 0 : shore * (0.04 + swell * 0.08), now, 0.2);

    const rain = g.weather ? g.weather.rain : 0;
    this.rainG.gain.setTargetAtTime(paused ? 0 : rain * (car ? 0.1 : 0.16), now, 0.3);

    // radio plays in cars
    const wantMusic = !!car && !paused && this.station < STATIONS.length && !car.wrecked;
    this.music.gain.setTargetAtTime(wantMusic ? this.musicVolume : 0, now, 0.25);
    if (wantMusic) {
      if (this.nextTime < now) this.nextTime = now + 0.05;
      this._schedule();
    }
  }
}
