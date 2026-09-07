// ───────────────────────────────────────────────────────────────
//  BATTLE MODE — third-person combat.
//  Owns the battlefield, the player vehicle, projectile pool,
//  wave spawning and the combat HUD.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Battlefield, heightAt, MAPS, getMap } from './world.js';
import { Tank } from './tank.js';
import { AITank } from './ai.js';
import { FX } from './fx.js';
import { Assets } from './assets.js';
import { clamp, smooth, rand, chance } from './util.js';
import { Save } from './save.js';
import { Ads } from './ads.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const GRAVITY = -20;

// ─────────────── projectiles ───────────────
class Projectile {
  constructor(mesh) {
    this.mesh = mesh;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.prev = new THREE.Vector3();
  }
}

export class BattleMode {
  constructor(app) {
    this.app = app;
    this.field = new Battlefield(app.renderer);
    this.scene = this.field.scene;
    this.fx = new FX(this.scene);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 900);
    this.camYaw = 0;
    this.camPitch = 0.16;
    this.camDist = 11;
    this.camTargetDist = 11;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.shake = 0;

    this.enemies = [];      // red team
    this.allies = [];       // blue team AI, fighting alongside you
    this.allyCount = 2;
    this.projectiles = [];
    this.active = false;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.time = 0;
    this.aimPoint = new THREE.Vector3();
    this.keys = {};
    this.firing = false;
    this.playerVel = new THREE.Vector3();

