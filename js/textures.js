// ───────────────────────────────────────────────────────────────
//  Procedural PBR texture generation.
//  Everything is baked on a 2D canvas at load time: albedo,
//  roughness, metalness and a normal map derived from a height
//  field via Sobel. No external image assets, no CORS, no waiting.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { fbm, ridge, clamp, lerp } from './util.js';

function cv(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Sobel a height field (Float32Array, size*size, values 0..1) into a normal map. */
function normalFromHeight(h, size, strength = 3.0) {
  const c = cv(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 3x3 Sobel for smoother normals than a plain central difference
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ─────────────── armour plate: panel lines, rivets, scratches, grime ───────────────
/**
 * @param {object} o
 *   color    base albedo [r,g,b] 0..1
 *   panel    px between panel seams
 *   wear     0..1 how battered the plate looks
 */
export function armourSet(o = {}) {
  const size = o.size || 256;
  const panel = o.panel || 64;
  const wear = o.wear ?? 0.5;
  const [br, bg, bb] = o.color || [0.30, 0.34, 0.30];

  const h = new Float32Array(size * size);
  const alb = cv(size), rgh = cv(size), mtl = cv(size);
  const ac = alb.getContext('2d'), rc = rgh.getContext('2d'), mc = mtl.getContext('2d');
  const ai = ac.createImageData(size, size);
  const ri = rc.createImageData(size, size);
  const mi = mc.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const idx = y * size + x;

      // large-scale paint mottling + fine cast grain
      const mottle = fbm(u * 6, v * 6, 4);
      const grain  = fbm(u * 110, v * 110, 3);
      const grime  = fbm(u * 3 + 11, v * 3 + 7, 5);

      // recessed panel seams
      const sx = Math.abs((x % panel) / panel - 0.5);
      const sy = Math.abs((y % panel) / panel - 0.5);
      const seam = clamp((Math.max(sx, sy) - 0.455) / 0.045, 0, 1);

      // rivets at panel intersections
      const gx = Math.round(x / panel) * panel;
      const gy = Math.round(y / panel) * panel;
      const rd = Math.hypot(x - gx, y - gy);
      const rivet = rd < 3.4 ? Math.cos((rd / 3.4) * Math.PI * 0.5) : 0;

      // directional scratches exposing bare metal
      const scr = ridge(u * 4 + 3, v * 190, 2);
      const scratch = wear * clamp((scr - 0.90) / 0.10, 0, 1);

      // edge chipping along seams
      const chip = wear * seam * clamp((fbm(u * 60, v * 60, 2) - 0.55) / 0.25, 0, 1);
      const bare = clamp(scratch + chip, 0, 1);

      h[idx] = 0.5 + mottle * 0.10 + grain * 0.05 - seam * 0.45 + rivet * 0.55 - bare * 0.06;

      // ── albedo ──
      let shade = 0.72 + mottle * 0.42 + grain * 0.10;
      shade *= 1 - seam * 0.42;              // seams read darker
      shade *= 1 - grime * 0.22 * wear;      // dirt accumulation
      let r = br * shade, g = bg * shade, b = bb * shade;
      // dust/rust tint in the low-lying grime
      const dust = grime * grime * 0.30 * wear;
      r = lerp(r, 0.34, dust); g = lerp(g, 0.26, dust); b = lerp(b, 0.17, dust);
      // bare steel showing through
      r = lerp(r, 0.62, bare); g = lerp(g, 0.63, bare); b = lerp(b, 0.64, bare);
      r += rivet * 0.10; g += rivet * 0.10; b += rivet * 0.10;

      const ii = idx * 4;
      ai.data[ii] = clamp(r, 0, 1) * 255;
      ai.data[ii + 1] = clamp(g, 0, 1) * 255;
      ai.data[ii + 2] = clamp(b, 0, 1) * 255;
      ai.data[ii + 3] = 255;

      // ── roughness: painted steel is rough, bare scratches are polished ──
      let rough = 0.58 + grain * 0.30 + grime * 0.18 * wear - bare * 0.42 - rivet * 0.12;
      rough = clamp(rough, 0.08, 0.98) * 255;
      ri.data[ii] = ri.data[ii + 1] = ri.data[ii + 2] = rough; ri.data[ii + 3] = 255;

      // ── metalness: paint is dielectric-ish, exposed steel is metal ──
      const met = clamp(0.55 + bare * 0.45 + rivet * 0.3 - grime * 0.3 * wear, 0, 1) * 255;
      mi.data[ii] = mi.data[ii + 1] = mi.data[ii + 2] = met; mi.data[ii + 3] = 255;
    }
  }
  ac.putImageData(ai, 0, 0); rc.putImageData(ri, 0, 0); mc.putImageData(mi, 0, 0);

  return {
    map: toTexture(alb, { srgb: true }),
    roughnessMap: toTexture(rgh),
    metalnessMap: toTexture(mtl),
    normalMap: toTexture(normalFromHeight(h, size, 2.6)),
  };
}

// ─────────────── rubber track tread ───────────────
export function treadSet(size = 256) {
  const h = new Float32Array(size * size);
  const alb = cv(size), rgh = cv(size);
  const ac = alb.getContext('2d'), rc = rgh.getContext('2d');
  const ai = ac.createImageData(size, size), ri = rc.createImageData(size, size);
  const bars = 8, barH = size / bars;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const idx = y * size + x;
      // horizontal cleats with rounded shoulders
      const t = (y % barH) / barH;
      const cleat = clamp(Math.sin(t * Math.PI) * 1.5 - 0.25, 0, 1);
      // guide horn down the centre of the link
      const centre = clamp(1 - Math.abs(u - 0.5) / 0.08, 0, 1) * 0.5;
      // link pin holes
      const px = Math.abs(((x + size / 4) % (size / 2)) - size / 4);
      const pin = (px < 6 && Math.abs(t - 0.5) < 0.16) ? -0.5 : 0;
      const grain = fbm(u * 90, v * 90, 3);
      const mud = fbm(u * 7, v * 7, 4);

      h[idx] = 0.4 + cleat * 0.5 + centre * 0.3 + pin + grain * 0.05;

      const base = 0.055 + cleat * 0.05 + grain * 0.035;
      const dirty = lerp(base, 0.20, mud * mud * 0.7);   // caked dirt in the treads
      const ii = idx * 4;
      ai.data[ii] = dirty * 255 * 1.10;
      ai.data[ii + 1] = dirty * 255 * 0.96;
      ai.data[ii + 2] = dirty * 255 * 0.82;
      ai.data[ii + 3] = 255;

      const rough = clamp(0.92 - cleat * 0.18 + grain * 0.08, 0.35, 1) * 255;
      ri.data[ii] = ri.data[ii + 1] = ri.data[ii + 2] = rough; ri.data[ii + 3] = 255;
    }
  }
  ac.putImageData(ai, 0, 0); rc.putImageData(ri, 0, 0);
  return {
    map: toTexture(alb, { srgb: true }),
    roughnessMap: toTexture(rgh),
    normalMap: toTexture(normalFromHeight(h, size, 4.0)),
  };
}

