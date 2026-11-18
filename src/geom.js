import * as THREE from 'three';

// Merge several coloured primitives into one non-indexed geometry with vertex
// colours. Each part: { geo, color, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z] }.
export function mergeColored(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    e.set(...(p.rot || [0, 0, 0]));
    q.setFromEuler(e);
    m.compose(
      new THREE.Vector3(...(p.pos || [0, 0, 0])),
      q,
      new THREE.Vector3(...(p.scale || [1, 1, 1]))
    );
    nm.getNormalMatrix(m);
    c.set(p.color);
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      normals.push(v.x, v.y, v.z);
      colors.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

// Wedge used for stunt ramps: rises from 0 at -z to h at +z.
export function wedgeGeometry(w, len, h) {
  const x0 = -w / 2, x1 = w / 2, z0 = -len / 2, z1 = len / 2;
  const P = [
    // slope
    [x0, 0, z0], [x1, 0, z0], [x1, h, z1],
    [x0, 0, z0], [x1, h, z1], [x0, h, z1],
    // back face
    [x0, 0, z1], [x0, h, z1], [x1, h, z1],
    [x0, 0, z1], [x1, h, z1], [x1, 0, z1],
    // left side
    [x0, 0, z0], [x0, h, z1], [x0, 0, z1],
    // right side
    [x1, 0, z0], [x1, 0, z1], [x1, h, z1],
  ];
  // The list above is written clockwise; flip each triangle so faces point outward.
  for (let i = 0; i < P.length; i += 3) [P[i + 1], P[i + 2]] = [P[i + 2], P[i + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
  g.computeVertexNormals();
  return g;
}

// Builds a flat textured quad list (y-up) from rectangles.
export class QuadBuilder {
  constructor() {
    this.pos = [];
    this.uv = [];
  }
  // uvFn(x, z) -> [u, v]
  rect(x0, z0, x1, z1, y, uvFn) {
    const a = [x0, z0], b = [x0, z1], c = [x1, z0], d = [x1, z1];
    for (const p of [a, b, c, c, b, d]) {
      this.pos.push(p[0], y, p[1]);
      const t = uvFn(p[0], p[1]);
      this.uv.push(t[0], t[1]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.computeBoundingSphere();
    return g;
  }
}
