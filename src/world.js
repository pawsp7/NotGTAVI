import * as THREE from 'three';
import {
  N_BLOCKS, ROAD_W, PITCH, BLOCK_W, HALF, SIDEWALK, CURB_H, LANE, PARK_LANE,
  BEACH_X0, WATER_X, WORLD, roadPos, blockCenter, mulberry32, district, clamp,
} from './config.js';
import {
  roadTexture, intersectionTexture, sidewalkTexture, grassTexture, sandTexture, glowTexture, signTexture,
  puddleTexture, waterNormalTexture,
} from './textures.js';
import { mergeColored, box, cyl, wedgeGeometry, QuadBuilder } from './geom.js';

const CELL = 16;
const cellKey = (cx, cz) => (cx + 512) * 4096 + (cz + 512);

// Window-pattern facade shader injected into a PBR material. Facades are
// patterned from world position, so instanced boxes of any size get windows,
// and the glass panes reflect the live sky.
function makeFacadeMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uSkyTint = uniforms.uSkyTint;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aStyle;
         varying vec3 vWPos; varying vec3 vWNrm; varying float vStyle;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 wp4 = vec4(transformed, 1.0);
         vec3 wn = objectNormal;
         #ifdef USE_INSTANCING
           wp4 = instanceMatrix * wp4;
           wn = mat3(instanceMatrix) * wn;
         #endif
         wp4 = modelMatrix * wp4;
         vWPos = wp4.xyz;
         vWNrm = normalize(mat3(modelMatrix) * wn);
         vStyle = aStyle;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uNight; uniform vec3 uSkyTint;
         varying vec3 vWPos; varying vec3 vWNrm; varying float vStyle;
         float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float winLit = 0.0;
         float winTint = 0.0;
         float winGlass = 0.0;
         float winRnd = 0.0;
         float wallGloss = 0.0;
         float winBright = 1.0;
         {
           float wall = 1.0 - step(0.5, abs(vWNrm.y));
           vec2 tng = normalize(vec2(-vWNrm.z, vWNrm.x) + 1e-5);
           float u = dot(vWPos.xz, tng);
           float v = vWPos.y;
           float cw = 3.0, ch = 3.4, x0 = 0.2, x1 = 0.8, y0 = 0.3, y1 = 0.8, litP = 0.5, glassMix = 0.85;
           if (vStyle < 0.5) { cw = 2.6; ch = 3.0; x0 = 0.3; x1 = 0.7; y0 = 0.35; y1 = 0.75; litP = 0.62; }
           else if (vStyle < 1.5) { }
           else if (vStyle < 2.5) { cw = 2.0; ch = 3.4; x0 = 0.07; x1 = 0.93; y0 = 0.12; y1 = 0.92; litP = 0.55; glassMix = 0.92; }
           else { cw = 4.0; ch = 6.0; x0 = 0.1; x1 = 0.9; y0 = 0.72; y1 = 0.86; litP = 0.7; }
           vec2 cell = vec2(floor(u / cw), floor(v / ch));
           vec2 f = vec2(fract(u / cw), fract(v / ch));
           float win = step(x0, f.x) * step(f.x, x1) * step(y0, f.y) * step(f.y, y1);
           // storefront band on commercial ground floors
           if (vStyle > 0.5 && vStyle < 1.5 && v < 3.4) {
             float sf = fract(u / 6.0);
             win = step(0.06, sf) * step(sf, 0.94) * step(0.35, v) * step(v, 2.9);
             cell = vec2(floor(u / 6.0), -1.0);
             litP = 0.25;
           }
           win *= wall * step(0.4, v);
           vec2 nq = floor(vWNrm.xz + 1.5); // face id, kept well away from rounding edges
           float rnd = h21(cell + vec2(dot(nq, vec2(17.0, 31.0)), floor(vStyle + 0.5) * 7.0));
           float tint = h21(cell.yx + 3.7);
           vec3 glass = mix(vec3(0.30, 0.40, 0.50), uSkyTint, 0.25 + 0.2 * rnd);
           diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * glassMix);
           winLit = win * step(litP, rnd) * uNight;
           winTint = tint;
           winBright = 0.3 + 1.1 * h21(cell * 1.7 + vec2(2.3, nq.x * 5.0 + nq.y));
           winGlass = win * glassMix;
           winRnd = rnd;
           wallGloss = (vStyle > 1.5 && vStyle < 2.5) ? 1.0 : 0.0;
           // fake ambient occlusion at the base, darker roofs
           diffuseColor.rgb *= mix(0.72, 1.0, clamp(v / 3.0, 0.0, 1.0));
           diffuseColor.rgb *= 1.0 - 0.35 * step(0.5, vWNrm.y);
         }`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         roughnessFactor = mix(mix(roughnessFactor, 0.55, wallGloss), 0.17 + 0.14 * winRnd, winGlass);
         metalnessFactor = mix(metalnessFactor, 0.8, winGlass * (1.0 - winLit));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += mix(vec3(1.0, 0.7, 0.38), vec3(0.55, 0.75, 1.0), step(0.82, winTint)) * winLit * winBright * 1.25;`
      );
  };
  mat.customProgramCacheKey = () => 'facade-pbr-2';
  return mat;
}

