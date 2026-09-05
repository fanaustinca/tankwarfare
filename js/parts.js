// ───────────────────────────────────────────────────────────────
//  Part catalogue + build-data model + derived stats.
//  A "build" is pure data (no Three.js) so it can be serialised,
//  generated for AI opponents, and costed by the UI.
// ───────────────────────────────────────────────────────────────

export const GRID = 15;          // cells per side of the build grid
export const CELL = 1.0;         // world units per cell (≈ 1 m)
export const TRACK_H = 0.46;     // track section height
export const BLOCK_H = 0.58;     // hull block height
export const MAX_LAYERS = 3;
export const TRACK_GAP = 4;      // max cell gap between parallel tread runs

export const START_FUNDS = 4200;

// ─────────────── upgrade tracks ───────────────
// Bought once in the bay and applied to every part of that class, so the
// build grid stays about layout while progression lives here.
export const UPGRADES = [
  { id: 'weapon', name: 'Fire Control', icon: '◈', max: 4, step: 0.20, baseCost: 280,
    desc: 'Better optics and ammunition.', effect: (n) => `+${n * 20}% weapon damage` },
  { id: 'drive', name: 'Drivetrain', icon: '⚙', max: 4, step: 0.22, baseCost: 240,
    desc: 'Uprated transmission and torque.', effect: (n) => `+${n * 22}% drive power` },
  { id: 'armour', name: 'Armour Plating', icon: '▣', max: 4, step: 0.25, baseCost: 300,
    desc: 'Appliqué plate on every module.', effect: (n) => `+${n * 25}% module health` },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

export const emptyUpgrades = () => ({ weapon: 0, drive: 0, armour: 0 });

/** Cost of buying the next level of an upgrade (escalates per level). */
export function upgradeCost(id, currentLevel) {
  const u = UPGRADE_BY_ID[id];
  if (!u || currentLevel >= u.max) return Infinity;
  return Math.round(u.baseCost * (1 + currentLevel * 0.85));
}

/** Total spent on an upgrade track at its current level. */
export function upgradeSpent(id, level) {
  let total = 0;
  for (let n = 0; n < level; n++) total += upgradeCost(id, n);
  return total;
}

/** Multipliers a build's upgrade levels produce. */
export function upgradeMultipliers(up = emptyUpgrades()) {
  return {
    damage: 1 + (up.weapon || 0) * UPGRADE_BY_ID.weapon.step,
    power:  1 + (up.drive  || 0) * UPGRADE_BY_ID.drive.step,
    hp:     1 + (up.armour || 0) * UPGRADE_BY_ID.armour.step,
  };
}

export const TRACKS = [
  { id: 'trk_std', name: 'Standard Track', cost: 60, weight: 120, power: 95, hp: 55,
    color: 0x2a2c2a, desc: 'Balanced tread section.' },
  { id: 'trk_hvy', name: 'Heavy Track', cost: 115, weight: 215, power: 180, hp: 120,
    color: 0x24261f, desc: 'Wide tread. More grunt, more mass.' },
  { id: 'trk_spd', name: 'Racing Track', cost: 95, weight: 78, power: 130, hp: 34,
    color: 0x2e2724, desc: 'Light alloy links. Fragile but fast.' },
];

export const BLOCKS = [
  { id: 'blk_lgt', name: 'Light Plate', cost: 70, weight: 82, hp: 80, armour: 0.9,
    color: [0.31, 0.35, 0.29], wear: 0.45, desc: 'Rolled steel. Cheap and light.' },
  { id: 'blk_hvy', name: 'Composite Armour', cost: 150, weight: 205, hp: 235, armour: 0.55,
    color: [0.24, 0.27, 0.25], wear: 0.6, desc: 'Layered ceramic. Soaks punishment.' },
  { id: 'blk_slp', name: 'Sloped Glacis', cost: 120, weight: 130, hp: 140, armour: 0.4,
    color: [0.29, 0.32, 0.28], wear: 0.5, sloped: true, desc: 'Angled face deflects incoming fire.' },
  { id: 'blk_eng', name: 'Engine Block', cost: 215, weight: 160, hp: 95, armour: 1.4, power: 145,
    color: [0.20, 0.21, 0.22], wear: 0.75, engine: true, desc: 'Turbo-diesel. Adds drive power.' },
];

/**
 * Turrets.
 *   foot   [width, depth] in grid cells — big guns physically occupy more hull
 *   salvo  true = every barrel fires at once; false = barrels alternate
 *   barrel.count number of tubes
 */
export const TURRETS = [
  { id: 'tur_mg_l', name: 'Light MG', cost: 70, weight: 38, hp: 34, icon: '·', foot: [1, 1],
    damage: 5, reload: 0.05, muzzle: 200, spread: 0.048, splash: 0, range: 75,
    barrel: { len: 0.85, rad: 0.028, count: 1 }, kind: 'auto', ring: 0.30,
    desc: 'Pintle gun. Chews infantry-grade armour.' },

  { id: 'tur_mg_h', name: 'Heavy .50 MG', cost: 135, weight: 72, hp: 52, icon: '∷', foot: [1, 1],
    damage: 13, reload: 0.095, muzzle: 185, spread: 0.036, splash: 0, range: 95,
    barrel: { len: 1.2, rad: 0.046, count: 1, brake: true }, kind: 'auto', ring: 0.34,
    desc: 'Heavier receiver, real stopping power.' },

  { id: 'tur_aut', name: '30mm Autocannon', cost: 250, weight: 155, hp: 95, icon: '≡', foot: [1, 1],
    damage: 18, reload: 0.105, muzzle: 160, spread: 0.030, splash: 0.6, range: 125,
    barrel: { len: 1.75, rad: 0.055, count: 2, spacing: 0.14 }, kind: 'auto', ring: 0.42,
    desc: 'Alternating twin feed. Shreds light armour.' },

  { id: 'tur_twin', name: 'Twin 40mm Flak', cost: 430, weight: 235, hp: 110, icon: '⑈', foot: [2, 1],
    damage: 34, reload: 0.30, muzzle: 165, spread: 0.022, splash: 1.2, range: 140,
    barrel: { len: 2.0, rad: 0.075, count: 2, spacing: 0.26, brake: true },
    kind: 'auto', salvo: true, ring: 0.5,
    desc: 'Both barrels fire together. Wide mount.' },

  { id: 'tur_can', name: '120mm Cannon', cost: 350, weight: 265, hp: 130, icon: '⬤', foot: [1, 1],
    damage: 170, reload: 1.55, muzzle: 115, spread: 0.010, splash: 3.2, range: 190,
    barrel: { len: 2.5, rad: 0.105, count: 1, brake: true }, kind: 'shell', ring: 0.44,
    desc: 'The dependable main gun.' },

  { id: 'tur_duo', name: 'Double 105mm', cost: 640, weight: 430, hp: 165, icon: '◎', foot: [2, 1],
    damage: 130, reload: 2.05, muzzle: 118, spread: 0.013, splash: 3.0, range: 185,
    barrel: { len: 2.7, rad: 0.115, count: 2, spacing: 0.30, brake: true },
    kind: 'shell', salvo: true, ring: 0.56,
    desc: 'Two shells downrange at once. Heavy mount.' },

  { id: 'tur_siege', name: '155mm Siege Gun', cost: 980, weight: 810, hp: 265, icon: '✹', foot: [3, 3],
    damage: 480, reload: 3.6, muzzle: 96, spread: 0.007, splash: 10.5, range: 250,
    barrel: { len: 4.7, rad: 0.215, count: 1, brake: true }, kind: 'shell', ring: 1.15,
    desc: 'Devastating. Needs a full 3×3 hull platform.' },

  { id: 'tur_mis', name: 'Missile Pod', cost: 460, weight: 215, hp: 85, icon: '▲', foot: [1, 1],
    damage: 250, reload: 2.7, muzzle: 52, spread: 0.004, splash: 6.5, range: 230,
    barrel: { len: 0.9, rad: 0.30, count: 1, pod: true }, kind: 'missile', homing: 1.6, ring: 0.42,
    desc: 'Guided warheads that track your target.' },
];

export const ALL_PARTS = {};
for (const p of [...TRACKS, ...BLOCKS, ...TURRETS]) ALL_PARTS[p.id] = p;
export const partsFor = (phase) => (phase === 0 ? TRACKS : phase === 1 ? BLOCKS : TURRETS);
export const footOf = (def) => (def && def.foot) || [1, 1];

/** Palette stat chips, derived from the live numbers so they can never drift. */
export function specOf(p) {
  const out = [];
  if (p.damage !== undefined) {
    const n = p.salvo ? (p.barrel.count || 1) : 1;
    out.push(['DMG', n > 1 ? `${p.damage}×${n}` : p.damage]);
    if (p.reload < 0.5) out.push(['RPM', Math.round(60 / p.reload) * n]);
    else out.push(['RLD', p.reload.toFixed(1) + 's']);
    if (p.splash >= 1) out.push(['SPL', p.splash + 'm']);
    else out.push(['RNG', p.range + 'm']);
    const [w, d] = footOf(p);
    out.push(['SIZE', `${w}×${d}`]);
  } else if (p.power !== undefined && p.hp !== undefined && p.armour === undefined) {
    out.push(['PWR', p.power], ['HP', p.hp], ['KG', p.weight]);
  } else {
    out.push(['HP', p.hp], ['KG', p.weight]);
    if (p.power) out.push(['PWR', p.power]);
    if (p.sloped) out.push(['DEFL', '65%']);
  }
  return out;
}

// ─────────────── build data model ───────────────
export const key2 = (i, j) => i + ',' + j;
export const key3 = (i, j, k) => i + ',' + j + ',' + k;

export function emptyBuild() {
  return { tracks: new Map(), blocks: new Map(), turrets: new Map(), upgrades: emptyUpgrades() };
}

export function cloneBuild(b) {
  return {
    tracks: new Map(b.tracks),
    blocks: new Map(b.blocks),
    turrets: new Map(b.turrets),
    upgrades: { ...(b.upgrades || emptyUpgrades()) },
  };
}

/** Highest occupied layer index in a column, or -1 if the column is empty. */
export function topLayer(build, i, j) {
  for (let k = MAX_LAYERS - 1; k >= 0; k--) if (build.blocks.has(key3(i, j, k))) return k;
  return -1;
}

/** Map of every grid cell covered by a turret → that turret's key. */
export function turretOccupancy(build, skipKey = null) {
  const occ = new Map();
  for (const [k, t] of build.turrets) {
    if (k === skipKey) continue;
    const [w, d] = footOf(ALL_PARTS[t.type]);
    for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) occ.set(key2(t.i + a, t.j + b), k);
  }
  return occ;
}

