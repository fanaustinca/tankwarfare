// ───────────────────────────────────────────────────────────────
//  One-time asset bake: textures → shared PBR materials.
//  Materials are cloned per team so we can tint hostiles red
//  without regenerating any texture data.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { armourSet, treadSet, groundSet, rockSet, spriteSet } from './textures.js';
import { BLOCKS } from './parts.js';

export const Assets = {
  ready: false,
  sprites: null,
  tex: {},
  mat: {},
  geo: {},
};

function pbr(set, o = {}) {
  return new THREE.MeshStandardMaterial({
    ...set,
    color: o.color ?? 0xffffff,
    metalness: o.metalness ?? 1.0,
    roughness: o.roughness ?? 1.0,
    normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1),
    envMapIntensity: o.env ?? 1.0,
  });
}

export async function bakeAssets(onProgress = () => {}) {
  const step = async (label, fn) => {
    onProgress(label);
    // yield to the browser so the loader can actually paint
    await new Promise((r) => setTimeout(r, 0));
    return fn();
  };

  Assets.sprites = await step('particle sprites', () => spriteSet());

  // one armour texture set per block type — each has its own colour + wear
  Assets.tex.armour = {};
  for (const b of BLOCKS) {
    Assets.tex.armour[b.id] = await step(`armour · ${b.name}`,
      () => armourSet({ size: 384, color: b.color, wear: b.wear,
                        panel: b.id === 'blk_eng' ? 64 : 96 }));
  }
  Assets.tex.tread = await step('track treads', () => treadSet());
  Assets.tex.ground = await step('battlefield terrain', () => groundSet(768));
  Assets.tex.rock = await step('rock + concrete', () => rockSet(384));
  // turrets reuse a darker gunmetal plate
  Assets.tex.gunmetal = await step('gunmetal',
    () => armourSet({ size: 384, color: [0.20, 0.22, 0.23], wear: 0.7, panel: 56 }));

  await step('materials', () => {
    Assets.mat.block = {};
    for (const b of BLOCKS) {
      Assets.mat.block[b.id] = pbr(Assets.tex.armour[b.id], { normal: 1.0, env: 1.0 });
    }
    Assets.mat.tread = pbr(Assets.tex.tread, { metalness: 0.25, normal: 1.4, env: 0.5 });
    Assets.mat.gun = pbr(Assets.tex.gunmetal, { normal: 0.9 });
    Assets.mat.barrel = new THREE.MeshStandardMaterial({
      color: 0x3a3d3e, metalness: 1.0, roughness: 0.34, envMapIntensity: 1.2,
    });
    Assets.mat.wheel = new THREE.MeshStandardMaterial({
      color: 0x2b2d2c, metalness: 0.85, roughness: 0.55,
    });
    // The ground tiles 90x across the map; without large-scale modulation that
    // repeat is obvious from any distance. Blend a map-scale noise over it.
    const groundMaps = { ...Assets.tex.ground };
    const macro = groundMaps.macro;
    delete groundMaps.macro;
    Assets.mat.ground = pbr(groundMaps, { metalness: 0.0, roughness: 1.0, normal: 1.1, env: 0.55 });
    Assets.mat.ground.onBeforeCompile = (shader) => {
      shader.uniforms.uMacro = { value: macro };
      shader.uniforms.uMacroScale = { value: 0.0125 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>',
                 '#include <worldpos_vertex>\n\tvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
                 '#include <common>\nuniform sampler2D uMacro;\nuniform float uMacroScale;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>',
                 '#include <map_fragment>\n'
               + '\tfloat mA = texture2D( uMacro, vWPos.xz * uMacroScale ).r;\n'
               + '\tfloat mB = texture2D( uMacro, vWPos.xz * uMacroScale * 0.31 + 0.37 ).r;\n'
               + '\tfloat mac = mix( mA, mB, 0.5 );\n'
               + '\tdiffuseColor.rgb *= 0.74 + mac * 0.58;\n'
               + '\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 0.99, 0.87), mac * 0.5 );');
    };
    Assets.mat.rock = pbr(Assets.tex.rock, { color: 0xa89e8d, metalness: 0.05, roughness: 1.0, normal: 1.2, env: 0.55 });
    Assets.mat.concrete = pbr(Assets.tex.rock, { color: 0x7d786c, metalness: 0.02, roughness: 0.95, normal: 0.8 });
    Assets.mat.glowHot = new THREE.MeshBasicMaterial({ color: 0xffb04a });
    Assets.mat.tracer = new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false });
    Assets.mat.tracerEnemy = new THREE.MeshBasicMaterial({ color: 0xff6a4a, toneMapped: false });
  });

  await step('geometry cache', () => {
    Assets.geo.wheel = new THREE.CylinderGeometry(0.30, 0.30, 0.26, 18);
    Assets.geo.wheel.rotateZ(Math.PI / 2);
    Assets.geo.sprocket = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
    Assets.geo.sprocket.rotateZ(Math.PI / 2);
    Assets.geo.shell = new THREE.SphereGeometry(0.11, 8, 6);
    Assets.geo.shell.scale(1, 1, 2.6);
  });

  Assets.ready = true;
  return Assets;
}

// One tinted instance per (material, tint) pair, shared by every tank that
// uses it — otherwise a nine-tank wave clones a few hundred materials.
const tintCache = new Map();

/** Tint a material for a given team (hostiles get a warmer, rustier hull). */
export function teamTint(mat, tint) {
  const key = mat.uuid + ':' + tint;
  let m = tintCache.get(key);
  if (!m) {
    m = mat.clone();
    m.color = new THREE.Color(tint);
    tintCache.set(key, m);
  }
  return m;
}

/** Apply a scene environment map to every baked material. */
export function applyEnv(envMap) {
  for (const m of tintCache.values()) { m.envMap = envMap; m.needsUpdate = true; }
  for (const key of Object.keys(Assets.mat)) {
    const m = Assets.mat[key];
    if (m && m.isMaterial && 'envMap' in m) { m.envMap = envMap; m.needsUpdate = true; }
    else if (m && !m.isMaterial) {
      for (const k2 of Object.keys(m)) {
        if (m[k2] && m[k2].isMaterial) { m[k2].envMap = envMap; m[k2].needsUpdate = true; }
      }
    }
  }
}
