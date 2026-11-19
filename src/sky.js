import * as THREE from 'three';
import { clamp, lerp } from './config.js';

// Time-of-day keyframes. Hours are game hours; one hour lasts 30 real seconds.
const KEYS = [
  { h: 0, top: '#060a22', hor: '#1b1640', sun: 0, amb: 0.42, fog: '#14143a' },
  { h: 5.2, top: '#0b1030', hor: '#2c2152', sun: 0, amb: 0.45, fog: '#1d1a45' },
  { h: 6.3, top: '#3d4f8a', hor: '#ff9e7a', sun: 0.6, amb: 0.7, fog: '#d99a8a' },
  { h: 8, top: '#2f7fd0', hor: '#bfe3ff', sun: 1.7, amb: 1.05, fog: '#b9d9f2' },
  { h: 16, top: '#2f7fd0', hor: '#c8e6ff', sun: 1.7, amb: 1.05, fog: '#c2def3' },
  { h: 17.6, top: '#4a6fb5', hor: '#ffc58a', sun: 1.45, amb: 0.95, fog: '#f0c49b' },
  { h: 18.7, top: '#2b2d6e', hor: '#ff6f7d', sun: 0.8, amb: 0.75, fog: '#d77588' },
  { h: 19.6, top: '#141640', hor: '#7b3f9e', sun: 0.08, amb: 0.55, fog: '#4d2f6e' },
  { h: 21, top: '#080c28', hor: '#26194a', sun: 0, amb: 0.45, fog: '#1a1740' },
  { h: 24, top: '#060a22', hor: '#1b1640', sun: 0, amb: 0.42, fog: '#14143a' },
];
const parsed = KEYS.map((k) => ({ ...k, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), fog: new THREE.Color(k.fog) }));
const STORM_TOP = new THREE.Color('#3b4250');
const STORM_HOR = new THREE.Color('#6d7480');
const STORM_FOG = new THREE.Color('#5d636d');