/** The cells a turret of `type` anchored at (i,j) would cover. */
export function footCells(type, i, j) {
  const [w, d] = footOf(ALL_PARTS[type]);
  const out = [];
  for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) out.push({ i: i + a, j: j + b });
  return out;
}

/**
 * Can a piece be placed here? Returns null when legal, else a reason string.
 * `type` matters in phase 2, where big guns need a flat multi-cell platform.
 */
export function placementError(build, phase, i, j, k, type) {
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 'outside the deck';
  if (phase === 0) {
    if (build.tracks.has(key2(i, j))) return 'track already here';
    if (build.tracks.size === 0) return null;
    // Running gear must stay one assembly, but a tank needs TWO parallel tread
    // runs with the hull between them — so allow a short gap rather than
    // requiring strict 4-neighbour adjacency.
    for (const t of build.tracks.values()) {
      if (Math.max(Math.abs(t.i - i), Math.abs(t.j - j)) <= TRACK_GAP) return null;
    }
    return 'too far from the running gear';
  }
  if (phase === 1) {
    if (build.blocks.has(key3(i, j, k))) return 'block already here';
    if (k === 0) {
      if (build.tracks.has(key2(i, j))) return 'cannot build on top of a track';
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (build.tracks.has(key2(i + di, j + dj)) || build.blocks.has(key3(i + di, j + dj, 0))) return null;
      return 'layer 1 must sit beside the tracks';
    }
    if (!build.blocks.has(key3(i, j, k - 1))) return 'nothing underneath';
    return null;
  }

  // ── phase 2: turrets, footprint aware ──
  const def = ALL_PARTS[type];
  const [w, d] = footOf(def);
  const anchorTop = topLayer(build, i, j);
  if (anchorTop < 0) return 'turrets need hull below';
  const occ = turretOccupancy(build);
  for (const c of footCells(type, i, j)) {
    if (c.i >= GRID || c.j >= GRID) return `needs a ${w}×${d} platform`;
    if (occ.has(key2(c.i, c.j))) return 'another turret is in the way';
    const t = topLayer(build, c.i, c.j);
    if (t < 0) return `needs a flat ${w}×${d} platform`;
    if (t !== anchorTop) return 'platform is not level';
  }
  return null;
}

