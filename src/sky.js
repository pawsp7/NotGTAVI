import * as THREE from 'three';
import { clamp, lerp } from './config.js';
import { smokeTexture } from './textures.js';

// Time-of-day keyframes. Hours are game hours; one hour lasts 30 real seconds.
const KEYS = [
  { h: 0, top: '#060a22', hor: '#1b1640', sun: 0, amb: 0.42, fog: '#14143a' },
  { h: 5.2, top: '#0b1030', hor: '#2c2152', sun: 0, amb: 0.45, fog: '#1d1a45' },
  { h: 6.3, top: '#3d4f8a', hor: '#ff9e7a', sun: 0.6, amb: 0.7, fog: '#d99a8a' },
  { h: 8, top: '#3a8edb', hor: '#bfe3ff', sun: 1.7, amb: 1.05, fog: '#b9d9f2' },
  { h: 16, top: '#3a8edb', hor: '#c8e6ff', sun: 1.7, amb: 1.05, fog: '#c2def3' },
  { h: 17.6, top: '#4a6fb5', hor: '#ffc58a', sun: 1.45, amb: 0.95, fog: '#f0c49b' },
  { h: 18.7, top: '#2b2d6e', hor: '#ff6f7d', sun: 0.8, amb: 0.75, fog: '#d77588' },
  { h: 19.6, top: '#141640', hor: '#7b3f9e', sun: 0.08, amb: 0.55, fog: '#4d2f6e' },
  { h: 21, top: '#080c28', hor: '#26194a', sun: 0, amb: 0.45, fog: '#1a1740' },
  { h: 24, top: '#060a22', hor: '#1b1640', sun: 0, amb: 0.42, fog: '#14143a' },
];
const parsed = KEYS.map((k) => ({ ...k, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), fog: new THREE.Color(k.fog) }));

export class Sky {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.hour = 17.2;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.5, h));
          col = mix(col, uHor * 0.55, smoothstep(0.0, -0.25, h));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(sd, 6.0) * 0.45 + pow(sd, 64.0) * 0.8);
          col += uSunCol * smoothstep(0.9990, 0.9996, sd) * 3.0;
          float st = step(0.9982, hash(floor(d * 320.0)));
          col += st * uNight * smoothstep(0.02, 0.25, h) * vec3(0.9, 0.95, 1.0);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xbfd7ff, 0x5a4a3a, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    // Clouds: soft sprites far away, tinted by the horizon colour.
    const tex = smokeTexture();
    this.clouds = [];
    for (let i = 0; i < 18; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
      const s = new THREE.Sprite(m);
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const r = 900 + Math.random() * 300;
      s.position.set(Math.cos(a) * r, 140 + Math.random() * 120, Math.sin(a) * r);
      s.scale.set(380 + Math.random() * 300, 70 + Math.random() * 50, 1);
      s.renderOrder = -1;
      scene.add(s);
      this.clouds.push(s);
    }

    this.fog = new THREE.Fog(0xffffff, 140, 520);
    scene.fog = this.fog;
    this.night = 0;
    this.sunDir = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  setShadows(on) { this.sun.castShadow = on; }

  sample(hour) {
    let a = parsed[0], b = parsed[parsed.length - 1];
    for (let i = 0; i < parsed.length - 1; i++) {
      if (hour >= parsed[i].h && hour <= parsed[i + 1].h) { a = parsed[i]; b = parsed[i + 1]; break; }
    }
    const t = (hour - a.h) / (b.h - a.h || 1);
    return { a, b, t };
  }

  update(dt, focus) {
    this.hour = (this.hour + dt / 30) % 24;
    const { a, b, t } = this.sample(this.hour);
    const U = this.uniforms;
    U.uTop.value.copy(a.top).lerp(b.top, t);
    U.uHor.value.copy(a.hor).lerp(b.hor, t);
    this.fog.color.copy(a.fog).lerp(b.fog, t);
    const sunI = lerp(a.sun, b.sun, t);
    const amb = lerp(a.amb, b.amb, t);

    // Sun arc: rises over the city, sets over the ocean (east).
    const k = clamp((this.hour - 6.0) / 13.2, -0.2, 1.2);
    const ang = k * Math.PI;
    const elev = Math.sin(ang);
    this.sunDir.set(-Math.cos(ang), Math.max(elev, -0.3), 0.32).normalize();
    U.uSunDir.value.copy(this.sunDir);
    const warm = clamp(1 - elev * 2.2, 0, 1);
    U.uSunCol.value.setRGB(1, lerp(0.95, 0.55, warm), lerp(0.85, 0.35, warm)).multiplyScalar(clamp(elev * 4 + 0.2, 0, 1));
    this.night = clamp((0.08 - elev) / 0.22, 0, 1);
    U.uNight.value = this.night;

    // Direct light: sun by day, moon by night
    if (elev > -0.02) {
      this.sun.color.setRGB(1, lerp(0.97, 0.62, warm), lerp(0.92, 0.45, warm));
      this.sun.intensity = sunI * 1.9;
      this.sun.position.copy(this.sunDir).multiplyScalar(160).add(focus);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.55 * this.night;
      const md = new THREE.Vector3(0.4, 0.8, -0.3).normalize();
      this.sun.position.copy(md).multiplyScalar(160).add(focus);
    }
    // snap the shadow frustum to texels to reduce shimmering
    const texel = 150 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.position.x += fx - focus.x; this.sun.position.z += fz - focus.z;
    this.sun.target.position.set(fx, 0, fz);

    this.hemi.color.copy(U.uTop.value).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.copy(this.fog.color).multiplyScalar(0.45);
    this.hemi.intensity = amb * 1.7;

    for (const c of this.clouds) {
      c.material.color.copy(U.uHor.value).lerp(new THREE.Color(1, 1, 1), 0.35 * (1 - this.night)).multiplyScalar(lerp(1.1, 0.35, this.night));
    }
    this.dome.position.copy(this.game.camera.position);
    for (const c of this.clouds) c.position.x += dt * 0.6;
    this.game.world.uniforms.uSkyTint.value.copy(U.uHor.value).lerp(U.uTop.value, 0.4);
  }

  timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
