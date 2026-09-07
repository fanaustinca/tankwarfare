// ───────────────────────────────────────────────────────────────
//  Persistence: your chassis design, wave progress and settings.
//  Every access is guarded — localStorage throws in private mode
//  and in some embedded portal iframes, and a save failure must
//  never take the game down with it.
// ───────────────────────────────────────────────────────────────
import { emptyBuild, emptyUpgrades, key2, key3, ALL_PARTS } from './parts.js';

const KEY = { tank: 'tw.tank.v1', progress: 'tw.progress.v1', settings: 'tw.settings.v1' };

// Storage backend. Defaults to localStorage; a portal can swap in its own
// store with the same API (CrazyGames' data module syncs a logged-in player's
// saves across their devices) via setStorageBackend().
let backend = null;
const store = () => backend || localStorage;

export function setStorageBackend(b) {
  if (!b || typeof b.getItem !== 'function') return false;
  backend = b;
  return true;
}

function read(key) {
  try {
    const raw = store().getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function write(key, value) {
  try { store().setItem(key, JSON.stringify(value)); return true; }
  catch (_) { return false; }
}

function drop(key) { try { store().removeItem(key); } catch (_) {} }

// ─────────────── build serialisation ───────────────
export function serializeBuild(b) {
  return {
    v: 1,
    tracks: [...b.tracks.values()].map((t) => [t.i, t.j, t.type]),
    blocks: [...b.blocks.values()].map((x) => [x.i, x.j, x.k, x.type]),
    turrets: [...b.turrets.values()].map((t) => [t.i, t.j, t.type, t.rot || 0]),
    upgrades: { ...(b.upgrades || emptyUpgrades()) },
  };
}

export function deserializeBuild(data) {
  if (!data || data.v !== 1) return null;
  try {
    const b = emptyBuild();
    // skip anything referring to a part id this version no longer ships
    for (const [i, j, type] of data.tracks || [])
      if (ALL_PARTS[type]) b.tracks.set(key2(i, j), { i, j, type });
    for (const [i, j, k, type] of data.blocks || [])
      if (ALL_PARTS[type]) b.blocks.set(key3(i, j, k), { i, j, k, type });
    for (const [i, j, type, rot] of data.turrets || [])
      if (ALL_PARTS[type]) b.turrets.set(key2(i, j), { i, j, type, rot: rot || 0 });
    b.upgrades = { ...emptyUpgrades(), ...(data.upgrades || {}) };
    if (!b.tracks.size && !b.blocks.size) return null;
    return b;
  } catch (_) { return null; }
}

// ─────────────── public API ───────────────
export const Save = {
  setStorageBackend,

  available() {
    try { store().setItem('tw.probe', '1'); store().removeItem('tw.probe'); return true; }
    catch (_) { return false; }
  },

  saveTank(build) { return write(KEY.tank, serializeBuild(build)); },
  loadTank() { return deserializeBuild(read(KEY.tank)); },
  clearTank() { drop(KEY.tank); },
  hasTank() { return !!read(KEY.tank); },

  loadProgress() {
    const p = read(KEY.progress) || {};
    return {
      bestWave: p.bestWave || 0,
      bestScore: p.bestScore || 0,
      lastWave: p.lastWave || 0,
      totalKills: p.totalKills || 0,
      runs: p.runs || 0,
    };
  },

  /** Called on every wave clear so a closed tab doesn't lose the run. */
  saveWave(wave, score, kills) {
    const p = this.loadProgress();
    p.lastWave = wave;
    p.bestWave = Math.max(p.bestWave, wave);
    p.bestScore = Math.max(p.bestScore, score);
    p.totalKills = Math.max(p.totalKills, kills);
    return write(KEY.progress, p);
  },

  /** Called when a run ends; banks the bests and clears the resume point. */
  endRun(wave, score, kills) {
    const p = this.loadProgress();
    p.bestWave = Math.max(p.bestWave, wave);
    p.bestScore = Math.max(p.bestScore, score);
    p.totalKills = Math.max(p.totalKills, kills);
    p.lastWave = 0;
    p.runs = (p.runs || 0) + 1;
    return write(KEY.progress, p);
  },

  clearProgress() { drop(KEY.progress); },

  loadSettings() {
    const s = read(KEY.settings) || {};
    return {
      invertX: !!s.invertX,
      invertY: !!s.invertY,
      muted: !!s.muted,
      sensitivity: typeof s.sensitivity === 'number' ? s.sensitivity : 1,
    };
  },
  saveSettings(s) { return write(KEY.settings, s); },

  wipe() { drop(KEY.tank); drop(KEY.progress); drop(KEY.settings); },
};