const SKY_FRAG = `
  uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uGround;
  uniform float uNight; uniform float uCover; uniform float uTime; uniform float uFlash; uniform float uDark; uniform float uDisc;
  varying vec3 vDir;
  float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash2(i), hash2(i+vec2(1.0,0.0)), u.x), mix(hash2(i+vec2(0.0,1.0)), hash2(i+vec2(1.0,1.0)), u.x), u.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.5, h));
    col = mix(col, uGround, smoothstep(0.0, -0.12, h));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(sd, 6.0) * 0.45 + pow(sd, 64.0) * 0.8) * (1.0 - uDark * 0.8);
    col += uSunCol * smoothstep(0.9990, 0.9996, sd) * 6.0 * (1.0 - uDark) * uDisc;
    float st = step(0.9982, hash3(floor(d * 320.0)));
    col += st * uNight * smoothstep(0.02, 0.25, h) * vec3(0.9, 0.95, 1.0) * (1.0 - uCover);
    // clouds: fbm on a plane above the city, lit from the sun side
    if (h > -0.02) {
      vec2 cp = d.xz / (h + 0.14) * 0.85 + vec2(uTime * 0.012, uTime * 0.004);
      float n = fbm(cp);
      float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, n) * smoothstep(-0.02, 0.14, h);
      float n2 = fbm(cp + uSunDir.xz * 0.18);
      float light = clamp((n - n2) * 5.0 + 0.45, 0.0, 1.0);
      vec3 base = mix(uHor * 0.5 + uTop * 0.35, vec3(0.62, 0.64, 0.7), uDark);
      vec3 lit = uSunCol * 1.7 + uHor * 0.55;
      vec3 cc = mix(base * 0.75, lit, light * 0.65 * (1.0 - uDark) + pow(sd, 4.0) * 0.5 * (1.0 - uDark));
      cc = mix(cc, vec3(0.05, 0.055, 0.1) + uHor * 0.25, uNight * 0.8);
      cc *= 1.0 - uDark * 0.35;
      col = mix(col, cc, dens * 0.93);
    }
    col += uFlash * vec3(0.7, 0.75, 1.0) * (0.6 + 0.4 * smoothstep(0.0, 0.5, h));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Sky {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.hour = 17.2;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHor: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
      uNight: { value: 0 },
      uCover: { value: 0.38 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uDark: { value: 0 },
      uDisc: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: SKY_FRAG,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    // A tiny scene that only holds the sky, used to bake reflections.
    this.envScene = new THREE.Scene();
    // same sky, but with a dimmer sun disc so glass and paint don't flare to white
    const envMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uDisc: { value: 0.1 } }, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: SKY_FRAG,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
    this.pmrem = new THREE.PMREMGenerator(game.renderer);
    this.envRT = null;
    this.envT = 0;
    this.envEvery = 1.5;

    // Lights
    this.hemi = new THREE.HemisphereLight(0xbfd7ff, 0x5a4a3a, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.shadowSpan = 75;
    this._shadowCam(75);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.fog = new THREE.Fog(0xffffff, 140, 520);
    this.fogFar = 520;
    scene.fog = this.fog;
    this.night = 0;
    this.elev = 0;
    this.golden = 0;
    this.sunDir = new THREE.Vector3();
  }

  _shadowCam(span) {
    const sc = this.sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 420;
    sc.updateProjectionMatrix();
    this.shadowSpan = span;
  }

  setQuality(q) {
    const on = q !== 'low';
    this.sun.castShadow = on;
    const size = q === 'ultra' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this._shadowCam(q === 'ultra' ? 95 : 75);
    this.envEvery = q === 'low' ? 8 : q === 'ultra' ? 1 : 2;
    this.fogFar = q === 'low' ? 380 : q === 'ultra' ? 640 : 560;
  }

  sample(hour) {
    let a = parsed[0], b = parsed[parsed.length - 1];
    for (let i = 0; i < parsed.length - 1; i++) {
      if (hour >= parsed[i].h && hour <= parsed[i + 1].h) { a = parsed[i]; b = parsed[i + 1]; break; }
    }
    const t = (hour - a.h) / (b.h - a.h || 1);
    return { a, b, t };
  }

  bakeEnvironment() {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.game.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  update(dt, focus) {
    const wx = this.game.weather;
    const storm = wx ? wx.storm : 0;
    const flash = wx ? wx.flash : 0;
    this.hour = (this.hour + dt / 30) % 24;
    const { a, b, t } = this.sample(this.hour);
    const U = this.uniforms;
    U.uTime.value += dt;
    U.uTop.value.copy(a.top).lerp(b.top, t);
    U.uHor.value.copy(a.hor).lerp(b.hor, t);
    this.fog.color.copy(a.fog).lerp(b.fog, t);
    let sunI = lerp(a.sun, b.sun, t);
    let amb = lerp(a.amb, b.amb, t);

    // Sun arc: rises over the city, sets over the ocean (east).
    const k = clamp((this.hour - 6.0) / 13.2, -0.2, 1.2);
    const ang = k * Math.PI;
    const elev = Math.sin(ang);
    this.elev = elev;
    this.sunDir.set(-Math.cos(ang), Math.max(elev, -0.3), 0.32).normalize();
    U.uSunDir.value.copy(this.sunDir);
    const warm = clamp(1 - elev * 2.2, 0, 1);
    U.uSunCol.value.setRGB(1, lerp(0.95, 0.55, warm), lerp(0.85, 0.35, warm)).multiplyScalar(clamp(elev * 4 + 0.2, 0, 1));
    this.night = clamp((0.08 - elev) / 0.22, 0, 1);
    this.golden = clamp(1 - Math.abs(elev - 0.12) / 0.3, 0, 1) * (1 - this.night) * (1 - storm);
    U.uNight.value = this.night;

    // weather greys everything out
    const dayness = 1 - this.night;
    U.uTop.value.lerp(STORM_TOP.clone().multiplyScalar(lerp(0.15, 1, dayness)), storm * 0.85);
    U.uHor.value.lerp(STORM_HOR.clone().multiplyScalar(lerp(0.18, 1, dayness)), storm * 0.85);
    this.fog.color.lerp(STORM_FOG.clone().multiplyScalar(lerp(0.2, 1, dayness)), storm * 0.85);
    U.uCover.value = wx ? wx.cover : 0.38;
    U.uDark.value = storm;
    U.uFlash.value = flash;
    U.uGround.value.copy(this.fog.color).multiplyScalar(0.55);
    sunI *= 1 - storm * 0.8;
    amb *= 1 - storm * 0.25;
    this.fog.far = this.fogFar * lerp(1, 0.55, storm);
    this.fog.near = lerp(140, 40, storm);

    // Direct light: sun by day, moon by night
    if (elev > -0.02) {
      this.sun.color.setRGB(1, lerp(0.97, 0.62, warm), lerp(0.92, 0.45, warm));
      this.sun.intensity = sunI * 2.1;
      this.sun.position.copy(this.sunDir).multiplyScalar(180).add(focus);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.55 * this.night * (1 - storm * 0.6);
      const md = new THREE.Vector3(0.4, 0.8, -0.3).normalize();
      this.sun.position.copy(md).multiplyScalar(180).add(focus);
    }
    // snap the shadow frustum to texels to reduce shimmering
    const texel = (this.shadowSpan * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.position.x += fx - focus.x; this.sun.position.z += fz - focus.z;
    this.sun.target.position.set(fx, 0, fz);

    this.hemi.color.copy(U.uTop.value).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.copy(this.fog.color).multiplyScalar(0.45);
    this.hemi.intensity = amb * 1.55 + flash * 2.5;

    this.dome.position.copy(this.game.camera.position);
    this.game.world.uniforms.uSkyTint.value.copy(U.uHor.value).lerp(U.uTop.value, 0.4);

    // refresh reflections every so often (always right after a lightning flash ends)
    this.envT -= dt;
    if (this.envT <= 0 || !this.envRT) {
      this.envT = this.envEvery;
      if (flash < 0.05) this.bakeEnvironment();
    }
  }

  timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
