import { ARENA, PALETTE } from '../config.js';
import { rand, randInt, TAU, mixHex, clamp } from '../core/math.js';
import { BOUNCE, STRETCH, FLICKER, SPIN } from './Particles.js';

const WHITE = 0xffffff;

/**
 * The "juice" facade. Gameplay code says *what* happened (an enemy exploded, a bullet
 * hit a wall) and this class orchestrates every sense at once: particles, grid physics,
 * dynamic lights, screen-space refraction, camera trauma, hit-stop, flashes and sound.
 */
export class Effects {
  constructor({ particles, lights, shocks, popups, arcs, grid, camera, audio, game }) {
    this.p = particles;
    this.lights = lights;
    this.shocks = shocks;
    this.popups = popups;
    this.arcs = arcs;
    this.grid = grid;
    this.camera = camera;
    this.audio = audio;
    this.game = game;
    this.density = 1; // particle quality scale
    // Flash budget: many detonations in the same instant share the bloom instead of
    // stacking into a white-out. Sparks/shards are unaffected, so mass kills stay loud.
    this.heat = 0;
    const id = (n) => particles.id(n);
    this.F = {
      glow: id('glow'), dot: id('dot'), spark: id('spark'), flare: id('flare'), ring: id('ring'),
      ringThin: id('ringThin'), ringFine: id('ringFine'), shard: id('shard'), tri: id('tri'), sq: id('sq'), beam: id('beam'),
    };
  }

  tick(dt) {
    this.heat *= Math.exp(-6 * dt);
  }

  /** Intensity scale for the next flash; each flash adds heat. */
  _flash(weight = 1) {
    const k = 1 / (1 + this.heat * 0.25);
    this.heat += weight;
    return k;
  }

  pan(x) {
    return clamp((x - this.camera.x) / (ARENA.w * 0.55), -1, 1);
  }

  count(n) {
    const free = this.p.free;
    const scaled = Math.round(n * this.density);
    return free < scaled * 4 ? Math.min(scaled, Math.floor(free / 4)) : scaled;
  }

  // --- Weapons ----------------------------------------------------------------------