/** Drop any turret whose supporting platform no longer exists. */
export function pruneTurrets(build) {
  for (const [k, t] of [...build.turrets]) {
    if (placementError(build, 2, t.i, t.j, 0, t.type) &&
        turretOccupancy(build, k).size >= 0) {
      // re-test ignoring itself, so a legal turret is never pruned
      const saved = build.turrets.get(k);
      build.turrets.delete(k);
      if (placementError(build, 2, t.i, t.j, 0, t.type)) continue;   // still illegal → stays removed
      build.turrets.set(k, saved);
    }
  }
}

// ─────────────── derived stats ───────────────
export function computeStats(build) {
  const up = build.upgrades || emptyUpgrades();
  const mul = upgradeMultipliers(up);
  let weight = 0, power = 0, hp = 0, cost = 0, dps = 0;
  for (const t of build.tracks.values()) {
    const p = ALL_PARTS[t.type];
    weight += p.weight; power += p.power; hp += p.hp * mul.hp; cost += p.cost;
  }
  for (const b of build.blocks.values()) {
    const p = ALL_PARTS[b.type];
    weight += p.weight; hp += p.hp * mul.hp; cost += p.cost;
    if (p.power) power += p.power;
  }
  for (const t of build.turrets.values()) {
    const p = ALL_PARTS[t.type];
    weight += p.weight; hp += p.hp * mul.hp; cost += p.cost;
    dps += (p.damage * mul.damage * (p.salvo ? (p.barrel.count || 1) : 1)) / p.reload;
  }
  for (const u of UPGRADES) cost += upgradeSpent(u.id, up[u.id] || 0);

  power *= mul.power;
  const w = Math.max(weight, 1);
  const ratio = power / w;                       // power-to-weight
  const topSpeed = Math.min(26, ratio * 32);     // m/s
  const accel    = ratio * 11;                   // m/s²
  const turnRate = Math.min(2.4, ratio * 3.4);   // rad/s
  return {
    weight, power, hp, cost, dps, ratio, topSpeed, accel, turnRate, mul, upgrades: up,
    trackCount: build.tracks.size,
    blockCount: build.blocks.size,
    turretCount: build.turrets.size,
    valid: build.tracks.size >= 2 && build.blocks.size >= 1 && build.turrets.size >= 1,
  };
}

