import { clamp } from './config.js';

const ACTIONS = {
  enter: ['KeyF', 'KeyE', 'Enter'],
  jump: ['Space'],
  horn: ['KeyH'],
  radio: ['KeyR'],
  map: ['KeyM', 'Tab'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
  attack: ['KeyQ', 'KeyJ'],
  cine: ['KeyV'],
};

// Keyboard, mouse (pointer lock or drag) and touch controls, folded into one set of axes and actions.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedSet = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.dragging = false;
    this.steer = 0;
    this.touch = false;
    this.joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookTouch = { id: null, x: 0, y: 0 };
    this.held = new Set(); // touch-held actions
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._isGameKey(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      for (const [a, codes] of Object.entries(ACTIONS)) if (codes.includes(e.code)) this.pressedSet.add(a);
      if (this._isGameKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (this.locked) {
        if (e.button === 0) this.pressedSet.add('attack');
      } else {
        this.dragging = true;
        this.dragMoved = 0;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.dragging && !this.locked && this.dragMoved < 4 && e.button === 0 && e.target === canvas) this.pressedSet.add('attack');
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      } else if (this.dragging) {
        this.lookX += e.movementX * 1.3;
        this.lookY += e.movementY * 1.3;
        this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _isGameKey(code) {
    return ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code);
  }

  requestLock() {
    if (this.touch) return;
    try {
      const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* pointer lock unavailable: drag-to-look still works */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Touch overlay: left joystick, right-side look area, action buttons.
  setupTouch(root) {
    this.touch = true;
    root.hidden = false;
    const zone = root.querySelector('#joyZone');
    const knob = root.querySelector('#joyKnob');
    const base = root.querySelector('#joyBase');
    const R = 56;
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.joy.active = true; this.joy.id = t.identifier;
      this.joy.ox = t.clientX; this.joy.oy = t.clientY;
      base.style.left = t.clientX + 'px'; base.style.top = t.clientY + 'px';
      base.classList.add('on');
      e.preventDefault();
    }, { passive: false });
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          this.joy.x = dx / R; this.joy.y = -dy / R;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === this.lookTouch.id) {
          this.lookX += (t.clientX - this.lookTouch.x) * 1.6;
          this.lookY += (t.clientY - this.lookTouch.y) * 1.6;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.active = false; this.joy.id = null; this.joy.x = 0; this.joy.y = 0;
          knob.style.transform = '';
          base.classList.remove('on');
        }
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = null;
      }
    };
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    const look = root.querySelector('#lookZone');
    look.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      e.preventDefault();
    }, { passive: false });
    for (const btn of root.querySelectorAll('[data-act]')) {
      const act = btn.dataset.act;
      btn.addEventListener('touchstart', (e) => {
        this.pressedSet.add(act);
        this.held.add(act);
        btn.classList.add('down');
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        this.held.delete(act);
        btn.classList.remove('down');
        e.preventDefault();
      });
    }
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  pressed(a) { return this.enabled && this.pressedSet.has(a); }
  consume(a) { const had = this.pressedSet.has(a); this.pressedSet.delete(a); return had; }

  // Called once per frame before gameplay reads axes.
  sample(dt, inCar) {
    const k = this.enabled;
    const up = k && this.down('KeyW', 'ArrowUp');
    const dn = k && this.down('KeyS', 'ArrowDown');
    const lf = k && this.down('KeyA', 'ArrowLeft');
    const rt = k && this.down('KeyD', 'ArrowRight');
    let mx = (rt ? 1 : 0) - (lf ? 1 : 0);
    let my = (up ? 1 : 0) - (dn ? 1 : 0);
    if (this.joy.active) { mx = this.joy.x; my = this.joy.y; }
    this.moveX = mx; this.moveY = my;
    this.sprint = k && (this.down('ShiftLeft', 'ShiftRight') || this.held.has('sprint'));

    // driving
    if (this.joy.active) {
      this.steer = clamp(this.joy.x * 1.15, -1, 1);
      this.throttle = Math.abs(this.joy.y) > 0.2 ? clamp(this.joy.y * 1.25, -1, 1) : 0;
    } else {
      const target = mx;
      const rate = target === 0 ? 7 : (Math.sign(target) !== Math.sign(this.steer) ? 9 : 3.6);
      const d = target - this.steer;
      this.steer += clamp(d, -rate * dt, rate * dt);
      this.throttle = my;
    }
    if (this.held.has('gas')) this.throttle = 1;
    if (this.held.has('brake')) this.throttle = -1;
    this.handbrake = k && (this.down('Space') || this.held.has('jump'));
    this.inCar = inCar;
  }

  endFrame() {
    this.pressedSet.clear();
    this.lookX = 0;
    this.lookY = 0;
  }
}
