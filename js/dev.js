// ───────────────────────────────────────────────────────────────
//  Developer console.
//  Open DevTools (F12) and type `TW.help()`. Everything here is
//  deliberately reachable from the console — it is a debug surface,
//  not part of the in-game UI.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { AITank } from './ai.js';
import { heightAt } from './world.js';
import {
  TRACKS, BLOCKS, TURRETS, UPGRADES, ALL_PARTS, GRID,
  key2, key3, emptyBuild, quickBuild, computeStats, placementError, topLayer,
} from './parts.js';
import { rand } from './util.js';

const C = {
  head: 'color:#ffab2e;font-weight:700',
  cmd: 'color:#4fd6e8;font-family:monospace',
  txt: 'color:#8b9a9c',
  ok: 'color:#5fe08a',
  warn: 'color:#ff4d3d',
};

export function installDevConsole(app) {
  const need = (mode) => {
    if (mode === 'battle' && app.mode !== 'battle') {
      console.log('%cNot in battle — press Ready for Battle first.', C.warn);
      return false;
    }
    if (mode === 'build' && app.mode !== 'build') {
      console.log('%cNot in the assembly bay — press B in battle to return.', C.warn);
      return false;
    }
    return true;
  };
  const B = () => app.battle;
  const BM = () => app.build;

  const TW = {
    // ── economy & building ──
    money(n = 10000) {
      if (!need('build')) return;
      BM().bonusFunds = (BM().bonusFunds || 0) + n;
      BM().rebuild();
      console.log(`%c+$${n}  →  now ${Math.round(BM().funds)}`, C.ok);
      return BM().funds;
    },
    rich() { return TW.money(1e6); },

    /** Set every upgrade track to a level (default max). */
    upgrade(level = 99) {
      if (!need('build')) return;
      const up = BM().build.upgrades;
      for (const u of UPGRADES) up[u.id] = Math.min(u.max, level);
      BM().rebuild();
      console.log('%cupgrades:', C.ok, { ...up });
      return { ...up };
    },

    /** Load the starter chassis. */
    preset() { if (!need('build')) return; BM().build = quickBuild(); BM().rebuild(); BM().setPhase(2); },

    /** Wipe the deck. */
    clear() { if (!need('build')) return; BM().build = emptyBuild(); BM().rebuild(); BM().setPhase(0); },

    /**
     * Auto-assemble a chassis around a chosen main gun.
     * e.g. TW.make('tur_siege') or TW.make('tur_duo', 3)
     */
    make(mainGun = 'tur_can', upgradeLevel = 0) {
      if (!need('build')) return;
      if (!ALL_PARTS[mainGun]) { console.log('%cunknown turret — see TW.parts()', C.warn); return; }
      const bm = BM();
      const b = emptyBuild();
      const c = Math.floor(GRID / 2);
      const [fw, fd] = ALL_PARTS[mainGun].foot || [1, 1];
      const halfW = Math.max(1, Math.ceil(fw / 2));
      for (let j = -3; j <= 3; j++) {
        b.tracks.set(key2(c - halfW - 1, c + j), { i: c - halfW - 1, j: c + j, type: 'trk_hvy' });
        b.tracks.set(key2(c + halfW + 1, c + j), { i: c + halfW + 1, j: c + j, type: 'trk_hvy' });
      }
      for (let i = -halfW; i <= halfW; i++) for (let j = -3; j <= 3; j++)
        b.blocks.set(key3(c + i, c + j, 0), { i: c + i, j: c + j, k: 0,
          type: j >= 2 ? 'blk_slp' : (i === 0 && j <= -2 ? 'blk_eng' : 'blk_hvy') });
      for (let i = -halfW; i <= halfW; i++) for (let j = -1; j <= Math.max(0, fd - 1); j++)
        b.blocks.set(key3(c + i, c + j, 1), { i: c + i, j: c + j, k: 1, type: 'blk_hvy' });
      b.turrets.set(key2(c - Math.floor((fw - 1) / 2), c - 1),
        { i: c - Math.floor((fw - 1) / 2), j: c - 1, type: mainGun });
      for (const u of UPGRADES) b.upgrades[u.id] = Math.min(u.max, upgradeLevel);
      bm.build = b;
      bm.bonusFunds = (bm.bonusFunds || 0) + computeStats(b).cost;   // it's free in dev
      bm.rebuild(); bm.setPhase(2);
      console.log('%cbuilt', C.ok, mainGun, computeStats(b));
    },

    // ── combat ──
    god(on = null) {
      if (!need('battle')) return;
      B().godMode = on === null ? !B().godMode : on;
      B().player.invulnerable = B().godMode;
      console.log(`%cgod mode ${B().godMode ? 'ON' : 'OFF'}`, B().godMode ? C.ok : C.txt);
      return B().godMode;
    },
    repair() { if (!need('battle')) return; const n = B().player.repair(1); console.log('%crepaired', C.ok, n); },
    heal() { return TW.repair(); },

    /** Destroy every hostile on the field. */
    nuke() {
      if (!need('battle')) return;
      let n = 0;
      for (const e of B().enemies) if (e.alive) { e.tank.destroyed = true; e.tank.hp = 0; n++; }
      console.log(`%c${n} hostiles destroyed`, C.ok);
    },
    killall() { return TW.nuke(); },

    /** Spawn hostiles: TW.spawn(count, tier) */
    spawn(count = 1, tier = 2) {
      if (!need('battle')) return;
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2), r = rand(45, 90);
        const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r).add(B().player.pos);
        B().enemies.push(new AITank(B(), tier, p, 'red'));
      }
      console.log(`%cspawned ${count} × tier ${tier}`, C.ok);
    },

    /** Spawn friendly armour: TW.allies(count, tier) */
    allies(count = 2, tier = 2) {
      if (!need('battle')) return;
      B().spawnAllies(count, tier);
      console.log(`%c${count} wingmen joined (tier ${tier})`, C.ok);
    },

    /** How many wingmen you get from the next wave onward. */
    squadSize(n = 2) {
      if (!need('battle')) return;
      B().allyCount = Math.max(0, n);
      console.log(`%csquad size → ${B().allyCount}`, C.ok);
    },

    /** Skip to a wave number. */
    wave(n = null) {
      if (!need('battle')) return;
      const b = B();
      for (const e of b.enemies) e.removeFrom(b.scene);
      b.enemies.length = 0;
      b.wave = (n === null ? b.wave + 1 : n) - 1;
      b.waveClearing = false;
      b.nextWave();
      console.log(`%cwave ${b.wave}`, C.ok);
    },

    /** Teleport the player. TW.tp() jumps to the nearest hostile. */
    tp(x = null, z = null) {
      if (!need('battle')) return;
      const b = B();
      if (x === null) {
        let near = null, nd = 1e9;
        for (const e of b.enemies) if (e.alive) { const d = e.pos.distanceTo(b.player.pos); if (d < nd) { nd = d; near = e; } }
        if (!near) { console.log('%cno hostiles left', C.warn); return; }
        x = near.pos.x + 18; z = near.pos.z + 18;
      }
      b.player.pos.set(x, heightAt(x, z), z);
      b.player.speed = 0;
      console.log('%cteleported', C.ok, [x, z]);
    },

    /** Gunner assignment: 'auto' | 'manual'. */
    gunners(mode = 'auto') {
      if (!need('battle')) return;
      for (const t of B().player.turrets) if (!t.dead) { t.mode = mode; t.aiTarget = null; }
      B().renderWeapons();
      console.log(`%call turrets → ${mode}`, C.ok);
    },

    /** Simulation speed multiplier. */
    speed(x = 1) { app.timeScale = Math.max(0.05, Math.min(8, x)); console.log(`%ctime ×${app.timeScale}`, C.ok); },
    slowmo() { TW.speed(0.25); },

    /** Toggle post-processing bloom. */
    bloom(v = null) {
      const b = app.composer.bloom;
      b.strength = v === null ? (b.strength > 0 ? 0 : 0.55) : v;
      console.log('%cbloom', C.ok, b.strength);
    },

    mute() { app.audio.setMuted(app.audio.enabled); console.log('%caudio', C.ok, app.audio.enabled ? 'on' : 'off'); },

    // ── info ──
    parts() {
      console.log('%cTRACKS', C.head);  console.table(TRACKS.map(pick));
      console.log('%cBLOCKS', C.head);  console.table(BLOCKS.map(pick));
      console.log('%cTURRETS', C.head); console.table(TURRETS.map(pick));
      function pick(p) {
        return { id: p.id, name: p.name, cost: p.cost, weight: p.weight, hp: p.hp,
                 damage: p.damage ?? '', reload: p.reload ?? '', foot: (p.foot || [1, 1]).join('×') };
      }
    },

    stats() {
      const out = { mode: app.mode };
      if (app.mode === 'build') Object.assign(out, computeStats(BM().build), { funds: BM().funds });
      if (app.mode === 'battle') {
        const b = B();
        Object.assign(out, {
          wave: b.wave, kills: b.kills, score: b.score,
          hostiles: b.enemies.filter((e) => e.alive).length,
          wingmen: b.allies.filter((a) => a.alive).length,
          hp: `${Math.round(b.player.hp)}/${Math.round(b.player.maxHp)}`,
          drive: Math.round(b.player.mobility * 100) + '%',
          godMode: !!b.godMode,
          turrets: b.player.turrets.map((t) => `${t.def.name} [${t.dead ? 'wrecked' : t.mode}]`),
        });
      }
      console.log('%cTankWarfare', C.head, out);
      return out;
    },

    help() {
      const rows = [
        ['— assembly bay —', ''],
        ['TW.money(n)', 'add funds (default 10000)'],
        ['TW.rich()', 'effectively unlimited funds'],
        ['TW.upgrade(lvl)', 'set all upgrade tracks (default max)'],
        ['TW.make(gunId, lvl)', "auto-build around a gun, e.g. TW.make('tur_siege', 4)"],
        ['TW.preset() / TW.clear()', 'load the starter tank / wipe the deck'],
        ['— battle —', ''],
        ['TW.god()', 'toggle invulnerability'],
        ['TW.repair()', 'full field repair'],
        ['TW.nuke()', 'destroy every hostile'],
        ['TW.spawn(n, tier)', 'spawn hostiles'],
        ['TW.allies(n, tier)', 'spawn friendly armour'],
        ['TW.squadSize(n)', 'wingmen per wave from now on'],
        ['TW.wave(n)', 'jump to a wave'],
        ['TW.tp(x, z)', 'teleport (no args = next to nearest hostile)'],
        ['TW.gunners(mode)', "'auto' or 'manual' for every turret"],
        ['— general —', ''],
        ['TW.speed(x)', 'time scale (TW.slowmo() for 0.25×)'],
        ['TW.bloom(v)', 'toggle/set bloom'],
        ['TW.mute()', 'toggle audio'],
        ['TW.parts()', 'table of every part'],
        ['TW.stats()', 'current game state'],
      ];
      console.log('%cTANKWARFARE — dev console', C.head);
      for (const [cmd, desc] of rows) {
        if (!desc) console.log(`%c${cmd}`, C.head);
        else console.log(`%c  ${cmd.padEnd(26)}%c${desc}`, C.cmd, C.txt);
      }
    },
  };

  window.TW = TW;
  console.log('%cTANKWARFARE%c  dev console ready — type %cTW.help()%c for commands',
    C.head, C.txt, C.cmd, C.txt);
  return TW;
}
