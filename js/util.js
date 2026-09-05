// ─────────────── math + misc helpers ───────────────
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export const rand  = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

/** shortest signed angle from a to b */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** rotate `a` toward `b` by at most `max` radians */
export function turnToward(a, b, max) {
  const d = angleDelta(a, b);
  return a + clamp(d, -max, max);
}

// ─────────────── value noise / fbm (deterministic) ───────────────
function hash2(i, j) {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

export function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash2(i, j), hash2(i + 1, j), u),
    lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u),
    v
  );
}

/** fractional brownian motion, result roughly in [0,1] */
export function fbm(x, y, oct = 5, lac = 2.0, gain = 0.5) {
  let amp = 0.5, sum = 0, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f, y * f);
    norm += amp;
    f *= lac; amp *= gain;
  }
  return sum / norm;
}

/** ridged noise — good for scratches / erosion streaks */
export function ridge(x, y, oct = 3, lac = 2.1) {
  let amp = 0.5, sum = 0, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1));
    norm += amp; f *= lac; amp *= 0.5;
  }
  return sum / norm;
}

// ─────────────── generic object pool ───────────────
export class Pool {
  constructor(factory, size) {
    this.items = [];
    this.free = [];
    for (let i = 0; i < size; i++) {
      const it = factory(i);
      it._pooled = true;
      this.items.push(it);
      this.free.push(i);
    }
  }
  acquire() { return this.free.length ? this.items[this.free.pop()] : null; }
  release(idx) { this.free.push(idx); }
}

export const fmt = {
  money: (n) => '$' + Math.round(n).toLocaleString('en-US'),
  kg: (n) => (n >= 1000 ? (n / 1000).toFixed(2) + ' t' : Math.round(n) + ' kg'),
  deg: (r) => (r * 180 / Math.PI).toFixed(0) + '°/s',
};
