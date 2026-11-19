import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, lerp, damp } from './config.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LUM = `float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

// Bright sky pixels near the sun, the source for light shafts and the flare.
const ShaftMask = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThreshold: { value: 0.6 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect; uniform float uThreshold; varying vec2 vUv;
    ${LUM}
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = pow(clamp(1.0 - length(d) / 0.8, 0.0, 1.0), 2.0);
      float m = smoothstep(uThreshold, uThreshold * 2.2, lum(c));
      gl_FragColor = vec4(min(c, vec3(8.0)) * m * fall, 1.0);
    }`,
};

const RadialBlur = {
  uniforms: { tInput: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tInput; uniform vec2 uSun; uniform float uStep; varying vec2 vUv;
    void main(){
      const int N = 36;
      vec2 delta = (vUv - uSun) * uStep / float(N);
      vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0, tot = 0.0;
      for (int i = 0; i < N; i++) { acc += texture2D(tInput, uv).rgb * w; tot += w; w *= 0.955; uv -= delta; }
      gl_FragColor = vec4(acc / tot, 1.0);
    }`,
};

const StreakPre = {
  uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.4 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
    ${LUM}
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = lum(c);
      gl_FragColor = vec4(min(c, vec3(10.0)) * smoothstep(uThreshold, uThreshold * 1.8, l), 1.0); }`,
};

const HBlur = {
  uniforms: { tInput: { value: null }, uTexel: { value: 0.001 }, uSpread: { value: 4 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tInput; uniform float uTexel; uniform float uSpread; varying vec2 vUv;
    void main(){ vec3 acc = vec3(0.0); float tot = 0.0;
      for (int i = -14; i <= 14; i++) { float w = exp(-abs(float(i)) * 0.16);
        acc += texture2D(tInput, vUv + vec2(float(i) * uTexel * uSpread, 0.0)).rgb * w; tot += w; }
      gl_FragColor = vec4(acc / tot, 1.0); }`,
};

