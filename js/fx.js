// ───────────────────────────────────────────────────────────────
//  Particle + effects system.
//  Three pooled THREE.Points layers (smoke / additive / dust) drawn
//  with a tiny custom shader, plus pooled flash lights, shockwave
//  rings and ground scorch decals.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Assets } from './assets.js';
import { rand, clamp, lerp } from './util.js';

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (320.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

class Layer {
  constructor(map, max, blending, depthWrite = false) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    // per-particle sim state (CPU side)
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.fade = new Float32Array(max);     // 0 = linear, 1 = fast-in/slow-out
    this.baseSize = new Float32Array(max);
    this.colFrom = new Float32Array(max * 3);
    this.colTo = new Float32Array(max * 3);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite, depthTest: true,
      blending,
    });
    this.geo = g;
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  spawn(o) {
    let i;
    if (this.count < this.max) i = this.count++;
    else {
      // pool is full — reuse in allocation order, which is oldest-first
      this.cursor = (this.cursor || 0) % this.max;
      i = this.cursor++;
    }
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx; this.vel[i3 + 1] = o.vy; this.vel[i3 + 2] = o.vz;
    this.life[i] = 0; this.maxLife[i] = o.life;
    this.baseSize[i] = o.size; this.size[i] = o.size;
    this.grow[i] = o.grow || 0;
    this.drag[i] = o.drag ?? 1.2;
    this.grav[i] = o.grav ?? 0;
    this.fade[i] = o.fade ?? 0;
    this.alpha[i] = o.alpha ?? 1;
    const cf = o.from, ct = o.to || o.from;
    this.colFrom[i3] = cf[0]; this.colFrom[i3 + 1] = cf[1]; this.colFrom[i3 + 2] = cf[2];
    this.colTo[i3] = ct[0]; this.colTo[i3 + 1] = ct[1]; this.colTo[i3 + 2] = ct[2];
    this.col[i3] = cf[0]; this.col[i3 + 1] = cf[1]; this.col[i3 + 2] = cf[2];
    this._peak = o.alpha ?? 1;
    this.alphaPeak = this.alphaPeak || new Float32Array(this.max);
    this.alphaPeak[i] = o.alpha ?? 1;
  }

  update(dt) {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      if (this.maxLife[i] <= 0) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        this.maxLife[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // never sink through the ground
      if (this.pos[i3 + 1] < 0.02) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.2; }

      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      const peak = this.alphaPeak ? this.alphaPeak[i] : 1;
      this.alpha[i] = this.fade[i] > 0.5
        ? peak * Math.pow(1 - t, 2.2)                       // sharp
        : peak * Math.sin(Math.min(t * 6, 1) * Math.PI * 0.5) * (1 - t * t);
      const ct = t;
      this.col[i3] = lerp(this.colFrom[i3], this.colTo[i3], ct);
      this.col[i3 + 1] = lerp(this.colFrom[i3 + 1], this.colTo[i3 + 1], ct);
      this.col[i3 + 2] = lerp(this.colFrom[i3 + 2], this.colTo[i3 + 2], ct);
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    const S = Assets.sprites;
    this.smoke = new Layer(S.smoke, 1400, THREE.NormalBlending);
    this.hot   = new Layer(S.glow, 900, THREE.AdditiveBlending);
    this.spark = new Layer(S.spark, 1100, THREE.AdditiveBlending);
    this.dust  = new Layer(S.smoke, 900, THREE.NormalBlending);
    scene.add(this.smoke.points, this.dust.points, this.hot.points, this.spark.points);

    // pooled flash lights
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 40, 2);
      l.visible = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0, power: 0 });
    }

    // pooled shockwave rings
    this.rings = [];
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: S.ring, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0, size: 1 });
    }

    // pooled scorch decals
    this.decals = [];
    const decGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(decGeo, new THREE.MeshBasicMaterial({
        map: S.scorch, transparent: true, depthWrite: false, opacity: 0,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
    this.decalCursor = 0;
  }

  // ─────────────── emitters ───────────────
  muzzleFlash(pos, dir, scale = 1) {
    for (let i = 0; i < 7 * scale; i++) {
      this.hot.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * rand(6, 22) * scale + rand(-3, 3),
        vy: dir.y * rand(6, 22) * scale + rand(-2, 3),
        vz: dir.z * rand(6, 22) * scale + rand(-3, 3),
        life: rand(0.05, 0.13), size: rand(0.5, 1.3) * scale, grow: 2.4,
        drag: 7, fade: 1, alpha: 1,
        from: [1.0, 0.85, 0.45], to: [1.0, 0.35, 0.05],
      });
    }
    for (let i = 0; i < 5 * scale; i++) {
      this.smoke.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * rand(2, 9) + rand(-2, 2),
        vy: dir.y * rand(2, 9) + rand(0, 2),
        vz: dir.z * rand(2, 9) + rand(-2, 2),
        life: rand(0.4, 0.9), size: rand(0.5, 1.1) * scale, grow: 3.2,
        drag: 2.4, grav: 0.6, alpha: 0.42,
        from: [0.72, 0.70, 0.66], to: [0.34, 0.33, 0.32],
      });
    }
    this.flash(pos, 3.2 * scale, 0.07, 0xffb45a);
    // ground dust kicked up by the blast
    for (let i = 0; i < 4 * scale; i++) {
      this.dust.spawn({
        x: pos.x + rand(-0.6, 0.6), y: 0.12, z: pos.z + rand(-0.6, 0.6),
        vx: dir.x * rand(3, 8), vy: rand(0.4, 1.6), vz: dir.z * rand(3, 8),
        life: rand(0.7, 1.4), size: rand(0.8, 1.6), grow: 3.6,
        drag: 2.0, alpha: 0.30,
        from: [0.60, 0.52, 0.38], to: [0.45, 0.40, 0.31],
      });
    }
  }

  impactSparks(pos, normal, amount = 1, metal = true) {
    const n = Math.round(clamp(6 + amount * 0.5, 5, 26));
    for (let i = 0; i < n; i++) {
      this.spark.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: normal.x * rand(2, 10) + rand(-6, 6),
        vy: normal.y * rand(2, 10) + rand(0, 8),
        vz: normal.z * rand(2, 10) + rand(-6, 6),
        life: rand(0.22, 0.7), size: rand(0.10, 0.30), grow: -0.5,
        drag: 0.9, grav: -13, fade: 1, alpha: 1,
        from: [1.0, 0.92, 0.62], to: [1.0, 0.28, 0.04],
      });
    }
    if (metal) {
      for (let i = 0; i < 3; i++) {
        this.smoke.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: rand(-1.5, 1.5), vy: rand(0.6, 2.4), vz: rand(-1.5, 1.5),
          life: rand(0.35, 0.8), size: rand(0.25, 0.5), grow: 2.5,
          drag: 2.2, alpha: 0.34,
          from: [0.55, 0.54, 0.52], to: [0.28, 0.27, 0.26],
        });
      }
    }
    this.flash(pos, 1.1, 0.05, 0xffc070);
  }

  groundHit(pos, scale = 1) {
    for (let i = 0; i < 14 * scale; i++) {
      this.dust.spawn({
        x: pos.x + rand(-0.3, 0.3), y: pos.y + 0.05, z: pos.z + rand(-0.3, 0.3),
        vx: rand(-7, 7) * scale, vy: rand(1.5, 8) * scale, vz: rand(-7, 7) * scale,
        life: rand(0.8, 1.9), size: rand(0.5, 1.3) * scale, grow: 3.0,
        drag: 1.5, grav: -2.2, alpha: 0.5,
        from: [0.62, 0.54, 0.40], to: [0.44, 0.39, 0.31],
      });
    }
    for (let i = 0; i < 8 * scale; i++) {
      this.spark.spawn({
        x: pos.x, y: pos.y + 0.1, z: pos.z,
        vx: rand(-8, 8), vy: rand(2, 11), vz: rand(-8, 8),
        life: rand(0.3, 0.7), size: rand(0.08, 0.2),
        drag: 0.7, grav: -14, fade: 1,
        from: [1.0, 0.8, 0.5], to: [0.9, 0.25, 0.05],
      });
    }
    this.scorch(pos, 1.6 * scale);
  }

  explosion(pos, scale = 1) {
    // fireball
    for (let i = 0; i < 26 * scale; i++) {
      this.hot.spawn({
        x: pos.x + rand(-0.4, 0.4) * scale, y: pos.y + rand(-0.2, 0.5) * scale, z: pos.z + rand(-0.4, 0.4) * scale,
        vx: rand(-9, 9) * scale, vy: rand(0, 11) * scale, vz: rand(-9, 9) * scale,
        life: rand(0.24, 0.62), size: rand(1.1, 2.8) * scale, grow: 1.9,
        drag: 3.0, grav: 3.0, fade: 1, alpha: 1,
        from: [1.0, 0.88, 0.55], to: [0.95, 0.16, 0.02],
      });
    }
    // rolling smoke column
    for (let i = 0; i < 30 * scale; i++) {
      this.smoke.spawn({
        x: pos.x + rand(-0.8, 0.8) * scale, y: pos.y + rand(0, 0.8), z: pos.z + rand(-0.8, 0.8) * scale,
        vx: rand(-5, 5) * scale, vy: rand(1.2, 6.5) * scale, vz: rand(-5, 5) * scale,
        life: rand(1.6, 3.6), size: rand(1.2, 3.0) * scale, grow: 2.6,
        drag: 1.05, grav: 1.1, alpha: 0.62,
        from: [0.30, 0.28, 0.26], to: [0.14, 0.13, 0.13],
      });
    }
    // debris
    for (let i = 0; i < 22 * scale; i++) {
      this.spark.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: rand(-16, 16) * scale, vy: rand(2, 18) * scale, vz: rand(-16, 16) * scale,
        life: rand(0.5, 1.5), size: rand(0.1, 0.32),
        drag: 0.5, grav: -16, fade: 1,
        from: [1.0, 0.85, 0.5], to: [0.7, 0.16, 0.02],
      });
    }
    // ground dust ring
    for (let i = 0; i < 20 * scale; i++) {
      const a = rand(0, Math.PI * 2), s = rand(6, 16) * scale;
      this.dust.spawn({
        x: pos.x, y: 0.1, z: pos.z,
        vx: Math.cos(a) * s, vy: rand(0.3, 2.4), vz: Math.sin(a) * s,
        life: rand(1.0, 2.4), size: rand(1.0, 2.2) * scale, grow: 3.4,
        drag: 1.7, alpha: 0.45,
        from: [0.60, 0.53, 0.40], to: [0.42, 0.38, 0.30],
      });
    }
    this.flash(pos, 16 * scale, 0.34, 0xff8a30);
    this.ring(pos, 5.5 * scale, 0.5);
    this.scorch(pos, 3.4 * scale);
  }

  /** Continuous damage smoke trailing off a wounded module. */
  damageSmoke(pos, severity, dt) {
    if (Math.random() > severity * dt * 26) return;
    const dark = severity > 0.7;
    this.smoke.spawn({
      x: pos.x + rand(-0.2, 0.2), y: pos.y + rand(0, 0.2), z: pos.z + rand(-0.2, 0.2),
      vx: rand(-0.5, 0.5), vy: rand(1.0, 2.6), vz: rand(-0.5, 0.5),
      life: rand(1.1, 2.4), size: rand(0.35, 0.8), grow: 3.0,
      drag: 0.9, grav: 1.5, alpha: dark ? 0.55 : 0.32,
      from: dark ? [0.20, 0.19, 0.18] : [0.58, 0.56, 0.54],
      to: dark ? [0.09, 0.09, 0.09] : [0.30, 0.29, 0.28],
    });
    if (dark && Math.random() < 0.25) {
      this.hot.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: rand(-0.6, 0.6), vy: rand(0.5, 2.2), vz: rand(-0.6, 0.6),
        life: rand(0.2, 0.5), size: rand(0.2, 0.5), grow: 1.2,
        drag: 2, fade: 1, alpha: 0.9,
        from: [1.0, 0.6, 0.15], to: [0.8, 0.15, 0.0],
      });
    }
  }

  /** Dust kicked up by moving tracks. */
  trackDust(pos, speed, dt) {
    if (Math.random() > speed * dt * 1.6) return;
    this.dust.spawn({
      x: pos.x + rand(-0.3, 0.3), y: 0.08, z: pos.z + rand(-0.3, 0.3),
      vx: rand(-1.2, 1.2), vy: rand(0.3, 1.5), vz: rand(-1.2, 1.2),
      life: rand(0.9, 2.0), size: rand(0.4, 0.9), grow: 3.4,
      drag: 1.6, alpha: 0.24,
      from: [0.60, 0.53, 0.40], to: [0.46, 0.42, 0.34],
    });
  }

  /** Diesel exhaust puff. */
  exhaust(pos, load, dt) {
    if (Math.random() > (0.3 + load) * dt * 12) return;
    this.smoke.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: rand(-0.3, 0.3), vy: rand(0.8, 1.8), vz: rand(-0.3, 0.3),
      life: rand(0.5, 1.2), size: rand(0.14, 0.3), grow: 3.6,
      drag: 1.4, grav: 0.9, alpha: 0.10 + load * 0.16,
      from: [0.36, 0.35, 0.34], to: [0.24, 0.24, 0.24],
    });
  }

  flash(pos, power, dur, color) {
    let slot = this.lights.find((l) => l.t >= l.dur);
    if (!slot) slot = this.lights[0];
    slot.light.position.copy(pos);
    slot.light.color.setHex(color);
    slot.power = power;
    slot.t = 0; slot.dur = dur;
    slot.light.visible = true;
  }

  ring(pos, size, dur) {
    const r = this.rings.find((x) => x.t >= x.dur) || this.rings[0];
    r.mesh.position.set(pos.x, 0.16, pos.z);
    r.mesh.visible = true;
    r.t = 0; r.dur = dur; r.size = size;
  }

  scorch(pos, size) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    d.mesh.position.set(pos.x, 0.045, pos.z);
    d.mesh.rotation.z = rand(0, Math.PI * 2);
    d.mesh.scale.setScalar(size);
    d.mesh.visible = true;
    d.mesh.material.opacity = 0.85;
    d.life = 0;
  }

  update(dt) {
    this.smoke.update(dt);
    this.hot.update(dt);
    this.spark.update(dt);
    this.dust.update(dt);

    for (const l of this.lights) {
      if (l.t >= l.dur) { if (l.light.visible) { l.light.visible = false; l.light.intensity = 0; } continue; }
      l.t += dt;
      const k = 1 - l.t / l.dur;
      l.light.intensity = l.power * k * k;
    }
    for (const r of this.rings) {
      if (r.t >= r.dur) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.t += dt;
      const k = r.t / r.dur;
      r.mesh.scale.setScalar(lerp(1, r.size, Math.sqrt(k)));
      r.mesh.material.opacity = (1 - k) * 0.85;
    }
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.life += dt;
      if (d.life > 22) { d.mesh.visible = false; continue; }
      if (d.life > 14) d.mesh.material.opacity = 0.85 * (1 - (d.life - 14) / 8);
    }
  }
}