/** Bounding box of every occupied cell, used to centre the chassis. */
export function buildBounds(build) {
  let minI = 1e9, maxI = -1e9, minJ = 1e9, maxJ = -1e9, any = false;
  const visit = (i, j) => {
    any = true;
    if (i < minI) minI = i; if (i > maxI) maxI = i;
    if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
  };
  for (const t of build.tracks.values()) visit(t.i, t.j);
  for (const b of build.blocks.values()) visit(b.i, b.j);
  if (!any) return { minI: 0, maxI: 0, minJ: 0, maxJ: 0, cx: 0, cj: 0, w: 1, l: 1 };
  return {
    minI, maxI, minJ, maxJ,
    cx: (minI + maxI) / 2, cj: (minJ + maxJ) / 2,
    w: (maxI - minI + 1) * CELL, l: (maxJ - minJ + 1) * CELL,
  };
}

// ─────────────── preset / procedural builds ───────────────
/** A solid starter tank that fits inside the opening budget. */
export function quickBuild() {
  const b = emptyBuild();
  const c = Math.floor(GRID / 2);
  for (let j = -3; j <= 2; j++) {
    b.tracks.set(key2(c - 2, c + j), { i: c - 2, j: c + j, type: 'trk_std' });
    b.tracks.set(key2(c + 2, c + j), { i: c + 2, j: c + j, type: 'trk_std' });
  }
  for (let i = -1; i <= 1; i++) for (let j = -3; j <= 2; j++) {
    const front = j >= 1;
    b.blocks.set(key3(c + i, c + j, 0), {
      i: c + i, j: c + j, k: 0,
      type: front ? 'blk_slp' : (i === 0 && j <= -2 ? 'blk_eng' : 'blk_lgt'),
    });
  }
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 0; j++)
    b.blocks.set(key3(c + i, c + j, 1), { i: c + i, j: c + j, k: 1, type: 'blk_lgt' });
  b.turrets.set(key2(c, c), { i: c, j: c, type: 'tur_can' });
  b.turrets.set(key2(c + 1, c - 1), { i: c + 1, j: c - 1, type: 'tur_mg_h' });
  return b;
}

