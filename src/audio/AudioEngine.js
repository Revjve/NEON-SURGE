import { Music } from './Music.js';
import { clamp, rand } from '../core/math.js';

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

/**
 * 100% synthesized audio — no sample files. A small modular graph:
 *
 *   voices -> [sfx bus] --\
 *   music  -> [music bus] -+-> lowpass "muffle" -> compressor -> master -> out
 *   sends  -> convolver reverb (procedural impulse) --/
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, music: 0.55, sfx: 0.85 };
    this.muted = false;
    this.gates = new Map();
    this.pickupStep = 0;
    this.pickupAt = 0;
    this.music = null;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture on the web (autoplay policy). */
  unlock() {
    if (!this.ctx) this._init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));

    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.6;
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 3);
    this.reverbSend = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.32;

    this.sfxBus.connect(this.muffle);
    this.musicBus.connect(this.muffle);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.muffle);
    this.muffle.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);

    this.noise = this._noise(2);
    this.crunchCurve = this._distortion(70);
    this.softCurve = this._distortion(8);
    this.music = new Music(this);
    this.applyVolumes();
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : this.volumes.master;
    this.master.gain.setTargetAtTime(m * m, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx * this.volumes.sfx, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * this.volumes.music, t, 0.02);
  }

  /** 0 = clear, 1 = heavily muffled (pause menu, death). */
  setMuffle(amount, time = 0.15) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(420 / 20000, clamp(amount, 0, 1));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, time);
  }

  // --- building blocks ------------------------------------------------------------------

  _noise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _distortion(amount) {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  _ok(name, gapMs) {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted) return false;
    if (name) {
      const now = performance.now();
      if (now - (this.gates.get(name) ?? -1e9) < gapMs) return false;
      this.gates.set(name, now);
    }
    return true;
  }

  /** Output node for a voice: gain -> stereo pan -> sfx bus (+ optional reverb send). */
  _voice(pan = 0, reverb = 0, bus = this.sfxBus) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      p.connect(bus);
      if (reverb > 0) {
        const s = ctx.createGain();
        s.gain.value = reverb;
        p.connect(s);
        s.connect(this.reverbSend);
      }
    } else {
      g.connect(bus);
    }
    return g;
  }

  _env(param, t, peak, attack, decay, floor = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(floor, t);
    param.exponentialRampToValueAtTime(Math.max(peak, floor * 2), t + attack);
    param.exponentialRampToValueAtTime(floor, t + attack + decay);
  }

  _osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  _noiseSrc(t, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * 1.5);
    return s;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // --- sound effects --------------------------------------------------------------------

  shoot(level = 0, pan = 0) {
    if (!this._ok('shoot', 38)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._voice(pan * 0.5, 0.03);
    const f0 = 1180 * rand(0.94, 1.06) * (1 + level * 0.045);
    const a = this._osc('square', f0, t);
    a.frequency.exponentialRampToValueAtTime(f0 * 0.2, t + 0.085);
    const b = this._osc('sawtooth', f0 * 0.503, t);
    b.frequency.exponentialRampToValueAtTime(f0 * 0.1, t + 0.09);
    const hp = this._filter('highpass', 320);
    const lp = this._filter('lowpass', 7000);
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.09);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.12, 0.003, 0.095);
    a.connect(hp);
    b.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(out);
    a.start(t);
    b.start(t);
    a.stop(t + 0.12);
    b.stop(t + 0.12);
  }

  hit(pan = 0) {
    if (!this._ok('hit', 26)) return;
    const t = this.ctx.currentTime;
    const out = this._voice(pan * 0.6);
    const o = this._osc('triangle', rand(2000, 2500), t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.04);
    const g = this.ctx.createGain();
    this._env(g.gain, t, 0.075, 0.002, 0.045);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.06);
  }

  /** Deep bass crunch. size ~1 small, ~3+ huge. */
  explode(size = 1, pan = 0) {
    if (!this._ok('explode', 32)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = clamp(size, 0.6, 4.5);
    const out = this._voice(pan * 0.55, 0.12 + 0.05 * s);

    // Sub thump with a fast pitch drop.
    const sub = this._osc('sine', 130 + 40 / s, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.22 + 0.08 * s);
    const sg = ctx.createGain();
    this._env(sg.gain, t, Math.min(1, 0.55 + 0.18 * s), 0.004, 0.3 + 0.14 * s);
    sub.connect(sg);
    sg.connect(out);
    sub.start(t);
    sub.stop(t + 0.5 + 0.2 * s);

    // Distorted noise crunch with a closing lowpass.
    const n = this._noiseSrc(t, rand(0.55, 0.8));
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.crunchCurve;
    shaper.oversample = '2x';
    const lp = this._filter('lowpass', 3400, 0.9);
    lp.frequency.setValueAtTime(3400 + 400 * s, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.22 + 0.12 * s);
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.42, 0.002, 0.22 + 0.13 * s);
    n.connect(shaper);
    shaper.connect(lp);
    lp.connect(ng);
    ng.connect(out);
    n.stop(t + 0.45 + 0.2 * s);

    // Bright transient crack.
    const c = this._noiseSrc(t, 1);
    const bp = this._filter('bandpass', rand(1500, 2400), 1.1);
    const cg = ctx.createGain();
    this._env(cg.gain, t, 0.3, 0.001, 0.05);
    c.connect(bp);
    bp.connect(cg);
    cg.connect(out);
    c.stop(t + 0.08);
  }

  _sweep(type, f0, f1, dur, peak, pan, curve) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._voice(pan, 0.3);
    const o = this._osc(type, f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this._env(g.gain, t, peak, 0.01, dur);
    if (curve) {
      const sh = ctx.createWaveShaper();
      sh.curve = curve;
      o.connect(sh);
      sh.connect(g);
    } else {
      o.connect(g);
    }
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  playerHit(pan = 0) {
    if (!this._ok()) return;
    this.gates.delete('explode');
    this.explode(3.2, pan);
    this._sweep('sawtooth', 460, 38, 0.75, 0.22, pan * 0.4, this.crunchCurve);
    this.setMuffle(0.85, 0.02);
    setTimeout(() => this.setMuffle(0, 0.35), 380);
  }

  playerDeath(pan = 0) {
    if (!this._ok()) return;
    this.gates.delete('explode');
    this.explode(4.5, pan);
    this._sweep('sawtooth', 300, 28, 1.6, 0.26, 0, this.crunchCurve);
    this._sweep('square', 880, 55, 1.2, 0.08, 0, null);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noiseSrc(t, 0.5);
    const lp = this._filter('lowpass', 1800, 0.5);
    lp.frequency.exponentialRampToValueAtTime(80, t + 2.2);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.35, 0.01, 2.2);
    const out = this._voice(0, 0.5);
    n.connect(lp);
    lp.connect(g);
    g.connect(out);
    n.stop(t + 2.4);
    this.setMuffle(0.9, 0.05);
  }

  surge() {
    if (!this._ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._voice(0, 0.6);

    const w = this._noiseSrc(t, 1);
    const bp = this._filter('bandpass', 250, 2.5);
    bp.frequency.exponentialRampToValueAtTime(6500, t + 0.22);
    const wg = ctx.createGain();
    this._env(wg.gain, t, 0.35, 0.18, 0.12);
    w.connect(bp);
    bp.connect(wg);
    wg.connect(out);
    w.stop(t + 0.4);

    const sub = this._osc('sine', 95, t + 0.02);
    sub.frequency.exponentialRampToValueAtTime(22, t + 1.4);
    const sg = ctx.createGain();
    this._env(sg.gain, t + 0.02, 1, 0.01, 1.4);
    sub.connect(sg);
    sg.connect(out);
    sub.start(t + 0.02);
    sub.stop(t + 1.6);

    const n = this._noiseSrc(t, 0.6);
    const sh = ctx.createWaveShaper();
    sh.curve = this.crunchCurve;
    const lp = this._filter('lowpass', 6000, 0.8);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.3);
    const ng = ctx.createGain();
    this._env(ng.gain, t + 0.02, 0.5, 0.005, 1.2);
    n.connect(sh);
    sh.connect(lp);
    lp.connect(ng);
    ng.connect(out);
    n.stop(t + 1.5);

    // Shimmering major chord bloom.
    for (const m of [69, 73, 76, 81]) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      for (const det of [-9, 9]) {
        const o = this._osc('sawtooth', f, t);
        o.detune.value = det;
        const flt = this._filter('lowpass', 600, 2);
        flt.frequency.setValueAtTime(600, t);
        flt.frequency.exponentialRampToValueAtTime(5200, t + 0.3);
        flt.frequency.exponentialRampToValueAtTime(500, t + 1.8);
        const g = ctx.createGain();
        this._env(g.gain, t, 0.028, 0.05, 1.8);
        o.connect(flt);
        flt.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + 2);
      }
    }
    this.music?.duck(0.9);
  }

  spawn(pan = 0) {
    if (!this._ok('spawn', 70)) return;
    const t = this.ctx.currentTime;
    const out = this._voice(pan * 0.7, 0.1);
    const o = this._osc('sine', 190, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.17);
    const g = this.ctx.createGain();
    this._env(g.gain, t, 0.04, 0.08, 0.1);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.22);
  }

  pickup() {
    if (!this._ok('pickup', 26)) return;
    const now = performance.now();
    this.pickupStep = now - this.pickupAt < 650 ? Math.min(this.pickupStep + 1, PENTATONIC.length - 1) : 0;
    this.pickupAt = now;
    const t = this.ctx.currentTime;
    const f = 740 * Math.pow(2, PENTATONIC[this.pickupStep] / 12);
    const out = this._voice(0, 0.12);
    const o = this._osc('triangle', f, t);
    const o2 = this._osc('sine', f * 2, t);
    const g = this.ctx.createGain();
    this._env(g.gain, t, 0.07, 0.003, 0.11);
    o.connect(g);
    o2.connect(g);
    g.connect(out);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.14);
    o2.stop(t + 0.14);
  }

  _arpeggio(notes, gap, type, peak, reverb = 0.35) {
    if (!this._ok()) return;
    const t0 = this.ctx.currentTime;
    const out = this._voice(0, reverb);
    notes.forEach((m, i) => {
      const t = t0 + i * gap;
      const o = this._osc(type, 440 * Math.pow(2, (m - 69) / 12), t);
      const g = this.ctx.createGain();
      this._env(g.gain, t, peak, 0.004, 0.22);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.3);
    });
  }

  powerUp() {
    this._arpeggio([72, 76, 79, 84, 88], 0.065, 'square', 0.08);
  }

  extraLife() {
    this._arpeggio([76, 79, 83, 88, 91, 95], 0.06, 'triangle', 0.11);
  }

  surgeReady() {
    this._arpeggio([69, 76, 81], 0.08, 'sawtooth', 0.07, 0.5);
  }

  threatUp() {
    this._arpeggio([45, 52, 57], 0.11, 'sawtooth', 0.09, 0.6);
  }

  alarm() {
    if (!this._ok('alarm', 500)) return;
    const t0 = this.ctx.currentTime;
    const out = this._voice(0, 0.25);
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * 0.16;
      const o = this._osc('square', i % 2 ? 660 : 880, t);
      const f = this._filter('bandpass', 1400, 1.2);
      const g = this.ctx.createGain();
      this._env(g.gain, t, 0.1, 0.005, 0.13);
      o.connect(f);
      f.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.16);
    }
  }

  charge(pan = 0) {
    if (!this._ok('charge', 120)) return;
    this._sweep('sawtooth', 170, 900, 0.6, 0.045, pan * 0.6, null);
  }

  orbFire(pan = 0) {
    if (!this._ok('orb', 60)) return;
    this._sweep('sine', 640, 190, 0.16, 0.13, pan * 0.6, this.softCurve);
  }

  heartbeat() {
    if (!this._ok('heart', 400)) return;
    const t0 = this.ctx.currentTime;
    const out = this._voice(0, 0);
    [0, 0.17].forEach((d, i) => {
      const t = t0 + d;
      const o = this._osc('sine', 62, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = this.ctx.createGain();
      this._env(g.gain, t, i ? 0.2 : 0.3, 0.005, 0.16);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.22);
    });
  }

  ui(kind = 'move') {
    if (!this._ok('ui', 30)) return;
    const t = this.ctx.currentTime;
    const out = this._voice(0, 0.08);
    const [f0, f1, peak] = kind === 'select' ? [660, 1320, 0.05] : kind === 'back' ? [990, 495, 0.04] : [1500, 1500, 0.025];
    const o = this._osc('square', f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.06);
    const f = this._filter('lowpass', 3500);
    const g = this.ctx.createGain();
    this._env(g.gain, t, peak, 0.002, 0.07);
    o.connect(f);
    f.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }
}
