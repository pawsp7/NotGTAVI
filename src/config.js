// Shared constants and small helpers for Port Solana.
// The city is a square grid of blocks. Road centre lines sit on multiples of
// PITCH; blocks fill the space between them.

export const N_BLOCKS = 8;          // blocks per side
export const ROAD_W = 14;           // asphalt width (m)
export const PITCH = 80;            // distance between road centre lines (m)
export const BLOCK_W = PITCH - ROAD_W; // 66 m block incl. sidewalk
export const HALF = (N_BLOCKS * PITCH) / 2; // 320
export const SIDEWALK = 4;          // sidewalk width (m)
export const CURB_H = 0.18;         // sidewalk height (m)
export const LANE = 2.8;            // lane centre offset from road centre
export const PARK_LANE = 5.6;       // parked car offset from road centre
export const BEACH_X0 = HALF + ROAD_W / 2; // sand starts east of the coast road
export const WATER_X = 404;         // shoreline
export const WORLD = { minX: -HALF - 60, maxX: WATER_X + 40, minZ: -HALF - 60, maxZ: HALF + 60 };

export const GRAVITY = 22;

export const roadPos = (k) => -HALF + k * PITCH;
export const blockCenter = (i) => -HALF + (i + 0.5) * PITCH;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

// Deterministic RNG so the city looks the same on every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Non-deterministic helpers for gameplay randomness.
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// District layout. i runs west→east, j runs north→south (north is -z).
export function district(i, j) {
  if (i === 1 && j === 4) return 'park';
  if (i === 4 && j === 6) return 'park';
  if (i === 6 && j === 1) return 'showroom';
  if (i === N_BLOCKS - 1) return 'ocean';
  if (i >= 3 && i <= 5 && j >= 2 && j <= 4) return 'downtown';
  if (j <= 1 && i <= 3) return 'docks';
  if (j >= 6) return 'residential';
  return 'midtown';
}

// Named places used by missions, respawns and the map.
export const PLACES = {
  hospital: { name: 'Solana General', x: blockCenter(2) + 8, z: roadPos(3) - 0 },
  precinct: { name: 'SPD Precinct 4', x: roadPos(5), z: blockCenter(5) },
  diner: { name: 'Moonwake Diner', x: roadPos(7) - 0, z: blockCenter(5) + 14 },
};

export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