// Final look: speed blur, chromatic aberration, shafts, flare, streaks, grading, vignette, grain, letterbox.
const Grade = {
  uniforms: {
    tDiffuse: { value: null }, tShafts: { value: null }, tMask: { value: null }, tStreak: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uAspect: { value: 1 }, uTime: { value: 0 },
    uShaft: { value: 1 }, uFlare: { value: 0.6 }, uStreak: { value: 0 }, uSpeed: { value: 0 }, uCA: { value: 0.0025 },
    uVignette: { value: 0.35 }, uGrain: { value: 0.03 }, uLetterbox: { value: 0 }, uHurt: { value: 0 },
    uShadowTint: { value: new THREE.Color(0.9, 1, 1.08) }, uHighTint: { value: new THREE.Color(1.08, 1, 0.9) },
    uSat: { value: 1.1 }, uContrast: { value: 1.08 }, uFlash: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse, tShafts, tMask, tStreak;
    uniform vec2 uSun; uniform float uSunVis, uAspect, uTime, uShaft, uFlare, uStreak, uSpeed, uCA, uVignette, uGrain, uLetterbox, uHurt, uSat, uContrast, uFlash;
    uniform vec3 uShadowTint, uHighTint;
    varying vec2 vUv;
    ${LUM}
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    vec3 sampleCA(vec2 uv, vec2 dir, float k){
      return vec3(texture2D(tDiffuse, uv - dir * k).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + dir * k).b);
    }
    void main(){
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float r2 = dot(dir * vec2(uAspect, 1.0), dir * vec2(uAspect, 1.0));
      float ca = uCA * (0.3 + r2 * 2.0);
      vec3 col;
      if (uSpeed > 0.01) {
        float edge = smoothstep(0.02, 0.35, r2);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; acc += sampleCA(uv - dir * t * uSpeed * 0.06 * edge, dir, ca); }
        col = acc / 8.0;
      } else col = sampleCA(uv, dir, ca);

      col += texture2D(tShafts, uv).rgb * uShaft;
      col += texture2D(tStreak, uv).rgb * uStreak * vec3(0.55, 0.75, 1.2);

      // lens flare ghosts along the sun-centre axis
      if (uSunVis > 0.001) {
        vec2 toC = vec2(0.5) - uSun;
        vec3 fl = vec3(0.0);
        float ks[5]; ks[0] = 0.45; ks[1] = 0.8; ks[2] = 1.15; ks[3] = 1.55; ks[4] = 2.0;
        float rs[5]; rs[0] = 0.035; rs[1] = 0.06; rs[2] = 0.025; rs[3] = 0.11; rs[4] = 0.05;
        vec3 cs[5]; cs[0] = vec3(1.0, 0.6, 0.3); cs[1] = vec3(0.4, 0.8, 1.0); cs[2] = vec3(1.0, 0.4, 0.7); cs[3] = vec3(0.35, 1.0, 0.7); cs[4] = vec3(0.7, 0.5, 1.0);
        for (int i = 0; i < 5; i++) {
          vec2 p = uSun + toC * ks[i];
          float d = length((uv - p) * vec2(uAspect, 1.0));
          fl += cs[i] * smoothstep(rs[i], rs[i] * 0.4, d) * 0.06;
        }
        float ring = length((uv - 0.5) * vec2(uAspect, 1.0));
        float sd = length((uv - uSun) * vec2(uAspect, 1.0));
        fl += vec3(1.0, 0.75, 0.5) * smoothstep(0.03, 0.0, abs(ring - 0.42)) * smoothstep(0.9, 0.2, sd) * 0.05;
        // horizontal anamorphic glint through the sun
        fl += vec3(1.0, 0.7, 0.45) * exp(-abs(uv.y - uSun.y) * 160.0) * exp(-abs(uv.x - uSun.x) * uAspect * 2.2) * 0.9;
        col += fl * uSunVis * uFlare;
      }

      // grading (linear HDR, before tone mapping)
      float l = lum(col);
      col *= mix(uShadowTint, vec3(1.0), smoothstep(0.0, 0.35, l));
      col *= mix(vec3(1.0), uHighTint, smoothstep(0.25, 1.6, l));
      l = lum(col);
      col = mix(vec3(l), col, uSat * (1.0 - uHurt * 0.65));
      col = pow(max(col, vec3(0.0)) / 0.18, vec3(uContrast)) * 0.18;
      col += uFlash * vec3(0.6, 0.7, 1.0) * 0.35;

      // vignette, hurt pulse
      float vig = smoothstep(1.05, 0.25, length(dir * vec2(1.0 + (uAspect - 1.0) * 0.5, 1.0)) * 1.35);
      col *= mix(1.0, vig, uVignette);
      col = mix(col, col * vec3(1.4, 0.35, 0.35), uHurt * smoothstep(0.15, 0.6, r2) * (0.75 + 0.25 * sin(uTime * 6.0)));

      // film grain, stronger in shadows
      float g = hash(uv * 1031.7 + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * uGrain * (0.06 + sqrt(max(l, 0.0)) * 0.5);

      // letterbox
      float lb = step(0.5 - uLetterbox, abs(uv.y - 0.5));
      col *= 1.0 - lb;
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

function rt(w, h) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, depthBuffer: false });
}

class CinemaPass extends Pass {
  constructor() {
    super();
    this.mask = new FullScreenQuad(new THREE.ShaderMaterial({ ...ShaftMask, uniforms: THREE.UniformsUtils.clone(ShaftMask.uniforms) }));
    this.radial = new FullScreenQuad(new THREE.ShaderMaterial({ ...RadialBlur, uniforms: THREE.UniformsUtils.clone(RadialBlur.uniforms) }));
    this.streakPre = new FullScreenQuad(new THREE.ShaderMaterial({ ...StreakPre, uniforms: THREE.UniformsUtils.clone(StreakPre.uniforms) }));
    this.hblur = new FullScreenQuad(new THREE.ShaderMaterial({ ...HBlur, uniforms: THREE.UniformsUtils.clone(HBlur.uniforms) }));
    this.gradeMat = new THREE.ShaderMaterial({ ...Grade, uniforms: THREE.UniformsUtils.clone(Grade.uniforms) });
    this.grade = new FullScreenQuad(this.gradeMat);
    this.u = this.gradeMat.uniforms;
    this.rMask = rt(4, 4); this.rA = rt(4, 4); this.rB = rt(4, 4);
    this.sA = rt(4, 4); this.sB = rt(4, 4);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.shafts = true;
    this.streaks = false;
  }

