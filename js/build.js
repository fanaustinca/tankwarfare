// ───────────────────────────────────────────────────────────────
//  BUILD MODE — bird's-eye assembly deck, three phases:
//    0 tracks · 1 hull blocks · 2 turrets
//  Every edit rebuilds the preview chassis from the same Tank
//  class the battle uses, so what you see is exactly what you drive.
// ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { BuildBay } from './world.js';
import { Tank } from './tank.js';
import {
  GRID, CELL, TRACK_H, BLOCK_H, MAX_LAYERS, START_FUNDS,
  ALL_PARTS, partsFor, emptyBuild, cloneBuild, quickBuild,
  key2, key3, topLayer, placementError, computeStats, footOf, turretOccupancy, specOf,
  UPGRADES, upgradeCost, emptyUpgrades,
} from './parts.js';
import { clamp, smooth, fmt } from './util.js';

const ORIGIN = { ox: (-GRID / 2 + 0.5) * CELL, oz: (-GRID / 2 + 0.5) * CELL };

const PHASE_HINT = [
  'Lay <b>tracks</b> to give the chassis drive &mdash; each section must touch the last. <b>LMB</b> place &middot; <b>RMB</b> remove &middot; <b>RMB-drag</b> orbit',
  'Weld <b>hull blocks</b> beside the tracks, then stack upward. <b>1-3</b> switch layer &middot; <b>scroll</b> zoom',
  'Bolt <b>turrets</b> onto the top of any hull column. Mix guns for range and rate of fire.',
];

export class BuildMode {
  constructor(app) {
    this.app = app;
    this.bay = new BuildBay(app.renderer);
    this.scene = this.bay.scene;

    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 400);
    this.camDist = 27;
    this.camAzim = 0;
    this.camElev = 1.16;          // radians from horizontal — angled bird's-eye
    this.camTargetDist = 27;

    this.build = emptyBuild();
    this.phase = 0;
    this.layer = 0;
    this.selected = { 0: 'trk_std', 1: 'blk_lgt', 2: 'tur_can' };
    this.history = [];
    this.hoverCell = null;
    this.valid = false;
    this.tank = null;
    this.active = false;

