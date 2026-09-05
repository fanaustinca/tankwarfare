// ───────────────────────────────────────────────────────────────
//  Renderer + scenes.
//  Battlefield: physical sky, sun-lit displaced terrain, cover
//  props, IBL from the sky itself. Build bay: dark hangar with
//  a lit assembly deck.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Assets, applyEnv } from './assets.js';
import { fbm, rand, clamp } from './util.js';
import { GRID, CELL } from './parts.js';

export const ARENA = 230;           // playable half-extent * 2
const TERRAIN_SEG = 180;

/** Shared terrain height field — physics and geometry read the same function. */
export function heightAt(x, z) {
  const h =
    fbm(x * 0.0075 + 40, z * 0.0075 + 17, 4) * 5.4 +
    fbm(x * 0.019 + 71, z * 0.019 + 23, 3) * 2.4 +
    fbm(x * 0.031 + 3, z * 0.031 + 9, 3) * 1.1;
  // flatten the very centre so the deployment zone is drivable
  const d = Math.hypot(x, z);
  const flat = clamp((d - 14) / 22, 0, 1);
  return (h - 4.4) * flat;
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

    this.scene.fog = new THREE.FogExp2(0xb4ac97, 0.0019);   // warm dust haze

    // ── lights ──
    const sun = new THREE.DirectionalLight(0xfff2dc, 4.0);
    sun.position.copy(sunDir).multiplyScalar(90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -55; s.right = 55; s.top = 55; s.bottom = -55;
    s.near = 1; s.far = 260;
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

  _addObstacle(mesh, radius, height, kind) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const o = { mesh, radius, height, kind, pos: mesh.position.clone() };
    this.obstacles.push(o);
    return o;
  }

  _buildProps() {
    const half = ARENA / 2 - 18;
    const place = (minR, maxR) => {
      for (let tries = 0; tries < 30; tries++) {
        const x = rand(-half, half), z = rand(-half, half);
        if (Math.hypot(x, z) < 16) continue;          // keep spawn clear
        let ok = true;
        for (const o of this.obstacles) {
          if (Math.hypot(o.pos.x - x, o.pos.z - z) < o.radius + maxR + 3) { ok = false; break; }
        }
        if (ok) return { x, z };
      }
      return null;
    };

    // boulders
    for (let i = 0; i < 34; i++) {
      const p = place(2, 5); if (!p) continue;
      const r = rand(1.6, 4.2);
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const pa = geo.attributes.position;
      for (let v = 0; v < pa.count; v++) {
        const n = fbm(pa.getX(v) * 0.9 + 5, pa.getZ(v) * 0.9 + i, 3);
        const sc = 0.72 + n * 0.6;
        pa.setXYZ(v, pa.getX(v) * sc, pa.getY(v) * sc * 0.72, pa.getZ(v) * sc);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, Assets.mat.rock);
      m.position.set(p.x, heightAt(p.x, p.z) + r * 0.30, p.z);
      m.rotation.set(rand(-0.2, 0.2), rand(0, 6.28), rand(-0.2, 0.2));
      this._addObstacle(m, r * 0.85, r * 1.1, 'rock');
    }

    // concrete blast walls — the AI's favourite cover
    for (let i = 0; i < 16; i++) {
      const p = place(3, 7); if (!p) continue;
      const w = rand(5, 11), h = rand(2.2, 3.6), d = rand(0.8, 1.3);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Assets.mat.concrete);
      m.position.set(p.x, heightAt(p.x, p.z) + h / 2 - 0.2, p.z);
      m.rotation.y = rand(0, Math.PI * 2);
      this._addObstacle(m, Math.max(w, d) * 0.5, h, 'wall');
    }

    // bunkers / ruined structures
    for (let i = 0; i < 9; i++) {
      const p = place(4, 8); if (!p) continue;
      const grp = new THREE.Group();
      const w = rand(6, 10), h = rand(3, 4.6), d = rand(5, 9);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Assets.mat.concrete);
      body.position.y = h / 2;
      body.castShadow = body.receiveShadow = true;
      grp.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.14, 0.5, d * 1.14), Assets.mat.concrete);
      roof.position.y = h + 0.25;
      roof.castShadow = roof.receiveShadow = true;
      grp.add(roof);
      grp.position.set(p.x, heightAt(p.x, p.z) - 0.3, p.z);
      grp.rotation.y = rand(0, Math.PI * 2);
      this._addObstacle(grp, Math.max(w, d) * 0.55, h, 'bunker');
    }

    // scattered crates for visual density (still solid)
    for (let i = 0; i < 22; i++) {
      const p = place(1, 3); if (!p) continue;
      const s = rand(0.9, 1.7);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), Assets.mat.rock);
      m.position.set(p.x, heightAt(p.x, p.z) + s / 2, p.z);
      m.rotation.y = rand(0, 6.28);
      this._addObstacle(m, s * 0.62, s, 'crate');
    }
  }

  _buildBoundary() {
    // a ring of berms marking the edge of the engagement area
    const R = ARENA / 2 - 4;
    const seg = 92;
    const grp = new THREE.Group();
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const r = rand(3.4, 5.6);
      const geo = new THREE.IcosahedronGeometry(r, 0);
      const m = new THREE.Mesh(geo, Assets.mat.rock);
      m.position.set(x, heightAt(x, z) + r * 0.15, z);
      m.rotation.set(rand(0, 3), rand(0, 6.28), rand(0, 3));
      m.scale.set(1, 0.85, 1);
      m.castShadow = m.receiveShadow = true;
      grp.add(m);
    }
    this.scene.add(grp);
    this.boundaryR = R - 5;
  }

  /** Keep the shadow frustum tight around the player. */
  followSun(target) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 95);
  }

  /** Circle-vs-obstacle resolution. Mutates `pos`, returns true if it hit. */
  resolveCollision(pos, radius) {
    let hit = false;
    for (const o of this.obstacles) {
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

  /** True if the segment a→b is blocked by an obstacle (used for AI line of sight). */
  blocked(a, b, ignoreLow = true) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return false;
    const ux = dx / len, uz = dz / len;
    for (const o of this.obstacles) {
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
    for (const o of this.obstacles) {
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
