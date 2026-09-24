import { Container } from '../lib/pixi.js';
import { ARENA, PLAYER, PALETTE, SURGE, FLUX, WEAPON, QUALITY, STORAGE_KEYS } from '../config.js';
import { clamp, damp, rand, hexToRgb01 } from '../core/math.js';
import { Backdrop } from '../render/Backdrop.js';
import { WarpGrid } from '../render/WarpGrid.js';
import { Trail } from '../render/Trail.js';
import { GlowLayer } from '../render/GlowLayer.js';
import { Camera } from '../fx/Camera.js';
import { Particles } from '../fx/Particles.js';
import { Lights } from '../fx/Lights.js';
import { Shockwaves } from '../fx/Shockwaves.js';
import { Popups } from '../fx/Popups.js';
import { Effects } from '../fx/Effects.js';
import { Player } from './Player.js';
import { PlayerBullets, EnemyShots } from './Bullets.js';
import { Enemies } from './Enemies.js';
import { Flux } from './Flux.js';
import { Director } from './Director.js';
import { SpatialHash } from './SpatialHash.js';

const EXPLOSION_SIZE = { dart: 1, wisp: 1, mite: 0.65, lancer: 1.25, hive: 1.6, sentry: 1.8, bulwark: 2.6 };
const HIT_STOP = { bulwark: 0.045, sentry: 0.035, hive: 0.03 };
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const WAVE_NAMES = {
  swarm: 'SWARM FROM ALL SIDES',
  pincer: 'PINCER FORMATION',
  lancers: 'LANCER STRIKE',
  siege: 'SIEGE LINE',
  crossfire: 'CROSSFIRE',
};
const MULT_MILESTONES = [10, 25, 50, 75, 99];

export class Game {
  constructor({ pipeline, atlas, audio, input, ui, settings, debug = {} }) {
    this.pipe = pipeline;
    this.atlas = atlas;
    this.audio = audio;
    this.input = input;
    this.ui = ui;
    this.settings = settings;
    this.debug = debug;

    // Scene graph: backdrop -> world (camera) -> screen-space overlay.
    this.backdrop = new Backdrop(pipeline.quad);
    this.grid = new WarpGrid(60, 4);
    this.trail = new Trail();
    this.layer = new GlowLayer(atlas);
    this.overlay = new GlowLayer(atlas);
    this.world = new Container();
    this.world.addChild(this.grid.mesh, this.trail.mesh, this.layer.container);
    this.screen = new Container();
    this.screen.addChild(this.overlay.container);
    pipeline.scene.addChild(this.backdrop.mesh, this.world, this.screen);

    this.camera = new Camera();
    this.particles = new Particles(atlas, 7000);
    this.lights = new Lights();
    this.shocks = new Shockwaves();
    this.popups = new Popups(atlas);
    this.fx = new Effects({
      particles: this.particles, lights: this.lights, shocks: this.shocks, popups: this.popups,
      grid: this.grid, camera: this.camera, audio: this.audio, game: this,
    });
    this.player = new Player();
    this.bullets = new PlayerBullets();
    this.orbs = new EnemyShots();
    this.enemies = new Enemies();
    this.flux = new Flux();
    this.director = new Director();
    this.hash = new SpatialHash();

    this.state = 'title';
    this.clock = 0;
    this.lastNow = 0;
    this.wallDt = 0;
    this.timeScale = 1;
    this.slowRecover = 3;
    this.freeze = 0;
    this.flashAmt = 0;
    this.flashColor = [1, 1, 1];
    this.chroma = 0;
    this.borderFlash = 0;
    this.attractT = 0.5;
    this.fps = 60;
    this.frameTimes = [];
    this.autoLevel = 'high';
    this.perfT = 0;
    this.aimPoint = { x: ARENA.w / 2, y: 0 };
    this.tmp = { x: 0, y: 0 };
    this.persistentLights = [];
    this.playerLight = { x: 0, y: 0, radius: 300, intensity: 0.6, r: 0.3, g: 0.85, b: 1 };
    this.best = this._loadBest();

    this._emitBullet = (x, y, a, speed, pierce, color) => {
      if (this.bullets.spawn(x, y, a, speed, pierce, color)) this.stats.shots++;
    };

    this.resetRun();
    this.applySettings(settings);
  }

