// ───────────────────────────────────────────────────────────────
//  AI tank crews — used for BOTH sides.
//  A small state machine (PATROL → ENGAGE → FLANK → COVER →
//  REPOSITION) layered on the same physics the player uses, plus
//  fire control that leads its target and respects line of sight.
//  `team` decides who it hunts; everything else is identical.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Tank } from './tank.js';
import { heightAt } from './world.js';
import { enemyBuild } from './parts.js';
import { clamp, lerp, rand, randInt, angleDelta, chance } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const STATE = {
  PATROL: 'patrol',
  ENGAGE: 'engage',
  FLANK: 'flank',
  COVER: 'cover',
  REPOSITION: 'reposition',
};

// hostiles wear desert rust, friendlies wear the same green as your hull
const TINTS = {
  red: [0x8a5a3a, 0x7a4a42, 0x6a5a3a, 0x8a6a44],
  blue: [0x5d7a58, 0x54704f, 0x63805c],
};

export class AITank {
  /**
   * @param battle   the BattleMode that owns it
   * @param tier     1-4, scales hull size, armament and crew skill
   * @param spawnPos world position
   * @param team     'red' (hostile) or 'blue' (fights alongside the player)
   */
  constructor(battle, tier, spawnPos, team = 'red') {
    this.battle = battle;
    this.tier = tier;
    this.team = team;

    const build = enemyBuild(tier);
    // later tiers field upgraded hardware, same system the player buys
    build.upgrades = {
      weapon: Math.min(3, tier - 1),
      drive: Math.min(3, Math.floor(tier / 2)),
      armour: Math.min(2, tier - 1),
    };
    const pool = TINTS[team];
    this.tank = new Tank(build, { team, tint: pool[randInt(0, pool.length - 1)] });
    this.tank.pos.copy(spawnPos);
    this.tank.pos.y = heightAt(spawnPos.x, spawnPos.z);
    this.tank.yaw = rand(0, Math.PI * 2);
    this.tank.velVec = new THREE.Vector3();
    this.tank.syncTransform();
    battle.scene.add(this.tank.group);

    this.state = STATE.PATROL;
    this.stateTime = 0;
    this.aimPoint = new THREE.Vector3();
    this.waypoint = this._randomWaypoint();
    this.alertness = 0;               // 0..1, ramps up once it has a target in view
    this.lastSeen = new THREE.Vector3();
    this.hasLOS = false;
    this.losTimer = 0;
    this.foe = null;
    this.dead = false;
    this.deathTimer = 0;

    // crew skill scales with tier — later crews lead better and hesitate less
    this.skill = clamp(0.42 + tier * 0.11, 0.4, 0.92);
    this.reactionDelay = lerp(0.85, 0.18, this.skill);
    this.aimError = lerp(0.075, 0.014, this.skill);
    this.preferredRange = rand(28, 62) - tier * 3;
    this.strafeDir = chance(0.5) ? 1 : -1;
  }

  get pos() { return this.tank.pos; }
  get alive() { return !this.tank.destroyed; }

  /**
   * Where to head when not in contact. If a foe exists but is out of sensor
   * range we close on it rather than wandering — otherwise a unit can patrol
   * the far side of the map forever and stall the wave.
   */
  _patrolWaypoint() {
    if (this.foe && this.distToFoe > 55) {
      const to = _v.subVectors(this.foe.pos, this.pos).normalize();
      const side = _v2.set(-to.z, 0, to.x).multiplyScalar(rand(-22, 22));
      const p = new THREE.Vector3().copy(this.pos)
        .addScaledVector(to, Math.min(this.distToFoe - 25, 70)).add(side);
      p.y = heightAt(p.x, p.z);
      return p;
    }
    return this._randomWaypoint();
  }

  _randomWaypoint() {
    const R = this.battle.field.boundaryR * 0.8;
    const a = rand(0, Math.PI * 2), r = rand(20, R);
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    p.y = heightAt(p.x, p.z);
    return p;
  }

  // ─────────────── perception ───────────────
  _sense(dt) {
    // pick the closest living opponent as the current threat
    let best = null, bestD = Infinity;
    for (const u of this.battle.foesOf(this)) {
      if (!u.alive) continue;
      const d = this.pos.distanceTo(u.pos);
      if (d < bestD) { bestD = d; best = u; }
    }
    this.foe = best;
    this.distToFoe = bestD;

    if (!best) { this.hasLOS = false; this.alertness = Math.max(0, this.alertness - dt * 0.4); return; }

    const blocked = this.battle.field.blocked(this.pos, best.pos);
    this.hasLOS = !blocked && bestD < 145;

    if (this.hasLOS) {
      this.losTimer += dt;
      this.alertness = Math.min(1, this.alertness + dt * 1.6);
      this.lastSeen.copy(best.pos);
    } else {
      this.losTimer = 0;
      this.alertness = Math.max(0, this.alertness - dt * 0.18);
    }
  }