  setSize(w, h) {
    const qw = Math.ceil(w / 4), qh = Math.ceil(h / 4);
    for (const t of [this.rMask, this.rA, this.rB, this.sA, this.sB]) t.setSize(qw, qh);
    this.hblur.material.uniforms.uTexel.value = 1 / qw;
    this.u.uAspect.value = w / h;
    this.mask.material.uniforms.uAspect.value = w / h;
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.u;
    u.tDiffuse.value = readBuffer.texture;
    const useShafts = this.shafts && (u.uShaft.value > 0.01 || u.uFlare.value > 0.01) && u.uSunVis.value > -1;
    if (useShafts) {
      const m = this.mask.material.uniforms;
      m.tDiffuse.value = readBuffer.texture;
      m.uSun.value.copy(u.uSun.value);
      renderer.setRenderTarget(this.rMask); this.mask.render(renderer);
      const r = this.radial.material.uniforms;
      r.uSun.value.copy(u.uSun.value);
      r.tInput.value = this.rMask.texture; r.uStep.value = 1.0;
      renderer.setRenderTarget(this.rA); this.radial.render(renderer);
      r.tInput.value = this.rA.texture; r.uStep.value = 0.3;
      renderer.setRenderTarget(this.rB); this.radial.render(renderer);
      u.tShafts.value = this.rB.texture;
      u.tMask.value = this.rMask.texture;
    } else {
      u.tShafts.value = this.black; u.tMask.value = this.black;
    }
    if (this.streaks && u.uStreak.value > 0.01) {
      this.streakPre.material.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.sA); this.streakPre.render(renderer);
      const h = this.hblur.material.uniforms;
      h.tInput.value = this.sA.texture; h.uSpread.value = 5;
      renderer.setRenderTarget(this.sB); this.hblur.render(renderer);
      h.tInput.value = this.sB.texture; h.uSpread.value = 1.5;
      renderer.setRenderTarget(this.sA); this.hblur.render(renderer);
      u.tStreak.value = this.sA.texture;
    } else u.tStreak.value = this.black;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.grade.render(renderer);
  }
}