  // --- lifecycle ------------------------------------------------------------------------

  resetRun() {
    this.score = 0;
    this.progress = 0; // un-multiplied kill value: drives threat, weapon tiers, extra ships
    this.displayScore = 0;
    this.multiplier = 1;
    this.lives = PLAYER.lives;
    this.surge = 0;
    this.surgeWave = null;
    this.lifeAwards = 0;
    this.nextLifeAt = PLAYER.extraLifeStep;
    this.deathTimer = 0;
    this.heartT = 0;
    this.killsThisFrame = 0;
    this.stats = { kills: 0, time: 0, maxMult: 1, shots: 0, hits: 0, surges: 0 };
    this.player.reset();
    this.bullets.clear();
    this.orbs.clear();
    this.enemies.clear();
    this.flux.clear();
    this.popups.clear();
    this.director.reset();
    this.trail.reset();
    this.timeScale = 1;
    this.freeze = 0;
  }

  start() {
    this.resetRun();
    this.particles.clear();
    this.lights.clear();
    this.shocks.clear();
    this.grid.reset();
    this.camera.reset();
    this.state = 'playing';
    this.ui.setScreen(null);
    this.ui.showHud(true);
    this.ui.setPlaying(true);
    this.audio.unlock();
    this.audio.setMuffle(0);
    if (this.audio.music) {
      this.audio.music.setIntensity(1);
      this.audio.music.start();
    }
    const p = this.player;
    this.fx.spawnPortal(p.x, p.y, PALETTE.player, 40);
    this.fx.ascend(p.x, p.y, PALETTE.player);
    this.ui.announce('SURVIVE', 'WASD MOVE · MOUSE AIM · CLICK FIRE · SPACE SURGE', 'info');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseAll();
    this.ui.setScreen('pause');
    this.ui.setPlaying(false);
    this.audio.setMuffle(0.75, 0.08);
    this.audio.ui('back');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.setScreen(null);
    this.ui.setPlaying(true);
    this.audio.setMuffle(0, 0.1);
    this.lastNow = performance.now();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  toTitle() {
    this.resetRun();
    this.state = 'title';
    this.ui.showHud(false);
    this.ui.setPlaying(false);
    this.ui.setScreen('title');
    this.audio.setMuffle(0);
    if (this.audio.music) {
      this.audio.music.setIntensity(0);
      this.audio.music.start();
    }
  }

  applySettings(s) {
    this.settings = s;
    this.camera.intensity = s.shake;
    this.shocks.scale = s.reduceFlashes ? 0.35 : 1;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    this.ui.setFpsVisible(s.showFps);
    this.resize();
  }

  get qualityName() {
    return this.settings.quality === 'auto' ? this.autoLevel : this.settings.quality;
  }

  resize() {
    const q = QUALITY[this.qualityName] ?? QUALITY.high;
    const host = this.pipe.renderer.canvas.parentElement;
    const w = host?.clientWidth || window.innerWidth;
    const h = host?.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    this.pipe.resize(w, h, dpr, q.renderScale, q.bloomMips);
    this.fx.density = q.particles;
  }

  // --- frame ----------------------------------------------------------------------------

  frame(now) {
    // Simulation steps are clamped (no tunnelling after a hitch); wall-clock timers
    // such as the death sequence use the unclamped value so they finish on time.
    const elapsed = this.lastNow ? Math.max(0, (now - this.lastNow) / 1000) : 1 / 60;
    const realDt = Math.min(0.05, elapsed);
    this.wallDt = Math.min(0.25, elapsed);
    this.lastNow = now;
    this.clock += realDt;
    this.input.poll();
    this._globalInput();

    let dt = 0;
    if (this.state === 'playing' || this.state === 'dying' || this.state === 'title') {
      if (this.freeze > 0) this.freeze -= realDt;
      else dt = realDt * this.timeScale;
      this.timeScale = damp(this.timeScale, 1, this.slowRecover, realDt);
    }
    this.update(dt, realDt);
    this.render(realDt);
    this._trackPerformance(realDt);
    this.input.endFrame();
  }

  _globalInput() {
    const input = this.input;
    if (input.wasPressed('KeyM')) {
      this.audio.setMuted(!this.audio.muted);
      this.ui.toast(this.audio.muted ? 'SOUND OFF' : 'SOUND ON');
    }
    if (input.pausePressed()) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.ui.back();
      else if (this.ui.stack.length) this.ui.back();
    }
    this.ui.pad(input);
    const confirm = input.confirmPressed() && !this.ui.hasFocus();
    if (confirm && this.state === 'title' && this.ui.current === 'title') this.start();
    else if (confirm && this.state === 'gameover' && this.ui.current === 'over') this.start();
  }

