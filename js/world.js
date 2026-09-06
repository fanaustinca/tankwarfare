// ───────────────────────────────────────────────────────────────
//  Renderer + scenes.
//  Battlefield: physical sky, sun-lit displaced terrain, cover
//  props, IBL from the sky itself. Build bay: dark hangar with
//  a lit assembly deck.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Assets, applyEnv } from './assets.js';
import { fbm, rand, randInt, clamp } from './util.js';
import { GRID, CELL } from './parts.js';

export const ARENA = 560;           // full width of the battlefield in metres
const TERRAIN_SEG = 260;            // ~2.15 m per quad

/** Shared terrain height field — physics and geometry read the same function. */
export function heightAt(x, z) {
  // Frequencies are chosen against the value-noise lattice: too low and the
  // whole map samples inside a single cell, which reads as dead flat.
  let h = fbm(x * 0.0062 + 40, z * 0.0062 + 17, 4) * 30;                     // hills, ~160 m across
  h += (1 - Math.abs(fbm(x * 0.0115 + 9, z * 0.0115 + 3, 3) * 2 - 1)) * 13;  // ridge lines
  h += fbm(x * 0.030 + 71, z * 0.030 + 23, 3) * 4.5;                         // rolling ground
  h += fbm(x * 0.088 + 3, z * 0.088 + 9, 2) * 1.1;                           // surface detail
  h -= 24;
  // flatten the deployment zone so you always start on drivable ground
  const d = Math.hypot(x, z);
  const flat = clamp((d - 22) / 34, 0, 1);
  return h * flat;
}

export function terrainNormal(x, z, out = new THREE.Vector3()) {
  const e = 1.2;
  const hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}

// ─────────────── renderer ───────────────
export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.9));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.50, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.renderPass = renderPass;
  composer.bloom = bloom;
  return composer;
}

// ─────────────── battlefield ───────────────
export class Battlefield {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.obstacles = [];
    this.renderer = renderer;
    this._scratchA = []; this._scratchB = []; this._scratchC = [];
    this._rockGeos = [];
    this._queryStamp = 0;

    const sunDir = new THREE.Vector3();
    const elev = THREE.MathUtils.degToRad(90 - 38);   // mid-afternoon: long shadows, no glare
    const azim = THREE.MathUtils.degToRad(125);
    sunDir.setFromSphericalCoords(1, elev, azim);
    this.sunDir = sunDir;