// ─────────────── battlefield ground ───────────────
export function groundSet(size = 512) {
  const h = new Float32Array(size * size);
  const alb = cv(size), rgh = cv(size);
  const ac = alb.getContext('2d'), rc = rgh.getContext('2d');
  const ai = ac.createImageData(size, size), ri = rc.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const idx = y * size + x, ii = idx * 4;
      const coarse = fbm(u * 5, v * 5, 5);
      const fine   = fbm(u * 40, v * 40, 4);
      const pebble = fbm(u * 150, v * 150, 2);
      const crack  = clamp((ridge(u * 12, v * 12, 3) - 0.86) / 0.14, 0, 1);
      const patch  = fbm(u * 2.2 + 30, v * 2.2 + 12, 3);

      h[idx] = coarse * 0.5 + fine * 0.3 + pebble * 0.2 - crack * 0.5;

      // dry cracked earth → dusty sand, with sparse scrub patches
      let r = lerp(0.30, 0.46, coarse) + fine * 0.10 + pebble * 0.06;
      let g = lerp(0.25, 0.38, coarse) + fine * 0.09 + pebble * 0.06;
      let b = lerp(0.17, 0.25, coarse) + fine * 0.06 + pebble * 0.05;
      const scrub = clamp((patch - 0.60) / 0.24, 0, 1) * 0.7;
      r = lerp(r, 0.20, scrub); g = lerp(g, 0.24, scrub); b = lerp(b, 0.13, scrub);
      r *= 1 - crack * 0.45; g *= 1 - crack * 0.45; b *= 1 - crack * 0.45;

      ai.data[ii] = clamp(r, 0, 1) * 255;
      ai.data[ii + 1] = clamp(g, 0, 1) * 255;
      ai.data[ii + 2] = clamp(b, 0, 1) * 255;
      ai.data[ii + 3] = 255;

      const rough = clamp(0.86 + fine * 0.14 - pebble * 0.12, 0.55, 1) * 255;
      ri.data[ii] = ri.data[ii + 1] = ri.data[ii + 2] = rough; ri.data[ii + 3] = 255;
    }
  }
  ac.putImageData(ai, 0, 0); rc.putImageData(ri, 0, 0);
  return {
    map: toTexture(alb, { srgb: true, repeat: 42 }),
    roughnessMap: toTexture(rgh, { repeat: 42 }),
    normalMap: toTexture(normalFromHeight(h, size, 1.4), { repeat: 42 }),
  };
}

