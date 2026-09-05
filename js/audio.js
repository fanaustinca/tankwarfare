// ───────────────────────────────────────────────────────────────
//  Synthesised audio — no asset files. Everything is oscillators
//  and shaped noise through a master bus.
// ───────────────────────────────────────────────────────────────
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noiseBuf = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 8;
    this.master.connect(this.comp).connect(this.ctx.destination);

    // 2 s of white noise, reused by every percussive sound
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  get t() { return this.ctx.currentTime; }

  _noise(dur, { gain = 0.4, filter = 1200, q = 1, type = 'lowpass', sweep = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(filter, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  _tone(freq, dur, { gain = 0.25, type = 'sine', to = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // ── UI ──
  ui(p = 1) { this._tone(420 * p, 0.06, { gain: 0.05, type: 'triangle', to: 620 * p }); }
  weld() { this._noise(0.09, { gain: 0.16, filter: 2600, sweep: 700 }); this._tone(180, 0.07, { gain: 0.09, type: 'square', to: 90 }); }
  unweld() { this._tone(260, 0.08, { gain: 0.07, type: 'sawtooth', to: 120 }); }
  deny() { this._tone(150, 0.12, { gain: 0.09, type: 'square', to: 90 }); }

  // ── combat ──
  fire(kind, dist = 0) {
    const near = Math.max(0.15, 1 - dist / 140);
    if (kind === 'shell') {
      this._noise(0.42, { gain: 0.55 * near, filter: 1800, sweep: 90 });
      this._tone(72, 0.34, { gain: 0.42 * near, type: 'sine', to: 30 });
      this._noise(0.9, { gain: 0.14 * near, filter: 400, sweep: 80, delay: 0.05 });
    } else if (kind === 'missile') {
      this._noise(0.7, { gain: 0.32 * near, filter: 900, sweep: 2400, type: 'bandpass', q: 2 });
      this._tone(140, 0.5, { gain: 0.14 * near, type: 'sawtooth', to: 420 });
    } else {
      this._noise(0.075, { gain: 0.26 * near, filter: 2800, sweep: 500 });
      this._tone(160, 0.06, { gain: 0.16 * near, type: 'square', to: 70 });
    }
  }

  explode(scale = 1, dist = 0) {
    const near = Math.max(0.12, 1 - dist / 170);
    this._noise(0.5 * scale, { gain: 0.6 * near, filter: 900, sweep: 60 });
    this._tone(60, 0.7 * scale, { gain: 0.5 * near, type: 'sine', to: 24 });
    this._noise(1.5 * scale, { gain: 0.16 * near, filter: 340, sweep: 60, delay: 0.06 });
  }

  hit(metal = true, dist = 0) {
    const near = Math.max(0.15, 1 - dist / 120);
    if (metal) {
      this._noise(0.16, { gain: 0.3 * near, filter: 3400, sweep: 1100, type: 'bandpass', q: 3 });
      this._tone(760, 0.14, { gain: 0.11 * near, type: 'triangle', to: 300 });
    } else {
      this._noise(0.3, { gain: 0.22 * near, filter: 700, sweep: 120 });
    }
  }

  hurt() {
    this._noise(0.35, { gain: 0.42, filter: 600, sweep: 90 });
    this._tone(90, 0.3, { gain: 0.3, type: 'square', to: 40 });
  }

  // ── engine loop ──
  startEngine() {
    if (!this.ctx || this.engine) return;
    const g = this.ctx.createGain(); g.gain.value = 0;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;

    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 42;
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 28;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.35;

    const rumble = this.ctx.createBufferSource();
    rumble.buffer = this.noiseBuf; rumble.loop = true;
    const rf = this.ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 160;
    const rg = this.ctx.createGain(); rg.gain.value = 0.28;

    o1.connect(lp); o2.connect(g2).connect(lp);
    rumble.connect(rf).connect(rg).connect(lp);
    lp.connect(g).connect(this.master);
    o1.start(); o2.start(); rumble.start();
    this.engine = { g, lp, o1, o2, rg };
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    e.g.gain.setTargetAtTime(0, this.t, 0.1);
    setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch (_) {} }, 400);
    this.engine = null;
  }

  /** @param load 0..1 throttle  @param speed 0..1 normalised road speed */
  engineState(load, speed) {
    if (!this.engine) return;
    const e = this.engine;
    const rpm = 34 + load * 46 + speed * 26;
    e.o1.frequency.setTargetAtTime(rpm, this.t, 0.12);
    e.o2.frequency.setTargetAtTime(rpm * 0.66, this.t, 0.12);
    e.lp.frequency.setTargetAtTime(240 + load * 520 + speed * 300, this.t, 0.2);
    e.g.gain.setTargetAtTime(0.12 + load * 0.14, this.t, 0.15);
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.t, 0.05);
  }
}