  // ─────────────── state machine ───────────────
  _think(dt) {
    this.stateTime += dt;
    const hpFrac = this.tank.hp / this.tank.maxHp;

    switch (this.state) {
      case STATE.PATROL:
        if (this.alertness > 0.35) this._setState(STATE.ENGAGE);
        else if (this.pos.distanceTo(this.waypoint) < 6 || this.stateTime > 8) {
          this.waypoint = this._patrolWaypoint();
          this.stateTime = 0;
        }
        break;

      case STATE.ENGAGE:
        // badly hurt → break contact and use hard cover
        if (hpFrac < 0.34 && chance(dt * 0.9)) { this._setState(STATE.COVER); break; }
        // lost sight for a while → go hunt the last known position
        if (!this.hasLOS && this.alertness > 0.1 && this.stateTime > 2.2) { this._setState(STATE.FLANK); break; }
        if (this.alertness < 0.06) { this._setState(STATE.PATROL); break; }
        // shuffle position periodically so it isn't a static target
        if (this.stateTime > rand(4, 8)) { this._setState(STATE.REPOSITION); break; }
        break;

      case STATE.FLANK:
        if (this.hasLOS && this.stateTime > 0.6) { this._setState(STATE.ENGAGE); break; }
        if (this.stateTime > 9) this._setState(this.alertness > 0.2 ? STATE.ENGAGE : STATE.PATROL);
        break;

      case STATE.COVER:
        if (hpFrac > 0.55 || this.stateTime > 11) { this._setState(STATE.ENGAGE); break; }
        if (!this.coverSpot || this.pos.distanceTo(this.coverSpot) < 4) {
          // reached cover — sit tight, then peek out again
          if (this.stateTime > 4.5 && chance(dt * 0.6)) this._setState(STATE.ENGAGE);
        }
        break;

      case STATE.REPOSITION:
        if (this.stateTime > rand(1.6, 3.2)) this._setState(STATE.ENGAGE);
        break;
    }
  }

  _setState(s) {
    this.state = s;
    this.stateTime = 0;
    const threat = this.foe ? this.foe.pos : this.lastSeen;

    if (s === STATE.COVER) {
      this.coverSpot = this.battle.field.findCover(this.pos, threat, 60);
      if (!this.coverSpot) this.state = STATE.REPOSITION;
    }
    if (s === STATE.FLANK) {
      // arc around toward the last known position instead of charging straight in
      const to = _v.subVectors(this.lastSeen, this.pos);
      const dist = to.length() || 1;
      to.normalize();
      const side = _v2.set(-to.z, 0, to.x).multiplyScalar(this.strafeDir * Math.min(28, dist * 0.7));
      this.waypoint = new THREE.Vector3().copy(this.lastSeen).add(side);
      this.waypoint.y = heightAt(this.waypoint.x, this.waypoint.z);
    }
    if (s === STATE.REPOSITION) {
      this.strafeDir *= -1;
      const to = _v.subVectors(this.pos, threat).normalize();
      const side = _v2.set(-to.z, 0, to.x).multiplyScalar(this.strafeDir * rand(12, 22));
      this.waypoint = new THREE.Vector3().copy(this.pos).add(side).addScaledVector(to, rand(-6, 8));
      this.waypoint.y = heightAt(this.waypoint.x, this.waypoint.z);
    }
  }