    this._makeGhost();
    this._makeCursor();
    this._bindDOM();
    this._bindInput();
    this.rebuild();
    this.setPhase(0);
  }

  // ─────────────── visuals ───────────────
  _makeGhost() {
    // translucent preview of the piece about to be placed
    this.ghost = new THREE.Group();
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x6effc0, transparent: true, opacity: 0.42,
      emissive: 0x1c8f66, emissiveIntensity: 0.7, roughness: 0.4, metalness: 0.3,
      depthWrite: false,
    });
    this.ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    this.ghost.add(this.ghostBox);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  _makeCursor() {
    // footprint outline under the ghost
    const g = new THREE.BufferGeometry();
    const h = CELL * 0.5;
    const pts = [
      -h, 0, -h, h, 0, -h, h, 0, -h, h, 0, h,
      h, 0, h, -h, 0, h, -h, 0, h, -h, 0, -h,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.cursor = new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0x6effc0, transparent: true, opacity: 0.9 }));
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    // column guide showing which layer you are editing
    this.layerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID * CELL, GRID * CELL),
      new THREE.MeshBasicMaterial({
        color: 0x4fd6e8, transparent: true, opacity: 0.045,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    this.layerPlane.rotation.x = -Math.PI / 2;
    this.layerPlane.visible = false;
    this.scene.add(this.layerPlane);
  }

  rebuild() {
    if (this.tank) {
      this.scene.remove(this.tank.group);
      this.tank.dispose();
    }
    this.tank = new Tank(this.build, { originOffset: ORIGIN });
    this.scene.add(this.tank.group);
    this.stats = computeStats(this.build);
    this.funds = START_FUNDS + (this.bonusFunds || 0) - this.stats.cost;
    this.updateHUD();
  }

  // ─────────────── DOM ───────────────
  _bindDOM() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('build-ui'),
      funds: $('s-funds'), weight: $('s-weight'), speed: $('s-speed'),
      turn: $('s-turn'), hp: $('s-hp'), dps: $('s-dps'),
      paletteTitle: $('palette-title'), paletteList: $('palette-list'),
      tally: $('tally'), hint: $('build-hint'), layerctl: $('layerctl'),
      upgrades: $('upgrade-list'),
      battle: $('btn-battle'), next: $('btn-next'), prev: $('btn-prev'),
    };

    document.querySelectorAll('.phase').forEach((b) =>
      b.addEventListener('click', () => this.setPhase(+b.dataset.phase)));
    document.querySelectorAll('.layers button').forEach((b) =>
      b.addEventListener('click', () => this.setLayer(+b.dataset.layer)));

    $('btn-next').addEventListener('click', () => this.setPhase(Math.min(2, this.phase + 1)));
    $('btn-prev').addEventListener('click', () => this.setPhase(Math.max(0, this.phase - 1)));
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-clear').addEventListener('click', () => {
      const keep = this.build.upgrades;
      this.build = emptyBuild(); this.build.upgrades = keep;   // keep purchased upgrades
      this.history.length = 0; this.rebuild(); this.app.audio.ui(0.6);
    });
    $('btn-quick').addEventListener('click', () => {
      this.build = quickBuild(); this.history.length = 0; this.rebuild();
      this.setPhase(2); this.app.audio.ui(1.2);
    });
    $('btn-battle').addEventListener('click', () => {
      if (this.stats.valid) this.app.startBattle(cloneBuild(this.build));
    });
  }

  _bindInput() {
    const dom = this.app.renderer.domElement;
    this.dragging = false;
    this.dragMoved = 0;

    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (this.dragging) {
        this.camAzim -= e.movementX * 0.006;
        this.camElev = clamp(this.camElev - e.movementY * 0.005, 0.42, 1.50);
        this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
        return;
      }
      this.pointer = { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 };
      this.updateHover();
    });

    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.button === 2) { this.dragging = true; this.dragMoved = 0; dom.setPointerCapture(e.pointerId); }
      else if (e.button === 0) this.place();
    });

    dom.addEventListener('pointerup', (e) => {
      if (!this.active) return;
      if (e.button === 2) {
        this.dragging = false;
        try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
        if (this.dragMoved < 6) this.remove();
      }
    });

    dom.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.camTargetDist = clamp(this.camTargetDist + e.deltaY * 0.02, 9, 48);
    }, { passive: false });

    addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key >= '1' && e.key <= '3') {
        if (this.phase === 1) this.setLayer(+e.key - 1);
        else this.setPhase(+e.key - 1);
      }
      if (e.key === 'Tab') { e.preventDefault(); this.setPhase((this.phase + 1) % 3); }
      if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) this.undo();
      if (e.key.toLowerCase() === 'q') this.camAzim -= 0.22;
      if (e.key.toLowerCase() === 'e') this.camAzim += 0.22;
      if (e.key === 'Enter' && this.stats.valid) this.app.startBattle(cloneBuild(this.build));
    });
  }

  // ─────────────── phases & palette ───────────────
  setPhase(p) {
    this.phase = p;
    document.querySelectorAll('.phase').forEach((b) => {
      const n = +b.dataset.phase;
      b.classList.toggle('active', n === p);
      const done = (n === 0 && this.build.tracks.size > 0) ||
                   (n === 1 && this.build.blocks.size > 0) ||
                   (n === 2 && this.build.turrets.size > 0);
      b.classList.toggle('done', done && n !== p);
    });
    this.el.layerctl.classList.toggle('hidden', p !== 1);
    this.el.hint.innerHTML = PHASE_HINT[p];
    this.el.next.classList.toggle('gone', p === 2);
    this.el.prev.classList.toggle('gone', p === 0);
    this.el.paletteTitle.textContent =
      ['Track Sections', 'Hull Blocks', 'Turrets & Weapons'][p];
    this.renderPalette();
    this.updateGhostShape();
    this.app.audio.ui(0.8);
  }

  setLayer(k) {
    this.layer = clamp(k, 0, MAX_LAYERS - 1);
    document.querySelectorAll('.layers button').forEach((b) =>
      b.classList.toggle('on', +b.dataset.layer === this.layer));
    this.layerPlane.position.y = TRACK_H + BLOCK_H * this.layer + 0.01;
    this.updateGhostShape();
  }

  renderUpgrades() {
    const up = this.build.upgrades || (this.build.upgrades = emptyUpgrades());
    this.el.upgrades.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = up[u.id] || 0;
      const cost = upgradeCost(u.id, lvl);
      const maxed = lvl >= u.max;
      const afford = cost <= this.funds;
      const row = document.createElement('div');
      row.className = 'upg';
      row.innerHTML = `
        <div class="upg-top">
          <div class="upg-ico">${u.icon}</div>
          <div class="upg-name">${u.name}</div>
          <div class="upg-pips">${Array.from({ length: u.max },
            (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <div class="upg-eff ${lvl ? '' : 'none'}">${lvl ? u.effect(lvl) : u.desc}</div>
        <button class="upg-buy${maxed ? ' maxed' : ''}" ${maxed || !afford ? 'disabled' : ''}>
          ${maxed ? 'MAX LEVEL' : `UPGRADE &middot; <b>$${cost}</b>`}
        </button>`;
      if (!maxed) row.querySelector('.upg-buy').addEventListener('click', () => this.buyUpgrade(u.id));
      this.el.upgrades.appendChild(row);
    }
  }

  buyUpgrade(id) {
    const up = this.build.upgrades;
    const lvl = up[id] || 0;
    const cost = upgradeCost(id, lvl);
    if (cost > this.funds) { this.flashHint('not enough funds for that upgrade'); this.app.audio.deny(); return; }
    up[id] = lvl + 1;
    this.history.push({ op: 'upgrade', id });
    this.rebuild();
    this.app.audio.weld();
    this.pulse(this.el.funds);
  }

  renderPalette() {
    const list = this.el.paletteList;
    list.innerHTML = '';
    for (const p of partsFor(this.phase)) {
      const b = document.createElement('button');
      b.className = 'part' + (this.selected[this.phase] === p.id ? ' sel' : '') +
                    (p.cost > this.funds ? ' unaff' : '');
      b.innerHTML = `
        <div class="p-top"><span class="p-name">${p.name}</span><span class="p-cost">$${p.cost}</span></div>
        <div class="p-desc">${p.desc}</div>
        <div class="p-spec">${specOf(p).map(([k, v]) => `<span><i>${k}</i> ${v}</span>`).join('')}</div>`;
      b.addEventListener('click', () => {
        this.selected[this.phase] = p.id;
        this.renderPalette();
        this.updateGhostShape();
        this.app.audio.ui(1.0);
      });
      list.appendChild(b);
    }
  }

  get currentDef() { return ALL_PARTS[this.selected[this.phase]]; }

  updateGhostShape() {
    const def = this.currentDef;
    this.ghostBox.geometry.dispose();
    if (this.phase === 0) {
      this.ghostBox.geometry = new THREE.BoxGeometry(CELL * 0.94, TRACK_H, CELL * 0.99);
    } else if (this.phase === 1) {
      this.ghostBox.geometry = new THREE.BoxGeometry(CELL * 0.98, BLOCK_H, CELL * 0.98);
    } else {
      const [fw, fd] = footOf(def);
      this.ghostBox.geometry = new THREE.BoxGeometry(fw * CELL * 0.92, 0.46, fd * CELL * 0.92);
    }
  }

  // ─────────────── hover + placement ───────────────
  updateHover() {
    if (!this.pointer) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.pointer, this.camera);

    let cell = null;
    if (this.phase === 2) {
      // pick the actual hull so turrets land on the right column height
      const hits = ray.intersectObject(this.tank.group, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.cell) o = o.parent;
        if (o && o.userData.kind === 'block') { cell = { i: o.userData.cell.i, j: o.userData.cell.j }; break; }
      }
    }
    if (!cell) {
      const y = this.phase === 1 ? TRACK_H + BLOCK_H * this.layer : 0;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
      const pt = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, pt)) { this.hideGhost(); return; }
      cell = {
        i: Math.round((pt.x - ORIGIN.ox) / CELL),
        j: Math.round((pt.z - ORIGIN.oz) / CELL),
      };
    }

    if (cell.i < 0 || cell.j < 0 || cell.i >= GRID || cell.j >= GRID) { this.hideGhost(); return; }
    this.hoverCell = cell;

    const k = this.phase === 1 ? this.layer : 0;
    const err = placementError(this.build, this.phase, cell.i, cell.j, k, this.selected[this.phase]);
    const def = this.currentDef;
    const afford = def.cost <= this.funds;
    this.valid = !err && afford;
    this.hoverError = err || (afford ? null : 'insufficient funds');

    // position the ghost
    const x = cell.i * CELL + ORIGIN.ox, z = cell.j * CELL + ORIGIN.oz;
    let y;
    if (this.phase === 0) y = TRACK_H / 2;
    else if (this.phase === 1) y = TRACK_H + BLOCK_H * (this.layer + 0.5);
    else {
      const top = topLayer(this.build, cell.i, cell.j);
      y = TRACK_H + BLOCK_H * (top + 1) + 0.3;
    }
    // a multi-cell gun previews over the centre of the platform it would claim
    let gx = x, gz = z;
    if (this.phase === 2) {
      const [fw, fd] = footOf(def);
      gx += (fw - 1) * CELL * 0.5;
      gz += (fd - 1) * CELL * 0.5;
    }
    this.ghost.position.set(gx, y, gz);
    this.ghost.visible = true;
    this.cursor.position.set(gx, 0.03, gz);
    if (this.phase === 2) {
      const [fw, fd] = footOf(def);
      this.cursor.scale.set(fw, 1, fd);
    } else this.cursor.scale.set(1, 1, 1);
    this.cursor.visible = true;
    const col = this.valid ? 0x6effc0 : 0xff5a44;
    this.ghostMat.color.setHex(col);
    this.ghostMat.emissive.setHex(this.valid ? 0x1c8f66 : 0x8a2418);
    this.cursor.material.color.setHex(col);
    this.layerPlane.visible = this.phase === 1;
  }

  hideGhost() {
    this.ghost.visible = false;
    this.cursor.visible = false;
    this.hoverCell = null;
    this.valid = false;
  }

  place() {
    if (!this.hoverCell || !this.valid) {
      if (this.hoverError) this.flashHint(this.hoverError);
      this.app.audio.deny();
      return;
    }
    const { i, j } = this.hoverCell;
    const type = this.selected[this.phase];
    if (this.phase === 0) {
      this.build.tracks.set(key2(i, j), { i, j, type });
      this.history.push({ op: 'add', phase: 0, key: key2(i, j) });
    } else if (this.phase === 1) {
      const k = this.layer;
      this.build.blocks.set(key3(i, j, k), { i, j, k, type });
      this.history.push({ op: 'add', phase: 1, key: key3(i, j, k) });
    } else {
      this.build.turrets.set(key2(i, j), { i, j, type });
      this.history.push({ op: 'add', phase: 2, key: key2(i, j) });
    }
    this.rebuild();
    this.updateHover();
    this.app.audio.weld();
    this.pulse(this.el.funds);
  }

  remove() {
    if (!this.hoverCell) return;
    const { i, j } = this.hoverCell;
    // everything pulled off in one right-click, so undo can put it all back
    const undoBatch = { op: 'remove', items: [] };
    const drop = (map, key) => {
      const data = map.get(key);
      if (data === undefined) return false;
      undoBatch.items.push({ map, key, data });
      map.delete(key);
      return true;
    };
    let removed = false;

    if (this.phase === 2) {
      // click anywhere on a big gun's footprint to pull it off
      const owner = turretOccupancy(this.build).get(key2(i, j));
      if (owner) removed = drop(this.build.turrets, owner);
    } else if (this.phase === 1) {
      // never orphan a stack: remove from the top of the column down
      for (let k = MAX_LAYERS - 1; k >= 0; k--) {
        if (this.build.blocks.has(key3(i, j, k))) { removed = drop(this.build.blocks, key3(i, j, k)); break; }
      }
      if (removed) this.pruneUnsupported(drop);
    } else {
      removed = drop(this.build.tracks, key2(i, j));
      if (removed) this.pruneUnsupported(drop);
    }

    if (removed) {
      this.history.push(undoBatch);
      this.rebuild(); this.updateHover(); this.app.audio.unweld();
    } else this.app.audio.deny();
  }

  /** Drop turrets whose supporting platform was just cut away. */
  pruneUnsupported(drop) {
    for (const [k, t] of [...this.build.turrets]) {
      this.build.turrets.delete(k);
      if (!placementError(this.build, 2, t.i, t.j, 0, t.type)) { this.build.turrets.set(k, t); continue; }
      if (drop) { this.build.turrets.set(k, t); drop(this.build.turrets, k); }   // record for undo
    }
  }

  undo() {
    const h = this.history.pop();
    if (!h) { this.app.audio.deny(); return; }
    if (h.op === 'remove') {
      for (const it of h.items) it.map.set(it.key, it.data);       // put it back
    } else if (h.op === 'upgrade') {
      this.build.upgrades[h.id] = Math.max(0, (this.build.upgrades[h.id] || 1) - 1);
    } else {
      if (h.phase === 0) this.build.tracks.delete(h.key);
      else if (h.phase === 1) this.build.blocks.delete(h.key);
      else this.build.turrets.delete(h.key);
      this.pruneUnsupported();
    }
    this.rebuild();
    this.updateHover();
    this.app.audio.unweld();
  }

  flashHint(msg) {
    this.el.hint.innerHTML = `<span class="err">✕ ${msg}</span>`;
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => { this.el.hint.innerHTML = PHASE_HINT[this.phase]; }, 1400);
  }

  pulse(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ─────────────── HUD ───────────────
  updateHUD() {
    const s = this.stats, e = this.el;
    e.funds.textContent = fmt.money(this.funds);
    e.funds.classList.toggle('over', this.funds < 100);
    e.weight.textContent = fmt.kg(s.weight);
    e.speed.textContent = s.topSpeed.toFixed(1) + ' m/s';
    e.turn.textContent = fmt.deg(s.turnRate);
    e.hp.textContent = Math.round(s.hp);
    e.dps.textContent = s.dps.toFixed(0) + ' dps';
    e.tally.innerHTML = [
      ['Tracks', s.trackCount], ['Hull blocks', s.blockCount], ['Turrets', s.turretCount],
      ['Drive power', Math.round(s.power)], ['Power / weight', s.ratio.toFixed(2)],
      ['Upgrades', `×${s.mul.damage.toFixed(2)} dmg · ×${s.mul.hp.toFixed(2)} hp`],
      ['Spent', fmt.money(s.cost)],
    ].map(([k, v]) => `<div>${k} <b>${v}</b></div>`).join('');
    const broke = this.funds < 0;
    e.battle.disabled = !s.valid || broke;
    e.battle.title = broke ? 'Over budget — sell something off'
      : s.valid ? '' : 'Needs at least 2 tracks, 1 hull block and 1 turret';
    this.renderPalette();
    this.renderUpgrades();
    document.querySelectorAll('.phase').forEach((b) => {
      const n = +b.dataset.phase;
      const done = (n === 0 && this.build.tracks.size > 0) ||
                   (n === 1 && this.build.blocks.size > 0) ||
                   (n === 2 && this.build.turrets.size > 0);
      b.classList.toggle('done', done && n !== this.phase);
    });
  }

  // ─────────────── lifecycle ───────────────
  enter() {
    this.active = true;
    this.el.root.classList.remove('hidden');
    this.app.setScene(this.scene, this.camera);
    this.updateHUD();
  }

  exit() {
    this.active = false;
    this.el.root.classList.add('hidden');
    this.hideGhost();
  }

  update(dt, t) {
    this.camDist = smooth(this.camDist, this.camTargetDist, 8, dt);
    const y = Math.sin(this.camElev) * this.camDist;
    const r = Math.cos(this.camElev) * this.camDist;
    this.camera.position.set(Math.sin(this.camAzim) * r, y, Math.cos(this.camAzim) * r);
    this.camera.lookAt(0, 1.2, 0);

    // idle turret sweep so the preview feels alive
    if (this.tank) {
      for (const tur of this.tank.turrets) {
        tur.yaw = Math.sin(t * 0.35 + tur.yawGroup.position.x) * 0.4;
        tur.yawGroup.rotation.y = tur.yaw;
        tur.pitchGroup.rotation.x = Math.sin(t * 0.2) * 0.05 - 0.03;
      }
    }
    if (this.ghost.visible) {
      this.ghost.position.y += Math.sin(t * 4) * 0.004;
      this.ghostMat.opacity = 0.34 + Math.sin(t * 4) * 0.08;
    }
  }
}
