import * as THREE from 'three';
import { clamp, damp, rand } from './config.js';

const STATES = {
  clear: { cover: 0.36, storm: 0, rain: 0 },
  cloudy: { cover: 0.62, storm: 0.25, rain: 0 },
  storm: { cover: 0.88, storm: 1, rain: 1 },
};

// Weather: cloud cover, rain streaks around the camera, wet streets and lightning.
export class Weather {
  constructor(game) {
    this.game = game;
    this.mode = 'auto'; // auto | clear | storm
    this.state = 'clear';
    this.cover = STATES.clear.cover;
    this.storm = 0;
    this.rain = 0;
    this.wet = 0;
    this.flash = 0;
    this.nextChange = rand(120, 220);
    this.boltT = rand(6, 14);
    this.time = 0;
    this._buildRain(5000);
  }

  _buildRain(count) {
    const W = 70, H = 40;
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * W, y = Math.random() * H, z = Math.random() * W;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k);
        pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
        end[o] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainU = {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uW: { value: W }, uH: { value: H },
      uSpeed: { value: 32 }, uLen: { value: 1.1 }, uWind: { value: new THREE.Vector2(3, 1.5) },
      uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.85) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aEnd;
        uniform vec3 uCam; uniform float uTime, uW, uH, uSpeed, uLen; uniform vec2 uWind;
        varying float vA;
        void main(){
          vec3 p = position;
          float y = mod(p.y - uTime * uSpeed, uH);
          float fall = uTime;
          float px = p.x + uWind.x * fall, pz = p.z + uWind.y * fall;
          vec3 wp = vec3(uCam.x + mod(px - uCam.x, uW) - uW * 0.5, uCam.y + y - uH * 0.5, uCam.z + mod(pz - uCam.z, uW) - uW * 0.5);
          vec3 v = normalize(vec3(uWind.x, -uSpeed, uWind.y));
          wp -= v * uLen * aEnd;
          vA = 1.0 - aEnd * 0.9;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor; varying float vA;
        void main(){ gl_FragColor = vec4(uColor * uOpacity * vA, 1.0); }`,
    });
    this.rainMesh = new THREE.LineSegments(geo, mat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.game.scene.add(this.rainMesh);
    this.maxDrops = count;
  }

  setQuality(q) {
    const n = q === 'ultra' ? 5000 : q === 'high' ? 3000 : 1400;
    this.rainMesh.geometry.setDrawRange(0, n * 2);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'clear') this.state = 'clear';
    if (mode === 'storm') this.state = 'storm';
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    if (this.mode === 'auto') {
      this.nextChange -= dt;
      if (this.nextChange <= 0) {
        const r = Math.random();
        this.state = r < 0.55 ? 'clear' : r < 0.78 ? 'cloudy' : 'storm';
        this.nextChange = this.state === 'storm' ? rand(70, 130) : rand(140, 260);
      }
    }
    const s = STATES[this.state];
    this.cover = damp(this.cover, s.cover, 0.15, dt);
    this.storm = damp(this.storm, s.storm, 0.15, dt);
    this.rain = damp(this.rain, s.rain, 0.25, dt);
    // streets get wet fast and dry slowly
    this.wet = this.rain > this.wet ? damp(this.wet, this.rain, 0.4, dt) : damp(this.wet, 0, 0.03, dt);

    // lightning in heavy rain
    if (this.rain > 0.7) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = rand(7, 18);
        this.flash = 1;
        this._flicker = rand(0.1, 0.25);
        const delay = rand(0.4, 2.2);
        setTimeout(() => g.audio.thunder(), delay * 1000);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      if (this._flicker > 0) { this._flicker -= dt; if (this._flicker <= 0 && Math.random() < 0.6) this.flash = 0.8; }
    }

    // rain streaks follow the camera
    const u = this.rainU;
    u.uTime.value = this.time;
    u.uCam.value.copy(g.camera.position);
    const n = g.night;
    u.uOpacity.value = this.rain * (0.22 + n * 0.12) * (1 + this.flash);
    u.uColor.value.setRGB(0.62 + n * 0.1, 0.68 + n * 0.08, 0.8 + n * 0.1);
    this.rainMesh.visible = this.rain > 0.02;
  }
}

export const WEATHER_LABEL = { auto: 'Auto', clear: 'Clear', storm: 'Storm' };
export function nextWeatherMode(m) { return m === 'auto' ? 'clear' : m === 'clear' ? 'storm' : 'auto'; }
export const clampUnit = (v) => clamp(v, 0, 1);
