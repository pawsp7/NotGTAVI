import * as THREE from 'three';
import { mulberry32 } from './config.js';

// All textures are drawn on canvases at load time, so the game ships no image files.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function speckle(ctx, w, h, count, rng, colors, maxSize = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = 1 + rng() * maxSize;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

function finish(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}

// Road segment: 14 m wide (u), 14 m long (v). Double yellow centre, white edge lines.
export function roadTexture(renderer) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(7);
  g.fillStyle = '#3b3e46';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 2600, rng, ['#34373e', '#43464f', '#3f424a', '#2f3238'], 2);
  const px = S / 14;
  // tyre-worn darker bands in each lane
  g.fillStyle = 'rgba(20,20,26,0.18)';
  for (const off of [-3.6, -2.0, 2.0, 3.6]) g.fillRect((7 + off) * px - 6, 0, 12, S);
  // edge lines
  g.fillStyle = '#d9d6cc';
  g.fillRect(1.2 * px, 0, 0.18 * px, S);
  g.fillRect((14 - 1.2 - 0.18) * px, 0, 0.18 * px, S);
  // double yellow
  g.fillStyle = '#e9b93b';
  g.fillRect(6.8 * px - 2, 0, 0.14 * px, S);
  g.fillRect(7.2 * px - 1, 0, 0.14 * px, S);
  // patches
  g.fillStyle = 'rgba(30,30,36,0.35)';
  for (let i = 0; i < 3; i++) g.fillRect(rng() * S, rng() * S, 20 + rng() * 40, 10 + rng() * 25);
  return finish(c, renderer);
}

// Intersection: plain asphalt with zebra crossings on each side.
export function intersectionTexture(renderer) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(11);
  g.fillStyle = '#3a3d45';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 2600, rng, ['#34373e', '#43464f', '#3f424a', '#2f3238'], 2);
  const px = S / 14;
  g.fillStyle = '#dcd9cf';
  const band = 2.2 * px;
  for (let k = 0; k < 7; k++) {
    const a = (1.2 + k * 1.7) * px;
    const w = 0.85 * px;
    g.fillRect(a, 2, w, band); // north
    g.fillRect(a, S - band - 2, w, band); // south
    g.fillRect(2, a, band, w); // west
    g.fillRect(S - band - 2, a, band, w); // east
  }
  return finish(c, renderer, false);
}

// Concrete sidewalk with 2 m slabs. One tile = 4 m.
export function sidewalkTexture(renderer) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(3);
  g.fillStyle = '#b9b3a8';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 900, rng, ['#aea89d', '#c4beb3', '#a7a196'], 1.5);
  g.strokeStyle = 'rgba(80,74,66,0.45)';
  g.lineWidth = 1.5;
  for (let k = 0; k <= 2; k++) {
    g.beginPath();
    g.moveTo((k * S) / 2, 0);
    g.lineTo((k * S) / 2, S);
    g.moveTo(0, (k * S) / 2);
    g.lineTo(S, (k * S) / 2);
    g.stroke();
  }
  return finish(c, renderer);
}

export function grassTexture(renderer) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(5);
  g.fillStyle = '#5f8f45';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 2200, rng, ['#55843d', '#6a9b4e', '#4f7a39', '#77a85a'], 2);
  return finish(c, renderer);
}

export function sandTexture(renderer) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(9);
  g.fillStyle = '#e6d3a3';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 2500, rng, ['#dcc795', '#efdfb4', '#d6bf8a', '#f3e6c2'], 1.5);
  return finish(c, renderer);
}

// Soft round glow used for street light pools and particles.
export function glowTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokeTexture() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A painted sign for shop fronts / billboards.
export function signTexture(text, bg, fg, w = 512, h = 128) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  let size = Math.floor(h * 0.5);
  const font = (px) => `700 ${px}px "Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif`;
  g.font = font(size);
  while (size > 12 && g.measureText(text).width > w - 48) g.font = font(--size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Puddle mask (green channel): soft blobs that tile. Used to make wet streets patchy.
export function puddleTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(77);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = rng() * S, y = rng() * S, r = 10 + rng() * 34;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(x + ox, y + oy, r * (0.8 + rng() * 0.6), r, rng() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Tileable ocean normal map built from a sum of integer-frequency waves.
export function waterNormalTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rng = mulberry32(31);
  const waves = [];
  for (let i = 0; i < 14; i++) {
    const kx = Math.floor(rng() * 9) - 4, ky = 1 + Math.floor(rng() * 7);
    waves.push({ kx: rng() < 0.5 ? kx : ky, ky: rng() < 0.5 ? ky : kx, a: 1 / (1 + Math.hypot(kx, ky)), p: rng() * Math.PI * 2 });
  }
  const img = g.createImageData(S, S);
  const T = Math.PI * 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    const u = (x / S) * T, v = (y / S) * T;
    for (const w of waves) {
      const ph = w.kx * u + w.ky * v + w.p;
      const cph = Math.cos(ph) * w.a;
      dx += cph * w.kx; dy += cph * w.ky;
    }
    const s = 0.09;
    let nx = -dx * s, ny = -dy * s, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const o = (y * S + x) * 4;
    img.data[o] = (nx * 0.5 + 0.5) * 255;
    img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