    this._makeProjectilePool();
    this._bindDOM();
    this._bindInput();
  }

  /** Everything on the player's side, in a uniform unit shape. */
  blueUnits() {
    const out = this.playerUnit ? [this.playerUnit] : [];
    for (const a of this.allies) out.push(a);
    return out;
  }
  redUnits() { return this.enemies; }

  /** The units a given combatant is trying to kill. */
  foesOf(unit) { return unit.team === 'blue' ? this.redUnits() : this.blueUnits(); }
  alliesOf(unit) { return unit.team === 'blue' ? this.blueUnits() : this.redUnits(); }

  /** Which team a tank belongs to. */
  teamOf(tank) {
    if (tank === this.player) return 'blue';
    for (const a of this.allies) if (a.tank === tank) return 'blue';
    return 'red';
  }

  _makeProjectilePool() {
    const mkPool = (mat, n) => {
      const arr = [];
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(Assets.geo.shell, mat);
        m.visible = false;
        m.frustumCulled = false;
        this.scene.add(m);
        arr.push(new Projectile(m));
      }
      return arr;
    };
    this.projectiles = [
      ...mkPool(Assets.mat.tracer, 90),
      ...mkPool(Assets.mat.tracerEnemy, 90),
    ];
    this.playerPool = this.projectiles.slice(0, 90);
    this.enemyPool = this.projectiles.slice(90);
  }

  _bindDOM() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('battle-ui'), hp: $('b-hp'), hpbar: $('b-hpbar'), parts: $('b-parts'),
      armour: $('b-armor'), wave: $('b-wave'), enemies: $('b-enemies'), score: $('b-score'),
      squad: $('b-squad'),
      speed: $('b-speed'), throttle: $('b-throttle'), weapons: $('b-weapons'),
      minimap: $('minimap'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      vignette: $('vignette'), hitflash: $('hitflash'), killfeed: $('killfeed'), banner: $('banner'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
  }

  _bindInput() {
    const dom = this.app.renderer.domElement;

    addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyB' || e.code === 'Escape') this.app.returnToBuild();
      if (e.code === 'KeyM') this.app.audio.setMuted(this.app.audio.enabled);
      if (e.code === 'KeyT') this.toggleAllTurrets();
      if (e.code.startsWith('Digit')) {
        const n = +e.code.slice(5);
        if (n >= 1 && n <= 9) this.toggleTurret(n - 1);
      }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    dom.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement !== dom) { dom.requestPointerLock(); return; }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.camTargetDist = 7.5;      // zoom in for a steadier shot
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.camTargetDist = 11;
    });
    addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== dom) return;
      const s = this.app.settings;
      const sens = s.sensitivity || 1;
      this.camYaw -= e.movementX * 0.0022 * sens * (s.invertX ? -1 : 1);
      this.camPitch = clamp(
        this.camPitch + e.movementY * 0.0019 * sens * (s.invertY ? -1 : 1), -0.30, 0.62);
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.camTargetDist = clamp(this.camTargetDist + e.deltaY * 0.01, 6, 20);
    }, { passive: true });
  }

  // ─────────────── lifecycle ───────────────
  /** Rebuild the battlefield for another map. Safe to call between runs. */
  setMap(id) {
    if (getMap().id === id) return getMap();
    const m = this.field.applyMap(id);
    // anything already on the field is standing on the old terrain
    for (const e of this.enemies) e.removeFrom(this.scene);
    for (const a of this.allies) a.removeFrom(this.scene);
    this.enemies.length = 0;
    this.allies.length = 0;
    return m;
  }

  start(build) {
    // clean up any previous run
    for (const e of this.enemies) e.removeFrom(this.scene);
    for (const a of this.allies) a.removeFrom(this.scene);
    this.enemies.length = 0;
    this.allies.length = 0;
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
    if (this.player) { this.scene.remove(this.player.group); this.player.dispose(); }

    this.player = new Tank(build, { team: 'blue' });
    this.player.pos.set(0, heightAt(0, 0), 0);
    this.player.yaw = 0;
    this.player.velVec = this.playerVel;
    this.player.syncTransform();
    this.scene.add(this.player.group);

    // the player presented in the same shape as an AI unit, so targeting,
    // line-of-sight and projectile code never special-cases them
    const self = this;
    this.playerUnit = {
      team: 'blue', isPlayer: true, tank: this.player, tier: 0,
      get pos() { return self.player.pos; },
      get alive() { return !self.player.destroyed; },
    };

    // Carry the run across a trip to the assembly bay: pulling back to refit
    // should drop you into the same wave, not restart the ladder.
    const carry = this.pendingRun;
    this.pendingRun = null;
    this.wave = Math.max(0, (carry ? carry.wave : (this.resumeWave || 1)) - 1);
    this.resumeWave = 0;
    this.score = carry ? carry.score : 0;
    this.kills = carry ? carry.kills : 0;
    this.time = 0;
    this.gameOver = false;
    this.godMode = this.godMode || false;
    this.waveClearing = false;
    this.waveTimer = 0;
    this.endTimer = 0;
    this.camYaw = 0;
    this.camPitch = 0.16;
    this.shake = 0;
    this.el.vignette.style.opacity = 0;

    // you personally lay the primary gun; secondaries get an AI gunner
    let primary = 0, bestDmg = -1;
    this.player.turrets.forEach((t, i) => {
      const weight = t.def.damage * (t.salvo ? (t.def.barrel.count || 1) : 1);
      if (weight > bestDmg) { bestDmg = weight; primary = i; }
    });
    this.player.turrets.forEach((t, i) => { t.mode = i === primary ? 'manual' : 'auto'; t.aiTarget = null; });

    this.renderWeapons();
    this.spawnAllies();
    this.nextWave();

    this.active = true;
    this.el.root.classList.remove('hidden');
    this.app.setScene(this.scene, this.camera);
    this.app.audio.startEngine();

    const dom = this.app.renderer.domElement;
    setTimeout(() => { if (this.active) dom.requestPointerLock(); }, 80);
  }

  /** Stash the run so redeploying continues it rather than starting over. */
  suspend() {
    if (!this.active || this.gameOver || !this.player) return null;
    this.pendingRun = { wave: this.wave, score: this.score, kills: this.kills };
    return this.pendingRun;
  }

  /** Discard any suspended run — used when deliberately starting fresh. */
  clearRun() { this.pendingRun = null; }

  stop() {
    this.active = false;
    this.el.root.classList.add('hidden');
    this.app.audio.stopEngine();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ─────────────── waves ───────────────
  /** Bring the player's wingmen up to strength. */
  spawnAllies(count = this.allyCount, tier = null) {
    const t = tier ?? Math.max(1, Math.min(3, Math.floor(this.wave / 2) + 1));
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), r = rand(11, 22);
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)
        .add(this.player ? this.player.pos : new THREE.Vector3());
      this.allies.push(new AITank(this, t, p, 'blue'));
    }
    this.renderSquad();
  }

  nextWave() {
    this.wave++;
    const count = Math.min(9, 1 + Math.round(this.wave * 1.3));
    const tier = 1 + Math.floor((this.wave - 1) / 2);
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      // close enough to make contact quickly, far enough to need a manoeuvre
      const r = rand(55, Math.min(70 + this.wave * 12, 150));
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.enemies.push(new AITank(this, Math.min(4, tier + (chance(0.25) ? 1 : 0)), p, 'red'));
    }
    const squad = this.allies.filter((a) => a.alive).length;
    this.banner(`WAVE ${this.wave}`,
      `${count} hostile${count > 1 ? 's' : ''} inbound` + (squad ? ` · ${squad} wingman${squad > 1 ? 'en' : ''}` : ''));
    this.app.audio.ui(0.5);
  }

  onAIDestroyed(unit) {
    const dist = this.player.pos.distanceTo(unit.pos);
    _v.copy(unit.pos); _v.y += 0.9;
    this.fx.explosion(_v, 1.5 + unit.tier * 0.2);
    this.app.audio.explode(1.3, dist);
    this.shake = Math.max(this.shake, clamp(24 / (1 + dist), 0, 0.6));

    if (unit.team === 'red') {
      this.kills++;
      this.score += 100 * unit.tier;
      this.addKill(`Hostile <b>T${unit.tier}</b> destroyed`);
    } else {
      this.addKill(`<span style="color:var(--red)">Wingman down</span>`);
      this.renderSquad();
    }
  }

  // ─────────────── vehicle physics ───────────────
  /**
   * Shared drive model for player and AI.
   * Momentum, mass-limited acceleration, terrain following and
   * body roll all come from the build's computed stats.
   */
  stepVehicle(t, throttle, steer, dt, isPlayer) {
    const s = t.stats;
    const mob = t.mobility;                      // lost tracks = lost drive
    if (mob <= 0.01) { throttle = 0; steer *= 0.2; }

    const top = s.topSpeed * (0.35 + 0.65 * mob);
    const accel = s.accel * mob;
    const target = throttle * (throttle >= 0 ? top : top * 0.42);

    if (Math.abs(throttle) > 0.02) {
      const diff = target - t.speed;
      t.speed += clamp(diff, -accel * 2.4 * dt, accel * dt);
    } else {
      // engine braking + rolling resistance
      t.speed -= t.speed * Math.min(1, 2.2 * dt);
      if (Math.abs(t.speed) < 0.04) t.speed = 0;
    }
    t.speed = clamp(t.speed, -top * 0.45, top);

    // heavier tanks turn lazily; you can neutral-steer but slowly
    const speedFactor = 0.34 + 0.66 * clamp(Math.abs(t.speed) / Math.max(top, 0.1), 0, 1);
    const rate = s.turnRate * mob * speedFactor;
    const wantAng = steer * rate;
    t.angVel = smooth(t.angVel, wantAng, 7, dt);
    t.yaw += t.angVel * dt * (t.speed < -0.1 ? -1 : 1);

    // integrate
    const fwd = _v.set(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    const before = _v2.copy(t.pos);
    t.pos.addScaledVector(fwd, t.speed * dt);

    const hit = this.field.resolveCollision(t.pos, t.radius);
    let jammed = false;
    if (hit) {
      const moved = _v3.subVectors(t.pos, before).length();
      if (moved < Math.abs(t.speed) * dt * 0.35) {
        // genuinely stuck against something solid
        if (isPlayer && Math.abs(t.speed) > 5) {
          this.app.audio.hit(false, 0);
          this.shake = Math.max(this.shake, 0.12);
        }
        t.speed *= 0.25;
        jammed = true;
      }
    }
    // a unit asking for drive but going nowhere is wedged; the AI uses this to
    // back out, otherwise it can sit against a boulder forever and stall the wave
    if (jammed || (Math.abs(throttle) > 0.3 && Math.abs(t.speed) < 0.6)) {
      t.stuckTime = (t.stuckTime || 0) + dt;
    } else {
      t.stuckTime = Math.max(0, (t.stuckTime || 0) - dt * 2.5);
    }

    // terrain following
    const gh = heightAt(t.pos.x, t.pos.z);
    t.pos.y = smooth(t.pos.y, gh, 14, dt);

    // body attitude: terrain slope + weight transfer under accel/turn
    const L = Math.max(1.2, t.bounds.l * 0.45), W = Math.max(1.0, t.bounds.w * 0.45);
    const hF = heightAt(t.pos.x + fwd.x * L, t.pos.z + fwd.z * L);
    const hB = heightAt(t.pos.x - fwd.x * L, t.pos.z - fwd.z * L);
    const rgt = _v3.set(fwd.z, 0, -fwd.x);
    const hR = heightAt(t.pos.x + rgt.x * W, t.pos.z + rgt.z * W);
    const hL = heightAt(t.pos.x - rgt.x * W, t.pos.z - rgt.z * W);

    const slopePitch = Math.atan2(hB - hF, 2 * L);
    const slopeRoll = Math.atan2(hR - hL, 2 * W);
    const accelPitch = clamp((t.speed - (t.lastSpeed || 0)) / Math.max(dt, 1e-3) * 0.008, -0.09, 0.09);
    const turnRoll = clamp(-t.angVel * Math.abs(t.speed) * 0.020, -0.11, 0.11);
    t.lastSpeed = t.speed;

    t.pitch = smooth(t.pitch, slopePitch + accelPitch + (t.recoil || 0) * 0.4, 9, dt);
    t.roll = smooth(t.roll, slopeRoll + turnRoll, 8, dt);
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 3);

    t.syncTransform();
    t.updateSuspension(dt);
    t.spinWheels(dt);

    // track dust + engine exhaust
    if (Math.abs(t.speed) > 0.6) {
      for (const trk of t.tracks) {
        if (trk.dead || Math.random() > 0.25) continue;
        trk.mesh.getWorldPosition(_v3);
        this.fx.trackDust(_v3, Math.abs(t.speed) * 0.11, dt);
      }
    }
    for (const m of t.hullMeshes) {
      if (m.userData.exhaust) {
        _v3.copy(m.userData.exhaust).applyMatrix4(t.group.matrixWorld);
        this.fx.exhaust(_v3, clamp(Math.abs(throttle), 0, 1), dt);
      }
    }
  }

  /** Smoke and sparks streaming off damaged modules. */
  emitDamageFx(t, dt) {
    for (const m of t.modules) {
      const sev = m.dead ? 1 : m.damage01;
      if (sev < 0.45) continue;
      m.mesh.getWorldPosition(_v);
      _v.y += 0.25;
      this.fx.damageSmoke(_v, (sev - 0.4) * 1.5, dt);
      if (sev > 0.8 && chance(dt * 2.2)) {
        _n.set(rand(-1, 1), 1, rand(-1, 1)).normalize();
        this.fx.impactSparks(_v, _n, 3, true);
      }
    }
  }

  // ─────────────── shooting ───────────────
  fireTurret(owner, turret) {
    const tank = owner.tank || owner;
    if (!tank.canFire(turret)) return;
    const isPlayer = tank === this.player;
    const def = turret.def;
    const team = owner.team === 'red' ? 'red' : owner.team === 'blue' ? 'blue' : this.teamOf(tank);
    const pool = team === 'blue' ? this.playerPool : this.enemyPool;

    // salvo guns send every barrel downrange on one trigger pull
    const tips = tank.firingTips(turret);
    let fired = 0;

    for (const tipIdx of tips) {
      tank.muzzleAt(turret, tipIdx, _v, _v2);
      const spread = def.spread * (isPlayer ? (1 + turret.heat * 1.4) : 1.0);
      _v2.x += rand(-spread, spread);
      _v2.y += rand(-spread, spread);
      _v2.z += rand(-spread, spread);
      _v2.normalize();

      const p = pool.find((x) => !x.active);
      if (!p) break;
      fired++;

      p.active = true;
      p.owner = isPlayer ? 'player' : 'enemy';
      p.team = team;
      p.shooter = tank;
      p.def = def;
      p.damage = turret.damage !== undefined ? turret.damage : def.damage;
      p.splash = def.splash;
      p.life = 0;
      p.maxLife = def.range / def.muzzle + 1.5;
      p.homing = def.homing || 0;
      p.pos.copy(_v);
      p.prev.copy(_v);
      p.vel.copy(_v2).multiplyScalar(def.muzzle);
      p.mesh.visible = true;
      p.mesh.position.copy(_v);
      p.mesh.scale.setScalar(
        def.kind === 'missile' ? 2.0 : def.kind === 'shell' ? 1.1 + def.barrel.rad * 3 : 0.75);

      const fxScale = def.kind === 'shell' ? 1.1 + def.barrel.rad * 5
                    : def.kind === 'missile' ? 1.2 : 0.7;
      this.fx.muzzleFlash(_v, _v2, fxScale);
    }
    if (!fired) return;

    tank.markFired(turret);
    tank.recoil = Math.min(0.5, (tank.recoil || 0) + def.damage * 0.004 * tips.length);

    const dist = isPlayer ? 0 : this.player.pos.distanceTo(_v);
    this.app.audio.fire(def.kind, dist);
    if (isPlayer) {
      this.shake = Math.max(this.shake,
        def.kind === 'shell' ? clamp(0.10 + def.damage * 0.0022 * tips.length, 0.1, 0.45) : 0.05);
    }
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life += dt;
      p.prev.copy(p.pos);

      if (p.homing) {
        const tgt = this._nearestFoeToRay(p, p.pos, p.vel);
        if (tgt) this._homeToward(p, tgt.pos, dt);
      }
      p.vel.y += GRAVITY * (p.def.kind === 'missile' ? 0.15 : 0.55) * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.setFromUnitVectors(UP, _v.copy(p.vel).normalize());
      p.mesh.rotateX(Math.PI / 2);

      // tracer glow trail
      if (p.def.kind !== 'auto' || Math.random() < 0.6) {
        this.fx.hot.spawn({
          x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0, vz: 0,
          life: p.def.kind === 'missile' ? 0.5 : 0.12,
          size: p.def.kind === 'missile' ? 0.7 : 0.34, grow: p.def.kind === 'missile' ? 2.5 : 0,
          drag: 3, fade: 1, alpha: 0.9,
          from: p.team === 'blue' ? [1.0, 0.82, 0.45] : [1.0, 0.42, 0.28],
          to: [0.6, 0.15, 0.03],
        });
      }
      if (p.def.kind === 'missile') {
        this.fx.smoke.spawn({
          x: p.pos.x, y: p.pos.y, z: p.pos.z,
          vx: rand(-0.4, 0.4), vy: rand(0, 0.5), vz: rand(-0.4, 0.4),
          life: rand(0.8, 1.6), size: 0.32, grow: 3.2, drag: 1.4, alpha: 0.4,
          from: [0.75, 0.74, 0.72], to: [0.4, 0.4, 0.4],
        });
      }

      if (p.life > p.maxLife) { this._killProjectile(p); continue; }
      this._collideProjectile(p);
    }
  }

  _homeToward(p, target, dt) {
    _v.subVectors(target, p.pos);
    _v.y += 0.8;
    const d = _v.length();
    if (d < 0.5) return;
    _v.normalize().multiplyScalar(p.vel.length());
    p.vel.lerp(_v, clamp(p.homing * dt, 0, 1));
  }

  _nearestFoeToRay(p, pos, dir) {
    let best = null, bestD = Infinity;
    _v3.copy(dir).normalize();
    for (const e of (p.team === 'blue' ? this.redUnits() : this.blueUnits())) {
      if (!e.alive) continue;
      _v2.subVectors(e.pos, pos);
      const along = _v2.dot(_v3);
      if (along < 0) continue;
      const perp = _v2.lengthSq() - along * along;
      if (perp > 900) continue;                  // 30 m acquisition cone
      if (along < bestD) { bestD = along; best = e; }
    }
    return best;
  }

  _collideProjectile(p) {
    const seg = _v.subVectors(p.pos, p.prev);
    const segLen = seg.length();
    if (segLen < 1e-5) return;
    const dir = _v2.copy(seg).divideScalar(segLen);

    // ── ground ──
    const gh = heightAt(p.pos.x, p.pos.z);
    if (p.pos.y <= gh + 0.05) {
      p.pos.y = gh;
      this.detonate(p, p.pos, null);
      return;
    }
    // ── arena edge ──
    if (Math.hypot(p.pos.x, p.pos.z) > this.field.boundaryR + 6) { this._killProjectile(p); return; }

    // ── obstacles ──
    for (const o of this.field.obstacles) {
      const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z;
      if (Math.hypot(dx, dz) < o.radius && p.pos.y < o.pos.y + o.height + 0.5) {
        this.detonate(p, p.pos, null);
        return;
      }
    }

    // ── tanks (swept sphere against chassis radius, then module lookup) ──
    const targets = [];
    for (const u of (p.team === 'blue' ? this.redUnits() : this.blueUnits())) {
      if (u.alive && u.tank !== p.shooter) targets.push(u.tank);
    }

    for (const t of targets) {
      _v3.subVectors(t.pos, p.prev);
      const along = clamp(_v3.dot(dir), 0, segLen);
      const cx = p.prev.x + dir.x * along - t.pos.x;
      const cy = p.prev.y + dir.y * along - (t.pos.y + 0.8);
      const cz = p.prev.z + dir.z * along - t.pos.z;
      const r = t.radius + 0.5;
      if (cx * cx + cy * cy + cz * cz < r * r) {
        const hitPoint = _v.copy(p.prev).addScaledVector(dir, along);
        this.detonate(p, hitPoint, t);
        return;
      }
    }
  }

  detonate(p, point, directTank) {
    const def = p.def;
    const dmg = p.damage !== undefined ? p.damage : def.damage;
    const fromPlayer = p.owner === 'player';
    const fromBlue = p.team === 'blue';
    const distToCam = this.player ? this.player.pos.distanceTo(point) : 0;

    if (directTank) {
      // A big HE round should cave in a SECTION of hull, not the whole tank —
      // capped well under a chassis width so it never one-shots outright.
      const local = def.splash > 2 ? Math.min(def.splash * 0.20, 2.4) : 0;
      const res = directTank.applyDamage(point, dmg, local);
      _n.subVectors(point, directTank.pos).normalize();
      this.fx.impactSparks(point, _n, dmg, true);
      this.app.audio.hit(true, fromPlayer ? distToCam : 0);
      if (fromPlayer) {
        this.hitmarker(res && res.killed);
        this.score += Math.round(dmg);
      } else if (directTank === this.player) {
        this.playerHurt(dmg, res && res.deflected);
      }
      if (def.splash > 1) {
        this.fx.explosion(point, def.splash * 0.22);
        this.app.audio.explode(0.8, distToCam);
      }
    } else {
      // terrain / cover impact
      this.fx.groundHit(point, def.kind === 'shell' ? 1.2 : def.kind === 'missile' ? 1.6 : 0.45);
      if (def.kind !== 'auto') this.app.audio.explode(0.55, distToCam);
      else this.app.audio.hit(false, distToCam);
    }

    // ── splash damage to everything nearby ──
    if (def.splash > 0.5) {
      const all = [];
      for (const u of [...this.redUnits(), ...this.blueUnits()]) if (u.alive) all.push(u.tank);
      for (const t of all) {
        if (t === directTank) continue;
        const d = t.pos.distanceTo(point);
        if (d > def.splash) continue;
        const falloff = 1 - d / def.splash;
        const splashDmg = dmg * falloff * 0.55;
        // friendly fire is on — AI splash can hurt other AI
        const res = t.applyDamage(point, splashDmg);
        if (t === this.player) this.playerHurt(splashDmg, false);
        else if (fromPlayer && res && res.killed) this.hitmarker(true);
      }
    }

    if (def.kind === 'missile' || (def.kind === 'shell' && !directTank)) {
      this.shake = Math.max(this.shake, clamp(3.2 / (1 + distToCam * 0.5), 0, 0.5));
    }
    this._killProjectile(p);
  }

  _killProjectile(p) { p.active = false; p.mesh.visible = false; }

  playerHurt(amount, deflected) {
    if (this.godMode) return;
    this.el.hitflash.style.opacity = clamp(amount / 60, 0.12, 0.55);
    setTimeout(() => { this.el.hitflash.style.opacity = 0; }, 90);
    this.shake = Math.max(this.shake, clamp(amount / 90, 0.06, 0.4));
    this.app.audio.hurt();
    if (deflected) this.addKill('<b>DEFLECTED</b> &mdash; sloped armour held');
  }

  // ─────────────── player control ───────────────
  updatePlayer(dt) {
    const p = this.player;
    if (p.destroyed) {
      if (!this.gameOver) this.endRun(false);
      this.stepVehicle(p, 0, 0, dt, true);
      return;
    }
    const k = this.keys;
    let throttle = 0, steer = 0;
    if (k.KeyW || k.ArrowUp) throttle += 1;
    if (k.KeyS || k.ArrowDown) throttle -= 1;
    // Yaw increases toward world +X, which sits on the LEFT of the screen when
    // the camera looks down +Z — so left/right map to +/- steer, not the reverse.
    if (k.KeyA || k.ArrowLeft) steer += 1;
    if (k.KeyD || k.ArrowRight) steer -= 1;
    if (k.Space) { throttle = 0; p.speed *= Math.exp(-5 * dt); }
    // reversing inverts the steering feel, as on a real tracked vehicle
    if (throttle < 0) steer *= -1;

    this.stepVehicle(p, throttle, steer, dt, true);
    this.playerVel.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(p.speed);
    this.throttleDisplay = Math.abs(throttle);

    this.app.audio.engineState(
      Math.abs(throttle), clamp(Math.abs(p.speed) / Math.max(1, p.stats.topSpeed), 0, 1));

    // ── aiming & gunnery ──
    this.updateAimPoint();
    for (const t of p.turrets) {
      if (t.dead) continue;
      if (t.mode === 'auto') this.updateAutoGunner(p, t, dt);
      else {
        p.aimTurret(t, this.aimPoint, dt, 3.4);
        p.tickTurret(t, dt);
        if (this.firing && p.canFire(t)) this.fireTurret(p, t);
      }
    }
    this.emitDamageFx(p, dt);

  }

  /**
   * An AI-crewed turret: acquires its own target, leads it, and only
   * fires with line of sight and the gun actually pointed at the target.
   */
  updateAutoGunner(tank, turret, dt) {
    const def = turret.def;
    // re-acquire periodically, or immediately if the current target is gone
    turret.acquireT = (turret.acquireT || 0) - dt;
    const stale = !turret.aiTarget || !turret.aiTarget.alive ||
      turret.aiTarget.pos.distanceTo(tank.pos) > def.range * 1.15;
    if (stale || turret.acquireT <= 0) {
      turret.acquireT = 0.6;
      turret.aiTarget = this.pickAutoTarget(tank, def);
    }
    const tgt = turret.aiTarget;
    if (!tgt) {
      // no target: rest the gun forward
      _v.copy(tank.pos).addScaledVector(
        _v2.set(Math.sin(tank.yaw), 0, Math.cos(tank.yaw)), 30);
      _v.y = tank.pos.y + 1.2;
      tank.aimTurret(turret, _v, dt, 1.8);
      tank.tickTurret(turret, dt);
      return;
    }

    // lead the target by shell flight time
    const d = tgt.pos.distanceTo(tank.pos);
    _v.copy(tgt.pos).addScaledVector(tgt.tank.velVec || _v3.set(0, 0, 0), d / def.muzzle);
    if (tgt.tank.velVec === undefined) {
      _v3.set(Math.sin(tgt.tank.yaw), 0, Math.cos(tgt.tank.yaw)).multiplyScalar(tgt.tank.speed);
      _v.copy(tgt.pos).addScaledVector(_v3, d / def.muzzle);
    }
    _v.y += 0.9;

    const onTarget = tank.aimTurret(turret, _v, dt, 3.0);
    tank.tickTurret(turret, dt);

    if (onTarget && d <= def.range && !this.field.blocked(tank.pos, tgt.pos) && tank.canFire(turret)) {
      this.fireTurret(tank, turret);
    }
  }

  /** Nearest hostile the given gun can realistically engage. */
  pickAutoTarget(tank, def) {
    let best = null, bestD = Infinity;
    for (const e of this.redUnits()) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(tank.pos);
      if (d > def.range) continue;
      if (this.field.blocked(tank.pos, e.pos)) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Flip one turret between the player's crosshair and its own gunner. */
  toggleTurret(idx) {
    const t = this.player.turrets[idx];
    if (!t || t.dead) return;
    t.mode = t.mode === 'auto' ? 'manual' : 'auto';
    t.aiTarget = null;
    this.renderWeapons();
    this.app.audio.ui(t.mode === 'auto' ? 1.6 : 1.0);
    this.addKill(`${t.def.name} &rarr; <b>${t.mode === 'auto' ? 'AI GUNNER' : 'MANUAL'}</b>`);
  }

  toggleAllTurrets() {
    const anyManual = this.player.turrets.some((t) => !t.dead && t.mode === 'manual');
    for (const t of this.player.turrets) if (!t.dead) { t.mode = anyManual ? 'auto' : 'manual'; t.aiTarget = null; }
    this.renderWeapons();
    this.app.audio.ui(anyManual ? 1.8 : 1.0);
    this.addKill(`All guns &rarr; <b>${anyManual ? 'AI GUNNER' : 'MANUAL'}</b>`);
  }

  updateAimPoint() {
    // ray from the camera through the crosshair; first thing it meets wins
    _v.copy(this.camPos);
    _v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    let bestT = 400;
    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      _v3.subVectors(e.pos, _v);
      const along = _v3.dot(_v2);
      if (along < 2) continue;
      const perp2 = _v3.lengthSq() - along * along;
      const r = e.tank.radius + 1.2;
      if (perp2 < r * r && along < bestT) bestT = along;
    }
    // terrain: march the ray until it dips below the height field
    let t = 3;
    while (t < bestT) {
      const x = _v.x + _v2.x * t, y = _v.y + _v2.y * t, z = _v.z + _v2.z * t;
      if (y <= heightAt(x, z)) { bestT = t; break; }
      t += Math.max(1.5, t * 0.05);
    }
    this.aimPoint.copy(_v).addScaledVector(_v2, Math.min(bestT, 400));
  }

  // ─────────────── camera ───────────────
  updateCamera(dt) {
    const p = this.player;
    this.camDist = smooth(this.camDist, this.camTargetDist, 7, dt);

    // orbit anchor sits just above the hull
    const anchor = _v.copy(p.pos);
    anchor.y += 2.1 + p.bounds.l * 0.06;

    const dirX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const dirZ = Math.cos(this.camYaw) * Math.cos(this.camPitch);
    const dirY = Math.sin(this.camPitch);

    const want = _v2.set(
      anchor.x - dirX * this.camDist,
      anchor.y + dirY * this.camDist + 1.6,
      anchor.z - dirZ * this.camDist);

    // never let the camera sink into the terrain
    const gh = heightAt(want.x, want.z) + 1.4;
    if (want.y < gh) want.y = gh;

    this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
    this.camLook.lerp(anchor, 1 - Math.exp(-18 * dt));

    // screen shake
    if (this.shake > 0.001) {
      const s = this.shake;
      this.camPos.x += rand(-1, 1) * s;
      this.camPos.y += rand(-1, 1) * s * 0.7;
      this.camPos.z += rand(-1, 1) * s;
      this.shake *= Math.exp(-7 * dt);
    }

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.field.followSun(p.pos);
  }

  // ─────────────── HUD ───────────────
  renderSquad() {
    if (!this.el.squad) return;
    const live = this.allies.filter((a) => a.alive).length;
    this.el.squad.textContent = `${live}/${this.allies.length}`;
    this.el.squad.style.color = live ? 'var(--cyan)' : 'var(--dim2)';
  }

  renderWeapons() {
    this.el.weapons.innerHTML = '';
    this.wpnEls = [];
    this.player.turrets.forEach((t, i) => {
      const d = document.createElement('div');
      const auto = t.mode === 'auto';
      d.className = 'wpn' + (t.dead ? ' dead' : '') + (auto ? ' auto' : '');
      const foot = t.def.foot ? `${t.def.foot[0]}×${t.def.foot[1]}` : '1×1';
      const barrels = (t.def.barrel.count || 1) > 1
        ? (t.salvo ? `${t.def.barrel.count}× salvo` : `${t.def.barrel.count}× alt`) : foot;
      d.innerHTML = `
        <div class="w-key">${i + 1}</div>
        <div class="w-ico">${t.def.icon}</div>
        <div class="w-body">
          <div class="w-name">${t.def.name}<em>${barrels}</em></div>
          <div class="w-bar"><i></i></div>
        </div>
        <div class="w-mode">${t.dead ? 'WRECKED' : auto ? 'AI' : 'YOU'}</div>`;
      d.addEventListener('click', () => this.toggleTurret(i));
      this.el.weapons.appendChild(d);
      this.wpnEls.push({ el: d, bar: d.querySelector('.w-bar i'), turret: t, index: i });
    });
  }

  updateHUD(dt) {
    const p = this.player;
    const frac = clamp(p.hp / p.maxHp, 0, 1);
    this.el.hp.textContent = Math.round(frac * 100) + '%';
    this.el.hpbar.style.width = (frac * 100) + '%';
    this.el.hpbar.className = frac < 0.28 ? 'crit' : frac < 0.6 ? 'warn' : '';
    this.el.hp.style.color = frac < 0.28 ? 'var(--red)' : frac < 0.6 ? 'var(--amber)' : 'var(--green)';

    const alive = p.modules.filter((m) => !m.dead).length;
    this.el.parts.textContent = `${alive}/${p.modules.length} modules`;
    const mob = Math.round(p.mobility * 100);
    this.el.armour.textContent = `drive ${mob}%`;
    this.el.armour.style.color = mob < 60 ? 'var(--red)' : 'var(--dim2)';

    this.el.wave.textContent = this.wave;
    const live = this.enemies.filter((e) => e.alive).length;
    this.el.enemies.textContent = live;
    this.el.score.textContent = this.score;
    this.renderSquad();

    this.el.speed.textContent = Math.abs(p.speed).toFixed(1);
    this.el.throttle.style.height = ((this.throttleDisplay || 0) * 100) + '%';

    for (const w of this.wpnEls) {
      const t = w.turret;
      const auto = t.mode === 'auto';
      if (t.dead) {
        if (!w.el.classList.contains('dead')) { w.el.className = 'wpn dead'; this.renderWeapons(); break; }
        w.bar.style.width = '0%'; continue;
      }
      const ready = t.cooldown <= 0;
      w.el.className = 'wpn' + (ready ? ' rdy' : '') + (auto ? ' auto' : '') +
        (auto && t.aiTarget ? ' engaged' : '');
      w.bar.style.width = ready ? '100%' : ((1 - t.cooldown / t.def.reload) * 100) + '%';
    }

    // crosshair spread reflects heat on the guns you are personally laying
    const manual = p.liveTurrets.filter((t) => t.mode !== 'auto');
    const heat = manual.length ? Math.max(0, ...manual.map((t) => t.heat)) : 0;
    this.el.crosshair.classList.toggle('spread', heat > 0.35);
    this.el.crosshair.classList.toggle('nomanual', manual.length === 0);

    this.el.vignette.style.opacity = frac < 0.45 ? (0.45 - frac) * 2.0 : 0;
    this.drawMinimap();
  }

  drawMinimap() {
    const c = this.mmCtx, S = 180, R = this.field.boundaryR;
    c.clearRect(0, 0, S, S);
    const toMap = (x, z) => [S / 2 + (x / R) * (S / 2 - 8), S / 2 + (z / R) * (S / 2 - 8)];

    c.strokeStyle = 'rgba(140,170,175,.18)';
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 8, 0, 6.283); c.stroke();
    c.beginPath(); c.arc(S / 2, S / 2, (S / 2 - 8) * 0.5, 0, 6.283); c.stroke();

    // cover
    c.fillStyle = 'rgba(140,170,175,.14)';
    for (const o of this.field.obstacles) {
      if (o.height < 1.8) continue;
      const [x, y] = toMap(o.pos.x, o.pos.z);
      c.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // friendly armour
    for (const a of this.allies) {
      if (!a.alive) continue;
      const [x, y] = toMap(a.pos.x, a.pos.z);
      c.fillStyle = '#4fd6e8';
      c.beginPath(); c.arc(x, y, 3, 0, 6.283); c.fill();
    }

    // hostiles
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const [x, y] = toMap(e.pos.x, e.pos.z);
      c.fillStyle = e.hasLOS ? '#ff4d3d' : 'rgba(255,77,61,.45)';
      c.beginPath(); c.arc(x, y, 3, 0, 6.283); c.fill();
    }

    // player + facing wedge
    const [px, py] = toMap(this.player.pos.x, this.player.pos.z);
    c.save();
    c.translate(px, py);
    c.rotate(-this.player.yaw);
    c.fillStyle = '#ffab2e';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(0, 3); c.lineTo(-4, 5);
    c.closePath(); c.fill();
    c.restore();

    // camera cone
    c.save();
    c.translate(px, py);
    c.rotate(-this.camYaw);
    c.fillStyle = 'rgba(255,171,46,.10)';
    c.beginPath(); c.moveTo(0, 0);
    c.arc(0, 0, 34, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    c.closePath(); c.fill();
    c.restore();
  }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.style.borderColor = kill ? '#ffab2e' : '#ff4d3d';
    h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
    this.app.audio.ui(kill ? 2.2 : 1.6);
  }

  addKill(html) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = html;
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 3600);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
  }

  banner(title, sub) {
    this.el.banner.innerHTML = `<div class="bn-t">${title}</div><div class="bn-s">${sub}</div>`;
    this.el.banner.classList.remove('show'); void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  endRun(won) {
    this.gameOver = true;
    if (!won) {
      _v.copy(this.player.pos); _v.y += 1;
      this.fx.explosion(_v, 2.6);
      this.app.audio.explode(2, 0);
      this.shake = 0.9;
    }
    // run on the game clock, not wall time, so a stalled tab can't skip it
    this.endTimer = won ? 0.6 : 1.9;
    Save.endRun(this.wave, this.score, this.kills);
    const best = Save.loadProgress();
    this.endPayload = { won, wave: this.wave, kills: this.kills, score: this.score,
                        time: this.time, bestWave: best.bestWave, bestScore: best.bestScore };
  }

  /**
   * Level-of-detail for AI. Everything near the player runs every frame;
   * distant units accumulate time and run a bigger step less often, which
   * keeps a nine-tank wave off the frame budget without changing behaviour.
   */
  _updateUnit(u, dt) {
    const d2 = u.pos.distanceToSquared(this.player.pos);
    u.tank.setShadowCasting(d2 < 95 * 95);
    if (d2 < 110 * 110 || !u.alive) { u.update(dt); return; }
    const stride = d2 < 200 * 200 ? 2 : 4;
    u._acc = (u._acc || 0) + dt;
    if (u._lodStep === undefined) u._lodStep = (this.enemies.indexOf(u) + 1) % stride;
    if (++u._lodTick % stride === u._lodStep % stride || u._acc > 0.2) {
      u.update(u._acc);
      u._acc = 0;
    }
  }

  /**
   * Rewarded-ad revive: rebuild the destroyed modules to a fighting state and
   * resume the same run rather than restarting the wave ladder.
   */
  revive() {
    const p = this.player;
    p.destroyed = false;
    for (const m of p.modules) {
      if (!m.dead) { m.hp = m.maxHp; continue; }
      m.dead = false;
      m.hp = m.maxHp * 0.6;
      m.mesh.visible = true;
      m.mesh.rotation.set(0, m.kind === 'turret' ? (m.turret ? m.turret.yaw : 0) : 0, 0);
      if (m.baseColor && m.mesh.material.color) m.mesh.material.color.copy(m.baseColor);
      if (m.turret) m.turret.dead = false;
    }
    p.hp = p.modules.reduce((s, m) => s + m.hp, 0);
    this.gameOver = false;
    this.endTimer = 0;
    this.waveClearing = false;
    this.el.vignette.style.opacity = 0;
    // clear the immediate area so you don't die again on the spot
    for (const e of this.enemies) {
      if (e.alive && e.pos.distanceTo(p.pos) < 45) {
        const a = Math.atan2(e.pos.z - p.pos.z, e.pos.x - p.pos.x);
        e.tank.pos.set(p.pos.x + Math.cos(a) * 90, 0, p.pos.z + Math.sin(a) * 90);
        e.alertness = 0;
      }
    }
    this.renderWeapons();
    this.active = true;
    this.el.root.classList.remove('hidden');
    this.app.setScene(this.scene, this.camera);
    this.app.audio.startEngine();
    this.banner('BACK IN THE FIGHT', 'field repair complete');
  }

  // ─────────────── frame ───────────────
  update(dt) {
    if (!this.active) return;
    this.time += dt;

    this.updatePlayer(dt);
    for (const e of this.enemies) this._updateUnit(e, dt);
    for (const a of this.allies) this._updateUnit(a, dt);
    this.updateProjectiles(dt);
    this.updateCamera(dt);
    this.fx.update(dt);

    this.hudTimer = (this.hudTimer || 0) - dt;
    if (this.hudTimer <= 0) { this.hudTimer = 1 / 15; this.updateHUD(dt); }

    // ── end of run ──
    if (this.gameOver) {
      if (this.endTimer > 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0 && this.active) this.app.showEnd(this.endPayload);
      }
      return;
    }

    // ── wave progression, also on the game clock ──
    const live = this.enemies.filter((e) => e.alive).length;
    if (live === 0 && !this.waveClearing) {
      this.waveClearing = true;
      this.waveTimer = 3.2;
      this.score += 250 * this.wave;
      Save.saveWave(this.wave, this.score, this.kills);
      const repaired = this.player.repair(0.35);
      this.banner('SECTOR CLEAR',
        repaired > 0 ? `+${250 * this.wave} bonus · field repair` : `+${250 * this.wave} bonus`);
      if (repaired > 0) this.addKill(`Field repair &mdash; <b>+${repaired}</b> integrity`);
      this.app.audio.ui(2.4);
    }
    if (this.waveClearing) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        // a cleared sector is the natural break point; never mid-firefight
        if (this.wave > 0 && this.wave % 3 === 0 && !this._adPending) {
          this._adPending = true;
          Ads.commercialBreak(`Wave ${this.wave} cleared`).finally(() => { this._adPending = false; });
        }
        Ads.happytime();
        for (const e of this.enemies) e.removeFrom(this.scene);
        this.enemies.length = 0;
        // wrecked wingmen are replaced by fresh crews between waves
        for (const a of [...this.allies]) {
          if (!a.alive) { a.removeFrom(this.scene); this.allies.splice(this.allies.indexOf(a), 1); }
        }
        const missing = this.allyCount - this.allies.length;
        if (missing > 0) this.spawnAllies(missing);
        this.waveClearing = false;
        this.nextWave();
      }
    }
  }
}