// ─────────────── rock / concrete for cover objects ───────────────
export function rockSet(size = 256) {
  const h = new Float32Array(size * size);
  const alb = cv(size), rgh = cv(size);
  const ac = alb.getContext('2d'), rc = rgh.getContext('2d');
  const ai = ac.createImageData(size, size), ri = rc.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, idx = y * size + x, ii = idx * 4;
      const n = fbm(u * 9, v * 9, 5);
      const d = fbm(u * 55, v * 55, 3);
      const pit = clamp((fbm(u * 30 + 5, v * 30, 2) - 0.66) / 0.2, 0, 1);
      h[idx] = n * 0.6 + d * 0.35 - pit * 0.4;
      const s = 0.38 + n * 0.34 + d * 0.14 - pit * 0.16;
      ai.data[ii] = clamp(s * 1.02, 0, 1) * 255;
      ai.data[ii + 1] = clamp(s * 1.00, 0, 1) * 255;
      ai.data[ii + 2] = clamp(s * 0.94, 0, 1) * 255;
      ai.data[ii + 3] = 255;
      const rough = clamp(0.80 + d * 0.2, 0.6, 1) * 255;
      ri.data[ii] = ri.data[ii + 1] = ri.data[ii + 2] = rough; ri.data[ii + 3] = 255;
    }
  }
  ac.putImageData(ai, 0, 0); rc.putImageData(ri, 0, 0);
  return {
    map: toTexture(alb, { srgb: true, repeat: 2 }),
    roughnessMap: toTexture(rgh, { repeat: 2 }),
    normalMap: toTexture(normalFromHeight(h, size, 2.2), { repeat: 2 }),
  };
}

// ─────────────── particle sprites ───────────────
function radial(size, stops) {
  const c = cv(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function spriteSet() {
  const S = 128;

  // soft turbulent smoke puff
  const smokeC = cv(S), sx = smokeC.getContext('2d');
  const simg = sx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const n = fbm(u * 5, v * 5, 4) * 0.8 + 0.4;
    const a = clamp((1 - d) * n * 1.5, 0, 1);
    const i = (y * S + x) * 4;
    simg.data[i] = simg.data[i + 1] = simg.data[i + 2] = 255;
    simg.data[i + 3] = Math.pow(a, 1.5) * 255;
  }
  sx.putImageData(simg, 0, 0);

  const glow = radial(S, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,.85)'],
    [0.42, 'rgba(255,255,255,.22)'], [1, 'rgba(255,255,255,0)']]);

  const spark = radial(64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,200,.7)'],
    [1, 'rgba(255,150,40,0)']]);

  // hot fireball core
  const fireC = cv(S), fx = fireC.getContext('2d');
  const fimg = fx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const n = fbm(u * 7, v * 7, 4);
    const a = clamp((1 - d) * (0.55 + n * 0.9), 0, 1);
    const i = (y * S + x) * 4;
    const t = clamp(a * 1.4, 0, 1);
    fimg.data[i] = 255;
    fimg.data[i + 1] = lerp(60, 235, t) ;
    fimg.data[i + 2] = lerp(10, 140, t * t);
    fimg.data[i + 3] = Math.pow(a, 1.3) * 255;
  }
  fx.putImageData(fimg, 0, 0);

  // shockwave ring
  const ringC = cv(S), rx = ringC.getContext('2d');
  const g2 = rx.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.5);
  g2.addColorStop(0, 'rgba(255,255,255,0)');
  g2.addColorStop(0.55, 'rgba(255,230,190,.85)');
  g2.addColorStop(1, 'rgba(255,180,90,0)');
  rx.fillStyle = g2; rx.fillRect(0, 0, S, S);

  // scorch decal
  const scorchC = cv(S), cx2 = scorchC.getContext('2d');
  const simg2 = cx2.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const n = fbm(u * 6, v * 6, 4);
    const a = clamp((1 - d) * 1.6 - n * 0.6, 0, 1);
    const i = (y * S + x) * 4;
    const c = lerp(14, 46, n);
    simg2.data[i] = c; simg2.data[i + 1] = c * 0.9; simg2.data[i + 2] = c * 0.8;
    simg2.data[i + 3] = Math.pow(a, 1.2) * 235;
  }
  cx2.putImageData(simg2, 0, 0);

  const mk = (c, srgb = false) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return {
    smoke: mk(smokeC), glow: mk(glow), spark: mk(spark),
    fire: mk(fireC, true), ring: mk(ringC, true), scorch: mk(scorchC, true),
  };
}