// Asphalt / concrete that turns glossy with puddles when it rains.
function makeWetMaterial(map, uniforms, puddleTex, scale = 0.37) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = uniforms.uWet;
    shader.uniforms.tPuddle = { value: puddleTex };
    shader.uniforms.uPudScale = { value: scale };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWet; uniform sampler2D tPuddle; uniform float uPudScale;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float pud = texture2D(tPuddle, vMapUv * uPudScale).g;
        roughnessFactor = mix(roughnessFactor, mix(0.32, 0.1, pud), uWet);
        diffuseColor.rgb *= mix(1.0, mix(0.72, 0.42, pud), uWet);`);
  };
  mat.customProgramCacheKey = () => 'wet-street-1';
  return mat;
}

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.boxes = [];
    this.circles = [];
    this.grid = new Map();
    this.stamp = 1;
    this.ramps = [];
    this.parkingSpots = [];
    this.showroomSpots = [];
    this.pedBlocks = [];
    this.sprays = [];
    this.uniforms = { uNight: { value: 0 }, uSkyTint: { value: new THREE.Color(0.5, 0.6, 0.75) }, uTime: { value: 0 }, uWet: { value: 0 } };
    this.nightMaterials = []; // { mat, base:Color, boost }
    this.lightPools = null;
    this.places = {};
    // Ramps are defined up front so the lots under them stay empty.
    this.rampDefs = [
      { x: blockCenter(1), z: blockCenter(4) + 8, dx: 0, dz: -1, len: 10, wid: 6, h: 2.6 },
      { x: BEACH_X0 + 30, z: -120, dx: 0, dz: 1, len: 11, wid: 6, h: 3.0 },
      { x: BEACH_X0 + 34, z: 140, dx: 0, dz: -1, len: 11, wid: 6, h: 3.2 },
      { x: blockCenter(4), z: blockCenter(6) - 6, dx: 1, dz: 0, len: 10, wid: 6, h: 2.4 },
    ];
    this.sprayDefs = [
      { x: blockCenter(0), z: blockCenter(6) - BLOCK_W / 2 + 10, face: -1 },
      { x: blockCenter(5), z: blockCenter(0) + BLOCK_W / 2 - 10, face: 1 },
    ];
    // Landmark buildings with fixed footprints.
    this.specials = [
      { name: 'diner', x: blockCenter(6) + 19.33, z: blockCenter(5) + 19.33, sx: 15, sy: 5, sz: 14, color: '#2ec4b6', style: 1 },
      { name: 'hospital', x: blockCenter(2), z: blockCenter(2) + 18.5, sx: 40, sy: 16, sz: 17, color: '#eef3f5', style: 1 },
      { name: 'precinct', x: blockCenter(5) - 14, z: blockCenter(5), sx: 18, sy: 12, sz: 36, color: '#c8d1dc', style: 1 },
    ];
    this.reserved = [
      ...this.specials.map((b) => [b.x - b.sx / 2 - 1, b.z - b.sz / 2 - 1, b.x + b.sx / 2 + 1, b.z + b.sz / 2 + 1]),
      ...this.sprayDefs.map((d) => [d.x - 6, d.z - 7.5, d.x + 6, d.z + 7.5]),
      ...this.rampDefs.map((r) => [r.x - 8, r.z - 8, r.x + 8, r.z + 8]),
    ];
  }

  _isReserved(x0, z0, x1, z1) {
    for (const r of this.reserved) if (x0 < r[2] && x1 > r[0] && z0 < r[3] && z1 > r[1]) return true;
    return false;
  }

  // ---------- collision structures ----------
  _cellsFor(x0, z0, x1, z1, fn) {
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) fn(cellKey(cx, cz));
  }
  _bucket(k) {
    let b = this.grid.get(k);
    if (!b) { b = { boxes: [], circles: [] }; this.grid.set(k, b); }
    return b;
  }
  addBox(x0, z0, x1, z1, h) {
    const b = { x0, z0, x1, z1, h, s: 0 };
    this.boxes.push(b);
    this._cellsFor(x0, z0, x1, z1, (k) => this._bucket(k).boxes.push(b));
    return b;
  }
  addCircle(x, z, r) {
    const c = { x, z, r, s: 0 };
    this.circles.push(c);
    this._cellsFor(x - r, z - r, x + r, z + r, (k) => this._bucket(k).circles.push(c));
    return c;
  }
  // Calls fnBox / fnCircle for every collider overlapping the given rectangle, once each.
  query(x0, z0, x1, z1, fnBox, fnCircle) {
    const s = ++this.stamp;
    this._cellsFor(x0, z0, x1, z1, (k) => {
      const b = this.grid.get(k);
      if (!b) return;
      if (fnBox) for (const o of b.boxes) if (o.s !== s) { o.s = s; fnBox(o); }
      if (fnCircle) for (const o of b.circles) if (o.s !== s) { o.s = s; fnCircle(o); }
    });
  }

  // Push a circle (x,z,r) out of static geometry. Returns {x,z,nx,nz,hit} with the last contact normal.
  resolveCircle(x, z, r, out) {
    out.hit = false; out.nx = 0; out.nz = 0;
    for (let iter = 0; iter < 2; iter++) {
      this.query(x - r, z - r, x + r, z + r,
        (b) => {
          const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
          let dx = x - cx, dz = z - cz;
          let d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          if (d2 < 1e-8) {
            // centre inside the box: push out along the shallowest axis
            const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bb = b.z1 - z;
            const m = Math.min(l, rr, t, bb);
            if (m === l) { dx = -1; dz = 0; x = b.x0 - r; }
            else if (m === rr) { dx = 1; dz = 0; x = b.x1 + r; }
            else if (m === t) { dx = 0; dz = -1; z = b.z0 - r; }
            else { dx = 0; dz = 1; z = b.z1 + r; }
            out.nx = dx; out.nz = dz; out.hit = true;
            return;
          }
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          x += nx * (r - d); z += nz * (r - d);
          out.nx = nx; out.nz = nz; out.hit = true;
        },
        (c) => {
          const dx = x - c.x, dz = z - c.z;
          const rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-8) return;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          x += nx * (rr - d); z += nz * (rr - d);
          out.nx = nx; out.nz = nz; out.hit = true;
        });
    }
    // world bounds
    if (x < WORLD.minX + r) { x = WORLD.minX + r; out.nx = 1; out.nz = 0; out.hit = true; }
    if (x > WORLD.maxX - r) { x = WORLD.maxX - r; out.nx = -1; out.nz = 0; out.hit = true; }
    if (z < WORLD.minZ + r) { z = WORLD.minZ + r; out.nx = 0; out.nz = 1; out.hit = true; }
    if (z > WORLD.maxZ - r) { z = WORLD.maxZ - r; out.nx = 0; out.nz = -1; out.hit = true; }
    out.x = x; out.z = z;
    return out;
  }

  // 3D segment vs building boxes. Returns fraction t of first hit (1 if none).
  raycast(ax, ay, az, bx, by, bz) {
    let best = 1;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    this.query(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, (b) => {
      let tmin = 0, tmax = best;
      const axes = [[ax, dx, b.x0, b.x1], [ay, dy, 0, b.h], [az, dz, b.z0, b.z1]];
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) return;
        } else {
          let t1 = (lo - o) / d, t2 = (hi - o) / d;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return;
        }
      }
      if (tmin < best) best = tmin;
    });
    return best;
  }

  lineOfSight(ax, az, bx, bz) {
    return this.raycast(ax, 1.5, az, bx, 1.5, bz) >= 0.999;
  }

  rampAt(x, z) {
    for (const r of this.ramps) {
      const lx = x - r.x, lz = z - r.z;
      const s = lx * r.dx + lz * r.dz + r.len / 2;
      const lat = -lx * r.dz + lz * r.dx;
      if (s >= 0 && s <= r.len && Math.abs(lat) <= r.wid / 2) return r;
    }
    return null;
  }

  groundHeight(x, z) {
    for (const r of this.ramps) {
      const lx = x - r.x, lz = z - r.z;
      const s = lx * r.dx + lz * r.dz + r.len / 2; // 0 at low end
      const lat = -lx * r.dz + lz * r.dx;
      if (s >= 0 && s <= r.len && Math.abs(lat) <= r.wid / 2) return r.base + (s / r.len) * r.h;
    }
    if (x > -HALF && x < HALF && z > -HALF && z < HALF) {
      const lx = (x + HALF) % PITCH, lz = (z + HALF) % PITCH;
      const e = ROAD_W / 2;
      if (lx > e && lx < PITCH - e && lz > e && lz < PITCH - e) return CURB_H;
    }
    return 0;
  }

  inWater(x) { return x > WATER_X + 1.5; }

  isRoad(x, z) {
    if (x < -HALF - ROAD_W / 2 || x > HALF + ROAD_W / 2 || z < -HALF - ROAD_W / 2 || z > HALF + ROAD_W / 2) return false;
    const lx = (((x + HALF) % PITCH) + PITCH) % PITCH, lz = (((z + HALF) % PITCH) + PITCH) % PITCH;
    const e = ROAD_W / 2;
    return lx <= e || lx >= PITCH - e || lz <= e || lz >= PITCH - e;
  }

  // ---------- build ----------
  build(renderer) {
    const rng = mulberry32(20261118);
    this.rng = rng;
    const scene = this.scene;

    // base ground (outskirts)
    const grassTex = grassTexture(renderer);
    const groundTex = grassTex.clone();
    groundTex.needsUpdate = true;
    groundTex.repeat.set(220, 220);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshLambertMaterial({ map: groundTex, color: 0xb8c79a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-200, -0.02, 0);
    ground.receiveShadow = true;
    scene.add(ground);

    this._buildRoads(renderer);
    this._buildBlocks(renderer, rng, grassTex);
    this._buildBeach(renderer, rng);
    this._buildStreetLights(rng);
    this._buildRamps();
    this._buildLandmarks(rng);
    this._buildMapCanvas();

    // Places used by game systems.
    const [dn] = this.specials;
    this.places.hospital = { name: 'Solana General', x: blockCenter(2), z: blockCenter(2) + BLOCK_W / 2 - 2, heading: 0 };
    this.places.precinct = { name: 'SPD Precinct 4', x: blockCenter(5) - BLOCK_W / 2 + 2, z: blockCenter(5), heading: -Math.PI / 2 };
    this.places.diner = { name: 'Moonwake Diner', x: blockCenter(6) + BLOCK_W / 2 - 2, z: dn.z };
    this.places.start = { x: blockCenter(6) + BLOCK_W / 2 - 2, z: dn.z - 10, heading: Math.PI / 2 };
  }

  _buildRoads(renderer) {
    const roadTex = roadTexture(renderer);
    const interTex = intersectionTexture(renderer);
    this.puddles = puddleTexture();
    const qb = new QuadBuilder();
    const qi = new QuadBuilder();
    const e = ROAD_W / 2;
    for (let k = 0; k <= N_BLOCKS; k++) {
      const c = roadPos(k);
      for (let m = 0; m < N_BLOCKS; m++) {
        const a = roadPos(m) + e, b = roadPos(m + 1) - e;
        // road along x at z = c
        qb.rect(a, c - e, b, c + e, 0.02, (x, z) => [(z - (c - e)) / ROAD_W, x / ROAD_W]);
        // road along z at x = c
        qb.rect(c - e, a, c + e, b, 0.02, (x, z) => [(x - (c - e)) / ROAD_W, z / ROAD_W]);
      }
      for (let m = 0; m <= N_BLOCKS; m++) {
        const z = roadPos(m);
        qi.rect(c - e, z - e, c + e, z + e, 0.021, (x, zz) => [(x - (c - e)) / ROAD_W, (zz - (z - e)) / ROAD_W]);
      }
    }
    const roads = new THREE.Mesh(qb.build(), makeWetMaterial(roadTex, this.uniforms, this.puddles, 0.37));
    roads.receiveShadow = true;
    this.scene.add(roads);
    const inters = new THREE.Mesh(qi.build(), makeWetMaterial(interTex, this.uniforms, this.puddles, 0.7));
    inters.receiveShadow = true;
    this.scene.add(inters);

    // Intersection nodes for AI.
    this.nodes = [];
    for (let i = 0; i <= N_BLOCKS; i++) for (let j = 0; j <= N_BLOCKS; j++) this.nodes.push({ i, j, x: roadPos(i), z: roadPos(j) });
  }

  _buildBlocks(renderer, rng, grassTex) {
    const scene = this.scene;
    const swTex = sidewalkTexture(renderer);
    swTex.repeat.set(BLOCK_W / 4, BLOCK_W / 4);
    const plates = new THREE.InstancedMesh(box(BLOCK_W, CURB_H, BLOCK_W), makeWetMaterial(swTex, this.uniforms, this.puddles, 0.21), N_BLOCKS * N_BLOCKS);
    plates.receiveShadow = true;
    const inner = BLOCK_W - SIDEWALK * 2;
    const lawnTex = grassTex.clone();
    lawnTex.needsUpdate = true;
    lawnTex.repeat.set(inner / 5, inner / 5);
    const lawns = new THREE.InstancedMesh(new THREE.PlaneGeometry(inner, inner), new THREE.MeshLambertMaterial({ map: lawnTex }), N_BLOCKS * N_BLOCKS);
    lawns.receiveShadow = true;
    let lawnCount = 0;

    const B = []; // buildings: {x,z,sx,sy,sz,color,style}
    const roofs = []; // pitched roofs
    const props = []; // rooftop units etc. {x,y,z,sx,sy,sz,color}
    const neon = []; // emissive strips {x,y,z,sx,sy,sz,color}
    const awnings = [];
    this.palmSpots = [];
    const m4 = new THREE.Matrix4();
    const pal = {
      downtown: ['#7fa8c9', '#9bb7c4', '#5d7f9e', '#c9d6df', '#8a9bb0', '#d8c3a5', '#6c8f8a'],
      ocean: ['#f7c6d0', '#a8e6cf', '#ffd3b6', '#d4c1ec', '#fff1a8', '#9ad7e8', '#ffb3c7'],
      midtown: ['#e8d5b7', '#d9a679', '#c97b63', '#f0e2c8', '#b8c4a0', '#e3b7a0', '#9fb8c8'],
      residential: ['#f6e3c5', '#cfe8e0', '#f3cdbf', '#e5dff5', '#fff4d6', '#d6ecf5', '#f5d0d8'],
      docks: ['#8d8173', '#6f7c85', '#a4573e', '#7c8c6e', '#9a8f7a'],
      neon: ['#ff4fa3', '#33e6ff', '#b45cff', '#ffd23f', '#5cff9d'],
      roof: ['#b5523b', '#6b7f99', '#8a5a44', '#4f6b5a', '#c0853f'],
    };
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const addBuilding = (x, z, sx, sy, sz, color, style, force = false) => {
      if (!force && this._isReserved(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2)) return false;
      B.push({ x, z, sx, sy, sz, color, style });
      this.addBox(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, sy);
      return true;
    };
    for (const sp of this.specials) addBuilding(sp.x, sp.z, sp.sx, sp.sy, sp.sz, sp.color, sp.style, true);
    const dinerSp = this.specials[0];
    neon.push({ x: dinerSp.x, y: dinerSp.sy + 0.3, z: dinerSp.z, sx: dinerSp.sx + 0.3, sy: 0.35, sz: dinerSp.sz + 0.3, color: '#ff4fa3' });

    let idx = 0;
    for (let i = 0; i < N_BLOCKS; i++) {
      for (let j = 0; j < N_BLOCKS; j++) {
        const cx = blockCenter(i), cz = blockCenter(j);
        const d = district(i, j);
        m4.makeTranslation(cx, CURB_H / 2, cz);
        plates.setMatrixAt(idx++, m4);
        this.pedBlocks.push({ i, j, cx, cz });
        const x0 = cx - inner / 2, z0 = cz - inner / 2;
        const lawn = () => {
          m4.makeRotationX(-Math.PI / 2).setPosition(cx, CURB_H + 0.012, cz);
          lawns.setMatrixAt(lawnCount++, m4);
        };

        if (d === 'downtown') {
          const n = 2, lot = inner / n;
          for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
            const lx = x0 + lot * (a + 0.5), lz = z0 + lot * (b + 0.5);
            const fw = lot - 3 - rng() * 2, fd = lot - 3 - rng() * 2;
            const h = 38 + rng() * 70;
            const col = pick(pal.downtown);
            if (!addBuilding(lx, lz, fw, h, fd, col, 2)) continue;
            if (rng() < 0.6) {
              const h2 = 10 + rng() * 30;
              B.push({ x: lx, z: lz, sx: fw * 0.65, sy: h + h2, sz: fd * 0.65, color: col, style: 2 });
              if (rng() < 0.5) neon.push({ x: lx, y: h + h2 + 0.6, z: lz, sx: fw * 0.66, sy: 0.5, sz: fd * 0.66, color: pick(pal.neon) });
            }
            for (let p = 0; p < 2; p++) props.push({ x: lx + (rng() - 0.5) * fw * 0.5, y: h, z: lz + (rng() - 0.5) * fd * 0.5, sx: 3, sy: 1.6, sz: 2.5, color: '#9aa1a8' });
            if (rng() < 0.35) {
              // neon corner stripes
              const c = pick(pal.neon);
              for (const [sx, sz] of [[-1, -1], [1, 1]]) neon.push({ x: lx + sx * (fw / 2 + 0.1), y: h / 2, z: lz + sz * (fd / 2 + 0.1), sx: 0.35, sy: h * 0.96, sz: 0.35, color: c });
            }
          }
        } else if (d === 'ocean') {
          const n = 3, lot = inner / n;
          for (let b = 0; b < n; b++) {
            const lz = z0 + lot * (b + 0.5);
            const fw = inner - 8 - rng() * 6, fd = lot - 3;
            const h = 12 + rng() * 16;
            const col = pick(pal.ocean);
            const lx = cx - 2;
            if (!addBuilding(lx, lz, fw, h, fd, col, 1)) continue;
            const nc = pick(pal.neon);
            neon.push({ x: lx + fw / 2 + 0.15, y: h - 0.6, z: lz, sx: 0.3, sy: 0.45, sz: fd * 0.95, color: nc });
            neon.push({ x: lx + fw / 2 + 0.15, y: 3.6, z: lz, sx: 0.3, sy: 0.3, sz: fd * 0.9, color: nc });
            neon.push({ x: lx - fw / 2 - 0.15, y: h - 0.6, z: lz, sx: 0.3, sy: 0.45, sz: fd * 0.95, color: nc });
            awnings.push({ x: lx + fw / 2 + 1.2, y: 3.1, z: lz, sx: 2.4, sy: 0.25, sz: fd * 0.8, color: pick(pal.ocean) });
            props.push({ x: lx, y: h, z: lz, sx: 4, sy: 2.2, sz: 3, color: '#c8c2b6' });
          }
        } else if (d === 'midtown') {
          const n = 3, lot = inner / n;
          for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
            if (a === 1 && b === 1) { // courtyard / parking in the middle
              if (rng() < 0.5) this.palmSpots.push([x0 + lot * 1.5, z0 + lot * 1.5]);
              continue;
            }
            const lx = x0 + lot * (a + 0.5), lz = z0 + lot * (b + 0.5);
            const fw = lot - 2 - rng() * 2, fd = lot - 2 - rng() * 2;
            const h = 7 + rng() * 18;
            const col = pick(pal.midtown);
            if (!addBuilding(lx, lz, fw, h, fd, col, 1)) continue;
            if (rng() < 0.5) props.push({ x: lx, y: h, z: lz, sx: 2.5, sy: 1.4, sz: 2.5, color: '#a39d93' });
            // awning on a street-facing side
            const sides = [];
            if (a === 0) sides.push([-1, 0]);
            if (a === n - 1) sides.push([1, 0]);
            if (b === 0) sides.push([0, -1]);
            if (b === n - 1) sides.push([0, 1]);
            if (sides.length && rng() < 0.7) {
              const [sx, sz] = sides[Math.floor(rng() * sides.length)];
              const ac = pick(['#2a9d8f', '#e76f51', '#e9c46a', '#264653', '#d62d6f', '#3a86ff']);
              if (sx) awnings.push({ x: lx + sx * (fw / 2 + 0.9), y: 3.0, z: lz, sx: 1.8, sy: 0.2, sz: fd * 0.8, color: ac });
              else awnings.push({ x: lx, y: 3.0, z: lz + sz * (fd / 2 + 0.9), sx: fw * 0.8, sy: 0.2, sz: 1.8, color: ac });
            }
          }
        } else if (d === 'residential') {
          lawn();
          const n = 4, lot = inner / n;
          for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
            const lx = x0 + lot * (a + 0.5), lz = z0 + lot * (b + 0.5);
            const edge = a === 0 || b === 0 || a === n - 1 || b === n - 1;
            if (!edge || rng() < 0.15) {
              if (rng() < 0.6) this.palmSpots.push([lx + (rng() - 0.5) * 4, lz + (rng() - 0.5) * 4]);
              continue;
            }
            const fw = 8 + rng() * 2, fd = 8 + rng() * 2;
            const h = 3.6 + (rng() < 0.4 ? 3.0 : 0);
            const col = pick(pal.residential);
            if (!addBuilding(lx, lz, fw, h, fd, col, 0)) continue;
            roofs.push({ x: lx, y: h, z: lz, sx: fw + 0.8, sy: 2.2, sz: fd + 0.8, color: pick(pal.roof), rot: rng() < 0.5 ? 0 : Math.PI / 2 });
          }
        } else if (d === 'docks') {
          const lot = inner / 2;
          for (let a = 0; a < 2; a++) {
            const lx = x0 + lot * (a + 0.5);
            if (rng() < 0.3) {
              // container yard
              for (let k = 0; k < 6; k++) {
                const kx = lx + (k % 2 - 0.5) * 9, kz = z0 + 8 + Math.floor(k / 2) * 18;
                const stack = 1 + Math.floor(rng() * 3);
                const col = pick(['#c0392b', '#2471a3', '#d68910', '#1e8449', '#7d3c98', '#5d6d7e']);
                addBuilding(kx, kz, 2.5, 2.6 * stack, 12, col, 3);
              }
              continue;
            }
            const fw = lot - 4, fd = inner - 6 - rng() * 8;
            const h = 8 + rng() * 5;
            if (!addBuilding(lx, cz, fw, h, fd, pick(pal.docks), 3)) continue;
            roofs.push({ x: lx, y: h, z: cz, sx: fw + 0.4, sy: 2.4, sz: fd + 0.4, color: '#7b8187', rot: 0 });
          }
        } else if (d === 'park') {
          lawn();
          for (let k = 0; k < 14; k++) {
            const px = x0 + 4 + rng() * (inner - 8), pz = z0 + 4 + rng() * (inner - 8);
            if (!this._isReserved(px - 1, pz - 1, px + 1, pz + 1)) this.palmSpots.push([px, pz]);
          }
        } else if (d === 'showroom') {
          // Glass showroom on the north half, display lot on the south half.
          const sx = inner - 6, sz = inner / 2 - 4;
          addBuilding(cx, z0 + sz / 2 + 2, sx, 8, sz, '#d9e4ea', 2);
          neon.push({ x: cx, y: 8.4, z: z0 + sz + 2.2, sx: sx, sy: 0.5, sz: 0.3, color: '#ffd23f' });
          for (let k = 0; k < 4; k++) this.showroomSpots.push({ x: x0 + 9 + k * 13, z: cz + 12, heading: Math.PI });
          this.showroomSign = { x: cx, y: 11, z: z0 + sz + 2.5 };
        }

        // Palms on the corners of sidewalks in hotel / midtown blocks
        if (d === 'ocean') {
          for (let k = 0; k < 6; k++) this.palmSpots.push([cx + BLOCK_W / 2 - 1.5, cz - BLOCK_W / 2 + 6 + k * 10.8]);
        }
      }
    }
    plates.count = idx;
    lawns.count = lawnCount;
    scene.add(plates);
    if (lawnCount) scene.add(lawns);

    // Special buildings: hospital (2,2) and precinct (5,5) get signs.
    const [dn, hs, pc] = this.specials;
    this._signs = [
      { text: 'SOLANA GENERAL', bg: '#f4f7f8', fg: '#d6293e', x: hs.x, y: 10, z: hs.z + hs.sz / 2 + 0.25, ry: 0, w: 14, h: 2.8 },
      { text: 'SPD · PRECINCT 4', bg: '#14213d', fg: '#e5e5e5', x: pc.x - pc.sx / 2 - 0.25, y: 8, z: pc.z, ry: -Math.PI / 2, w: 12, h: 2.4 },
      { text: 'MOONWAKE DINER', bg: '#1b1035', fg: '#ff4fa3', x: dn.x + dn.sx / 2 + 0.25, y: 4.2, z: dn.z, ry: Math.PI / 2, w: 11, h: 2.2 },
    ];

    // Instanced buildings with facade shader.
    const bgeo = box(1, 1, 1);
    bgeo.translate(0, 0.5, 0);
    const style = new Float32Array(B.length);
    const bmesh = new THREE.InstancedMesh(bgeo, makeFacadeMaterial(this.uniforms), B.length);
    const col = new THREE.Color();
    B.forEach((b, k) => {
      m4.makeScale(b.sx, b.sy, b.sz).setPosition(b.x, CURB_H, b.z);
      bmesh.setMatrixAt(k, m4);
      bmesh.setColorAt(k, col.set(b.color));
      style[k] = b.style;
    });
    bgeo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 1));
    bmesh.castShadow = true;
    bmesh.receiveShadow = true;
    bmesh.frustumCulled = false;
    scene.add(bmesh);
    this.buildings = B;

    // Pitched roofs (triangular prisms).
    const prism = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1);
    prism.rotateZ(Math.PI / 2);
    prism.rotateX(Math.PI / 6 + Math.PI); // ridge up
    prism.translate(0, 0.25, 0);
    prism.scale(1, 2, 1.16);
    const rmesh = new THREE.InstancedMesh(prism, new THREE.MeshLambertMaterial(), Math.max(1, roofs.length));
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    roofs.forEach((r, k) => {
      q.setFromAxisAngle(yAxis, r.rot);
      const along = r.rot ? [r.sz, r.sx] : [r.sx, r.sz];
      m4.compose(new THREE.Vector3(r.x, CURB_H + r.y, r.z), q, new THREE.Vector3(along[0], r.sy / 2, along[1]));
      rmesh.setMatrixAt(k, m4);
      rmesh.setColorAt(k, col.set(r.color));
    });
    rmesh.count = roofs.length;
    rmesh.castShadow = true;
    rmesh.frustumCulled = false;
    scene.add(rmesh);

    const simpleInstanced = (list, material, shadow = true) => {
      if (!list.length) return null;
      const g = box(1, 1, 1);
      const mesh = new THREE.InstancedMesh(g, material, list.length);
      list.forEach((p, k) => {
        m4.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, CURB_H + p.y + (material.isMeshBasicMaterial ? 0 : p.sy / 2), p.z);
        mesh.setMatrixAt(k, m4);
        mesh.setColorAt(k, col.set(p.color));
      });
      mesh.castShadow = shadow;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    };
    simpleInstanced(props, new THREE.MeshLambertMaterial());
    simpleInstanced(awnings, new THREE.MeshLambertMaterial());
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    simpleInstanced(neon, neonMat, false);
    this.nightMaterials.push({ mat: neonMat, day: 0.8, night: 4.2 });

    // Parking spots along roads (both kerbs), skipping intersections.
    for (let k = 0; k <= N_BLOCKS; k++) {
      const c = roadPos(k);
      for (let m = 0; m < N_BLOCKS; m++) {
        const a = roadPos(m) + ROAD_W / 2 + 8, b = roadPos(m + 1) - ROAD_W / 2 - 8;
        for (let s = a; s <= b; s += 10) {
          if (rng() < 0.32) this.parkingSpots.push({ x: s, z: c + PARK_LANE, heading: Math.PI / 2 });
          if (rng() < 0.32) this.parkingSpots.push({ x: s, z: c - PARK_LANE, heading: -Math.PI / 2 });
          if (k < N_BLOCKS) { // coast road east kerb is the beach: keep only west
            if (rng() < 0.32) this.parkingSpots.push({ x: c - PARK_LANE, z: s, heading: 0 });
          } else if (rng() < 0.2) this.parkingSpots.push({ x: c - PARK_LANE, z: s, heading: 0 });
          if (rng() < 0.32) this.parkingSpots.push({ x: c + PARK_LANE, z: s, heading: Math.PI });
        }
      }
    }

    this._buildPalms();
  }

  _buildPalms() {
    const parts = [];
    // curved trunk from stacked tapered segments
    const segs = 6;
    let x = 0, y = 0;
    for (let s = 0; s < segs; s++) {
      const h = 1.25;
      const r0 = 0.28 - s * 0.025, r1 = 0.28 - (s + 1) * 0.025;
      parts.push({ geo: cyl(r1, r0, h, 7), color: s % 2 ? '#8b6b4a' : '#7a5c3e', pos: [x, y + h / 2, 0], rot: [0, 0, -0.05 * s] });
      x += Math.sin(0.05 * s) * h * 0.9;
      y += h * 0.98;
    }
    const top = [x, y, 0];
    parts.push({ geo: new THREE.SphereGeometry(0.42, 7, 5), color: '#6b4e2e', pos: top });
    for (let f = 0; f < 8; f++) {
      const a = (f / 8) * Math.PI * 2;
      const leaf = box(0.9, 0.06, 3.4);
      leaf.translate(0, 0, 1.7);
      parts.push({ geo: leaf, color: f % 2 ? '#2f7d3a' : '#3d9446', pos: top, rot: [0.55, a, 0] });
      const tip = box(0.6, 0.05, 1.6);
      tip.translate(0, 0, 0.8);
      const ox = Math.sin(a) * 2.9, oz = Math.cos(a) * 2.9;
      parts.push({ geo: tip, color: '#2a6f33', pos: [top[0] + ox, top[1] - 1.75, top[2] + oz], rot: [1.15, a, 0] });
    }
    const geo = mergeColored(parts);
    const list = this.palmSpots;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const rng = this.rng;
    list.forEach(([px, pz], k) => {
      const s = 0.85 + rng() * 0.5;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      m4.compose(new THREE.Vector3(px, this.groundHeight(px, pz), pz), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(k, m4);
      this.addCircle(px, pz, 0.4 * s);
    });
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  _buildBeach(renderer, rng) {
    const scene = this.scene;
    const sTex = sandTexture(renderer);
    const w = WATER_X - BEACH_X0 + 80;
    sTex.repeat.set(w / 6, 900 / 6);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(w, 900), new THREE.MeshLambertMaterial({ map: sTex }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(BEACH_X0 + w / 2, 0.005, 0);
    sand.receiveShadow = true;
    scene.add(sand);

    // Ocean
    const waterGeo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
    const wn = waterNormalTexture();
    wn.repeat.set(90, 90);
    const water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshStandardMaterial({ color: 0x0c5368, roughness: 0.1, metalness: 0, normalMap: wn, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.15 })
    );
    this.waterNormal = wn;
    water.rotation.x = -Math.PI / 2;
    water.position.set(WATER_X + 700, 0.06, 0);
    scene.add(water);
    this.water = water;

    // Shallow-water band and animated surf line
    const shallow = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 900),
      new THREE.MeshBasicMaterial({ color: 0x7fe0d6, transparent: true, opacity: 0.55, depthWrite: false })
    );
    shallow.rotation.x = -Math.PI / 2;
    shallow.position.set(WATER_X + 7, 0.075, 0);
    scene.add(shallow);
    const surf = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 900),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false })
    );
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(WATER_X, 0.08, 0);
    scene.add(surf);
    this.surf = surf;

    // Beach umbrellas and towels
    const parts = [
      { geo: cyl(0.04, 0.04, 2.4, 5), color: '#eeeeee', pos: [0, 1.2, 0] },
      { geo: new THREE.ConeGeometry(1.6, 0.6, 8), color: '#ffffff', pos: [0, 2.5, 0] },
    ];
    const ugeo = mergeColored(parts);
    const count = 40;
    const umb = new THREE.InstancedMesh(ugeo, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
    const towels = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshLambertMaterial(), count);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const ucols = ['#ff5d73', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff'];
    for (let k = 0; k < count; k++) {
      const x = BEACH_X0 + 30 + rng() * (WATER_X - BEACH_X0 - 40);
      const z = -300 + rng() * 600;
      m4.makeTranslation(x, 0, z);
      umb.setMatrixAt(k, m4);
      umb.setColorAt(k, col.set(ucols[k % ucols.length]));
      m4.makeRotationX(-Math.PI / 2).setPosition(x + 1.3, 0.03, z + 0.5);
      towels.setMatrixAt(k, m4);
      towels.setColorAt(k, col.set(ucols[(k + 2) % ucols.length]));
      this.addCircle(x, z, 0.15);
    }
    umb.castShadow = true;
    umb.frustumCulled = false;
    towels.frustumCulled = false;
    scene.add(umb, towels);

    // Palms along the beach boulevard, on the sand and in the outskirts (second batch).
    const extra = [];
    for (let z = -HALF + 4; z < HALF; z += 13) extra.push([BEACH_X0 + 3, z]);
    for (let k = 0; k < 30; k++) {
      const px = BEACH_X0 + 20 + rng() * 40, pz = -330 + rng() * 660;
      if (!this._isReserved(px - 1, pz - 1, px + 1, pz + 1)) extra.push([px, pz]);
    }
    // outskirts palms
    for (let k = 0; k < 60; k++) {
      const side = k % 3;
      const x = side === 0 ? -HALF - 15 - rng() * 35 : -HALF + rng() * (2 * HALF);
      const z = side === 0 ? -HALF + rng() * 2 * HALF : (side === 1 ? -HALF - 15 - rng() * 35 : HALF + 15 + rng() * 35);
      extra.push([x, z]);
    }
    this.palmSpots = extra;
    this._buildPalms();

    // Lifeguard towers
    const lgParts = [
      ...[[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]].map(([x, z]) => ({ geo: box(0.15, 2.4, 0.15), color: '#f2f2f2', pos: [x, 1.2, z] })),
      { geo: box(2.4, 0.2, 2.4), color: '#f2f2f2', pos: [0, 2.45, 0] },
      { geo: box(2.0, 1.6, 2.0), color: '#ff4f5e', pos: [0, 3.35, 0] },
      { geo: box(2.5, 0.15, 2.5), color: '#f2f2f2', pos: [0, 4.2, 0] },
      { geo: box(1.8, 0.7, 0.05), color: '#3f6f8f', pos: [0, 3.5, 1.01] },
    ];
    const lgGeo = mergeColored(lgParts);
    const lgMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const z of [-220, -40, 150, 280]) {
      const t = new THREE.Mesh(lgGeo, lgMat);
      t.position.set(WATER_X - 22, 0, z);
      t.rotation.y = Math.PI / 2;
      t.castShadow = true;
      scene.add(t);
      this.addBox(WATER_X - 23.3, z - 1.3, WATER_X - 20.7, z + 1.3, 4.3);
    }
  }

  _buildStreetLights(rng) {
    const spots = [];
    const e = ROAD_W / 2 + 0.8;
    for (let i = 0; i <= N_BLOCKS; i++) for (let j = 0; j <= N_BLOCKS; j++) {
      const x = roadPos(i), z = roadPos(j);
      spots.push([x + e, z + e, Math.PI * 0.75]);
      spots.push([x - e, z - e, -Math.PI * 0.25]);
    }
    // mid-block lamps
    for (let k = 0; k <= N_BLOCKS; k++) for (let m = 0; m < N_BLOCKS; m++) {
      const c = roadPos(k), mid = blockCenter(m);
      spots.push([mid, c - e, 0]);
      spots.push([c + e, mid, Math.PI / 2]);
    }
    const valid = spots.filter(([x, z]) => x < BEACH_X0 + 2 && x > -HALF - 8 && z > -HALF - 8 && z < HALF + 8);
    const poleGeo = mergeColored([
      { geo: cyl(0.09, 0.13, 7, 6), color: '#3c4047', pos: [0, 3.5, 0] },
      { geo: box(0.12, 0.12, 2.2), color: '#3c4047', pos: [0, 6.9, 1.0] },
      { geo: box(0.5, 0.18, 0.8), color: '#2b2e33', pos: [0, 6.85, 2.0] },
    ]);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), valid.length);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
    const heads = new THREE.InstancedMesh(box(0.42, 0.06, 0.7), headMat, valid.length);
    const pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffc77a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      valid.length
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    valid.forEach(([x, z, a], k) => {
      // face the arm toward the road
      const ry = this._armToward(x, z);
      q.setFromAxisAngle(up, ry);
      m4.compose(new THREE.Vector3(x, CURB_H, z), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(k, m4);
      const hx = x + Math.sin(ry) * 2.0, hz = z + Math.cos(ry) * 2.0;
      m4.compose(new THREE.Vector3(hx, CURB_H + 6.74, hz), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(k, m4);
      m4.makeRotationX(-Math.PI / 2).setPosition(hx, 0.05, hz);
      pools.setMatrixAt(k, m4);
      this.addCircle(x, z, 0.16);
    });
    poles.castShadow = true;
    for (const m of [poles, heads, pools]) { m.frustumCulled = false; this.scene.add(m); }
    this.lightPools = pools;
    this.nightMaterials.push({ mat: headMat, day: 0.5, night: 7 });
  }

  _armToward(x, z) {
    // direction from the lamp toward the nearest road centre line
    const kx = Math.round((x + HALF) / PITCH), kz = Math.round((z + HALF) / PITCH);
    const rx = roadPos(kx), rz = roadPos(kz);
    if (Math.abs(x - rx) < Math.abs(z - rz)) return x > rx ? -Math.PI / 2 : Math.PI / 2;
    return z > rz ? Math.PI : 0;
  }

  _buildRamps() {
    const list = this.rampDefs;
    const mat = new THREE.MeshLambertMaterial({ color: 0xf2b134 });
    const stripe = new THREE.MeshLambertMaterial({ color: 0x23262b });
    for (const r of list) {
      const base = r.x > HALF ? 0 : CURB_H;
      r.base = base;
      const g = new THREE.Group();
      const wedge = new THREE.Mesh(wedgeGeometry(r.wid, r.len, r.h), mat);
      wedge.castShadow = wedge.receiveShadow = true;
      g.add(wedge);
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(wedgeGeometry(0.4, r.len, r.h + 0.02), stripe);
        s.position.x = sx * (r.wid / 2 - 0.4);
        g.add(s);
      }
      g.position.set(r.x, base, r.z);
      g.rotation.y = Math.atan2(r.dx, r.dz);
      this.scene.add(g);
      this.ramps.push(r);
    }
  }

  _buildLandmarks(rng) {
    const scene = this.scene;
    // Lighthouse at the north end of the beach
    const lhParts = [];
    for (let s = 0; s < 6; s++) {
      lhParts.push({ geo: cyl(2.2 - s * 0.22, 2.4 - s * 0.22, 4, 14), color: s % 2 ? '#d93a3a' : '#f5f5f0', pos: [0, 2 + s * 4, 0] });
    }
    lhParts.push({ geo: cyl(1.5, 1.5, 0.4, 14), color: '#2c2c2c', pos: [0, 24.2, 0] });
    lhParts.push({ geo: cyl(1.1, 1.1, 2.4, 10), color: '#cfe9ff', pos: [0, 25.6, 0] });
    lhParts.push({ geo: new THREE.ConeGeometry(1.5, 1.6, 10), color: '#2c2c2c', pos: [0, 27.6, 0] });
    const lh = new THREE.Mesh(mergeColored(lhParts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    const lx = WATER_X - 12, lz = -HALF - 30;
    lh.position.set(lx, 0, lz);
    lh.castShadow = true;
    scene.add(lh);
    this.addCircle(lx, lz, 2.5);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.ConeGeometry(6, 70, 16, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(35, 0, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(lx, 25.6, lz);
    scene.add(beam);
    this.lighthouseBeam = beam;

    // Signs and billboards
    const signs = [
      ...this._signs,
      { text: 'SOLANA FM 88.4', bg: '#13072e', fg: '#33e6ff', x: blockCenter(4), y: 0, z: blockCenter(3), ry: 0, roof: true, w: 16, h: 4 },
      { text: 'KESTREL GT', bg: '#2b0b0b', fg: '#ffd23f', x: this.showroomSign.x, y: this.showroomSign.y, z: this.showroomSign.z + 0.3, ry: 0, w: 14, h: 3 },
      { text: 'PALM CREST HOTEL', bg: '#ffe8f0', fg: '#d6336c', x: blockCenter(7), y: 0, z: blockCenter(2), ry: Math.PI / 2, roof: true, w: 18, h: 4 },
      { text: 'SURF · SUN · SOLANA', bg: '#0b3954', fg: '#ffd166', x: blockCenter(7), y: 0, z: blockCenter(5), ry: Math.PI / 2, roof: true, w: 18, h: 4 },
    ];
    for (const s of signs) {
      const w = s.w || 10, h = s.h || 2;
      const tex = signTexture(s.text, s.bg, s.fg);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xdddddd });
      this.nightMaterials.push({ mat, day: 0.85, night: 2.1 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      let y = s.y;
      if (s.roof) {
        // sit on top of the tallest building near that point
        let top = 0;
        for (const b of this.buildings) {
          if (Math.abs(b.x - s.x) < b.sx / 2 + 2 && Math.abs(b.z - s.z) < b.sz / 2 + 2) top = Math.max(top, b.sy);
        }
        y = top + CURB_H + h / 2 + 1.5;
        const back = new THREE.Mesh(box(w + 0.4, h + 0.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
        back.position.set(s.x, y, s.z);
        back.rotation.y = s.ry;
        scene.add(back);
        m.position.set(s.x + Math.sin(s.ry) * 0.2, y, s.z + Math.cos(s.ry) * 0.2);
        // second face
        const m2 = new THREE.Mesh(m.geometry, mat);
        m2.position.set(s.x - Math.sin(s.ry) * 0.2, y, s.z - Math.cos(s.ry) * 0.2);
        m2.rotation.y = s.ry + Math.PI;
        scene.add(m2);
      } else {
        m.position.set(s.x, y, s.z);
      }
      m.rotation.y = s.ry;
      scene.add(m);
    }

    // Spray Shack garages: drive in to lose the cops and get a fresh coat.
    for (const sd of this.sprayDefs) {
      const g = new THREE.Group();
      const shell = new THREE.MeshLambertMaterial({ color: 0x5b6470 });
      const wl = new THREE.Mesh(box(0.6, 6, 12), shell);
      wl.position.set(-4.5, 3, 0);
      const wr = wl.clone();
      wr.position.x = 4.5;
      const back = new THREE.Mesh(box(9.6, 6, 0.6), shell);
      back.position.set(0, 3, -sd.face * 6);
      const roof = new THREE.Mesh(box(9.6, 0.5, 12.6), new THREE.MeshLambertMaterial({ color: 0x3d434b }));
      roof.position.set(0, 6.2, 0);
      const tex = signTexture('SPRAY SHACK', '#111111', '#5cff9d');
      const smat = new THREE.MeshBasicMaterial({ map: tex });
      this.nightMaterials.push({ mat: smat, day: 0.9, night: 2.4 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), smat);
      sign.position.set(0, 7.6, sd.face * 6.3);
      if (sd.face < 0) sign.rotation.y = Math.PI;
      for (const m of [wl, wr, back, roof]) { m.castShadow = true; g.add(m); }
      g.add(sign);
      g.position.set(sd.x, CURB_H, sd.z);
      this.scene.add(g);
      this.addBox(sd.x - 4.8, sd.z - 6, sd.x - 4.2, sd.z + 6, 6);
      this.addBox(sd.x + 4.2, sd.z - 6, sd.x + 4.8, sd.z + 6, 6);
      const bz = sd.z - sd.face * 6;
      this.addBox(sd.x - 4.8, bz - 0.3, sd.x + 4.8, bz + 0.3, 6);
      this.sprays.push({ x: sd.x, z: sd.z, face: sd.face });
    }
  }

  _buildMapCanvas() {
    const s = 1; // px per metre
    const W = Math.ceil((WORLD.maxX - WORLD.minX) * s), H = Math.ceil((WORLD.maxZ - WORLD.minZ) * s);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X = (x) => (x - WORLD.minX) * s, Z = (z) => (z - WORLD.minZ) * s;
    g.fillStyle = '#26402f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#c9b27a';
    g.fillRect(X(BEACH_X0), 0, W, H);
    g.fillStyle = '#17405e';
    g.fillRect(X(WATER_X), 0, W, H);
    for (const b of this.pedBlocks) {
      const d = district(b.i, b.j);
      g.fillStyle = d === 'park' ? '#2f6b43' : d === 'residential' ? '#3a4d3c' : '#3a4250';
      g.fillRect(X(b.cx - BLOCK_W / 2), Z(b.cz - BLOCK_W / 2), BLOCK_W * s, BLOCK_W * s);
    }
    g.fillStyle = '#566173';
    for (const b of this.buildings) g.fillRect(X(b.x - b.sx / 2), Z(b.z - b.sz / 2), b.sx * s, b.sz * s);
    g.fillStyle = '#c3ccd8';
    for (let k = 0; k <= N_BLOCKS; k++) {
      const p = roadPos(k);
      g.fillRect(X(-HALF - ROAD_W / 2), Z(p - ROAD_W / 2), (2 * HALF + ROAD_W) * s, ROAD_W * s);
      g.fillRect(X(p - ROAD_W / 2), Z(-HALF - ROAD_W / 2), ROAD_W * s, (2 * HALF + ROAD_W) * s);
    }
    this.mapCanvas = c;
    this.mapScale = s;
  }

  // Per-frame visual updates driven by time of day.
  update(dt, t, night, wet = 0, hdr = 1) {
    this.uniforms.uNight.value = night;
    this.uniforms.uWet.value = wet;
    for (const n of this.nightMaterials) {
      let k = n.day + (n.night - n.day) * night;
      if (k > 1) k = 1 + (k - 1) * hdr; // without bloom keep emitters in range
      n.mat.color.setRGB(k, k, k);
    }
    if (this.lightPools) this.lightPools.material.opacity = night * 0.55 * (1 + wet * 0.7);
    if (this.waterNormal) {
      this.waterNormal.offset.x = (t * 0.011) % 1;
      this.waterNormal.offset.y = (t * 0.007) % 1;
    }
    if (this.lighthouseBeam) {
      this.lighthouseBeam.rotation.y = t * 0.8;
      this.lighthouseBeam.material.opacity = 0.05 + night * 0.22;
    }
    if (this.surf) {
      const w = Math.sin(t * 0.9);
      this.surf.position.x = WATER_X + 1.5 + w * 1.6;
      this.surf.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.9 + 1.2));
    }
  }
}