  update(dt, realDt) {
    this.killsThisFrame = 0;
    if (this.state === 'playing') this._updatePlaying(dt, realDt);
    else if (this.state === 'dying') this._updateDying(dt);
    else if (this.state === 'title') this._updateAttract(dt);

    if (this.state !== 'paused' && this.state !== 'gameover') {
      this.particles.update(dt);
      this.lights.update(dt);
      this.shocks.update(dt);
      this.popups.update(dt);
      this.grid.update(dt);
    } else if (this.state === 'gameover') {
      // Keep the world alive (slowly) behind the results screen.
      this.particles.update(realDt * 0.35);
      this.lights.update(realDt * 0.35);
      this.shocks.update(realDt * 0.35);
      this.grid.update(realDt * 0.5);
    }

    const p = this.player;
    const focusX = this.state === 'title' ? ARENA.w / 2 + Math.cos(this.clock * 0.13) * 520 : p.x;
    const focusY = this.state === 'title' ? ARENA.h / 2 + Math.sin(this.clock * 0.17) * 300 : p.y;
    if (this.state !== 'paused') this.camera.update(realDt, focusX, focusY);

    this.flashAmt *= Math.exp(-8 * realDt);
    this.chroma *= Math.exp(-5 * realDt);
    this.borderFlash *= Math.exp(-6 * realDt);
    this.displayScore = damp(this.displayScore, this.score, 11, realDt);
    if (Math.abs(this.score - this.displayScore) < 1) this.displayScore = this.score;

    if (this.killsThisFrame >= 5) this.hitStop(0.03);
    if (this.state === 'playing' || this.state === 'dying') this._pushHud();
  }

  _updatePlaying(dt, realDt) {
    const p = this.player;
    const input = this.input;
    this.stats.time += dt;

    const aim = this._aimWorld();
    p.update(dt, input, aim.x, aim.y);

    const volleys = dt > 0 ? p.tryFire(dt, input.firing, this._emitBullet) : 0;
    if (volleys) this._onFire();

    if (input.surgePressed()) this.triggerSurge();

    this.director.update(dt, this);
    this._rebuildHash();
    this.enemies.update(dt, this);
    this._rebuildHash();
    this.bullets.update(dt, this);
    this.orbs.update(dt, this);
    this._enemyContact();
    this.flux.update(dt, this);
    this._updateSurgeWave(dt);
    this._engine(dt);

    if (this.lives === 1) {
      this.heartT -= realDt;
      if (this.heartT <= 0) {
        this.heartT = 1.05;
        this.audio.heartbeat();
      }
    }
  }

  _updateDying(dt) {
    this.deathTimer -= this.wallDt;
    this._rebuildHash();
    this.enemies.update(dt, this);
    this.flux.update(dt, this);
    if (this.deathTimer <= 0) this.gameOver();
  }

  _updateAttract(dt) {
    this.attractT -= dt;
    if (this.attractT <= 0) {
      this.attractT = rand(0.9, 1.7);
      this.fx.ambient();
    }
  }

  _rebuildHash() {
    this.hash.clear();
    for (const e of this.enemies.list) this.hash.insert(e);
  }

  _aimWorld() {
    const pipe = this.pipe;
    const s = pipe.width / pipe.cssWidth;
    return this.camera.screenToWorld(this.input.mouseX * s, this.input.mouseY * s, this.aimPoint);
  }

  _onFire() {
    const p = this.player;
    const ca = Math.cos(p.heading);
    const sa = Math.sin(p.heading);
    const nx = p.x + ca * PLAYER.size;
    const ny = p.y + sa * PLAYER.size;
    const color = PALETTE.bulletByLevel[p.weapon];
    this.fx.muzzle(nx, ny, p.heading, color);
    this.audio.shoot(p.weapon, this.fx.pan(p.x));
    this.camera.addTrauma(0.07, 0.2);
    this.camera.kick(-ca * 70, -sa * 70);
    this.grid.push(nx, ny, ca, sa, 1.1, 80);
  }

