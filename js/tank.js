// ───────────────────────────────────────────────────────────────
//  Turns build data into an articulated Three.js chassis:
//  tracks + road wheels, hull blocks, traversing turrets with
//  elevating barrels. Also owns per-module damage state.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Assets, teamTint } from './assets.js';
import { ALL_PARTS, CELL, TRACK_H, BLOCK_H, buildBounds, computeStats, topLayer, key2, footOf,
  upgradeMultipliers, emptyUpgrades } from './parts.js';
import { clamp, turnToward, angleDelta } from './util.js';
import { heightAt } from './world.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

// cached geometry so 12 tanks don't build 400 buffers
const geoCache = new Map();
function rbox(w, h, d, r = 0.05) {
  const k = `${w}|${h}|${d}|${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 2, r));
  return geoCache.get(k);
}

/**
 * A module = one destructible piece of the tank (track / block / turret).
 * Damage is applied to the nearest module to the impact point, so hitting
 * a turret kills the gun while hitting a track immobilises the tank.
 */
class Module {
  constructor(kind, mesh, def, cell, hpMul = 1) {
    this.kind = kind;          // 'track' | 'block' | 'turret'
    this.mesh = mesh;
    this.def = def;
    this.cell = cell;
    this.maxHp = Math.round(def.hp * hpMul);
    this.hp = this.maxHp;
    this.dead = false;
    this.smokeTimer = 0;
    this.baseColor = null;
  }
  get damage01() { return 1 - this.hp / this.maxHp; }
}

export class Tank {
  /**
   * @param build   build-data object from parts.js
   * @param opts    { team:'blue'|'red', tint:number }
   */
  constructor(build, opts = {}) {
    this.build = build;
    this.team = opts.team || 'blue';
    this.stats = computeStats(build);
    this.upgrades = build.upgrades || emptyUpgrades();
    this.mul = upgradeMultipliers(this.upgrades);
    this.group = new THREE.Group();
    this.modules = [];
    this.turrets = [];
    this.tracks = [];
    this.hullMeshes = [];
    this.destroyed = false;

    // physics state
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.angVel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.recoil = 0;
    this.originOffset = opts.originOffset || null;

    this._buildMeshes(opts.tint);

    this.maxHp = this.modules.reduce((s, m) => s + m.maxHp, 0);
    this.hp = this.maxHp;
    this.radius = Math.max(this.bounds.w, this.bounds.l) * 0.46;
  }

  // ─────────────── construction ───────────────
  _buildMeshes(tint) {
    const b = this.build;
    const bd = buildBounds(b);
    this.bounds = bd;
    // centre the chassis on its own footprint so it rotates about its middle,
    // unless the caller pins it to grid space (build bay preview)
    const ox = this.originOffset ? this.originOffset.ox : -bd.cx * CELL;
    const oz = this.originOffset ? this.originOffset.oz : -bd.cj * CELL;
    this.offset = { ox, oz };

    const treadMat = tint
      ? teamTint(Assets.mat.tread, 0xd8cfc6)
      : Assets.mat.tread;

    // ── tracks ──
    // Flood-fill the track cells into connected runs. Each run is a separate
    // bogie that carries its own suspension, so a tank with two side treads
    // articulates independently over rough ground.
    const runOf = new Map();
    {
      const cells = [...b.tracks.values()];
      const at = new Map(cells.map((c) => [key2(c.i, c.j), c]));
      let runId = 0;
      for (const c of cells) {
        const ck = key2(c.i, c.j);
        if (runOf.has(ck)) continue;
        const stack = [c];
        runOf.set(ck, runId);
        while (stack.length) {
          const cur = stack.pop();
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = key2(cur.i + di, cur.j + dj);
            if (at.has(nk) && !runOf.has(nk)) { runOf.set(nk, runId); stack.push(at.get(nk)); }
          }
        }
        runId++;
      }
      this.runCount = runId;
    }

    this.trackRuns = [];
    for (let r = 0; r < (this.runCount || 0); r++) {
      const members = [...b.tracks.values()].filter((t) => runOf.get(key2(t.i, t.j)) === r);
      let sx = 0, sz = 0, minJ = 1e9, maxJ = -1e9;
      for (const m of members) {
        sx += m.i; sz += m.j;
        if (m.j < minJ) minJ = m.j;
        if (m.j > maxJ) maxJ = m.j;
      }
      const grp = new THREE.Group();
      grp.position.set((sx / members.length) * CELL + ox, 0, (sz / members.length) * CELL + oz);
      this.group.add(grp);
      this.trackRuns.push({
        group: grp, mods: [],
        cx: grp.position.x, cz: grp.position.z,
        halfLen: Math.max(0.6, (maxJ - minJ + 1) * CELL * 0.5),
        y: 0, pitch: 0, vy: 0,
      });
    }

    for (const t of b.tracks.values()) {
      const def = ALL_PARTS[t.type];
      const run = this.trackRuns[runOf.get(key2(t.i, t.j))];
      const g = new THREE.Group();
      g.position.set(t.i * CELL + ox - run.cx, TRACK_H / 2, t.j * CELL + oz - run.cz);

      const shoe = new THREE.Mesh(rbox(CELL * 0.94, TRACK_H, CELL * 0.99, 0.09), treadMat);
      shoe.castShadow = shoe.receiveShadow = true;
      g.add(shoe);

      // road wheel peeking through the tread
      const isEnd = !b.tracks.has(key2(t.i, t.j - 1)) || !b.tracks.has(key2(t.i, t.j + 1));
      const wheel = new THREE.Mesh(isEnd ? Assets.geo.sprocket : Assets.geo.wheel, Assets.mat.wheel);
      wheel.position.y = 0.02;   // small parts skip shadow casting — pure cost, no read
      g.add(wheel);

      g.userData.cell = t; g.userData.kind = 'track';
      run.group.add(g);
      const mod = new Module('track', g, def, t, this.mul.hp);
      mod.wheel = wheel;
      mod.run = run;
      run.mods.push(mod);
      this.modules.push(mod);
      this.tracks.push(mod);
    }

    // ── hull blocks ──
    for (const blk of b.blocks.values()) {
      const def = ALL_PARTS[blk.type];
      let mat = Assets.mat.block[blk.type];
      if (tint !== undefined) mat = teamTint(mat, tint);

      let geo;
      if (def.sloped) {
        geo = slopedBlockGeometry();
      } else {
        geo = rbox(CELL * 1.0, BLOCK_H * 1.02, CELL * 1.0, 0.03);
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(blk.i * CELL + ox, TRACK_H + BLOCK_H * (blk.k + 0.5), blk.j * CELL + oz);
      m.castShadow = m.receiveShadow = true;
      m.userData.cell = blk; m.userData.kind = 'block';
      this.group.add(m);

      if (def.engine) {
        // exhaust stack + grille glow so the engine block reads at a glance
        const stack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.095, 0.34, 10), Assets.mat.barrel);
        stack.position.set(m.position.x + 0.3, m.position.y + BLOCK_H * 0.5 + 0.15, m.position.z);
        stack.castShadow = true;
        this.group.add(stack);
        m.userData.stack = stack;
        m.userData.exhaust = new THREE.Vector3(0.3, BLOCK_H * 0.5 + 0.32, 0)
          .add(m.position);
      }

      const mod = new Module('block', m, def, blk, this.mul.hp);
      mod.baseColor = mat.color.clone();
      this.modules.push(mod);
      this.hullMeshes.push(m);
    }

    // ── turrets ──
    for (const t of b.turrets.values()) {
      const def = ALL_PARTS[t.type];
      const rot = t.rot || 0;
      const [fw, fd] = footOf(def, rot);
      const k = topLayer(b, t.i, t.j);
      const baseY = TRACK_H + BLOCK_H * (k + 1);
      // a multi-cell gun sits at the centre of the platform it occupies
      const cx = t.i + (fw - 1) / 2;
      const cz = t.j + (fd - 1) / 2;
      const tur = this._makeTurret(def, tint, rot);
      tur.mount.position.set(cx * CELL + ox, baseY, cz * CELL + oz);
      tur.origin = tur.mount.position.clone();
      tur.mount.userData.cell = t; tur.mount.userData.kind = 'turret';
      this.group.add(tur.mount);

      const mod = new Module('turret', tur.mount, def, t, this.mul.hp);
      mod.turret = tur;
      tur.module = mod;
      this.modules.push(mod);
      this.turrets.push(tur);
    }
  }

  _makeTurret(def, tint, rot = 0) {
    const mount = new THREE.Group();        // bolted to the hull, does not traverse
    const yawGroup = new THREE.Group();     // the gun itself, traverses freely
    const gunMat = tint !== undefined ? teamTint(Assets.mat.gun, tint) : Assets.mat.gun;
    const [fw, fd] = footOf(def, rot);
    const bd = def.barrel;
    const count = bd.count || 1;
    const scale = Math.max(fw, fd);          // bigger footprint = physically bigger gun

    // ── bed plate: shows exactly which cells the mount claims ──
    const PLATE_H = 0.13;
    if (fw > 1 || fd > 1) {
      const plate = new THREE.Mesh(
        rbox(fw * CELL * 0.95, PLATE_H, fd * CELL * 0.95, 0.04), gunMat);
      plate.position.y = PLATE_H / 2;
      plate.castShadow = plate.receiveShadow = true;
      mount.add(plate);
    }
    yawGroup.position.y = (fw > 1 || fd > 1) ? PLATE_H : 0;
    mount.add(yawGroup);

    // ── ring / base ──
    const ringR = def.ring || 0.42;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(ringR, ringR * 1.08, 0.10, 22), Assets.mat.barrel);
    ring.position.y = 0.05;
    yawGroup.add(ring);

    // ── body sized to the footprint ──
    // body proportions come from the gun's own size, so turning the mount
    // doesn't turn the turret into a different shape
    const [gw, gd] = footOf(def, 0);
    const bodyH = 0.34 + scale * 0.10;
    let bodyGeo;
    if (bd.pod) bodyGeo = rbox(0.86, 0.44, 0.72, 0.06);
    else bodyGeo = rbox(gw * 0.82 + 0.14, bodyH, gd * 0.86 + 0.24, 0.08);
    const body = new THREE.Mesh(bodyGeo, gunMat);
    const bodyY = 0.10 + bodyH / 2;
    body.position.y = bodyY;
    body.castShadow = body.receiveShadow = true;
    yawGroup.add(body);

    // heavy mounts get a rear counterweight / bustle
    if (scale > 1 || def.kind === 'shell') {
      const bustle = new THREE.Mesh(
        rbox(gw * 0.62 + 0.10, bodyH * 0.62, 0.36, 0.05), gunMat);
      bustle.position.set(0, bodyY + 0.02, -(gd * 0.43 + 0.28));
      bustle.castShadow = true;
      yawGroup.add(bustle);
    }

    // ── elevating mantlet + barrels ──
    const pitchGroup = new THREE.Group();
    pitchGroup.position.set(0, bodyY, bd.pod ? 0.18 : gd * 0.30 + 0.10);
    yawGroup.add(pitchGroup);

    if (!bd.pod) {
      // size the mantlet off the barrel, not the footprint, so a wide mount
      // with slim barrels doesn't grow an oversized collar
      const mantR = Math.max(0.17, bd.rad * 2.3) * (count > 1 ? 1.25 : 1);
      const mantlet = new THREE.Mesh(
        new THREE.CylinderGeometry(mantR * 0.9, mantR, 0.30 + 0.18 * scale, 16),
        Assets.mat.barrel);
      mantlet.rotation.z = Math.PI / 2;
      mantlet.castShadow = true;
      pitchGroup.add(mantlet);

      // recoil cylinders flanking the breech on the heavier guns
      if (bd.rad > 0.12) {
        for (const sx of [-1, 1]) {
          const rc = new THREE.Mesh(
            new THREE.CylinderGeometry(bd.rad * 0.42, bd.rad * 0.42, bd.len * 0.34, 10),
            Assets.mat.barrel);
          rc.rotation.x = Math.PI / 2;
          rc.position.set(sx * mantR * 0.82, mantR * 0.5, bd.len * 0.20);
          rc.castShadow = true;
          pitchGroup.add(rc);
        }
      }
    }

    const tips = [];
    const addBarrel = (xOff) => {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(bd.rad * 0.86, bd.rad, bd.len, 14), Assets.mat.barrel);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(xOff, 0, bd.len / 2);
      bar.castShadow = true;
      pitchGroup.add(bar);
      if (bd.brake) {
        const brake = new THREE.Mesh(
          new THREE.CylinderGeometry(bd.rad * 1.5, bd.rad * 1.5, 0.28, 14), Assets.mat.barrel);
        brake.rotation.x = Math.PI / 2;
        brake.position.set(xOff, 0, bd.len - 0.14);
        pitchGroup.add(brake);
        // muzzle-brake vents
        for (const sx of [-1, 1]) {
          const vent = new THREE.Mesh(
            new THREE.BoxGeometry(bd.rad * 0.5, bd.rad * 1.9, 0.09), Assets.mat.barrel);
          vent.position.set(xOff + sx * bd.rad * 1.5, 0, bd.len - 0.14);
          pitchGroup.add(vent);
        }
      }
      const tip = new THREE.Object3D();
      tip.position.set(xOff, 0, bd.len + 0.14);
      pitchGroup.add(tip);
      tips.push(tip);
    };

    if (bd.pod) {
      // 2×3 missile tube cluster
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.10, 0.10, 0.66, 10), Assets.mat.barrel);
        tube.rotation.x = Math.PI / 2;
        tube.position.set((c - 1) * 0.24, (r - 0.5) * 0.22, 0.34);
        tube.castShadow = true;
        pitchGroup.add(tube);
      }
      const tip = new THREE.Object3D();
      tip.position.set(0, 0, 0.72);
      pitchGroup.add(tip);
      tips.push(tip);
    } else {
      const spacing = bd.spacing || 0.16;
      for (let n = 0; n < count; n++) {
        const xOff = count === 1 ? 0 : (n - (count - 1) / 2) * spacing * 2;
        addBarrel(xOff);
      }
    }

    // optics block — small detail that sells the silhouette
    const optic = new THREE.Mesh(rbox(0.18, 0.14, 0.12, 0.03), Assets.mat.barrel);
    optic.position.set(ringR * 0.68, bodyY + bodyH / 2 + 0.06, -0.10);
    yawGroup.add(optic);

    return {
      def, mount, yawGroup, pitchGroup, tips, tipIndex: 0, rot,
      yaw: 0, pitch: 0, cooldown: 0, heat: 0, dead: false,
      recoil: 0, recoilBase: pitchGroup.position.z,
      salvo: !!def.salvo,
      damage: def.damage * (this.mul ? this.mul.damage : 1),
      splash: def.splash,
      mode: 'manual',            // battle-mode gunner assignment
      aiTarget: null,
    };
  }

  // ─────────────── runtime ───────────────
  /** Aim one turret at a world point. Returns true when it is on target. */
  aimTurret(t, target, dt, turnSpeed = 3.2) {
    if (t.dead) return false;
    // world → chassis-local so turret yaw is relative to the hull
    _v.copy(target);
    this.group.worldToLocal(_v);
    _v2.copy(t.origin || t.yawGroup.position);
    const dx = _v.x - _v2.x, dz = _v.z - _v2.z, dy = _v.y - (_v2.y + 0.45);
    const wantYaw = Math.atan2(dx, dz);
    const horiz = Math.hypot(dx, dz);
    const wantPitch = clamp(-Math.atan2(dy, horiz), -0.32, 0.20);

    // heavy guns traverse more slowly — a 155mm can't whip around
    const mass = 1 / (1 + (t.def.weight || 200) / 620);
    const rate = turnSpeed * (0.45 + mass);

    const dYaw = angleDelta(t.yaw, wantYaw);
    t.yaw = turnToward(t.yaw, wantYaw, rate * dt);
    t.pitch += clamp(wantPitch - t.pitch, -1.4 * dt, 1.4 * dt);
    t.yawGroup.rotation.y = t.yaw;
    t.pitchGroup.rotation.x = t.pitch;
    return Math.abs(dYaw) < 0.055;
  }

  /** Per-frame cooldown/recoil bookkeeping for one turret. */
  tickTurret(t, dt) {
    if (t.recoil > 0) {
      t.recoil = Math.max(0, t.recoil - dt * 4.5);
      t.pitchGroup.position.z = t.recoilBase - t.recoil;
    }
    t.cooldown = Math.max(0, t.cooldown - dt);
    t.heat = Math.max(0, t.heat - dt * 0.55);
  }

  /** Aim every live turret at one point (used by the AI and manual gunners). */
  aimAt(target, dt, turnSpeed = 3.2) {
    let onTarget = true;
    for (const t of this.turrets) {
      if (t.dead) continue;
      if (!this.aimTurret(t, target, dt, turnSpeed)) onTarget = false;
      this.tickTurret(t, dt);
    }
    return onTarget;
  }

  /** World-space muzzle position + forward direction for one barrel. */
  muzzleAt(t, tipIdx, outPos, outDir) {
    const tip = t.tips[tipIdx % t.tips.length];
    tip.getWorldPosition(outPos);
    tip.getWorldQuaternion(_q);
    outDir.set(0, 0, 1).applyQuaternion(_q).normalize();
    return outPos;
  }

  /** Which barrels fire on this trigger pull. */
  firingTips(t) {
    if (t.salvo) return t.tips.map((_, i) => i);
    return [t.tipIndex % t.tips.length];
  }

  muzzle(t, outPos, outDir) {
    return this.muzzleAt(t, t.tipIndex, outPos, outDir);
  }

  canFire(t) { return !t.dead && !this.destroyed && t.cooldown <= 0; }

  markFired(t) {
    t.cooldown = t.def.reload;
    if (!t.salvo) t.tipIndex++;
    t.recoil = t.def.barrel.pod ? 0.05 : Math.min(0.34, t.def.damage * 0.005);
    t.heat = Math.min(1, t.heat + (t.def.reload < 0.2 ? 0.12 : 0.3));
  }

  /** Locate the module nearest a world-space impact point. */
  moduleAt(worldPoint) {
    let best = null, bestD = Infinity;
    for (const m of this.modules) {
      if (m.dead) continue;
      m.mesh.getWorldPosition(_v);
      const d = _v.distanceToSquared(worldPoint);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  /**
   * Apply damage at a point. Sloped armour deflects a share of it.
   * @returns {{module:Module, killed:boolean, destroyedTank:boolean, deflected:boolean}}
   */
  applyDamage(worldPoint, amount) {
    if (this.destroyed || this.invulnerable) return null;
    const m = this.moduleAt(worldPoint);
    if (!m) return null;
    let deflected = false;
    let dmg = amount;
    if (m.def.sloped && Math.random() < 0.35) { dmg *= 0.35; deflected = true; }
    m.hp -= dmg;
    this.hp = Math.max(0, this.hp - dmg);

    let killed = false;
    if (m.hp <= 0) {
      m.hp = 0; m.dead = true; killed = true;
      this._killModule(m);
    } else if (m.baseColor) {
      // scorch the plate progressively as it takes hits
      this._ownMaterial(m);
      m.mesh.material.color.copy(m.baseColor).multiplyScalar(1 - m.damage01 * 0.55);
    }

    // a "structural kill": once enough of the hull is gone the tank is finished,
    // even if odd plates and track sections are still nominally intact
    const structural = this.modules.filter((x) => x.kind === 'block');
    const aliveStructural = structural.filter((x) => !x.dead).length;
    const destroyedTank = this.hp <= 0 || aliveStructural === 0 ||
      aliveStructural / Math.max(1, structural.length) < 0.6;
    if (destroyedTank) this.destroyed = true;
    return { module: m, killed, destroyedTank, deflected };
  }

  _killModule(m) {
    if (m.kind === 'turret') {
      m.turret.dead = true;
      m.mesh.rotation.z = (Math.random() - 0.5) * 0.5;
      m.mesh.position.y -= 0.06;
    } else if (m.kind === 'track') {
      m.mesh.rotation.z = (Math.random() - 0.5) * 0.35;
      m.mesh.position.y -= 0.12;
    } else {
      // blow the plate off the hull
      m.mesh.visible = false;
    }
    if (m.mesh.material && m.mesh.material.color) {
      this._ownMaterial(m);
      m.mesh.material.color.multiplyScalar(0.25);
    }
  }

  /** Give a module its own material instance — once — so damage can tint it. */
  _ownMaterial(m) {
    if (m.ownsMaterial || !m.mesh.material || !m.mesh.material.clone) return;
    m.mesh.material = m.mesh.material.clone();
    m.mesh.material._owned = true;
    m.ownsMaterial = true;
    if (!m.baseColor && m.mesh.material.color) m.baseColor = m.mesh.material.color.clone();
  }

  /**
   * Patch up surviving modules between waves. Destroyed modules stay destroyed —
   * you cannot weld a blown-off plate back on in the field.
   * @returns the amount of integrity restored
   */
  repair(frac) {
    let restored = 0;
    for (const m of this.modules) {
      if (m.dead || m.hp >= m.maxHp) continue;
      const before = m.hp;
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * frac);
      restored += m.hp - before;
      if (m.baseColor && m.mesh.material.color) {
        m.mesh.material.color.copy(m.baseColor).multiplyScalar(1 - m.damage01 * 0.55);
      }
    }
    this.hp = Math.min(this.maxHp, this.hp + restored);
    return Math.round(restored);
  }

  /** Drive-power fraction remaining — losing tracks slows you down. */
  get mobility() {
    if (!this.tracks.length) return 0;
    const alive = this.tracks.filter((t) => !t.dead).length;
    return alive / this.tracks.length;
  }

  get liveTurrets() { return this.turrets.filter((t) => !t.dead); }

  /** Sync the transform from physics state. */
  syncTransform() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  /**
   * Independent suspension per track run.
   * Each run samples the ground under its own front and back, then rides to
   * that height with a damped spring — so a tank straddling a rock leans on
   * it, and a dead track sags instead of floating.
   */
  updateSuspension(dt) {
    if (!this.trackRuns || !this.trackRuns.length) return;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const TRAVEL = 0.42;                    // metres of articulation either way

    for (const run of this.trackRuns) {
      // run centre and its fore/aft contact patches, in world space
      const wx = this.pos.x + (run.cx * cy + run.cz * sy);
      const wz = this.pos.z + (-run.cx * sy + run.cz * cy);
      const fx = wx + sy * run.halfLen, fz = wz + cy * run.halfLen;
      const bx = wx - sy * run.halfLen, bz = wz - cy * run.halfLen;

      const hF = heightAt(fx, fz), hB = heightAt(bx, bz);
      const ground = Math.max(hF, hB) * 0.5 + Math.min(hF, hB) * 0.5;

      // where the run wants to sit relative to the hull
      let want = ground - this.pos.y;
      const dead = run.mods.length && run.mods.every((m) => m.dead);
      if (dead) want -= 0.22;               // a wrecked run drops off its torsion bars
      want = clamp(want, -TRAVEL, TRAVEL);

      // critically-damped spring, so it settles without wobbling
      const k = 130, c = 21;
      run.vy += (want - run.y) * k * dt - run.vy * c * dt;
      run.vy = clamp(run.vy, -14, 14);
      run.y = clamp(run.y + run.vy * dt, -TRAVEL * 1.3, TRAVEL * 1.3);

      // pitch the bogie to match the slope it is actually sitting on
      const wantPitch = clamp(Math.atan2(hB - hF, run.halfLen * 2) - this.pitch, -0.30, 0.30);
      run.pitch += (wantPitch - run.pitch) * Math.min(1, 9 * dt);

      run.group.position.y = run.y;
      run.group.rotation.x = run.pitch;
    }
  }

  /**
   * Shadow casting is re-rendered for every caster each frame. A full wave of
   * tanks is hundreds of meshes, so distant ones stop casting — at that range
   * their shadow is a few pixels.
   */
  setShadowCasting(on) {
    if (this._shadowOn === on) return;
    this._shadowOn = on;
    this.group.traverse((o) => { if (o.isMesh && o.castShadow !== undefined) o.castShadow = on; });
  }

  /** Spin road wheels with travel — cheap but reads as motion. */
  spinWheels(dt) {
    const r = this.speed * dt / 0.30;
    for (const t of this.tracks) if (t.wheel && !t.dead) t.wheel.rotation.x += r;
  }

  /** Release only the materials this tank owns; shared ones stay in the cache. */
  dispose() {
    for (const m of this.modules) {
      if (m.ownsMaterial && m.mesh.material) m.mesh.material.dispose();
    }
  }
}

// ─────────────── sloped glacis geometry ───────────────
let _slopedGeo = null;
function slopedBlockGeometry() {
  if (_slopedGeo) return _slopedGeo;
  const w = CELL * 1.0, h = BLOCK_H * 1.02, d = CELL * 1.0;
  // a box whose +Z top edge is pulled back, giving an angled front face
  const g = new THREE.BufferGeometry();
  const hw = w / 2, hh = h / 2, hd = d / 2, slope = d * 0.55;
  const v = [
    // bottom face corners
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh, hd,  -hw, -hh, hd,
    // top face corners (front edge pulled back by `slope`)
    -hw, hh, -hd,  hw, hh, -hd,  hw, hh, hd - slope,  -hw, hh, hd - slope,
  ];
  const idx = [
    0, 2, 1, 0, 3, 2,       // bottom
    4, 5, 6, 4, 6, 7,       // top
    3, 6, 2, 3, 7, 6,       // sloped front
    0, 1, 5, 0, 5, 4,       // back
    1, 2, 6, 1, 6, 5,       // right
    0, 4, 7, 0, 7, 3,       // left
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // planar UVs so the armour texture still tiles sensibly
  const pos = g.attributes.position;
  const uv = [];
  for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i) / w + 0.5, pos.getZ(i) / d + 0.5);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  _slopedGeo = g;
  return g;
}
