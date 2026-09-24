import { Container } from '../lib/pixi.js';
import { ARENA, PLAYER, PALETTE, SURGE, FLUX, QUALITY, ROUNDS, ENEMIES } from '../config.js';
import { clamp, damp, rand, hexToRgb01, TAU } from '../core/math.js';
import { Backdrop } from '../render/Backdrop.js';
import { WarpGrid } from '../render/WarpGrid.js';
import { Trail } from '../render/Trail.js';
import { GlowLayer } from '../render/GlowLayer.js';
import { Camera } from '../fx/Camera.js';
import { Particles } from '../fx/Particles.js';
import { Lights } from '../fx/Lights.js';
import { Shockwaves } from '../fx/Shockwaves.js';
import { Arcs } from '../fx/Arcs.js';
import { Effects } from '../fx/Effects.js';
import { FloatText } from '../ui/FloatText.js';
import { Player } from './Player.js';
import { PlayerBullets, EnemyShots } from './Bullets.js';
import { Enemies } from './Enemies.js';
import { Drones } from './Drones.js';
import { Flux } from './Flux.js';
import { Director } from './Director.js';
import { SpatialHash } from './SpatialHash.js';
import { computeStats, buildShot, rollOffers, RARITY, UPGRADE_BY_ID, CACHE_OFFER } from './Upgrades.js';
import { computeRewards } from './Meta.js';

const EXPLOSION_SIZE = { dart: 1, wisp: 1, mite: 0.65, lancer: 1.25, hive: 1.6, sentry: 1.8, bulwark: 2.6 };
const HIT_STOP = { bulwark: 0.045, sentry: 0.035, hive: 0.03 };
const SET_PIECE_NAMES = {
  swarm: 'SWARM FROM ALL SIDES',
  pincer: 'PINCER FORMATION',
  lancers: 'LANCER STRIKE',
  siege: 'SIEGE LINE',
  crossfire: 'CROSSFIRE',
};
const MULT_MILESTONES = [10, 25, 50, 75, 99];
// States in which simulation time advances (hit-stop / slow-mo apply).
const SIM_STATES = new Set(['playing', 'roundClear', 'dying', 'title', 'hangar']);
const BLAST_CAP = 120;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * Game states:
 *   title -> playing <-> paused
 *   playing -> roundClear (purge nova, flux vacuum) -> upgrade (pick 1 of 3) -> playing
 *   playing -> dying -> hangar (rewards + permanent shop) -> playing | title
 */
export class Game {
  constructor({ pipeline, atlas, audio, input, ui, settings, meta, debug = {} }) {
    this.pipe = pipeline;
    this.atlas = atlas;
    this.audio = audio;
    this.input = input;
    this.ui = ui;
    this.settings = settings;
    this.meta = meta;
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
    this.arcs = new Arcs();
    this.popups = new FloatText(ui.el.popups);
    this.fx = new Effects({
      particles: this.particles, lights: this.lights, shocks: this.shocks, popups: this.popups, arcs: this.arcs,
      grid: this.grid, camera: this.camera, audio: this.audio, game: this,
    });
    this.player = new Player();
    this.bullets = new PlayerBullets();
    this.orbs = new EnemyShots();
    this.enemies = new Enemies();
    this.drones = new Drones();
    this.flux = new Flux();
    this.director = new Director();
    this.hash = new SpatialHash();

    this.state = 'title';
    this.pausedFrom = 'playing';
    this.clock = 0;
    this.lastNow = 0;
    this.wallDt = 0;
    this.timeScale = 1;
    this.slowRecover = 3;
    this.freeze = 0;
    this.hitStopCD = 0;
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
    this.persistentLights = [];
    this.playerLight = { x: 0, y: 0, radius: 300, intensity: 0.6, r: 0.3, g: 0.85, b: 1 };

    // Damage pipeline scratch space (no per-frame allocations, no shared query buffers).
    this.blasts = [];
    this.blastNear = [];
    this.arcNear = [];
    this.arcHit = [];
    this.contactNear = [];
    this.arcBudget = 0;
    this.popupBudget = 0;
    this.critPopT = 0;
    this.shardEstimate = 0;
    this.shardEstimateT = 0;

    this._emitBullet = (x, y, a) => {
      if (this.bullets.spawn(x, y, a, this.shot)) this.record.shots++;
    };

    this.resetRun();
    this.applySettings(settings);
    // A purchase (or another tab) changed the Hangar: refresh derived stats while idle.
    meta.subscribe(() => {
      if (this.state === 'title' || this.state === 'hangar') this._rebuildStats();
    });
  }

  // --- lifecycle ------------------------------------------------------------------------