  _engine(dt) {
    const p = this.player;
    if (!p.alive || dt <= 0) return;
    const speed = Math.hypot(p.vx, p.vy);
    const power = clamp(speed / PLAYER.maxSpeed, 0, 1);
    let dx = -Math.cos(p.heading);
    let dy = -Math.sin(p.heading);
    if (speed > 25) {
      dx = -p.vx / speed;
      dy = -p.vy / speed;
    }
    const ex = p.x + dx * PLAYER.size * 0.42;
    const ey = p.y + dy * PLAYER.size * 0.42;
    this.trail.push(ex, ey, dt, power);
    this.fx.exhaust(ex, ey, dx, dy, power);
    const k = dt * 60;
    this.grid.implode(p.x, p.y, 0.18 * k, 150);
    if (speed > 25) this.grid.push(p.x, p.y, -dx, -dy, (0.4 + power * 0.9) * k, 130);
  }

  // --- combat ---------------------------------------------------------------------------

  spawnEnemy(kind, x, y) {
    const e = this.enemies.spawn(kind, x, y, this.director.hpMul, this.director.speedMul);
    if (!e) return null;
    this.fx.spawnPortal(e.x, e.y, e.def.color, e.radius);
    this.audio.spawn(this.fx.pan(e.x));
    return e;
  }

  bulletHitEnemy(b, e, hx, hy) {
    this.stats.hits++;
    e.hp -= 1;
    e.flash = 0.07;
    const k = 160 / e.mass;
    e.vx += Math.cos(b.angle) * k;
    e.vy += Math.sin(b.angle) * k;
    if (e.hp <= 0) this.killEnemy(e, 'bullet');
    else this.fx.bulletImpact(hx, hy, b.angle, e.def.color, e.kind === 'bulwark');
  }