// Post-processing stack and the per-frame "camera crew" decisions (grade, exposure, flare).
export class PostFX {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.letterbox = 0;
    this.sunVis = 0;
    this._v = new THREE.Vector3();
  }

  build(samples) {
    const g = this.game;
    const r = g.renderer;
    if (this.composer) this.composer.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(g.scene, g.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.55, 1.0);
    // clamp specular fireflies before they are blurred across the frame
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb *= min(1.0, 12.0 / max(dot(texel.rgb, vec3(0.3333)), 1e-4));'
    );
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.cinema = new CinemaPass();
    this.composer.addPass(this.cinema);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    this.enabled = q !== 'low';
    if (!this.enabled) return;
    this.build(4);
    this.cinema.streaks = q === 'ultra';
  }

  resize() {
    if (!this.composer) return;
    const r = this.game.renderer;
    const w = window.innerWidth, h = window.innerHeight;
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = r.getPixelRatio();
    this.cinema.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }

  update(dt) {
    const g = this.game;
    const sky = g.sky;
    const wx = g.weather;
    const night = sky.night;
    const storm = wx ? wx.storm : 0;
    const golden = sky.golden;
    const cine = g.cine && g.cine.wantsLetterbox();
    this.letterbox = damp(this.letterbox, cine ? 0.122 : 0, 4, dt);

    // exposure follows the light a little, like an auto-iris
    const exp = lerp(1.0, 1.32, night) * lerp(1, 0.92, storm) * lerp(1, 1.05, golden);
    g.renderer.toneMappingExposure = damp(g.renderer.toneMappingExposure, exp, 1.5, dt);
    if (!this.enabled) return;

    const u = this.cinema.u;
    u.uTime.value += dt;
    u.uLetterbox.value = this.letterbox;

    // sun on screen
    const cam = g.camera;
    const sd = sky.sunDir;
    this._v.copy(cam.position).addScaledVector(sd, 1000).project(cam);
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    const facing = camDir.dot(sd);
    const onScreen = facing > 0 && Math.abs(this._v.x) < 1.3 && Math.abs(this._v.y) < 1.3;
    u.uSun.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
    const sunUp = clamp(sky.elev * 6 + 0.2, 0, 1) * (1 - storm * 0.9) * (1 - night);
    const inFrame = onScreen ? clamp(1.3 - Math.max(Math.abs(this._v.x), Math.abs(this._v.y)), 0, 0.3) / 0.3 : 0;
    // occlusion: is the sun pixel actually sky? (cheap check against buildings)
    let visible = 1;
    if (onScreen) {
      const p = cam.position;
      const t = g.world.raycast(p.x, p.y, p.z, p.x + sd.x * 400, p.y + sd.y * 400, p.z + sd.z * 400);
      visible = t < 1 ? 0 : 1;
    }
    this.sunVis = damp(this.sunVis, inFrame * sunUp * visible, 6, dt);
    u.uSunVis.value = this.sunVis;
    u.uShaft.value = lerp(0.5, 1.6, golden) * sunUp * inFrame;
    u.uFlare.value = (this.quality === 'ultra' ? 1 : 0.7) * lerp(0.6, 1.2, golden);
    this.cinema.mask.material.uniforms.uThreshold.value = lerp(0.9, 0.45, golden);

    // bloom: stronger once the neon is on
    this.bloom.strength = lerp(0.32, 0.55, night) + storm * 0.05;
    this.bloom.threshold = lerp(1.6, 1.3, night);
    this.bloom.radius = lerp(0.35, 0.5, night);
    u.uStreak.value = lerp(0.12, 0.85, night) * (1 + storm * 0.4);

    // grade: teal shadows and warm highlights, pushed harder at golden hour
    const st = u.uShadowTint.value, hi = u.uHighTint.value;
    st.setRGB(lerp(0.94, 0.82, golden), lerp(1.0, 0.95, golden), lerp(1.04, 1.14, golden));
    hi.setRGB(lerp(1.04, 1.14, golden), lerp(1.0, 0.97, golden), lerp(0.95, 0.84, golden));
    if (night > 0) {
      st.lerp(new THREE.Color(0.8, 0.92, 1.22), night);
      hi.lerp(new THREE.Color(1.12, 0.94, 1.08), night);
    }
    if (storm > 0) { st.lerp(new THREE.Color(0.9, 0.97, 1.08), storm); hi.lerp(new THREE.Color(0.97, 1.0, 1.04), storm); }
    u.uSat.value = lerp(1.08, 1.2, Math.max(golden, night * 0.8)) * lerp(1, 0.8, storm);
    u.uContrast.value = lerp(1.06, 1.12, Math.max(golden, night));
    u.uVignette.value = cine ? 0.55 : 0.38;
    u.uGrain.value = this.quality === 'ultra' ? 0.05 : 0.035;
    u.uCA.value = cine ? 0.004 : 0.0022;
    u.uFlash.value = wx ? wx.flash : 0;

    const p = g.player;
    const sp = p.inCar ? p.car.speed : 0;
    u.uSpeed.value = damp(u.uSpeed.value, clamp((sp - 24) / 30, 0, 1) * 0.8, 3, dt);
    u.uHurt.value = damp(u.uHurt.value, g.state === 'playing' ? clamp((35 - p.health) / 35, 0, 1) : 0, 3, dt);
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.game.renderer.render(this.game.scene, this.game.camera);
  }
}
