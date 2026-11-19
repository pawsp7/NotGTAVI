import { WORLD, HALF, PITCH, N_BLOCKS, roadPos, clamp, fmtMoney } from './config.js';

const $ = (id) => document.getElementById(id);

// DOM overlay: cash, wanted stars, health, minimap, speedometer, objective text,
// toasts, big messages and the full-screen map.
export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), cash: $('cash'), stars: $('stars'), health: $('healthFill'), clock: $('clock'),
      speedo: $('speedo'), speed: $('speedVal'), carName: $('carName'), carHealth: $('carHealthFill'),
      objective: $('objective'), timer: $('timer'), toasts: $('toasts'), prompt: $('prompt'),
      big: $('bigMsg'), bigTitle: $('bigTitle'), bigSub: $('bigSub'), radio: $('radio'),
      damage: $('damage'), fade: $('fade'), mapWrap: $('bigMap'), mapCanvas: $('bigMapCanvas'),
      mini: $('minimap'),
    };
    this.mini = this.el.mini.getContext('2d');
    this.starEls = [];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';
      this.el.stars.appendChild(s);
      this.starEls.push(s);
    }
    this.shownCash = 0;
    this.radioT = 0;
    this.bigT = 0;
    this.lastStars = -1;
    this.mapOpen = false;
  }

  toast(text, kind = 'info', time = 3.6) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, time * 1000);
  }

  big(title, sub = '', kind = 'pass', time = 3.2) {
    const b = this.el.big;
    b.className = 'show ' + kind;
    this.el.bigTitle.textContent = title;
    this.el.bigSub.textContent = sub;
    this.bigT = time;
  }

  objective(text) {
    if (text === this._obj) return;
    this._obj = text;
    this.el.objective.innerHTML = text || '';
    this.el.objective.classList.toggle('on', !!text);
  }

  timer(sec) {
    if (sec == null) { this.el.timer.hidden = true; return; }
    this.el.timer.hidden = false;
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60), r = Math.floor(s % 60), t = Math.floor((s * 10) % 10);
    this.el.timer.textContent = `${m}:${String(r).padStart(2, '0')}.${t}`;
    this.el.timer.classList.toggle('low', s < 10);
  }

  prompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    this.el.prompt.innerHTML = text || '';
    this.el.prompt.classList.toggle('on', !!text);
  }

  showRadio(name, genre) {
    this.el.radio.innerHTML = `<b>${name}</b><span>${genre}</span>`;
    this.el.radio.classList.add('on');
    this.radioT = 3;
  }

  flashDamage() {
    const d = this.el.damage;
    d.classList.remove('hit');
    void d.offsetWidth;
    d.classList.add('hit');
  }

  fade(on) { this.el.fade.classList.toggle('on', on); }

  setCinematic(on) { this.el.hud.classList.toggle('cine', on); }

  toggleMap(open) {
    this.mapOpen = open;
    this.el.mapWrap.hidden = !open;
    if (open) this.drawBigMap();
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    // cash counts up
    const diff = g.cash - this.shownCash;
    this.shownCash += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 6);
    this.el.cash.textContent = fmtMoney(this.shownCash);
    this.el.clock.textContent = g.sky.timeString();
    // stars
    const st = g.wanted.stars;
    const flashing = g.wanted.evading && st > 0;
    const blink = flashing && Math.floor(performance.now() / 260) % 2 === 0;
    for (let i = 0; i < 5; i++) {
      const on = i < st;
      this.starEls[i].classList.toggle('on', on && !blink);
      this.starEls[i].classList.toggle('dim', on && blink);
    }
    if (st !== this.lastStars) {
      this.el.stars.classList.toggle('active', st > 0);
      this.lastStars = st;
    }
    this.el.health.style.width = `${clamp(p.health, 0, 100)}%`;
    this.el.health.classList.toggle('low', p.health < 30);
    // speedo
    if (p.inCar) {
      const c = p.car;
      this.el.speedo.classList.add('on');
      this.el.speed.textContent = Math.round(c.speed * 2.237);
      this.el.carName.textContent = c.type.name;
      this.el.carHealth.style.width = `${clamp(c.health, 0, 100)}%`;
      this.el.carHealth.classList.toggle('low', c.health < 35);
    } else this.el.speedo.classList.remove('on');
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) this.el.radio.classList.remove('on'); }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.el.big.className = ''; }
    this.drawMinimap();
  }

  // ---------- maps ----------
  _blips() {
    const g = this.game;
    const out = [];
    for (const c of g.cars) if (c.driver === 'cop' && c.sirenOn) out.push({ x: c.x, z: c.z, type: 'cop' });
    for (const b of g.missions.blips()) out.push(b);
    for (const s of g.world.sprays) out.push({ x: s.x, z: s.z, type: 'spray' });
    for (const k of g.pickups.blips()) out.push(k);
    out.push({ x: g.world.places.hospital.x, z: g.world.places.hospital.z, type: 'hospital' });
    return out;
  }

  _drawIcon(ctx, x, y, type, r) {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(x, y);
    switch (type) {
      case 'cop': {
        const ph = Math.floor(t * 6) % 2;
        ctx.fillStyle = ph ? '#ff3344' : '#3d6bff';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'mission': case 'contact': {
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = '#1b1035'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1b1035';
        ctx.font = `700 ${r * 1.3}px "Barlow Condensed", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(type === 'contact' ? 'N' : '!', 0, 1);
        break;
      }
      case 'checkpoint': {
        ctx.fillStyle = '#ff4fa3'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      }
      case 'spray': {
        ctx.fillStyle = '#5cff9d'; ctx.strokeStyle = '#0d2b1b'; ctx.lineWidth = 2;
        ctx.fillRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5); ctx.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
        break;
      }
      case 'hospital': {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        ctx.fillStyle = '#e63946';
        ctx.fillRect(-r * 0.2, -r * 0.6, r * 0.4, r * 1.2); ctx.fillRect(-r * 0.6, -r * 0.2, r * 1.2, r * 0.4);
        break;
      }
      case 'cash': {
        ctx.fillStyle = '#42e695';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  _route() {
    const g = this.game;
    const tgt = g.missions.target();
    if (!tgt) return null;
    const p = g.player;
    const snap = (v) => clamp(Math.round((v + HALF) / PITCH), 0, N_BLOCKS);
    const ai = snap(p.x), aj = snap(p.z), bi = snap(tgt.x), bj = snap(tgt.z);
    const pts = [[p.x, p.z], [roadPos(ai), roadPos(aj)]];
    // L-shaped route: go along the longer axis first
    if (Math.abs(bi - ai) >= Math.abs(bj - aj)) pts.push([roadPos(bi), roadPos(aj)]);
    else pts.push([roadPos(ai), roadPos(bj)]);
    pts.push([roadPos(bi), roadPos(bj)], [tgt.x, tgt.z]);
    return pts;
  }

  drawMinimap() {
    const ctx = this.mini;
    const g = this.game;
    const W = this.el.mini.width, H = this.el.mini.height;
    const p = g.player;
    const scale = (p.inCar ? clamp(1.25 - p.car.speed * 0.012, 0.75, 1.25) : 1.6) * (W / 200);
    const yaw = g.cameraRig.yaw;
    const map = g.world.mapCanvas;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#17405e'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-(p.x - WORLD.minX), -(p.z - WORLD.minZ));
    ctx.drawImage(map, 0, 0);
    // GPS route
    const route = this._route();
    if (route) {
      ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 7 / scale * (W / 200); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      route.forEach(([x, z], i) => (i ? ctx.lineTo(x - WORLD.minX, z - WORLD.minZ) : ctx.moveTo(x - WORLD.minX, z - WORLD.minZ)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // blips in screen space (clamped to the rim)
    const R = W / 2 - 10;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const b of this._blips()) {
      const dx = (b.x - p.x) * scale, dz = (b.z - p.z) * scale;
      let sx = dx * cy - dz * sy, sz = dx * sy + dz * cy;
      const d = Math.hypot(sx, sz);
      const edgeOk = b.type === 'mission' || b.type === 'contact' || b.type === 'checkpoint' || b.type === 'cop';
      if (d > R) { if (!edgeOk) continue; sx *= R / d; sz *= R / d; }
      this._drawIcon(ctx, W / 2 + sx, H / 2 + sz, b.type, 7 * (W / 200));
    }
    // player arrow
    const h = p.inCar ? p.car.heading : p.heading;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI - h + yaw);
    const a = 9 * (W / 200);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1b1035'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -a); ctx.lineTo(a * 0.7, a * 0.75); ctx.lineTo(0, a * 0.35); ctx.lineTo(-a * 0.7, a * 0.75); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north marker (world -z) on the rim
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(10,12,30,0.8)';
    ctx.lineWidth = 3;
    ctx.font = `700 ${12 * (W / 200)}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const nx = W / 2 + sy * R, nz = H / 2 - cy * R;
    ctx.strokeText('N', nx, nz);
    ctx.fillText('N', nx, nz);
  }

  drawBigMap() {
    const g = this.game;
    const c = this.el.mapCanvas;
    const wrap = c.parentElement.getBoundingClientRect();
    const map = g.world.mapCanvas;
    const s = Math.min((wrap.width - 32) / map.width, (wrap.height - 200) / map.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.floor(map.width * s * dpr); c.height = Math.floor(map.height * s * dpr);
    c.style.width = `${Math.floor(map.width * s)}px`; c.style.height = `${Math.floor(map.height * s)}px`;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.scale(s * dpr, s * dpr);
    ctx.drawImage(map, 0, 0);
    const route = this._route();
    if (route) {
      ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach(([x, z], i) => (i ? ctx.lineTo(x - WORLD.minX, z - WORLD.minZ) : ctx.moveTo(x - WORLD.minX, z - WORLD.minZ)));
      ctx.stroke();
    }
    ctx.restore();
    const k = s * dpr;
    for (const b of this._blips()) this._drawIcon(ctx, (b.x - WORLD.minX) * k, (b.z - WORLD.minZ) * k, b.type, 9 * dpr);
    const p = g.player;
    const h = p.inCar ? p.car.heading : p.heading;
    ctx.save();
    ctx.translate((p.x - WORLD.minX) * k, (p.z - WORLD.minZ) * k);
    ctx.rotate(Math.PI - h);
    const a = 11 * dpr;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1035'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -a); ctx.lineTo(a * 0.7, a * 0.75); ctx.lineTo(0, a * 0.35); ctx.lineTo(-a * 0.7, a * 0.75); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // district labels
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 ${13 * dpr}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center';
    const label = (t, x, z) => ctx.fillText(t, (x - WORLD.minX) * k, (z - WORLD.minZ) * k);
    label('DOWNTOWN', 40, -120);
    label('THE DOCKS', -200, -260);
    label('PALM HEIGHTS', 0, 250);
    label('SURFSIDE STRIP', 290, -10);
    label('SOLANA BEACH', 370, 60);
    label('MIDTOWN', -200, 40);
  }
}