  // ─────────────── driving ───────────────
  _drive(dt) {
    const t = this.tank;
    let goal;

    if (this.state === STATE.ENGAGE && this.foe) {
      // hold a standoff band around the target and strafe across it
      const to = _v.subVectors(this.foe.pos, this.pos).normalize();
      const side = _v2.set(-to.z, 0, to.x).multiplyScalar(this.strafeDir * 16);
      goal = new THREE.Vector3().copy(this.foe.pos)
        .addScaledVector(to, -this.preferredRange).add(side);
      goal.y = heightAt(goal.x, goal.z);
      if (chance(dt * 0.22)) this.strafeDir *= -1;
    } else if (this.state === STATE.COVER) {
      goal = this.coverSpot || this.waypoint;
    } else {
      goal = this.waypoint;
    }

    // obstacle whisker — steer around anything dead ahead
    const fwd = _v.set(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    const probe = _v2.copy(t.pos).addScaledVector(fwd, t.radius + 5);
    let avoid = 0;
    for (const o of this.battle.field.obstacles) {
      if (o.height < 1.0) continue;
      if (Math.hypot(probe.x - o.pos.x, probe.z - o.pos.z) < o.radius + t.radius + 1.5) {
        const cross = fwd.x * (o.pos.z - t.pos.z) - fwd.z * (o.pos.x - t.pos.x);
        avoid += cross > 0 ? -1 : 1;
      }
    }

    const dx = goal.x - t.pos.x, dz = goal.z - t.pos.z;
    const distGoal = Math.hypot(dx, dz);
    let wantYaw = Math.atan2(dx, dz);
    if (avoid !== 0) wantYaw += clamp(avoid, -1, 1) * 0.85;

    const dYaw = angleDelta(t.yaw, wantYaw);
    this.steerInput = clamp(dYaw * 1.9, -1, 1);

    // slow down for sharp turns and when close to the goal
    let throttle = 1;
    if (Math.abs(dYaw) > 1.1) throttle = 0.32;
    if (distGoal < 5) throttle = this.state === STATE.PATROL ? 0.2 : 0.45;
    if (this.state === STATE.COVER && distGoal < 3.5) throttle = 0;
    if (this.state === STATE.ENGAGE && distGoal < 3) throttle = 0.15;
    this.throttleInput = throttle;
  }

  // ─────────────── gunnery ───────────────
  _shoot(dt) {
    const t = this.tank;
    if (!this.foe || !this.hasLOS || this.alertness < 0.3) {
      // no target: sweep the turrets toward the last known bearing
      _v.copy(this.lastSeen.lengthSq() ? this.lastSeen : this.pos);
      _v.y += 1.2;
      t.aimAt(_v, dt, 1.6);
      return;
    }

    const turret = t.liveTurrets[0];
    const shellSpeed = turret ? turret.def.muzzle : 100;
    const d = this.distToFoe;
    // lead the target — better gunners lead more accurately
    _v.copy(this.foe.pos).addScaledVector(this.foe.tank.velVec || _v2.set(0, 0, 0),
      (d / shellSpeed) * this.skill);
    _v.y += 0.9;
    // aim jitter that shrinks as the gunner settles on target
    const settle = clamp(this.losTimer / this.reactionDelay, 0, 1);
    const err = this.aimError * d * (1.6 - settle);
    _v.x += Math.sin(this.stateTime * 3.1 + this.tier) * err;
    _v.z += Math.cos(this.stateTime * 2.3) * err;
    this.aimPoint.copy(_v);

    const onTarget = t.aimAt(_v, dt, 2.4);
    if (settle < 1 || !onTarget) return;

    for (const tur of t.liveTurrets) {
      if (!t.canFire(tur) || d > tur.def.range) continue;
      // burst discipline for automatic weapons
      if (tur.def.kind === 'auto') {
        if (tur.burstLeft === undefined || tur.burstLeft <= 0) {
          if (tur.burstCool > 0) { tur.burstCool -= dt; continue; }
          tur.burstLeft = randInt(5, 12);
        }
        tur.burstLeft--;
        if (tur.burstLeft <= 0) tur.burstCool = rand(0.5, 1.4);
      }
      this.battle.fireTurret(this, tur);
    }
  }

  // ─────────────── frame ───────────────
  update(dt) {
    if (this.tank.destroyed) { this._updateDeath(dt); return; }
    this._sense(dt);
    this._think(dt);
    this._drive(dt);
    this._shoot(dt);
    this.battle.stepVehicle(this.tank, this.throttleInput, this.steerInput, dt, false);
    this.tank.velVec.set(Math.sin(this.tank.yaw), 0, Math.cos(this.tank.yaw))
      .multiplyScalar(this.tank.speed);
    this.battle.emitDamageFx(this.tank, dt);
  }

  _updateDeath(dt) {
    this.deathTimer += dt;
    if (!this.dead) {
      this.dead = true;
      this.battle.onAIDestroyed(this);
    }
    // settle the wreck onto the terrain
    const t = this.tank;
    t.speed *= Math.exp(-3 * dt);
    t.pos.x += Math.sin(t.yaw) * t.speed * dt;
    t.pos.z += Math.cos(t.yaw) * t.speed * dt;
    t.pos.y = heightAt(t.pos.x, t.pos.z);
    t.syncTransform();
    if (this.deathTimer < 6) {
      _v.copy(t.pos); _v.y += 1.0;
      this.battle.fx.damageSmoke(_v, 1.0, dt * 2.2);
    }
  }

  removeFrom(scene) { scene.remove(this.tank.group); this.tank.dispose(); }
}

// kept for readability at call sites
export const EnemyTank = AITank;