  muzzle(x, y, angle, color) {
    const { p, F } = this;
    p.spawn(F.flare, x, y, 0, 0, 0.06, 11, 18, WHITE, color, 2.6, 0, 0, 0, angle);
    for (let i = 0, n = this.count(2); i < n; i++) {
      const a = angle + rand(-0.45, 0.45);
      const s = rand(260, 620);
      p.spawn(F.spark, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.06, 0.12), 1.6, 0.4, WHITE, color, 2.4, 0, 6, STRETCH, 0, 0, 0.02);
    }
    this.lights.add(x, y, 150, 0.55, color, 0.06);
  }

  bulletImpact(x, y, angle, color, heavy = false) {
    const { p, F } = this;
    const back = angle + Math.PI;
    for (let i = 0, n = this.count(heavy ? 8 : 5); i < n; i++) {
      const a = back + rand(-0.9, 0.9);
      const s = rand(200, 720);
      p.spawn(F.spark, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.1, 0.24), 1.8, 0.4, WHITE, color, 3, 0, 5, STRETCH, 0, 0, 0.028);
    }
    p.spawn(F.glow, x, y, 0, 0, 0.1, 14, 26, WHITE, color, 1.6, 0);
    this.grid.explode(x, y, 2.2, 90, 0.25);
    this.audio.hit(this.pan(x));
  }

  wallImpact(x, y, nx, ny, color) {
    const { p, F } = this;
    const base = Math.atan2(ny, nx);
    for (let i = 0, n = this.count(4); i < n; i++) {
      const a = base + rand(-1.2, 1.2);
      const s = rand(150, 520);
      p.spawn(F.spark, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.08, 0.2), 1.5, 0.3, WHITE, color, 2.2, 0, 6, STRETCH, 0, 0, 0.025);
    }
    p.spawn(F.glow, x, y, 0, 0, 0.12, 10, 30, color, PALETTE.borderHot, 1.4, 0);
    this.grid.explode(x, y, 3, 100, 0.35);
  }

  // --- Enemies ------------------------------------------------------------------------

  spawnPortal(x, y, color, radius) {
    const { p, F } = this;
    p.spawn(F.ringThin, x, y, 0, 0, 0.55, radius * 4.2, radius * 0.6, WHITE, color, 0.2, 2.2, 0, 0);
    p.spawn(F.glow, x, y, 0, 0, 0.55, radius * 0.5, radius * 2.6, color, WHITE, 0.2, 1.4, 0, 0);
    for (let i = 0, n = this.count(6); i < n; i++) {
      const a = rand(0, TAU);
      const d = radius * rand(3, 5);
      p.spawn(F.dot, x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * d * 1.9, -Math.sin(a) * d * 1.9, 0.5, 2.5, 1.5, color, WHITE, 0.5, 2.4, 0, 0);
    }
    this.grid.implode(x, y, 1.2, 140);
  }

  /** Enemy death. `size` ~1 for small fry, ~2.5 for heavies. */
  explosion(x, y, color, size = 1, { silent = false, quiet = false } = {}) {
    const { p, F } = this;
    const s = size;
    const rs = Math.sqrt(s);

    const cs = Math.min(s, 2.2); // flash size cap: big blasts get more stuff, not a bigger blob
    const k = this._flash(Math.min(2, s));
    p.spawn(F.glow, x, y, 0, 0, 0.16, 18 * cs, 72 * cs, WHITE, color, 2.6 * k, 0);
    p.spawn(F.flare, x, y, 0, 0, 0.13, 28 * cs, 85 * cs, WHITE, color, 2.4 * k, 0, 0, 0, rand(0, TAU));
    p.spawn(F.ringThin, x, y, 0, 0, 0.42, 10 * s, 140 * s, WHITE, color, 2.4 * (0.5 + 0.5 * k), 0);
    if (s > 1.4) p.spawn(F.ringThin, x, y, 0, 0, 0.7, 8 * s, 230 * s, color, color, 1.2, 0);

    for (let i = 0, n = this.count(10 + 8 * s); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(160, 640) * rs;
      const sz = rand(5, 10) * rs;
      p.spawn(F.shard, x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * sp, Math.sin(a) * sp,
        rand(0.8, 1.6), sz, sz * 0.4, WHITE, color, 3.2, 0, 1.9, BOUNCE | SPIN, rand(0, TAU), rand(-14, 14));
    }
    for (let i = 0, n = this.count(14 + 12 * s); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(380, 1350) * rs;
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.22, 0.55), rand(1.8, 3), 0.5,
        WHITE, color, 4, 0, 3.4, STRETCH | BOUNCE, 0, 0, 0.034);
    }
    for (let i = 0, n = this.count(6 + 6 * s); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(30, 260) * rs;
      p.spawn(F.dot, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.8, 1.9), rand(3, 5.5), 1,
        mixHex(color, WHITE, 0.4), color, 2, 0, 1.3, FLICKER | BOUNCE);
    }
    for (let i = 0, n = this.count(4 * s); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(120, 480) * rs;
      p.spawn(F.sq, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.6, 1.2), rand(2, 3.5), 1,
        WHITE, color, 2.6, 0, 2.2, BOUNCE | SPIN, rand(0, TAU), rand(-20, 20));
    }

    this.grid.explode(x, y, 9 + 7 * s, 150 + 85 * s, 0.3 + 0.14 * s);
    this.lights.add(x, y, 200 + 110 * s, (0.75 + 0.25 * s) * k, color, 0.3 + 0.12 * s);
    if (s >= 1.4) this.shocks.add(x, y, 700 + 350 * s, 0.009 * s, 0.55);
    if (!quiet) {
      this.camera.addTrauma(0.2 + 0.1 * s, s >= 1.4 ? 0.8 : 0.55);
      this.camera.punch(0.22 * s);
    }
    if (!silent) this.audio.explode(s, this.pan(x));
  }

  /** Ghost copy left behind by dashing enemies. */
  afterimage(frameId, x, y, rot, radius, color) {
    this.p.spawn(frameId, x, y, 0, 0, 0.28, radius, radius * 0.9, color, color, 1.1, 0, 0, 0, rot);
  }

  enemyShot(x, y, angle, color) {
    const { p, F } = this;
    p.spawn(F.flare, x, y, 0, 0, 0.12, 14, 30, WHITE, color, 2.2, 0, 0, 0, angle);
    this.lights.add(x, y, 180, 0.8, color, 0.12);
  }

  orbPop(x, y, color) {
    const { p, F } = this;
    p.spawn(F.glow, x, y, 0, 0, 0.14, 10, 40, WHITE, color, 2.5, 0);
    for (let i = 0, n = this.count(6); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(120, 420);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.12, 0.25), 1.5, 0.3, WHITE, color, 2.5, 0, 5, STRETCH, 0, 0, 0.03);
    }
  }

  // --- Player -------------------------------------------------------------------------

  exhaust(x, y, dirX, dirY, power) {
    if (power < 0.05) return;
    const { p, F } = this;
    for (let i = 0, n = Math.random() < power ? 2 : 1; i < n; i++) {
      const a = Math.atan2(dirY, dirX) + rand(-0.35, 0.35);
      const sp = rand(140, 320) * (0.4 + power);
      p.spawn(F.dot, x + rand(-3, 3), y + rand(-3, 3), Math.cos(a) * sp, Math.sin(a) * sp, rand(0.18, 0.34),
        rand(3.5, 5.5) * (0.6 + power * 0.5), 0.8, 0xbff8ff, 0x5b3bff, 2.2 * power + 0.3, 0, 4, 0);
    }
  }

  fluxCollect(x, y, multiplier) {
    const { p, F } = this;
    p.spawn(F.ring, x, y, 0, 0, 0.22, 6, 26, WHITE, PALETTE.flux, 2, 0);
    for (let i = 0, n = this.count(4); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(90, 260);
      p.spawn(F.dot, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.2, 0.35), 3, 0.5, WHITE, PALETTE.flux, 2.4, 0, 4, 0);
    }
    this.audio.pickup(multiplier);
  }

  playerHit(x, y) {
    const { p, F } = this;
    const c = PALETTE.player;
    this.explosion(x, y, c, 2.6, { silent: true, quiet: true });
    p.spawn(F.ringFine, x, y, 0, 0, 0.8, 20, 560, WHITE, PALETTE.danger, 2.4, 0);
    for (let i = 0, n = this.count(40); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(600, 1900);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), rand(2, 3.5), 0.5,
        WHITE, i % 2 ? c : PALETTE.danger, 4.5, 0, 2.6, STRETCH | BOUNCE, 0, 0, 0.03);
    }
    this.grid.explode(x, y, 45, 650, 0.9);
    this.lights.add(x, y, 650, 1.3, PALETTE.danger, 0.8);
    this.shocks.add(x, y, 1500, 0.05, 0.8);
    this.camera.addTrauma(1);
    this.camera.punch(1.6);
    this.audio.playerHit(this.pan(x));
  }

  playerDeath(x, y) {
    const { p, F } = this;
    const c = PALETTE.player;
    this.explosion(x, y, c, 3.5, { silent: true, quiet: true });
    this.explosion(x, y, PALETTE.danger, 2.5, { silent: true, quiet: true });
    for (let k = 0; k < 3; k++) {
      p.spawn(F.ringFine, x, y, 0, 0, 0.9 + k * 0.35, 20, 700 + k * 380, WHITE, k === 1 ? PALETTE.danger : c, 2.6 - k * 0.5, 0);
    }
    // The hull itself: long glowing struts tumbling away.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rand(-0.3, 0.3);
      const sp = rand(220, 480);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(1.6, 2.4), 4, 2, WHITE, c, 3.4, 0, 1.2,
        BOUNCE | SPIN, rand(0, TAU), rand(-9, 9), 0, 9);
    }
    for (let i = 0, n = this.count(90); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(500, 2400);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 1), rand(2, 4), 0.5,
        WHITE, i % 3 ? c : PALETTE.danger, 5, 0, 2, STRETCH | BOUNCE, 0, 0, 0.03);
    }
    this.grid.explode(x, y, 60, 1000, 0.9);
    this.lights.add(x, y, 900, 1.6, PALETTE.danger, 1.4);
    this.shocks.add(x, y, 1900, 0.075, 1.2);
    this.shocks.add(x, y, 900, 0.04, 1.4);
    this.camera.addTrauma(1);
    this.camera.punch(2.4);
    this.audio.playerDeath(this.pan(x));
  }

  surgeNova(x, y) {
    const { p, F } = this;
    const c = PALETTE.surge;
    p.spawn(F.glow, x, y, 0, 0, 0.3, 50, 260, WHITE, c, 2.6, 0);
    for (let k = 0; k < 4; k++) {
      p.spawn(F.ringFine, x, y, 0, 0, 0.7 + k * 0.18, 30, 1500 + k * 300, WHITE, k % 2 ? c : PALETTE.player, 3 - k * 0.5, 0);
    }
    for (let i = 0, n = this.count(120); i < n; i++) {
      const a = (i / 120) * TAU + rand(-0.04, 0.04);
      const sp = rand(900, 2600);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.45, 0.95), rand(2.5, 4), 0.6,
        WHITE, i % 2 ? c : PALETTE.player, 5, 0, 1.6, STRETCH | BOUNCE, 0, 0, 0.035);
    }
    this.grid.explode(x, y, 55, 1250, 0.8);
    this.lights.add(x, y, 400, 1.5, c, 1.1, 2600);
    this.shocks.add(x, y, 2300, 0.085, 1.1);
    this.camera.addTrauma(0.8);
    this.camera.punch(-2.2);
    this.audio.surge();
  }

  /** Crisp DOM combat text (see ui/FloatText.js). */
  popup(x, y, text, kind = 'score', size = 1) {
    this.popups.add(x, y, text, kind, size);
  }

  // --- Upgrade effects ------------------------------------------------------------------

  /** VOLATILE ROUNDS detonation. `radius` is the real damage radius. */
  blast(x, y, radius, gen = 0) {
    const { p, F } = this;
    const hot = 0xffb45a;
    const k = radius / 100;
    const f = this._flash(0.7);
    // The ring marks the true damage radius; the core flash stays small (it rides on top
    // of the kill explosion that triggered it).
    p.spawn(F.glow, x, y, 0, 0, 0.16, radius * 0.25, radius * 0.75, WHITE, hot, (1.5 - gen * 0.2) * f, 0);
    p.spawn(F.ringThin, x, y, 0, 0, 0.26, radius * 0.2, radius * 1.05, WHITE, 0xff6a2a, 2.4 * (0.5 + 0.5 * f), 0);
    p.spawn(F.flare, x, y, 0, 0, 0.1, radius * 0.4, radius * 0.9, WHITE, hot, 1.3 * f, 0, 0, 0, rand(0, TAU));
    for (let i = 0, n = this.count(10 + 6 * k); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(300, 900) * k;
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.14, 0.32), rand(1.8, 2.8), 0.4,
        WHITE, i % 3 ? hot : 0xff4a2a, 3.6, 0, 4, STRETCH | BOUNCE, 0, 0, 0.03);
    }
    for (let i = 0, n = this.count(4 + 3 * k); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 200) * k;
      p.spawn(F.dot, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.8), rand(3, 5), 1, 0xfff0c0, hot, 2, 0, 2, FLICKER);
    }
    this.grid.explode(x, y, 8 + 6 * k, radius * 1.6, 0.35);
    this.lights.add(x, y, radius * 2.4, 0.8 * f, hot, 0.22);
    if (k > 1.1) this.shocks.add(x, y, 800, 0.007 * k, 0.4);
    this.camera.addTrauma(0.1, 0.45);
    this.audio.blast(this.pan(x), gen);
  }

  /** ARC COIL lightning between two points. */
  arc(x1, y1, x2, y2) {
    const { p, F } = this;
    const c = PALETTE.arc;
    this.arcs.add(x1, y1, x2, y2, c);
    p.spawn(F.glow, x2, y2, 0, 0, 0.12, 8, 34, WHITE, c, 2.2, 0);
    for (let i = 0, n = this.count(4); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(200, 600);
      p.spawn(F.spark, x2, y2, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.08, 0.18), 1.5, 0.3, WHITE, c, 3, 0, 6, STRETCH, 0, 0, 0.025);
    }
    this.lights.add(x2, y2, 160, 0.6, c, 0.1);
    this.audio.zap(this.pan(x2));
  }

  /** OVERCHARGE critical hit. */
  crit(x, y, angle) {
    const { p, F } = this;
    const c = 0xff7ae6;
    p.spawn(F.flare, x, y, 0, 0, 0.12, 18, 46, WHITE, c, 3, 0, 0, 0, angle + Math.PI / 4);
    p.spawn(F.ring, x, y, 0, 0, 0.18, 6, 34, WHITE, c, 2.4, 0);
    for (let i = 0, n = this.count(6); i < n; i++) {
      const a = angle + Math.PI + rand(-1.1, 1.1);
      const sp = rand(300, 900);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.1, 0.22), 2, 0.4, WHITE, c, 3.6, 0, 5, STRETCH, 0, 0, 0.03);
    }
    this.camera.addTrauma(0.05, 0.35);
    this.audio.crit(this.pan(x));
  }

  /** RICOCHET wall bounce. */
  bounce(x, y, nx, ny, color) {
    const { p, F } = this;
    const base = Math.atan2(ny, nx);
    p.spawn(F.ring, x, y, 0, 0, 0.14, 4, 22, WHITE, color, 2, 0);
    for (let i = 0, n = this.count(3); i < n; i++) {
      const a = base + rand(-0.9, 0.9);
      const sp = rand(180, 480);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.07, 0.16), 1.4, 0.3, WHITE, color, 2.4, 0, 6, STRETCH, 0, 0, 0.025);
    }
    this.grid.explode(x, y, 2.5, 90, 0.3);
    this.audio.ping(this.pan(x));
  }

  /** DEFLECTOR absorbed a hit. */
  shieldBlock(x, y) {
    const { p, F } = this;
    const c = PALETTE.shield;
    p.spawn(F.ringThin, x, y, 0, 0, 0.45, 30, 300, WHITE, c, 2.8, 0);
    p.spawn(F.glow, x, y, 0, 0, 0.25, 40, 160, WHITE, c, 2, 0);
    for (let i = 0, n = this.count(28); i < n; i++) {
      const a = (i / 28) * TAU;
      const sp = rand(500, 1100);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.2, 0.4), 2.2, 0.5, WHITE, c, 3.6, 0, 3, STRETCH | BOUNCE, 0, 0, 0.03);
    }
    this.grid.explode(x, y, 28, 420, 0.5);
    this.lights.add(x, y, 460, 1.1, c, 0.4);
    this.shocks.add(x, y, 1300, 0.03, 0.5);
    this.camera.addTrauma(0.55);
    this.camera.punch(0.8);
    this.audio.shieldBlock();
  }

  /** Wave cleared: a golden purge nova rolls out from the ship. */
  purgeNova(x, y) {
    const { p, F } = this;
    const c = PALETTE.purge;
    p.spawn(F.glow, x, y, 0, 0, 0.35, 60, 300, WHITE, c, 1.5, 0);
    for (let k = 0; k < 3; k++) {
      p.spawn(F.ringFine, x, y, 0, 0, 0.9 + k * 0.25, 30, 2000 + k * 300, WHITE, k === 1 ? PALETTE.player : c, 2.8 - k * 0.6, 0);
    }
    for (let i = 0, n = this.count(90); i < n; i++) {
      const a = (i / 90) * TAU + rand(-0.03, 0.03);
      const sp = rand(1000, 2400);
      p.spawn(F.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.5, 1), rand(2.5, 4), 0.6,
        WHITE, i % 2 ? c : 0xfff2c0, 3.6, 0, 1.4, STRETCH | BOUNCE, 0, 0, 0.035);
    }
    this.grid.explode(x, y, 40, 1400, 0.45);
    this.lights.add(x, y, 400, 0.9, c, 1.2, 2400);
    this.shocks.add(x, y, 2400, 0.06, 1.1);
    this.camera.addTrauma(0.6);
    this.camera.punch(-1.6);
    this.audio.roundClear();
  }

  repair(x, y) {
    this.ascend(x, y, PALETTE.repair);
    this.popup(x, y - 52, '+HULL', 'heal', 1.1);
  }

  /** An elite materialises: bigger portal, alarm. */
  eliteSpawn(x, y, color, radius) {
    const { p, F } = this;
    this.spawnPortal(x, y, color, Math.min(radius, 44)); // drama from the gold ring, not a bigger blob
    p.spawn(F.ringFine, x, y, 0, 0, 0.9, radius * 14, radius, WHITE, PALETTE.flux, 0.3, 2.6, 0, 0);
    this.grid.implode(x, y, 12, 420);
    this.lights.add(x, y, 520, 1.2, PALETTE.flux, 0.9);
    this.audio.alarm();
  }

  /** Celebration sparkle (extra life, weapon upgrade) around the ship. */
  ascend(x, y, color) {
    const { p, F } = this;
    p.spawn(F.ringThin, x, y, 0, 0, 0.6, 20, 260, WHITE, color, 2.8, 0);
    for (let i = 0, n = this.count(36); i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(200, 700);
      p.spawn(F.dot, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.9), rand(3, 5), 1, WHITE, color, 3, 0, 3, FLICKER);
    }
    this.lights.add(x, y, 420, 1, color, 0.6);
    this.grid.explode(x, y, 20, 420, 0.6);
  }

  /** Attract-mode fireworks for the title screen. */
  ambient() {
    const colors = [0xff2bd6, 0x4d8bff, 0xc6ff2e, 0xff7a1a, 0xa45cff, 0x3ef2ff];
    const x = rand(200, ARENA.w - 200);
    const y = rand(150, ARENA.h - 150);
    this.explosion(x, y, colors[randInt(0, colors.length - 1)], rand(0.8, 1.8), { silent: true, quiet: true });
  }
}