    // ── physical sky ──
    const sky = new Sky();
    sky.scale.setScalar(45000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.4;
    u.rayleigh.value = 2.8;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.80;
    u.sunPosition.value.copy(sunDir);

    // The Sky shader emits radiance far above 1.0. UnrealBloomPass runs on the
    // raw HDR buffer *before* tone mapping, so an unscaled sky blooms across the
    // whole frame and washes everything to white. Scale its output into a sane
    // range here; then bloom only catches things we actually want glowing.
    sky.material.onBeforeCompile = (shader) => {
      shader.uniforms.skyGain = { value: 0.12 };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float skyGain;\nvoid main() {')
        .replace('gl_FragColor = vec4( retColor, 1.0 );',
                 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
      sky.material.userData.shader = shader;
    };
    sky.material.needsUpdate = true;
    this.sky = sky;

    // image-based lighting straight off the sky — free realistic reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const envRT = pmrem.fromScene(skyScene);
    this.scene.environment = envRT.texture;
    this.scene.environmentIntensity = 0.85;
    skyScene.remove(sky);
    this.scene.add(sky);
    pmrem.dispose();
    applyEnv(envRT.texture);

    this.scene.fog = new THREE.FogExp2(0xb4ac97, 0.0011);   // warm dust haze

    // ── lights ──
    const sun = new THREE.DirectionalLight(0xfff2dc, 4.0);
    sun.position.copy(sunDir).multiplyScalar(90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -78; s.right = 78; s.top = 78; s.bottom = -78;
    s.near = 1; s.far = 340;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // warm bounce from the ground, cool fill from the sky
    const hemi = new THREE.HemisphereLight(0xa8c4d8, 0x6b5334, 0.45);
    this.scene.add(hemi);

    this._buildTerrain();
    this._buildProps();
    this._buildBoundary();
  }

  _buildTerrain() {
    const g = new THREE.PlaneGeometry(ARENA, ARENA, TERRAIN_SEG, TERRAIN_SEG);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, Assets.mat.ground);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  /**
   * Records an obstacle for physics and queues its geometry for merging.
   * Rocks are static, so drawing them individually cost one call each — a few
   * hundred calls for scenery alone. Nothing outside construction needs the
   * per-rock mesh, only pos/radius/height.
   */
  _addObstacle(mesh, radius, height, kind) {
    mesh.updateMatrix();
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    this._rockGeos.push(geo);
    mesh.geometry.dispose();
    const o = { radius, height, kind, pos: mesh.position.clone() };
    this.obstacles.push(o);
    return o;
  }

  /** Merge the queued rock geometry into a handful of batched meshes. */
  _flushRocks(batchSize = 40) {
    for (let i = 0; i < this._rockGeos.length; i += batchSize) {
      const slice = this._rockGeos.slice(i, i + batchSize);
      const merged = mergeGeometries(slice, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, Assets.mat.rock);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      for (const g of slice) g.dispose();
    }
    this._rockGeos.length = 0;
  }

  /**
   * Cover is entirely natural rock now — big boulders, slabs and spires,
   * grouped into fields with open ground between them so there are real
   * approach lanes rather than a scatter of crates.
   */
  _buildProps() {
    const half = ARENA / 2 - 30;
    const clear = 30;                       // keep the deployment zone open

    const tryPlace = (r) => {
      for (let n = 0; n < 40; n++) {
        const x = rand(-half, half), z = rand(-half, half);
        if (Math.hypot(x, z) < clear + r) continue;
        let ok = true;
        for (const o of this.obstacles) {
          if (Math.hypot(o.pos.x - x, o.pos.z - z) < o.radius + r + 5) { ok = false; break; }
        }
        if (ok) return { x, z };
      }
      return null;
    };

    /** One rock. `kind` shapes it: rounded boulder, flat slab or tall spire. */
    const rock = (x, z, r, kind, seed) => {
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const pa = geo.attributes.position;
      const yScale = kind === 'spire' ? rand(1.6, 2.4) : kind === 'slab' ? rand(0.32, 0.5) : rand(0.68, 0.95);
      for (let v = 0; v < pa.count; v++) {
        const n = fbm(pa.getX(v) * 0.55 + seed, pa.getZ(v) * 0.55 + seed * 1.7, 4);
        const sc = 0.66 + n * 0.72;
        pa.setXYZ(v, pa.getX(v) * sc, pa.getY(v) * sc * yScale, pa.getZ(v) * sc);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, Assets.mat.rock);
      const h = r * yScale;
      m.position.set(x, heightAt(x, z) + h * 0.32, z);
      m.rotation.set(rand(-0.14, 0.14), rand(0, 6.28), rand(-0.14, 0.14));
      return this._addObstacle(m, r * 0.82, h * 1.3, 'rock');
    };

    // ── rock fields: a big anchor stone with smaller companions around it ──
    for (let f = 0; f < 26; f++) {
      const anchorR = rand(6, 15);
      const p = tryPlace(anchorR);
      if (!p) continue;
      const kind = Math.random() < 0.22 ? 'spire' : Math.random() < 0.3 ? 'slab' : 'boulder';
      rock(p.x, p.z, anchorR, kind, f);

      const companions = randInt(2, 5);
      for (let c = 0; c < companions; c++) {
        const a = rand(0, Math.PI * 2);
        const cr = anchorR * rand(0.32, 0.62);
        const dist = anchorR + cr + rand(2, 12);
        const cx = p.x + Math.cos(a) * dist, cz = p.z + Math.sin(a) * dist;
        if (Math.hypot(cx, cz) < clear) continue;
        if (Math.abs(cx) > half + 20 || Math.abs(cz) > half + 20) continue;
        rock(cx, cz, cr, Math.random() < 0.3 ? 'slab' : 'boulder', f * 10 + c);
      }
    }

    // ── lone landmarks scattered between the fields ──
    for (let i = 0; i < 34; i++) {
      const r = rand(3.5, 9);
      const p = tryPlace(r);
      if (!p) continue;
      rock(p.x, p.z, r, Math.random() < 0.28 ? 'spire' : 'boulder', 200 + i);
    }

    this._flushRocks();
    this._buildObstacleGrid();
  }

  /**
   * Uniform spatial grid over the obstacles. Collision and line-of-sight run
   * every frame for every vehicle, so scanning all of them was the single
   * hottest loop once the map grew.
   */
  _buildObstacleGrid() {
    this.gridCell = 48;
    this.gridMap = new Map();
    const key = (cx, cz) => cx + ',' + cz;
    for (const o of this.obstacles) {
      const r = o.radius;
      const i0 = Math.floor((o.pos.x - r) / this.gridCell), i1 = Math.floor((o.pos.x + r) / this.gridCell);
      const j0 = Math.floor((o.pos.z - r) / this.gridCell), j1 = Math.floor((o.pos.z + r) / this.gridCell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        if (!this.gridMap.has(k)) this.gridMap.set(k, []);
        this.gridMap.get(k).push(o);
      }
    }
  }

  /** Obstacles whose grid cells overlap a circle, de-duplicated by stamp. */
  _near(x, z, radius, out) {
    out.length = 0;
    const stamp = ++this._queryStamp;
    const c = this.gridCell;
    const i0 = Math.floor((x - radius) / c), i1 = Math.floor((x + radius) / c);
    const j0 = Math.floor((z - radius) / c), j1 = Math.floor((z + radius) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const bucket = this.gridMap.get(i + ',' + j);
      if (!bucket) continue;
      for (let n = 0; n < bucket.length; n++) {
        const o = bucket[n];
        if (o._stamp === stamp) continue;    // O(1) dedupe instead of a scan
        o._stamp = stamp;
        out.push(o);
      }
    }
    return out;
  }

  _buildBoundary() {
    // a ring of berms marking the edge of the engagement area
    const R = ARENA / 2 - 8;
    const seg = 150;
    const geos = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const r = rand(7, 13);
      const geo = new THREE.IcosahedronGeometry(r, 0);
      const m = new THREE.Object3D();
      m.position.set(x, heightAt(x, z) + r * 0.10, z);
      m.rotation.set(rand(0, 3), rand(0, 6.28), rand(0, 3));
      m.scale.set(1, 0.85, 1);
      m.updateMatrix();
      geos.push(geo.applyMatrix4(m.matrix));
    }
    const ring = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (ring) {
      ring.computeBoundingSphere();
      const mesh = new THREE.Mesh(ring, Assets.mat.rock);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    this.boundaryR = R - 10;
  }

  /** Keep the shadow frustum tight around the player. */
  followSun(target) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 95);
  }

  /** Circle-vs-obstacle resolution. Mutates `pos`, returns true if it hit. */
  resolveCollision(pos, radius) {
    let hit = false;
    for (const o of this._near(pos.x, pos.z, radius + 2, this._scratchA)) {
      const dx = pos.x - o.pos.x, dz = pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const min = o.radius + radius;
      if (d < min && d > 1e-4) {
        const push = (min - d);
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
        hit = true;
      }
    }
    // arena boundary
    const dr = Math.hypot(pos.x, pos.z);
    if (dr > this.boundaryR) {
      pos.x *= this.boundaryR / dr;
      pos.z *= this.boundaryR / dr;
      hit = true;
    }
    return hit;
  }

  /**
   * Terrain occlusion: does the ground itself rise above the sight line?
   * Without this, crews happily "see" through hills and fire shells into the
   * slope in front of them — which is exactly what happened once the map
   * gained real relief.
   */
  terrainBlocks(a, b, eye = 1.4) {
    const ax = a.x, az = a.z, bx = b.x, bz = b.z;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 4) return false;
    const ay = heightAt(ax, az) + eye;
    const by = heightAt(bx, bz) + eye;
    const steps = Math.min(24, Math.max(6, Math.round(len / 12)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const sight = ay + (by - ay) * t;
      if (heightAt(x, z) > sight + 0.6) return true;
    }
    return false;
  }

  /** True if the segment a→b is blocked by cover or by the terrain itself. */
  blocked(a, b, ignoreLow = true) {
    if (this.terrainBlocks(a, b)) return true;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return false;
    const ux = dx / len, uz = dz / len;
    // only test obstacles whose grid cells the ray actually crosses
    const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
    for (const o of this._near(mx, mz, len * 0.5 + 20, this._scratchB)) {
      if (ignoreLow && o.height < 1.4) continue;
      const px = o.pos.x - a.x, pz = o.pos.z - a.z;
      let t = px * ux + pz * uz;
      if (t < 0 || t > len) continue;
      const cx = px - ux * t, cz = pz - uz * t;
      if (Math.hypot(cx, cz) < o.radius * 0.92) return true;
    }
    return false;
  }

  /** Nearest obstacle that would break line of sight from `threat`. */
  findCover(from, threat, maxDist = 45) {
    let best = null, bestScore = Infinity;
    for (const o of this._near(from.x, from.z, maxDist, this._scratchC)) {
      if (o.height < 1.8 || o.radius < 1.5) continue;
      const d = Math.hypot(o.pos.x - from.x, o.pos.z - from.z);
      if (d > maxDist) continue;
      // stand on the far side of the obstacle relative to the threat
      const tx = o.pos.x - threat.x, tz = o.pos.z - threat.z;
      const tl = Math.hypot(tx, tz) || 1;
      const spot = new THREE.Vector3(
        o.pos.x + (tx / tl) * (o.radius + 2.4), 0,
        o.pos.z + (tz / tl) * (o.radius + 2.4));
      spot.y = heightAt(spot.x, spot.z);
      const score = d + Math.hypot(spot.x - from.x, spot.z - from.z) * 0.4;
      if (score < bestScore) { bestScore = score; best = spot; }
    }
    return best;
  }
}

// ─────────────── build bay ───────────────
export class BuildBay {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d0f);
    this.scene.fog = new THREE.Fog(0x0a0d0f, 34, 78);