  resetRun() {
    this.run = {
      round: 0,
      wavesCleared: 0,
      stacks: {},
      picks: [],
      offers: [],
      rerolls: 0,
      bonusShards: 0,
      eliteKills: 0,
      rewarded: false,
      summary: null,
    };
    this.record = { kills: 0, time: 0, maxMult: 1, shots: 0, damage: 0, surges: 0 };
    this.player.reset();
    this.bullets.clear();
    this.orbs.clear();
    this.enemies.clear();
    this.flux.clear();
    this.popups.clear();
    this.arcs.clear();
    this.blasts.length = 0;
    this.drones.clear();
    this.director.reset();
    this.trail.reset();
    this._rebuildStats();
    this.run.rerolls = this.stats.rerolls;
    this.hull = this.stats.maxHull;
    this.shieldCharges = this.stats.shield;
    this.score = 0;
    this.displayScore = 0;
    this.multiplier = 1;
    this.surge = this.stats.startSurge;
    this.surgeWave = null;
    this.deathTimer = 0;
    this.clearTimer = 0;
    this.heartT = 0;
    this.killsThisFrame = 0;
    this.shardEstimate = 0;
    this.timeScale = 1;
    this.freeze = 0;
  }

  /** Recompute the whole build from Hangar levels + this run's upgrade stacks. */
  _rebuildStats() {
    this.stats = computeStats(this.meta.levels, this.run.stacks);
    this.shot = buildShot(this.stats);
    if (this.hull !== undefined) this.hull = Math.min(this.hull, this.stats.maxHull);
    this.drones.sync(this.stats.drones, this.player.x, this.player.y);
    this.ui.updateBuild(this._buildChips());
  }

  _buildChips() {
    const chips = [];
    for (const id of Object.keys(this.run.stacks)) {
      const u = UPGRADE_BY_ID[id];
      if (u) chips.push({ id, name: u.name, rarity: u.rarity, n: this.run.stacks[id] });
    }
    return chips;
  }

  startRun() {
    this.resetRun();
    this.particles.clear();
    this.lights.clear();
    this.shocks.clear();
    this.grid.reset();
    this.camera.reset();
    this.audio.unlock();
    if (this.audio.music) this.audio.music.start();
    const p = this.player;
    this.drones.recall(p.x, p.y);
    this.fx.spawnPortal(p.x, p.y, PALETTE.player, 40);
    this.fx.ascend(p.x, p.y, PALETTE.player);
    this.beginRound(1);
  }