/** Procedurally generate an enemy chassis. Tier scales size and armament. */
export function enemyBuild(tier = 1, rng = Math.random) {
  const b = emptyBuild();
  const c = Math.floor(GRID / 2);
  // only late-tier hostiles field a wide hull, so early waves aren't
  // physically bigger than the player's starter chassis
  const halfW = tier >= 3 && rng() < 0.55 ? 2 : 1;
  const len = 4 + (rng() < 0.5 ? 1 : 0) + (tier > 2 ? 1 : 0);
  const j0 = -Math.floor(len / 2);
  const trkType = tier >= 3 ? 'trk_hvy' : rng() < 0.25 ? 'trk_spd' : 'trk_std';
  const armour = tier >= 2 ? (rng() < 0.5 ? 'blk_hvy' : 'blk_lgt') : 'blk_lgt';

  for (let j = j0; j < j0 + len; j++) {
    b.tracks.set(key2(c - halfW - 1, c + j), { i: c - halfW - 1, j: c + j, type: trkType });
    b.tracks.set(key2(c + halfW + 1, c + j), { i: c + halfW + 1, j: c + j, type: trkType });
  }
  for (let i = -halfW; i <= halfW; i++) for (let j = j0; j < j0 + len; j++) {
    const front = j >= j0 + len - 2;
    b.blocks.set(key3(c + i, c + j, 0), {
      i: c + i, j: c + j, k: 0,
      type: front && rng() < 0.7 ? 'blk_slp' : armour,
    });
  }
  // superstructure
  const supW = Math.max(0, halfW - (rng() < 0.5 ? 1 : 0));
  for (let i = -supW; i <= supW; i++) for (let j = j0 + 1; j < j0 + len - 1; j++)
    if (rng() < 0.85) b.blocks.set(key3(c + i, c + j, 1), { i: c + i, j: c + j, k: 1, type: armour });

  // armament
  const mainPool = tier >= 4 ? ['tur_siege', 'tur_duo', 'tur_mis']
                 : tier >= 3 ? ['tur_can', 'tur_mis', 'tur_twin']
                 : tier >= 2 ? ['tur_can', 'tur_aut', 'tur_twin']
                 : ['tur_aut', 'tur_can', 'tur_mg_h'];
  const mj = c + j0 + 2;
  // shuffle the pool, then take the first gun the hull can actually carry
  const order = [...mainPool].sort(() => rng() - 0.5);
  order.push('tur_can');
  let main = 'tur_can', mi = c;
  for (const id of order) {
    const [fw] = footOf(ALL_PARTS[id]);
    const anchor = c - Math.floor((fw - 1) / 2);      // centre a wide mount on the hull
    if (!placementError(b, 2, anchor, mj, 0, id)) { main = id; mi = anchor; break; }
  }
  b.turrets.set(key2(mi, mj), { i: mi, j: mj, type: main });

  if (tier >= 2 && rng() < 0.6) {
    const si = c + (rng() < 0.5 ? -1 : 1) * Math.max(1, supW);
    const sj = c + j0 + len - 2;
    const sec = rng() < 0.5 ? 'tur_mg_l' : 'tur_mg_h';
    if (!placementError(b, 2, si, sj, 0, sec)) b.turrets.set(key2(si, sj), { i: si, j: sj, type: sec });
  }
  return b;
}