    const size = GRID * CELL;

    // hangar floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x121517, roughness: 0.86, metalness: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // raised assembly deck
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(size + 1.4, 0.35, size + 1.4),
      new THREE.MeshStandardMaterial({ color: 0x1a1f22, roughness: 0.7, metalness: 0.55 }));
    deck.position.y = -0.18;
    deck.receiveShadow = true;
    this.scene.add(deck);

    // grid
    const grid = new THREE.GridHelper(size, GRID, 0x4a5a5e, 0x232b2e);
    grid.position.y = 0.012;
    grid.material.opacity = 0.55;
    grid.material.transparent = true;
    this.scene.add(grid);

    // deck outline
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size, 0.02, size)),
      new THREE.LineBasicMaterial({ color: 0xffab2e, transparent: true, opacity: 0.5 }));
    edge.position.y = 0.02;
    this.scene.add(edge);

    // lighting rig
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(14, 26, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -18; c.right = 18; c.top = 18; c.bottom = -18; c.near = 1; c.far = 80;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6fa8c8, 1.5);
    rim.position.set(-16, 12, -14);
    this.scene.add(rim);

    const fill = new THREE.HemisphereLight(0x9fb8c8, 0x1a1512, 0.7);
    this.scene.add(fill);

    // warm work lamps at the deck corners
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const l = new THREE.PointLight(0xffb060, 22, 30, 2);
      l.position.set(dx * (size / 2 + 2), 4.5, dz * (size / 2 + 2));
      this.scene.add(l);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffcc88, toneMapped: false }));
      bulb.position.copy(l.position);
      this.scene.add(bulb);
    }

    // studio-ish IBL for the metal
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(60, 30, 60),
      new THREE.MeshBasicMaterial({ color: 0x3c4448, side: THREE.BackSide }));
    envScene.add(box);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    panel.position.set(0, 14.9, 0); panel.rotation.x = Math.PI / 2;
    envScene.add(panel);
    const rt = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
    this.envMap = rt.texture;

    this.gridSize = size;
  }
}
