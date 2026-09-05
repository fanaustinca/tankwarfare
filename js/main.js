// ───────────────────────────────────────────────────────────────
//  TankWarfare — bootstrap and mode switching.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createRenderer, createComposer } from './world.js';
import { bakeAssets } from './assets.js';
import { BuildMode } from './build.js';
import { BattleMode } from './battle.js';
import { Audio } from './audio.js';
import { installDevConsole } from './dev.js';

class App {
  constructor() {
    this.renderer = createRenderer(document.getElementById('viewport'));
    this.audio = new Audio();
    this.clock = new THREE.Clock();
    this.mode = null;
    this.lastBuild = null;
    this.timeScale = 1;
  }

  async boot() {
    const loader = document.getElementById('loader');
    const txt = loader.querySelector('.ldr-txt');

    await bakeAssets((label) => { txt.textContent = label.toUpperCase(); });

    txt.textContent = 'ASSEMBLING WORLD';
    await new Promise((r) => setTimeout(r, 0));

    this.build = new BuildMode(this);
    this.battle = new BattleMode(this);

    this.composer = createComposer(this.renderer, this.build.scene, this.build.camera);

    addEventListener('resize', () => this.resize());
    this.resize();

    // overlays
    document.getElementById('btn-start').addEventListener('click', () => {
      this.audio.init(); this.audio.resume();
      document.getElementById('overlay').classList.add('hidden');
      this.enterBuild();
    });
    document.getElementById('btn-again').addEventListener('click', () => {
      document.getElementById('overlay').classList.add('hidden');
      this.startBattle(this.lastBuild);
    });
    document.getElementById('btn-rebuild').addEventListener('click', () => {
      document.getElementById('overlay').classList.add('hidden');
      this.returnToBuild();
    });

    installDevConsole(this);

    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 600);

    // warm the pipeline on the build scene so the first frame isn't a stutter
    this.enterBuild();
    document.getElementById('build-ui').classList.add('hidden');

    this.renderer.setAnimationLoop(() => this.frame());
  }

  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    if (this.composer) {
      this.composer.renderPass.scene = scene;
      this.composer.renderPass.camera = camera;
    }
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    for (const cam of [this.build && this.build.camera, this.battle && this.battle.camera]) {
      if (!cam) continue;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  }

  // ─────────────── modes ───────────────
  enterBuild() {
    if (this.battle) this.battle.stop();
    this.mode = 'build';
    this.build.enter();
    this.composer.bloom.strength = 0.40;
    this.renderer.toneMappingExposure = 1.35;   // dark hangar interior
  }

  startBattle(build) {
    this.lastBuild = build;
    this.build.exit();
    this.mode = 'battle';
    this.audio.init(); this.audio.resume();
    this.battle.start(build);
    this.composer.bloom.strength = 0.55;
    this.renderer.toneMappingExposure = 1.6;    // outdoor daylight
  }

  returnToBuild() {
    this.enterBuild();
  }

  showEnd({ won, wave, kills, score, time }) {
    this.battle.stop();
    this.mode = 'end';
    const ov = document.getElementById('overlay');
    document.getElementById('ov-start').classList.add('hidden');
    const end = document.getElementById('ov-end');
    end.classList.remove('hidden');
    ov.classList.remove('hidden');

    document.getElementById('end-mark').textContent = won ? '★' : '☠';
    document.getElementById('end-mark').className = 'ov-mark' + (won ? ' win' : '');
    document.getElementById('end-title').innerHTML = won ? 'SECTOR <b>HELD</b>' : 'TANK <b>DESTROYED</b>';
    document.getElementById('end-sub').textContent = won
      ? 'Your chassis held the line.'
      : 'Your chassis came apart under fire. Rebuild it stronger.';
    document.getElementById('end-stats').innerHTML = `
      <div><label>Waves</label><span>${wave}</span></div>
      <div><label>Kills</label><span>${kills}</span></div>
      <div><label>Score</label><span>${score.toLocaleString('en-US')}</span></div>
      <div><label>Time</label><span>${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}</span></div>`;
  }

  // ─────────────── loop ───────────────
  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05);
    const dt = raw * this.timeScale;
    const t = this.clock.elapsedTime;

    if (this.mode === 'build') this.build.update(dt, t);
    else if (this.mode === 'battle') this.battle.update(dt);

    if (this.scene && this.camera) this.composer.render();
  }
}

const app = new App();
window.__app = app;          // handy for debugging from the console
app.boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loader');
  if (l) l.querySelector('.ldr-txt').innerHTML =
    'FAILED TO START<br><span style="color:#ff4d3d">' + e.message + '</span>';
});