  /** cause: 'bullet' | 'surge' | 'clear' (player-hit nova) | 'cascade' (game over) */
  killEnemy(e, cause) {
    if (!e.active) return;
    const def = e.def;
    const scoring = cause === 'bullet' || cause === 'surge';
    this.enemies.remove(e);
    const size = EXPLOSION_SIZE[e.kind] ?? 1;
    this.fx.explosion(e.x, e.y, def.color, size, { quiet: cause === 'cascade' });

    if (scoring) {
      const pts = def.score * this.multiplier;
      this.addScore(pts, def.score);
      this.fx.popup(e.x, e.y - e.radius - 8, String(pts), size > 1.5 ? 0xfff2c0 : 0xdffcff, size > 1.5 ? 1.3 : 1);
      const drops = Math.floor(def.flux) + (Math.random() < def.flux % 1 ? 1 : 0);
      if (drops) this.flux.drop(e.x, e.y, drops);
      if (cause !== 'surge') this.addSurge(def.surge); // no surge chaining
      this.stats.kills++;
      this.killsThisFrame++;
      if (HIT_STOP[e.kind]) this.hitStop(HIT_STOP[e.kind]);
    }

    if (e.kind === 'hive' && scoring) {
      const n = def.splits;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
        const m = this.enemies.spawn('mite', e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12, 1, this.director.speedMul);
        if (m) {
          m.spawn = 0.06;
          m.vx = Math.cos(a) * 460;
          m.vy = Math.sin(a) * 460;
        }
      }
    }
  }

  _enemyContact() {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    const near = this.hash.query(p.x, p.y, p.radius + 48);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (!e.active || e.spawn > 0 || e.dying > 0) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const rr = e.radius * 0.82 + p.radius;
      if (dx * dx + dy * dy < rr * rr) {
        this.hurtPlayer();
        return;
      }
    }
  }

  hurtPlayer() {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || this.debug.god) return;
    this.lives--;
    this.multiplier = 1;
    this.fx.playerHit(p.x, p.y);
    this.hitStop(0.05);
    this.slowMo(0.2, 1.7);
    this.flashScreen(PALETTE.danger, 0.65);
    this.chromaPulse(0.03);
    const list = this.enemies.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (Math.hypot(e.x - p.x, e.y - p.y) < 460) this.killEnemy(e, 'clear');
    }
    this.orbs.clear();
    if (this.lives <= 0) {
      this.die();
      return;
    }
    p.invuln = PLAYER.invulnTime;
    this.ui.announce(this.lives === 1 ? 'LAST LIFE' : `${this.lives} LIVES LEFT`, 'HULL BREACH', 'danger');
  }

  die() {
    const p = this.player;
    p.alive = false;
    this.state = 'dying';
    this.deathTimer = 3;
    this.fx.playerDeath(p.x, p.y);
    this.hitStop(0.07);
    this.slowMo(0.12, 0.5);
    this.flashScreen(PALETTE.white, 0.7);
    this.chromaPulse(0.04);
    this.trail.reset();
    this.bullets.clear();
    this.orbs.clear();
    this.surgeWave = null;
    for (const e of this.enemies.list) {
      e.dying = 0.3 + Math.hypot(e.x - p.x, e.y - p.y) / 1500 + rand(0, 0.15);
    }
    if (this.audio.music) {
      this.audio.music.setIntensity(0);
      this.audio.music.stop(2.5);
    }
    this.ui.setPlaying(false);
  }

  gameOver() {
    this.state = 'gameover';
    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      this._saveBest(this.best);
    }
    this.enemies.clear();
    this.ui.showHud(false);
    this.ui.showGameOver({
      score: this.score,
      best: this.best,
      isBest,
      time: this.stats.time,
      kills: this.stats.kills,
      maxMult: this.stats.maxMult,
      accuracy: this.stats.shots ? this.stats.hits / this.stats.shots : 0,
      level: this.director.level,
    });
    this.audio.setMuffle(0.35, 0.6);
    if (this.audio.music) {
      this.audio.music.setIntensity(0);
      this.audio.music.start();
    }
  }

  // --- scoring & meta -------------------------------------------------------------------

  addScore(points, progress = 0) {
    this.score += points;
    this.progress += progress;
    const p = this.player;
    const levels = WEAPON.levels;
    while (p.weapon < levels.length - 1 && this.progress >= levels[p.weapon + 1].progress) {
      p.weapon++;
      this.ui.announce(`WEAPON MK ${ROMAN[p.weapon]}`, 'FIREPOWER INCREASED', 'power');
      this.audio.powerUp();
      this.fx.ascend(p.x, p.y, PALETTE.bulletByLevel[p.weapon]);
    }
    if (this.progress >= this.nextLifeAt) {
      this.lifeAwards++;
      this.nextLifeAt += PLAYER.extraLifeStep * (this.lifeAwards + 1);
      if (this.lives < PLAYER.maxLives) {
        this.lives++;
        this.ui.announce('EXTRA LIFE', `${this.lives} SHIPS IN RESERVE`, 'life');
        this.audio.extraLife();
        this.fx.ascend(p.x, p.y, 0x7dff9a);
      }
    }
  }

  collectFlux(f) {
    const before = this.multiplier;
    this.multiplier = Math.min(FLUX.maxMultiplier, this.multiplier + 1);
    this.stats.maxMult = Math.max(this.stats.maxMult, this.multiplier);
    this.addSurge(SURGE.fluxGain);
    this.fx.fluxCollect(f.x, f.y, this.multiplier);
    for (const m of MULT_MILESTONES) {
      if (before < m && this.multiplier >= m) {
        const p = this.player;
        this.fx.popup(p.x, p.y - 46, `x${m}`, PALETTE.flux, 1.6);
        this.fx.ascend(p.x, p.y, PALETTE.flux);
        this.audio.powerUp();
      }
    }
  }

  addSurge(v) {
    const before = this.surge;
    this.surge = Math.min(1, this.surge + v);
    if (before < 1 && this.surge >= 1) {
      this.ui.announce('SURGE READY', 'SPACE · RIGHT CLICK · LB', 'surge');
      this.audio.surgeReady();
    }
  }

  triggerSurge() {
    const p = this.player;
    if (!p.alive) return;
    if (this.surge < 1) {
      this.audio.ui('back');
      return;
    }
    this.surge = 0;
    this.stats.surges++;
    this.surgeWave = { x: p.x, y: p.y, r: 0 };
    p.invuln = Math.max(p.invuln, 0.9);
    this.fx.surgeNova(p.x, p.y);
    this.hitStop(0.05);
    this.slowMo(0.35, 2.4);
    this.flashScreen(PALETTE.surge, 0.6);
    this.chromaPulse(0.025);
  }

  _updateSurgeWave(dt) {
    const w = this.surgeWave;
    if (!w) return;
    w.r += SURGE.speed * dt;
    const r2 = w.r * w.r;
    const list = this.enemies.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (i >= list.length) continue;
      const dx = e.x - w.x;
      const dy = e.y - w.y;
      if (dx * dx + dy * dy < r2) this.killEnemy(e, 'surge');
    }
    for (let i = this.orbs.active.length - 1; i >= 0; i--) {
      const o = this.orbs.active[i];
      if ((o.x - w.x) ** 2 + (o.y - w.y) ** 2 < r2) this.orbs.pop(o, this);
    }
    if (w.r > SURGE.maxRadius) this.surgeWave = null;
  }

  onThreatLevel(level) {
    if (this.state !== 'playing') return;
    this.ui.announce(`THREAT LEVEL ${level}`, level >= 6 ? 'MAXIMUM HOSTILITY' : 'HOSTILES ADAPTING', 'threat');
    this.audio.threatUp();
    if (this.audio.music) this.audio.music.setIntensity(level >= 5 ? 4 : level >= 3 ? 3 : 2);
    this.borderFlash = 1.5;
  }

  onWave(n, type) {
    this.ui.announce(`WAVE ${n}`, WAVE_NAMES[type] ?? '', 'wave');
    this.audio.alarm();
    this.borderFlash = 2.5;
  }

  // --- feel helpers -----------------------------------------------------------------------

  hitStop(seconds) {
    this.freeze = Math.max(this.freeze, seconds);
  }

  slowMo(scale, recover) {
    this.timeScale = Math.min(this.timeScale, scale);
    this.slowRecover = recover;
  }

  flashScreen(color, amount) {
    const scale = this.settings.reduceFlashes ? 0.25 : 1;
    this.flashColor = hexToRgb01(color);
    this.flashAmt = Math.max(this.flashAmt, amount * scale);
  }

  chromaPulse(amount) {
    const scale = this.settings.reduceFlashes ? 0.3 : 1;
    this.chroma = Math.max(this.chroma, amount * scale);
  }

  // --- rendering --------------------------------------------------------------------------

  render() {
    const pipe = this.pipe;
    const W = pipe.width;
    const H = pipe.height;
    const cam = this.camera;
    cam.apply(this.world, W, H);
    const beat = this.audio.music && this.audio.music.playing ? this.audio.music.pulse() : 0;

    const danger = this.state === 'playing' && this.lives === 1;
    this.backdrop.update(W, H, this.clock, cam.x, cam.y, danger ? [0.25, 0.0, 0.05, 0.3 + 0.2 * Math.sin(this.clock * 4)] : [0, 0, 0, 0]);

    // Grid lighting.
    const lights = this.persistentLights;
    lights.length = 0;
    const p = this.player;
    if (p.alive && this.state !== 'title') {
      const L = this.playerLight;
      L.x = p.x;
      L.y = p.y;
      L.intensity = 0.26 + p.fireHeat * 0.16 + p.thrust * 0.08;
      lights.push(L);
    }
    this.grid.setLights(this.lights.collect(lights));
    this.grid.params[0] = 1 + beat * 0.3 + Math.min(1, this.borderFlash) * 0.4;
    this.grid.updateMesh(cam.x, cam.y);
    this.trail.rebuild(p.alive && this.state !== 'title' ? 1.9 : 0);

    // World sprites (one draw call).
    const L = this.layer;
    L.begin();
    this._drawArena(L, beat);
    this.flux.draw(L, this.clock);
    this.enemies.draw(L, this.clock);
    this.orbs.draw(L);
    this.bullets.draw(L, this.atlas);
    if (this.state === 'playing' || this.state === 'paused') {
      p.draw(L, this.clock);
      if (this.input.device === 'gamepad') {
        const d = 190;
        L.sprite('reticle', p.x + Math.cos(p.heading) * d, p.y + Math.sin(p.heading) * d, this.clock, 15, PALETTE.player, 1.4);
      } else {
        p.drawSight(L);
      }
    }
    this.particles.draw(L);
    this.popups.draw(L);
    L.end();

    // Screen-space overlay (mouse reticle).
    const O = this.overlay;
    O.begin();
    if (this.state === 'playing' && this.input.device === 'mouse') {
      const s = W / pipe.cssWidth;
      const mx = this.input.mouseX * s;
      const my = this.input.mouseY * s;
      const r = 17 * s * (1 + p.fireHeat * 0.22);
      O.sprite('reticleGlow', mx, my, this.clock * 0.9, r * 1.1, PALETTE.player, 0.8);
      O.sprite('reticle', mx, my, this.clock * 0.9, r, 0xe8fdff, 1.9);
    }
    O.end();

    // Post-processing.
    const post = pipe.post;
    const reduce = this.settings.reduceFlashes;
    post.bloom = 1.7 + beat * 0.15;
    post.chromatic = 0.0011 + this.chroma;
    post.flash[0] = this.flashColor[0];
    post.flash[1] = this.flashColor[1];
    post.flash[2] = this.flashColor[2];
    post.flash[3] = this.flashAmt;
    post.danger = danger ? 0.1 + 0.08 * Math.sin(this.clock * 4.2) * (reduce ? 0.3 : 1) : 0;
    const dyingT = this.state === 'dying' ? 1 - this.deathTimer / 3 : 0;
    post.desaturate = this.state === 'gameover' ? 0.55 : dyingT * 0.45;
    post.fade = this.state === 'paused' ? 0.38 : this.state === 'gameover' ? 0.28 : this.state === 'title' ? 0.12 : 0;
    post.scanlines = this.settings.scanlines ? 0.055 : 0;
    post.grain = 0.028;

    pipe.render(this.clock, this.shocks.project(cam, W, H));
  }

  _drawArena(L, beat) {
    const c = PALETTE.border;
    const hot = Math.min(1.5, this.borderFlash);
    const I = 0.7 + beat * 0.45 + hot * 0.8;
    const color = hot > 0.1 ? PALETTE.borderHot : c;
    const w = ARENA.w;
    const h = ARENA.h;
    L.line(0, 0, w, 0, 3.4, color, I);
    L.line(0, h, w, h, 3.4, color, I);
    L.line(0, 0, 0, h, 3.4, color, I);
    L.line(w, 0, w, h, 3.4, color, I);
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      L.sprite('glow', x, y, 0, 70, PALETTE.borderHot, 0.5 + beat * 0.5 + hot);
      L.sprite('dot', x, y, 0, 7, PALETTE.white, 1.6 + beat);
    }
  }

  _pushHud() {
    this.ui.updateHud({
      score: Math.round(this.displayScore),
      best: Math.max(this.best, this.score),
      multiplier: this.multiplier,
      lives: this.lives,
      surge: this.surge,
      weapon: this.player.weapon,
      level: this.director.level,
    });
  }

  _trackPerformance(realDt) {
    this.fps = damp(this.fps, 1 / Math.max(realDt, 1e-3), 3, realDt);
    this.ui.setFps(this.fps);
    if (this.settings.quality !== 'auto' || this.state !== 'playing') {
      this.perfT = 0;
      this.frameTimes.length = 0;
      return;
    }
    this.frameTimes.push(realDt);
    this.perfT += realDt;
    if (this.perfT < 3) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.perfT = 0;
    this.frameTimes.length = 0;
    if (avg > 1 / 45 && this.autoLevel !== 'low') {
      this.autoLevel = this.autoLevel === 'high' ? 'medium' : 'low';
      this.resize();
      console.info(`[neon-surge] auto quality -> ${this.autoLevel} (avg frame ${(avg * 1000).toFixed(1)} ms)`);
    }
  }

  _loadBest() {
    try {
      return Number(localStorage.getItem(STORAGE_KEYS.best)) || 0;
    } catch {
      return 0;
    }
  }

  _saveBest(v) {
    try {
      localStorage.setItem(STORAGE_KEYS.best, String(v));
    } catch {
      /* storage unavailable (private mode / sandboxed iframe) */
    }
  }
}
