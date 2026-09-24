// Generative synthwave soundtrack. A lookahead scheduler (setInterval + AudioContext
// clock) sequences drums, a sidechained bass, detuned pads and a delayed arpeggio over
// an i-VI-III-VII progression in A minor. Layers fade in with the game's threat level.

const BPM = 124;
const STEP = 60 / BPM / 4; // one 16th note
const LOOKAHEAD = 0.12;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

const PROGRESSION = [
  { root: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] }, // Am
  { root: 29, pad: [57, 60, 65], arp: [65, 69, 72, 77] }, // F
  { root: 36, pad: [55, 60, 64], arp: [67, 72, 76, 79] }, // C
  { root: 31, pad: [55, 59, 62], arp: [67, 71, 74, 79] }, // G
];
const ARP_PATTERN = [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 2, 3, 1, 2];
const BASS_OCTAVE = [0, 0, 0, 12, 0, 0, 12, 0];

export class Music {
  constructor(engine) {
    const ctx = engine.ctx;
    this.e = engine;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.fxDuck = ctx.createGain();
    this.out.connect(this.fxDuck);
    this.fxDuck.connect(engine.musicBus);

    this.sidechain = ctx.createGain();
    this.sidechain.connect(this.out);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.85;
    this.drums.connect(this.out);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.38;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 2400;
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delayTone.connect(this.sidechain);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.5;
    this.delaySend.connect(this.delay);

    this.intensity = 0;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.kicks = new Float64Array(8).fill(-10);
    this.kickIndex = 0;
  }

  start() {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(1, t, 0.4);
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = t + 0.06;
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop(fade = 0.6) {
    if (!this.playing) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    clearTimeout(this._stopTimer);
    this._stopTimer = setTimeout(() => {
      if (this.out.gain.value < 0.02) {
        clearInterval(this.timer);
        this.playing = false;
      }
    }, fade * 1000 + 200);
  }

  setIntensity(level) {
    this.intensity = Math.max(0, Math.min(4, level | 0));
  }

  /** Momentarily pull the music down under a huge sound effect. */
  duck(amount = 0.8) {
    const g = this.fxDuck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.05, 1 - amount), t);
    g.setTargetAtTime(1, t + 0.25, 0.35);
  }

  /** 1 right on a kick drum, decaying to 0 — drives beat-synced visuals. */
  pulse() {
    const now = this.ctx.currentTime;
    let last = -10;
    for (const k of this.kicks) if (k <= now && k > last) last = k;
    return Math.exp(-(now - last) * 7);
  }

  _tick() {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.25) {
      // We were throttled (background tab): skip ahead instead of bursting notes.
      const missed = Math.ceil((now - this.nextTime) / STEP);
      this.step += missed;
      this.nextTime += missed * STEP;
    }
    while (this.nextTime < now + LOOKAHEAD) {
      this._play(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  _play(step, t) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chord = PROGRESSION[bar];
    const I = this.intensity;

    if (s === 0) this._pad(chord.pad, t, STEP * 16);

    if (I >= 1 && s % 4 === 0) this._kick(t);
    if (I >= 2 && (s === 4 || s === 12)) this._snare(t, 1);
    if (I >= 3 && bar === 3 && s >= 13) this._snare(t, 0.45);
    if (I >= 1 && s % 4 === 2) this._hat(t, 0.06, false);
    if (I >= 3 && s % 2 === 1) this._hat(t, 0.025, false);
    if (I >= 3 && s === 14) this._hat(t, 0.05, true);

    if (I >= 1 && s % 2 === 0) this._bass(chord.root + BASS_OCTAVE[(s / 2) % 8], t, STEP * 1.8, 1);
    if (I >= 4 && s % 2 === 1) this._bass(chord.root + 12, t, STEP * 0.8, 0.55);

    if (I === 0 && s % 4 === 0) this._arp(chord.arp[ARP_PATTERN[s]], t, 0.55, 0.35);
    if (I >= 2) {
      const lift = I >= 4 && s % 8 >= 4 ? 12 : 0;
      this._arp(chord.arp[ARP_PATTERN[s]] + lift, t, I >= 3 ? 0.9 : 0.7, 0.14);
    }
  }

  _env(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(158, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.95, 0.002, 0.34);
    o.connect(g);
    g.connect(this.drums);
    o.start(t);
    o.stop(t + 0.4);

    const n = ctx.createBufferSource();
    n.buffer = this.e.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.12, 0.001, 0.014);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.drums);
    n.start(t, Math.random());
    n.stop(t + 0.03);

    // Sidechain pump on the melodic bus.
    const sc = this.sidechain.gain;
    sc.setValueAtTime(0.3, t);
    sc.setTargetAtTime(1, t + 0.015, 0.085);

    this.kicks[this.kickIndex] = t;
    this.kickIndex = (this.kickIndex + 1) % this.kicks.length;
  }

  _snare(t, vel) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.e.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    this._env(g.gain, t, 0.34 * vel, 0.002, 0.17);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.drums);
    n.start(t, Math.random());
    n.stop(t + 0.22);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain();
    this._env(og.gain, t, 0.2 * vel, 0.002, 0.08);
    o.connect(og);
    og.connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  _hat(t, peak, open) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.e.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7600;
    const g = ctx.createGain();
    this._env(g.gain, t, peak, 0.001, open ? 0.16 : 0.035);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.drums);
    n.start(t, Math.random());
    n.stop(t + (open ? 0.2 : 0.06));
  }

  _bass(note, t, dur, vel) {
    const ctx = this.ctx;
    const f = midi(note);
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = f;
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = f / 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.012);
    lp.frequency.exponentialRampToValueAtTime(230, t + dur);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.2 * vel, 0.004, dur);
    const sg = ctx.createGain();
    sg.gain.value = 0.9;
    a.connect(lp);
    lp.connect(g);
    b.connect(sg);
    sg.connect(g);
    g.connect(this.sidechain);
    a.start(t);
    b.start(t);
    a.stop(t + dur + 0.05);
    b.stop(t + dur + 0.05);
  }

  _pad(notes, t, dur) {
    const ctx = this.ctx;
    for (const m of notes) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
      lp.frequency.linearRampToValueAtTime(800, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.022, t + 0.5);
      g.gain.setValueAtTime(0.022, t + dur - 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
      lp.connect(g);
      g.connect(this.sidechain);
      for (const det of [-11, 0, 11]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
  }

  _arp(note, t, vel, decay) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midi(note);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + decay);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.035 * vel, 0.003, decay);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.sidechain);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}
