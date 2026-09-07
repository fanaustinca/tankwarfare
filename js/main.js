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
import { Save } from './save.js';
import { Ads } from './ads.js';

class App {
  constructor() {
    this.renderer = createRenderer(document.getElementById('viewport'));
    this.audio = new Audio();
    this.clock = new THREE.Clock();
    this.mode = null;
    this.lastBuild = null;
    this.timeScale = 1;
    this.settings = Save.loadSettings();
  }

  async boot() {
    const loader = document.getElementById('loader');
    const txt = loader.querySelector('.ldr-txt');

    await bakeAssets((label) => { txt.textContent = label.toUpperCase(); });

    txt.textContent = 'ASSEMBLING WORLD';
    await new Promise((r) => setTimeout(r, 0));

    this.build = new BuildMode(this);
    this.battle = new BattleMode(this);

    // restore the last chassis you were working on
    const saved = Save.loadTank();
    if (saved) {
      this.build.build = saved;
      this.build.rebuild();
      this.build.setPhase(saved.turrets.size ? 2 : saved.blocks.size ? 1 : 0);
    }

    this.composer = createComposer(this.renderer, this.build.scene, this.build.camera);

    addEventListener('resize', () => this.resize());
    this.resize();

    this._initOverlay();

    // overlays
    document.getElementById('btn-start').addEventListener('click', () => {
      this.audio.init(); this.audio.resume();
      document.getElementById('overlay').classList.add('hidden');
      this.enterBuild();
    });
    document.getElementById('btn-again').addEventListener('click', () => {
      document.getElementById('overlay').classList.add('hidden');
      this.battle.clearRun();
      this.startBattle(this.lastBuild);
    });
    document.getElementById('btn-rebuild').addEventListener('click', () => {
      document.getElementById('overlay').classList.add('hidden');
      this.returnToBuild();
    });
    document.getElementById('btn-revive').addEventListener('click', async () => {
      const btn = document.getElementById('btn-revive');
      btn.disabled = true;
      const earned = await Ads.rewardedBreak('Repair & continue');
      btn.disabled = false;
      if (!earned) return;
      document.getElementById('overlay').classList.add('hidden');
      this.mode = 'battle';
      this.battle.revive();
      Ads.gameplayStart();
    });
    document.getElementById('btn-resume').addEventListener('click', () => {
      document.getElementById('overlay').classList.add('hidden');
      this.battle.resumeWave = this._resumeWave || 1;
      this.startBattle(this.lastBuild);
    });

    // Ads pause the simulation rather than letting it run behind the overlay
    await Ads.init({
      onPause: () => { this.paused = true; this.audio.setMuted(true); },
      onResume: () => { this.paused = false; this.audio.setMuted(this.settings.muted); },
    });
    Ads.mountBanner(document.getElementById('bay-banner'), '300x250');

    installDevConsole(this);

    Ads.loadingFinished();
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 600);

    // warm the pipeline on the build scene so the first frame isn't a stutter
    this.enterBuild();
    document.getElementById('build-ui').classList.add('hidden');

    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Start-screen: saved-tank notice, best run, and the look settings. */
  _initOverlay() {
    const p = Save.loadProgress();
    const note = document.getElementById('ov-save');
    const bits = [];
    if (Save.hasTank()) bits.push('chassis restored');
    if (p.bestWave) bits.push(`best <b>wave ${p.bestWave}</b> &middot; <b>${p.bestScore.toLocaleString('en-US')}</b> pts`);
    if (p.lastWave > 1) bits.push(`run in progress at <b>wave ${p.lastWave}</b>`);
    if (bits.length) { note.innerHTML = bits.join(' &nbsp;·&nbsp; '); note.classList.remove('hidden'); }
    if (!Save.available()) {
      note.innerHTML = 'saving unavailable in this browser &mdash; progress will not persist';
      note.classList.remove('hidden');
    }

    const s = this.settings;
    const invx = document.getElementById('opt-invx');
    const invy = document.getElementById('opt-invy');
    const sens = document.getElementById('opt-sens');
    invx.checked = s.invertX; invy.checked = s.invertY; sens.value = s.sensitivity;
    const persist = () => { Save.saveSettings(this.settings); };
    invx.addEventListener('change', () => { s.invertX = invx.checked; persist(); });
    invy.addEventListener('change', () => { s.invertY = invy.checked; persist(); });
    sens.addEventListener('input', () => { s.sensitivity = +sens.value; persist(); });
    document.getElementById('btn-wipe').addEventListener('click', () => {
      Save.wipe();
      this.settings = Save.loadSettings();
      document.getElementById('ov-save').classList.add('hidden');
      invx.checked = invy.checked = false; sens.value = 1;
    });
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
    this._usedRevive = false;
    this.build.exit();
    this.mode = 'battle';
    this.audio.init(); this.audio.resume();
    const wanted = this.settings.map || 'dunes';
    this.battle.setMap(wanted);
    this.battle.start(build);
    Ads.gameplayStart();
    this.composer.bloom.strength = 0.55;
    this.renderer.toneMappingExposure = 1.6;    // outdoor daylight
  }

  returnToBuild() {
    Ads.gameplayStop();
    this.battle.suspend();          // keep the wave you were on
    this.enterBuild();
    this.build.updateHUD();
  }

  showEnd({ won, wave, kills, score, time, bestWave, bestScore }) {
    Ads.gameplayStop();
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
    const beat = bestWave && wave >= bestWave;
    document.getElementById('end-sub').innerHTML = (won
      ? 'Your chassis held the line.'
      : 'Your chassis came apart under fire. Rebuild it stronger.')
      + (beat ? ' &nbsp;<span style="color:var(--amber)">New personal best.</span>'
              : bestWave ? ` &nbsp;<span style="color:var(--dim2)">Best: wave ${bestWave}</span>` : '');
    document.getElementById('end-stats').innerHTML = `
      <div><label>Waves</label><span>${wave}</span></div>
      <div><label>Kills</label><span>${kills}</span></div>
      <div><label>Score</label><span>${score.toLocaleString('en-US')}</span></div>
      <div><label>Time</label><span>${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}</span></div>`;

    // offer a resume a couple of waves back rather than restarting the ladder
    this._resumeWave = Math.max(1, wave - 1);
    document.getElementById('resume-wave').textContent = this._resumeWave;
    document.getElementById('btn-resume').style.display = wave > 2 ? '' : 'none';

    // one revive per run, and only after an actual defeat
    const revive = document.getElementById('btn-revive');
    revive.style.display = (!won && !this._usedRevive) ? '' : 'none';
    if (!won) this._usedRevive = true;
  }

  // ─────────────── loop ───────────────
  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05);
    const dt = raw * this.timeScale;
    const t = this.clock.elapsedTime;

    if (!this.paused) {
      if (this.mode === 'build') this.build.update(dt, t);
      else if (this.mode === 'battle') this.battle.update(dt);
    }

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