  beginRound(n) {
    const info = this.director.startRound(n);
    this.run.round = n;
    this.run.offers = [];
    this.state = 'playing';
    this.shieldCharges = this.stats.shield;
    this.bullets.clear();
    this.orbs.clear();
    this.blasts.length = 0;
    this.ui.setScreen(null);
    this.ui.showHud(true);
    this.ui.setPlaying(true);
    this.audio.setMuffle(0, 0.25);
    if (this.audio.music) this.audio.music.setIntensity(n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1);
    let sub = n === 1 ? 'SURVIVE UNTIL THE TIMER RUNS OUT' : 'HOLD THE GRID';
    let kind = 'wave';
    if (info.elite) {
      sub = `ELITE ${ENEMIES[info.elite].label} INBOUND`;
      kind = 'elite';
    } else if (info.newKinds.length) {
      sub = `NEW HOSTILE: ${info.newKinds.map((k) => ENEMIES[k].label).join(' + ')}`;
      kind = 'threat';
      this.audio.threatUp();
    }
    this.ui.announce(`WAVE ${n}`, sub, kind);
    this.borderFlash = 1.5;
    if (n === 1) this.ui.toast('WASD MOVE · MOUSE AIM · CLICK FIRE · SPACE SURGE');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /** Timer expired (and elites are dead): purge the arena and celebrate. */
  endRound() {
    if (this.state !== 'playing') return;
    this.state = 'roundClear';
    this.run.wavesCleared++;
    this.clearTimer = ROUNDS.clearTime;
    const p = this.player;
    this.surgeWave = null;
    this.orbs.clear();
    // A golden ring rolls outward; every hostile pops as it passes (scored, no flux).
    for (const e of this.enemies.list) {
      if (e.dying > 0) continue;
      e.dying = 0.08 + Math.hypot(e.x - p.x, e.y - p.y) / 2400;
      e.dieCause = 'purge';
    }
    this.fx.purgeNova(p.x, p.y);
    this.hitStop(0.06, true);
    this.slowMo(0.3, 2.2);
    this.flashScreen(PALETTE.purge, 0.45);
    this.chromaPulse(0.02);
    let repaired = false;
    if (this.stats.repair > 0 && this.hull < this.stats.maxHull) {
      this.hull = Math.min(this.stats.maxHull, this.hull + this.stats.repair);
      this.fx.repair(p.x, p.y);
      repaired = true;
    }
    this.ui.announce(`WAVE ${this.run.round} CLEARED`, repaired ? 'NANITES REPAIRED THE HULL' : 'UPGRADE INCOMING', 'clear');
    if (this.audio.music) this.audio.music.setIntensity(1);
  }

  /** Freeze the game and offer three upgrades. */
  openUpgrade() {
    this.state = 'upgrade';
    this.bullets.clear();
    this.blasts.length = 0;
    this.enemies.clear();
    this.flux.clear();
    this.popups.clear();
    this.ui.showHud(false);
    this.run.offers = rollOffers(this.run.stacks, { count: 3, luck: this.stats.luck, round: this.run.round + 1 });
    this.ui.setPlaying(false);
    this.ui.showUpgrades(this._upgradeView());
    this.audio.setMuffle(0.45, 0.3);
  }

  _upgradeView() {
    const stacks = this.run.stacks;
    return {
      round: this.run.round,
      rerolls: this.run.rerolls,
      build: this._buildChips(),
      offers: this.run.offers.map((u) => {
        const level = stacks[u.id] | 0;
        const next = u === CACHE_OFFER ? this.stats : computeStats(this.meta.levels, { ...stacks, [u.id]: level + 1 });
        return {
          id: u.id,
          name: u.name,
          rarity: u.rarity,
          rarityLabel: RARITY[u.rarity].label,
          tag: u.tag,
          desc: u.desc,
          synergy: u.synergy ?? '',
          level,
          max: u.max,
          before: level ? u.stat(this.stats) : '',
          after: u.stat(next),
        };
      }),
    };
  }

  pickUpgrade(index) {
    if (this.state !== 'upgrade') return;
    const u = this.run.offers[index];
    if (!u) return;
    if (u === CACHE_OFFER) {
      this.run.bonusShards += 30;
    } else {
      this.run.stacks[u.id] = (this.run.stacks[u.id] | 0) + 1;
    }
    this.run.picks.push(u.id);
    this._rebuildStats();
    if (u.id === 'hull') this.hull = Math.min(this.stats.maxHull, this.hull + 1);
    const p = this.player;
    this.audio.pick(u.rarity);
    this.fx.ascend(p.x, p.y, RARITY[u.rarity].color);
    this.fx.popup(p.x, p.y - 60, u.name, 'mult', 1);
    this.beginRound(this.run.round + 1);
  }

  rerollUpgrades() {
    if (this.state !== 'upgrade' || this.ui.picking) return; // a pick is already animating
    if (this.run.rerolls <= 0) {
      this.audio.denied();
      return;
    }
    this.run.rerolls--;
    const exclude = this.run.offers.map((u) => u.id);
    this.run.offers = rollOffers(this.run.stacks, { count: 3, luck: this.stats.luck, round: this.run.round + 1, exclude });
    this.audio.ui('select');
    this.ui.showUpgrades(this._upgradeView(), true);
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'roundClear') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.input.releaseAll();
    this.ui.setScreen('pause');
    this.ui.setPlaying(false);
    this.audio.setMuffle(0.75, 0.08);
    this.audio.ui('back');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.ui.setScreen(null);
    this.ui.setPlaying(true);
    this.audio.setMuffle(0, 0.1);
    this.lastNow = performance.now();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /** Pause menu -> bail out. The run still pays out what it earned. */
  abandonRun() {
    if (this.state !== 'paused') return;
    this.player.alive = false;
    this.endRun('abandoned');
  }

  die() {
    const p = this.player;
    p.alive = false;
    this.state = 'dying';
    this.deathTimer = 3;
    this.fx.playerDeath(p.x, p.y);
    this.hitStop(0.07, true);
    this.slowMo(0.12, 0.5);
    this.flashScreen(PALETTE.white, 0.7);
    this.chromaPulse(0.04);
    this.trail.reset();
    this.bullets.clear();
    this.orbs.clear();
    this.blasts.length = 0;
    this.surgeWave = null;
    for (const e of this.enemies.list) {
      e.dying = 0.3 + Math.hypot(e.x - p.x, e.y - p.y) / 1500 + rand(0, 0.15);
      e.dieCause = 'cascade';
    }
    if (this.audio.music) {
      this.audio.music.setIntensity(0);
      this.audio.music.stop(2.5);
    }
    this.ui.setPlaying(false);
  }

  /** Bank the run's shards (exactly once) and go to the Hangar. */
  endRun(reason = 'destroyed') {
    const run = this.run;
    if (run.rewarded) return;
    run.rewarded = true;
    const rewards = computeRewards({
      time: this.record.time,
      wavesCleared: run.wavesCleared,
      score: this.score,
      eliteKills: run.eliteKills,
      bonus: run.bonusShards,
    }, this.stats.shardMul);
    const res = this.meta.commitRun({ shards: rewards.total, wave: run.round, score: this.score, kills: this.record.kills });
    run.summary = {
      reason,
      wave: run.round,
      wavesCleared: run.wavesCleared,
      score: this.score,
      time: this.record.time,
      kills: this.record.kills,
      damage: this.record.damage,
      maxMult: this.record.maxMult,
      eliteKills: run.eliteKills,
      build: this._buildChips(),
      rewards,
      newBestWave: res.newBestWave,
      newBestScore: res.newBestScore,
      saved: res.saved,
    };
    this.openHangar(run.summary);
  }

  openHangar(summary = null) {
    this.state = 'hangar';
    this.enemies.clear();
    this.bullets.clear();
    this.orbs.clear();
    this.flux.clear();
    this.blasts.length = 0;
    this.popups.clear();
    this.surgeWave = null;
    this.ui.showHud(false);
    this.ui.setPlaying(false);
    this.ui.showHangar(this.meta, summary);
    this.audio.setMuffle(summary ? 0.3 : 0.15, 0.6);
    if (this.audio.music) {
      this.audio.music.setIntensity(0);
      this.audio.music.start();
    }
  }

  buy(id) {
    const res = this.meta.buy(id);
    if (res.ok) {
      this.audio.purchase();
      this.ui.refreshHangar(this.meta, id);
      if (!res.saved) this.ui.toast('PURCHASE KEPT FOR THIS SESSION ONLY · STORAGE BLOCKED');
    } else {
      this.audio.denied();
      this.ui.shopDenied(id, res.reason);
    }
  }

  /** Settings -> reset progress (after confirmation). A run in progress keeps its loadout. */
  resetProgress() {
    this.meta.reset(); // subscribers refresh the wallet / stats
    this.ui.toast('PROGRESS RESET');
  }

  toTitle() {
    this.resetRun();
    this.state = 'title';
    this.ui.showHud(false);
    this.ui.setPlaying(false);
    this.ui.showTitle(this.meta);
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
    this.hitStopCD = Math.max(0, this.hitStopCD - realDt);
    this.input.poll();
    this._globalInput();

    let dt = 0;
    if (SIM_STATES.has(this.state)) {
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
      if (this.state === 'playing' || this.state === 'roundClear') this.pause();
      else if (this.state === 'paused') this.ui.back();
      else if (this.ui.stack.length) this.ui.back();
    }
    this.ui.pad(input);
    if (this.state === 'upgrade' && this.ui.current === 'upgrade') {
      for (let i = 0; i < 3; i++) {
        if (input.wasPressed(`Digit${i + 1}`) || input.wasPressed(`Numpad${i + 1}`)) this.ui.pickCard(i);
      }
      if (input.wasPressed('KeyR') || input.padPressed.has(3)) this.rerollUpgrades();
    }
    const confirm = input.confirmPressed() && !this.ui.hasFocus();
    if (confirm && this.state === 'title' && this.ui.current === 'title') this.startRun();
    else if (confirm && this.state === 'hangar' && this.ui.current === 'hangar') this.startRun();
  }

  update(dt, realDt) {
    this.killsThisFrame = 0;
    this.arcBudget = 48;
    this.popupBudget = 6;
    this.critPopT -= realDt;
    const state = this.state;
    if (state === 'playing') this._updatePlaying(dt, realDt);
    else if (state === 'roundClear') this._updateRoundClear(dt);
    else if (state === 'dying') this._updateDying(dt);
    else if (state === 'title' || state === 'hangar') this._updateAttract(dt);

    if (state === 'upgrade') {
      // Game logic is frozen; keep the backdrop breathing slowly behind the cards.
      const slow = realDt * 0.3;
      this.particles.update(slow);
      this.lights.update(slow);
      this.shocks.update(slow);
      this.grid.update(slow);
    } else if (state !== 'paused') {
      const fxDt = state === 'hangar' ? dt * 0.6 : dt;
      this.fx.tick(fxDt);
      this.particles.update(fxDt);
      this.lights.update(fxDt);
      this.shocks.update(fxDt);
      this.arcs.update(fxDt);
      this.popups.update(fxDt);
      this.grid.update(fxDt);
    }

    const p = this.player;
    const idle = state === 'title' || state === 'hangar';
    const focusX = idle ? ARENA.w / 2 + Math.cos(this.clock * 0.13) * 520 : p.x;
    const focusY = idle ? ARENA.h / 2 + Math.sin(this.clock * 0.17) * 300 : p.y;
    if (state !== 'paused' && state !== 'upgrade') this.camera.update(realDt, focusX, focusY);

    this.flashAmt *= Math.exp(-8 * realDt);
    this.chroma *= Math.exp(-5 * realDt);
    this.borderFlash *= Math.exp(-6 * realDt);
    this.displayScore = damp(this.displayScore, this.score, 11, realDt);
    if (Math.abs(this.score - this.displayScore) < 1) this.displayScore = this.score;

    if (this.killsThisFrame >= 5) this.hitStop(0.035);
    if (state === 'playing' || state === 'roundClear' || state === 'dying') this._pushHud(realDt);
  }

  _updatePlaying(dt, realDt) {
    const p = this.player;
    const input = this.input;
    this.record.time += dt;

    const aim = this._aimWorld();
    p.update(dt, input, aim.x, aim.y, this.stats.moveSpeed);

    const volleys = dt > 0 ? p.tryFire(dt, input.firing, this.stats, this._emitBullet) : 0;
    if (volleys) this._onFire();

    if (input.surgePressed()) this.triggerSurge();

    this.director.update(dt, this);
    this._rebuildHash();
    this.enemies.update(dt, this);
    this._rebuildHash();
    if (dt > 0) this.drones.update(dt, this, true);
    this.bullets.update(dt, this);
    this._updateBlasts(dt);
    this.orbs.update(dt, this);
    this._enemyContact();
    this.flux.update(dt, this);
    this._updateSurgeWave(dt);
    this._engine(dt);

    if (this.hull === 1 && this.shieldCharges === 0) {
      this.heartT -= realDt;
      if (this.heartT <= 0) {
        this.heartT = 1.05;
        this.audio.heartbeat();
      }
    }
    if (this.state === 'playing' && this.director.finished) this.endRound();
  }

  _updateRoundClear(dt) {
    const p = this.player;
    this.clearTimer -= this.wallDt;
    const aim = this._aimWorld();
    p.update(dt, this.input, aim.x, aim.y, this.stats.moveSpeed);
    this._rebuildHash();
    this.enemies.update(dt, this);
    this._rebuildHash();
    if (dt > 0) this.drones.update(dt, this, false);
    this.bullets.update(dt, this);
    this._updateBlasts(dt);
    this.flux.update(dt, this);
    this._engine(dt);
    const settled = this.enemies.count === 0 && this.flux.active.length === 0;
    if ((this.clearTimer <= 0 && settled) || this.clearTimer < -2) this.openUpgrade();
  }

  _updateDying(dt) {
    this.deathTimer -= this.wallDt;
    this._rebuildHash();
    this.enemies.update(dt, this);
    this.flux.update(dt, this);
    if (this.deathTimer <= 0) this.endRun('destroyed');
  }

  _updateAttract(dt) {
    this.attractT -= dt;
    if (this.attractT <= 0) {
      this.attractT = this.state === 'hangar' ? rand(1.6, 2.8) : rand(0.9, 1.7);
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
    this.fx.muzzle(nx, ny, p.heading, this.shot.color);
    this.audio.shoot(Math.min(4, this.stats.projectiles - 1), this.fx.pan(p.x));
    // Small shake on every shot (capped so rapid fire never stacks into a quake).
    this.camera.addTrauma(0.07, 0.2);
    this.camera.kick(-ca * 70, -sa * 70);
    this.grid.push(nx, ny, ca, sa, 1.1, 80);
  }

  _engine(dt) {
    const p = this.player;
    if (!p.alive || dt <= 0) return;
    const speed = Math.hypot(p.vx, p.vy);
    const power = clamp(speed / this.stats.moveSpeed, 0, 1);
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

  // --- spawning ---------------------------------------------------------------------------

  spawnEnemy(kind, x, y) {
    const e = this.enemies.spawn(kind, x, y, this.director.hpMul, this.director.speedMul);
    if (!e) return null;
    this.fx.spawnPortal(e.x, e.y, e.def.color, e.radius);
    this.audio.spawn(this.fx.pan(e.x));
    return e;
  }

  spawnElite(kind, x, y) {
    const e = this.enemies.spawn(kind, x, y, this.director.hpMul, this.director.speedMul, true);
    if (!e) return null;
    this.fx.eliteSpawn(e.x, e.y, e.def.color, e.radius);
    this.ui.announce(`ELITE ${e.def.label}`, 'DESTROY IT TO CLEAR THE WAVE', 'elite');
    this.borderFlash = 2.5;
    return e;
  }

  elitesAlive() {
    let n = 0;
    for (const e of this.enemies.list) if (e.elite && e.dying <= 0) n++;
    return n;
  }

  /** GUARDIAN DRONE volley: the build's shot profile, half the multishot, 60% damage. */
  fireDrone(d) {
    const n = Math.max(1, Math.ceil(this.stats.projectiles / 2));
    const spread = n > 1 ? Math.min(0.5, 0.09 * (n - 1)) : 0;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      const a = d.aim + t * spread;
      this.bullets.spawn(d.x + Math.cos(a) * 12, d.y + Math.sin(a) * 12, a, this.shot, 0, 0.6, 0.85, 0.8);
    }
    const p = this.fx.p;
    p.spawn(this.fx.F.flare, d.x + Math.cos(d.aim) * 14, d.y + Math.sin(d.aim) * 14, 0, 0, 0.05, 7, 12, 0xffffff, this.shot.color, 2.2, 0, 0, 0, d.aim);
    this.audio.shoot(0, this.fx.pan(d.x) * 0.6);
  }

  // --- damage pipeline --------------------------------------------------------------------
  //
  // Every source of player damage funnels through damageEnemy() -> killEnemy(), which is
  // where on-kill upgrades trigger. Because the trigger only looks at the *shot profile*
  // attached to the damage, mods compose: any projectile kill can explode, any blast kill
  // can cascade, any bolt/arc kill can fragment, and shards carry the same mods.

  bulletHitEnemy(b, e, hx, hy) {
    const shot = b.shot;
    let dmg = shot.damage * b.dmgMul;
    const crit = shot.critChance > 0 && Math.random() < shot.critChance;
    if (crit) dmg *= shot.critMult;
    const push = (150 + 60 * b.size) / e.mass;
    e.vx += Math.cos(b.angle) * push;
    e.vy += Math.sin(b.angle) * push;
    const killed = this.damageEnemy(e, dmg, 'bullet', shot, b.gen, b.dmgMul, b.angle);
    if (!killed) this.fx.bulletImpact(hx, hy, b.angle, e.def.color, e.kind === 'bulwark' || e.elite);
    if (crit) {
      this.fx.crit(hx, hy, b.angle);
      if (this.critPopT <= 0) {
        this.critPopT = 0.12;
        this.fx.popup(hx, hy - 18, 'CRIT', 'crit', 0.9);
      }
    }
    if (shot.chain > 0 && this.arcBudget > 0) this.arcFrom(e, shot, shot.damage * b.dmgMul * shot.chainMul, b.gen, b.dmgMul);
  }

  /** Returns true when the hit killed the enemy. */
  damageEnemy(e, amount, cause, shot = null, gen = 0, dmgMul = 1, angle = 0) {
    if (!e.active || e.dying > 0 || e.spawn > 0) return false;
    this.record.damage += Math.min(amount, e.hp);
    e.hp -= amount;
    e.flash = 0.07;
    if (e.hp > 0) return false;
    this.killEnemy(e, cause, shot, gen, dmgMul, angle);
    return true;
  }

  /**
   * cause: 'bullet' | 'arc' | 'blast' | 'surge' | 'purge' (wave clear) |
   *        'clear' (hull-breach nova) | 'cascade' (game over)
   */
  killEnemy(e, cause, shot = null, gen = 0, dmgMul = 1, angle = rand(0, TAU)) {
    if (!e.active) return;
    const def = e.def;
    const scoring = cause !== 'cascade' && cause !== 'clear';
    this.enemies.remove(e);
    const size = (EXPLOSION_SIZE[e.kind] ?? 1) * (e.elite ? 1.5 : 1);
    this.fx.explosion(e.x, e.y, def.color, size, { quiet: cause === 'cascade' || cause === 'purge' });

    if (scoring) {
      const pts = def.score * (e.elite ? 10 : 1) * this.multiplier;
      this.score += pts;
      if (this.popupBudget > 0) {
        this.popupBudget--;
        const big = size > 1.5;
        this.fx.popup(e.x, e.y - e.radius - 8, fmt(pts), big ? 'big' : 'score', big ? 1.25 : 1);
      }
      if (cause !== 'purge') {
        const chance = def.flux + this.stats.fluxBonus;
        const drops = Math.floor(chance) + (Math.random() < chance % 1 ? 1 : 0) + (e.elite ? 10 : 0);
        if (drops) this.flux.drop(e.x, e.y, drops);
        if (cause !== 'surge') this.addSurge(def.surge * this.stats.surgeGain * (e.elite ? 6 : 1)); // no surge chaining
      }
      this.record.kills++;
      this.killsThisFrame++;
      if (HIT_STOP[e.kind]) this.hitStop(HIT_STOP[e.kind]);
    }

    if (e.elite && scoring) {
      this.run.eliteKills++;
      this.fx.explosion(e.x, e.y, PALETTE.flux, 2.2, { silent: true, quiet: true });
      this.fx.popup(e.x, e.y - e.radius - 34, 'ELITE DESTROYED', 'elite', 1.2);
      this.hitStop(0.06, true);
      this.slowMo(0.35, 2);
      this.flashScreen(PALETTE.flux, 0.35);
      this.chromaPulse(0.02);
      this.camera.addTrauma(0.7);
      this.audio.powerUp();
    }

    // On-kill upgrade triggers.
    if (shot && cause !== 'purge') {
      const byProjectile = cause === 'bullet' || cause === 'arc';
      if (shot.explosive && (byProjectile || (cause === 'blast' && shot.cascade && gen < 4))) {
        this.queueBlast(e.x, e.y, shot, byProjectile ? 0 : gen + 1, dmgMul);
      }
      if (shot.shrapnel && byProjectile && gen === 0) this.spawnShrapnel(e.x, e.y, shot, angle);
    }

    if (e.kind === 'hive' && scoring && cause !== 'purge') {
      const n = Math.round(def.splits * (e.elite ? 2.5 : 1));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(-0.3, 0.3);
        const m = this.enemies.spawn('mite', e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12, 1, this.director.speedMul);
        if (m) {
          m.spawn = 0.06;
          m.vx = Math.cos(a) * 460;
          m.vy = Math.sin(a) * 460;
        }
      }
    }
  }

  /** VOLATILE ROUNDS: schedule an AoE blast. Cascade links detonate slightly later. */
  queueBlast(x, y, shot, gen, dmgMul) {
    if (this.blasts.length >= BLAST_CAP) return;
    this.blasts.push({
      x, y, gen, dmgMul, shot,
      radius: shot.blastRadius * (gen ? 0.9 : 1),
      damage: shot.damage * dmgMul * shot.blastMul * Math.pow(0.8, gen),
      delay: gen ? rand(0.05, 0.09) : 0,
    });
  }

  _updateBlasts(dt) {
    let budget = 36; // detonations per frame; the rest wait a frame
    const list = this.blasts;
    for (let i = 0; i < list.length && budget > 0;) {
      const b = list[i];
      b.delay -= dt;
      if (b.delay > 0) {
        i++;
        continue;
      }
      list[i] = list[list.length - 1];
      list.pop();
      budget--;
      this._detonate(b);
    }
  }

  _detonate(b) {
    this.fx.blast(b.x, b.y, b.radius, b.gen);
    const near = this.hash.query(b.x, b.y, b.radius + 80, this.blastNear);
    for (let k = 0; k < near.length; k++) {
      const e = near[k];
      if (!e.active || e.dying > 0 || e.spawn > 0) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = b.radius + e.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > rr * rr) continue;
      const d = Math.sqrt(d2) || 1;
      const push = 420 / e.mass;
      e.vx += (dx / d) * push;
      e.vy += (dy / d) * push;
      this.damageEnemy(e, b.damage, 'blast', b.shot, b.gen, b.dmgMul, Math.atan2(dy, dx));
    }
    this.orbs.popWithin(b.x, b.y, b.radius, this);
  }

  /** ARC COIL: lightning hops from enemy to enemy. */
  arcFrom(src, shot, dmg, gen, dmgMul) {
    const hit = this.arcHit;
    hit.length = 0;
    hit.push(src);
    let fx = src.x;
    let fy = src.y;
    const r2 = shot.chainRange * shot.chainRange;
    for (let j = 0; j < shot.chain && this.arcBudget > 0; j++) {
      const near = this.hash.query(fx, fy, shot.chainRange, this.arcNear);
      let best = null;
      let bestD = r2;
      for (let k = 0; k < near.length; k++) {
        const e = near[k];
        if (!e.active || e.dying > 0 || e.spawn > 0 || hit.includes(e)) continue;
        const d2 = (e.x - fx) ** 2 + (e.y - fy) ** 2;
        if (d2 < bestD) {
          bestD = d2;
          best = e;
        }
      }
      if (!best) break;
      this.arcBudget--;
      hit.push(best);
      const bx = best.x;
      const by = best.y;
      this.fx.arc(fx, fy, bx, by);
      this.damageEnemy(best, dmg, 'arc', shot, gen, dmgMul, Math.atan2(by - fy, bx - fx));
      fx = bx;
      fy = by;
    }
  }

  /** FRAGMENTATION: shards radiate from the kill and inherit the full shot profile. */
  spawnShrapnel(x, y, shot, angle) {
    if (this.bullets.free.length < 200) return; // the main gun always keeps priority
    const n = shot.shrapnel;
    for (let i = 0; i < n; i++) {
      const a = angle + (i / n) * TAU + rand(-0.25, 0.25);
      this.bullets.spawn(x + Math.cos(a) * 10, y + Math.sin(a) * 10, a, shot, 1, shot.shrapnelMul, 0.4, 0.7);
    }
  }

  _enemyContact() {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    const near = this.hash.query(p.x, p.y, p.radius + 80, this.contactNear);
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

    if (this.shieldCharges > 0) {
      // DEFLECTOR: absorb the hit, shove everything back.
      this.shieldCharges--;
      p.invuln = PLAYER.shieldInvuln;
      this.fx.shieldBlock(p.x, p.y);
      this.fx.popup(p.x, p.y - 52, 'DEFLECTED', 'shield', 1);
      this.hitStop(0.04, true);
      this.flashScreen(PALETTE.shield, 0.3);
      this.chromaPulse(0.015);
      this.orbs.popWithin(p.x, p.y, 340, this);
      for (const e of this.enemies.list) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 320) {
          const push = (1100 * (1 - d / 320) + 250) / e.mass;
          e.vx += (dx / d) * push;
          e.vy += (dy / d) * push;
        }
      }
      return;
    }

    this.hull--;
    this.multiplier = 1;
    this.fx.playerHit(p.x, p.y);
    this.hitStop(0.05, true);
    this.slowMo(0.2, 1.7);
    this.flashScreen(PALETTE.danger, 0.65);
    this.chromaPulse(0.03);
    const list = this.enemies.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.elite && Math.hypot(e.x - p.x, e.y - p.y) < 420) this.killEnemy(e, 'clear');
    }
    this.orbs.clear();
    if (this.hull <= 0) {
      this.die();
      return;
    }
    p.invuln = PLAYER.invulnTime;
    this.ui.announce(this.hull === 1 ? 'HULL CRITICAL' : `${this.hull} HULL LEFT`, 'HULL BREACH', 'danger');
  }

  // --- scoring ----------------------------------------------------------------------------

  collectFlux(f) {
    const before = this.multiplier;
    this.multiplier = Math.min(FLUX.maxMultiplier, this.multiplier + 1);
    this.record.maxMult = Math.max(this.record.maxMult, this.multiplier);
    this.addSurge(SURGE.fluxGain * this.stats.surgeGain);
    this.fx.fluxCollect(f.x, f.y, this.multiplier);
    for (const m of MULT_MILESTONES) {
      if (before < m && this.multiplier >= m) {
        const p = this.player;
        this.fx.popup(p.x, p.y - 46, `×${m}`, 'mult', 1.5);
        this.fx.ascend(p.x, p.y, PALETTE.flux);
        this.audio.powerUp();
      }
    }
  }

  addSurge(v) {
    const before = this.surge;
    this.surge = Math.min(1, this.surge + v);
    if (before < 1 && this.surge >= 1 && this.state === 'playing') {
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
    this.record.surges++;
    this.surgeWave = { x: p.x, y: p.y, r: 0 };
    p.invuln = Math.max(p.invuln, 0.9);
    this.fx.surgeNova(p.x, p.y);
    this.hitStop(0.05, true);
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
      if (dx * dx + dy * dy >= r2 || e.dying > 0) continue;
      // Elites shrug off the surge: heavy damage instead of an instant kill.
      if (e.elite) {
        if (!e.surgeHit) {
          e.surgeHit = true;
          this.damageEnemy(e, e.maxHp * 0.35, 'surge');
        }
        continue;
      }
      this.killEnemy(e, 'surge');
    }
    for (let i = this.orbs.active.length - 1; i >= 0; i--) {
      const o = this.orbs.active[i];
      if ((o.x - w.x) ** 2 + (o.y - w.y) ** 2 < r2) this.orbs.pop(o, this);
    }
    if (w.r > SURGE.maxRadius) {
      this.surgeWave = null;
      for (const e of list) e.surgeHit = false;
    }
  }

  onSetPiece(type) {
    this.ui.announce(SET_PIECE_NAMES[type] ?? 'INCOMING', 'INCOMING FORMATION', 'wave');
    this.audio.alarm();
    this.borderFlash = 2.5;
  }

  // --- feel helpers -----------------------------------------------------------------------

  /**
   * Freeze the simulation for a few frames (30-70 ms). Routine kill hit-stops respect a
   * short cooldown so kill-heavy builds don't stutter; big moments pass force = true.
   */
  hitStop(seconds, force = false) {
    if (!force && this.hitStopCD > 0) return;
    this.freeze = Math.max(this.freeze, seconds);
    this.hitStopCD = seconds + 0.12;
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
    const state = this.state;
    cam.apply(this.world, W, H);
    const beat = this.audio.music && this.audio.music.playing ? this.audio.music.pulse() : 0;

    const danger = state === 'playing' && this.hull === 1 && this.shieldCharges === 0;
    this.backdrop.update(W, H, this.clock, cam.x, cam.y, danger ? [0.25, 0.0, 0.05, 0.3 + 0.2 * Math.sin(this.clock * 4)] : [0, 0, 0, 0]);

    // Grid lighting.
    const lights = this.persistentLights;
    lights.length = 0;
    const p = this.player;
    const shipVisible = p.alive && (state === 'playing' || state === 'paused' || state === 'roundClear' || state === 'upgrade');
    if (shipVisible) {
      const L = this.playerLight;
      L.x = p.x;
      L.y = p.y;
      L.intensity = 0.26 + p.fireHeat * 0.16 + p.thrust * 0.08;
      lights.push(L);
    }
    this.grid.setLights(this.lights.collect(lights));
    this.grid.params[0] = 1 + beat * 0.3 + Math.min(1, this.borderFlash) * 0.4;
    this.grid.updateMesh(cam.x, cam.y);
    this.trail.rebuild(shipVisible ? 1.9 : 0);

    // World sprites (one draw call).
    const L = this.layer;
    L.begin();
    this._drawArena(L, beat);
    this.flux.draw(L, this.clock);
    this.enemies.draw(L, this.clock);
    this.orbs.draw(L);
    this.bullets.draw(L, this.atlas);
    this.arcs.draw(L);
    if (shipVisible) {
      this.drones.draw(L, this.clock);
      p.draw(L, this.clock, this.shieldCharges);
      if (state === 'playing') {
        if (this.input.device === 'gamepad') {
          const d = 190;
          L.sprite('reticle', p.x + Math.cos(p.heading) * d, p.y + Math.sin(p.heading) * d, this.clock, 15, PALETTE.player, 1.4);
        } else {
          p.drawSight(L);
        }
      }
    }
    this.particles.draw(L);
    L.end();

    // Screen-space overlay (mouse reticle).
    const O = this.overlay;
    O.begin();
    if (state === 'playing' && this.input.device === 'mouse') {
      const s = W / pipe.cssWidth;
      const mx = this.input.mouseX * s;
      const my = this.input.mouseY * s;
      const r = 17 * s * (1 + p.fireHeat * 0.22);
      O.sprite('reticleGlow', mx, my, this.clock * 0.9, r * 1.1, PALETTE.player, 0.8);
      O.sprite('reticle', mx, my, this.clock * 0.9, r, 0xe8fdff, 1.9);
    }
    O.end();

    // DOM combat text follows the camera (and its shake).
    this.popups.render(cam, W / pipe.cssWidth);

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
    const dyingT = state === 'dying' ? 1 - this.deathTimer / 3 : 0;
    post.desaturate = state === 'hangar' ? 0.45 : state === 'upgrade' ? 0.25 : dyingT * 0.45;
    post.fade = { paused: 0.38, upgrade: 0.5, hangar: 0.3, title: 0.12 }[state] ?? 0;
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

  _pushHud(realDt) {
    this.shardEstimateT -= realDt;
    if (this.shardEstimateT <= 0) {
      this.shardEstimateT = 0.25;
      this.shardEstimate = computeRewards({
        time: this.record.time,
        wavesCleared: this.run.wavesCleared,
        score: this.score,
        eliteKills: this.run.eliteKills,
        bonus: this.run.bonusShards,
      }, this.stats.shardMul).total;
    }
    const d = this.director;
    this.ui.updateHud({
      score: Math.round(this.displayScore),
      best: Math.max(this.meta.records.bestScore, this.score),
      multiplier: this.multiplier,
      hull: this.hull,
      maxHull: this.stats.maxHull,
      shield: this.shieldCharges,
      maxShield: this.stats.shield,
      surge: this.surge,
      wave: this.run.round,
      timeLeft: Math.ceil(d.timeLeft),
      timeFrac: this.state === 'roundClear' ? 0 : d.timeLeft / d.duration,
      overtime: d.overtime && this.state === 'playing',
      cleared: this.state === 'roundClear',
      shards: this.shardEstimate,
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
}
