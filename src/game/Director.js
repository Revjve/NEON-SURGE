import { ARENA, ENEMIES, ROUNDS } from '../config.js';
import { rand, randInt, pick } from '../core/math.js';

// How each archetype arrives: relative frequency, group size (grows with the round), spread.
const GROUPS = {
  dart: { weight: 10, size: (k) => randInt(3, 4 + Math.min(6, Math.floor(k * 0.7))), spread: 60 },
  wisp: { weight: 6, size: (k) => randInt(2, 3 + Math.min(3, Math.floor(k / 3))), spread: 55 },
  lancer: { weight: 5, size: (k) => randInt(1, 1 + Math.min(3, Math.floor(k / 3))), spread: 90 },
  bulwark: { weight: 3, size: (k) => randInt(1, 1 + Math.min(2, Math.floor(k / 6))), spread: 110 },
  hive: { weight: 4, size: (k) => randInt(1, 2 + Math.min(1, Math.floor(k / 7))), spread: 90 },
  sentry: { weight: 3, size: (k) => randInt(1, 1 + Math.min(2, Math.floor(k / 7))), spread: 160 },
};

// Telegraphed set pieces and the first round each can appear in.
const SET_PIECES = [['swarm', 1], ['pincer', 2], ['lancers', 3], ['siege', 4], ['crossfire', 6]];
const ELITE_KINDS = ['bulwark', 'sentry', 'hive', 'lancer'];
const INSET = 46;

/**
 * Round-based spawn director. Difficulty is a pure function of the round number; the
 * player's power curve comes from the upgrades picked between rounds. A round lasts a
 * fixed time, then ends as soon as its elites (every Nth round) are destroyed.
 */
export class Director {
  constructor() {
    this.reset();
  }

  reset() {
    this.round = 0;
    this.time = 0;
    this.duration = ROUNDS.firstDuration;
    this.budget = 0;
    this.queue = [];
    this.pending = null;
    this.finished = false;
    this.overtime = false;
    this.setPieces = [];
    this.eliteCount = 0;
    this.eliteAt = Infinity;
    this.eliteKind = null;
    this.newKinds = [];
  }

  /** Prepare round `n` (1-based). Returns a description for the round intro. */
  startRound(n) {
    this.reset();
    this.round = n;
    this.duration = Math.min(ROUNDS.maxDuration, ROUNDS.firstDuration + ROUNDS.durationStep * (n - 1));
    this.budget = ROUNDS.openingBudget + Math.min(6, this.k * 0.5);
    this.newKinds = Object.keys(ENEMIES).filter((k) => ENEMIES[k].unlockRound === n);
    if (n >= 2) this.setPieces.push(this.duration * rand(0.35, 0.55));
    if (n >= 9) this.setPieces.push(this.duration * rand(0.72, 0.82));
    if (n % ROUNDS.eliteEvery === 0) {
      const kinds = ELITE_KINDS.filter((k) => ENEMIES[k].unlockRound <= n);
      this.eliteKind = pick(kinds.length ? kinds : ['bulwark']);
      this.eliteCount = 1 + Math.floor(n / 10);
      this.eliteAt = Math.max(ROUNDS.grace + 1.5, this.duration * 0.18);
    }
    return { round: n, duration: this.duration, newKinds: this.newKinds, elite: this.eliteCount > 0 ? this.eliteKind : null };
  }

  /** Rounds completed before this one: the difficulty axis. */
  get k() {
    return Math.max(0, this.round - 1);
  }

  /** Legacy-style threat scalar used by a few enemy behaviours (sentry fire rate). */
  get threat() {
    return this.k * 0.7;
  }

  get speedMul() {
    return 1 + ROUNDS.speedPerRound * Math.min(this.k, ROUNDS.speedRoundCap);
  }

  get hpMul() {
    const k = this.k;
    return 1 + ROUNDS.hpLinear * k + ROUNDS.hpQuadratic * k * k;
  }

  get maxAlive() {
    return Math.min(ROUNDS.maxAliveCap, ROUNDS.maxAliveBase + ROUNDS.maxAlivePerRound * this.k);
  }

  get timeLeft() {
    return Math.max(0, this.duration - this.time);
  }

  get progress() {
    return Math.min(1, this.time / this.duration);
  }

  update(dt, game) {
    if (this.finished || this.round === 0) return;
    this.time += dt;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        game.spawnEnemy(q.kind, q.x, q.y);
        this.queue.splice(i, 1);
      }
    }

    if (this.time < ROUNDS.grace) return;

    if (this.eliteCount > 0 && this.time >= this.eliteAt) {
      this._spawnElites(game);
      this.eliteCount = 0;
    }

    const over = this.time >= this.duration;
    if (over) {
      // Time is up. Elite rounds go into overtime until every elite is destroyed.
      if (game.elitesAlive() > 0) {
        this.overtime = true;
      } else {
        this.finished = true;
        this.queue.length = 0;
        return;
      }
    }

    const k = this.k;
    const base = Math.min(ROUNDS.budgetMax, ROUNDS.budgetBase + ROUNDS.budgetPerRound * k);
    const ramp = over ? 0.45 : 0.75 + 0.5 * this.progress; // each round builds to a climax
    this.budget = Math.min(this.budget + base * ramp * dt, 14 + k);
    if (!this.pending) this.pending = this._pickGroup();
    const alive = game.enemies.count + this.queue.length;
    if (alive < this.maxAlive && this.budget >= this.pending.cost) {
      this.budget -= this.pending.cost;
      this._spawnGroup(game, this.pending.kind, this.pending.size);
      this.pending = null;
    }

    if (!over && this.setPieces.length && this.time >= this.setPieces[0]) {
      this.setPieces.shift();
      this._launchSetPiece(game);
    }
  }

  _pickGroup() {
    const n = this.round;
    let total = 0;
    const options = [];
    for (const kind in GROUPS) {
      if (ENEMIES[kind].unlockRound > n) continue;
      const w = GROUPS[kind].weight;
      options.push([kind, w]);
      total += w;
    }
    let roll = Math.random() * total;
    let kind = 'dart';
    for (const [k, w] of options) {
      roll -= w;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    const size = GROUPS[kind].size(this.k);
    return { kind, size, cost: size * ENEMIES[kind].cost };
  }

  /** A point on an arena edge (0 top, 1 right, 2 bottom, 3 left), `u` in 0..1. */
  _edgePoint(edge, u) {
    switch (edge) {
      case 0: return [INSET + u * (ARENA.w - INSET * 2), INSET];
      case 1: return [ARENA.w - INSET, INSET + u * (ARENA.h - INSET * 2)];
      case 2: return [INSET + u * (ARENA.w - INSET * 2), ARENA.h - INSET];
      default: return [INSET, INSET + u * (ARENA.h - INSET * 2)];
    }
  }

  /** Random edge point at least `minDist` from the player (fairness). */
  _safeEdgePoint(game, minDist = 380) {
    const p = game.player;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 8; i++) {
      const pt = this._edgePoint(randInt(0, 3), rand(0.05, 0.95));
      const d = Math.hypot(pt[0] - p.x, pt[1] - p.y);
      if (d >= minDist) return pt;
      if (d > bestD) {
        bestD = d;
        best = pt;
      }
    }
    return best;
  }

  _enqueue(kind, x, y, delay) {
    this.queue.push({ kind, x, y, delay });
  }

  _spawnGroup(game, kind, size) {
    const [cx, cy] = this._safeEdgePoint(game);
    const spread = GROUPS[kind].spread;
    for (let i = 0; i < size; i++) {
      const a = (i / size) * Math.PI * 2 + rand(-0.4, 0.4);
      const d = i === 0 ? 0 : spread * (0.6 + Math.random() * 0.6);
      this._enqueue(kind, cx + Math.cos(a) * d, cy + Math.sin(a) * d, i * 0.07);
    }
  }

  _spawnElites(game) {
    for (let i = 0; i < this.eliteCount; i++) {
      const [x, y] = this._safeEdgePoint(game, 600);
      game.spawnElite(this.eliteKind, x, y);
    }
  }

  _launchSetPiece(game) {
    const n = this.round;
    const k = this.k;
    const type = pick(SET_PIECES.filter(([, r]) => r <= n).map(([t]) => t));
    switch (type) {
      case 'swarm': {
        const per = 3 + Math.min(8, Math.floor(k * 0.8));
        for (let edge = 0; edge < 4; edge++) {
          for (let i = 0; i < per; i++) {
            const [x, y] = this._edgePoint(edge, (i + 0.5) / per);
            this._enqueue('dart', x, y, 0.35 + i * 0.05);
          }
        }
        break;
      }
      case 'pincer': {
        const horizontal = Math.random() < 0.5;
        const per = 4 + Math.min(7, Math.floor(k * 0.7));
        for (const edge of horizontal ? [1, 3] : [0, 2]) {
          for (let i = 0; i < per; i++) {
            const [x, y] = this._edgePoint(edge, (i + 0.5) / per);
            this._enqueue(i % 2 ? 'wisp' : 'dart', x, y, 0.35 + i * 0.08);
          }
        }
        break;
      }
      case 'lancers': {
        const corners = [[INSET, INSET], [ARENA.w - INSET, INSET], [INSET, ARENA.h - INSET], [ARENA.w - INSET, ARENA.h - INSET]];
        const per = 1 + Math.min(2, Math.floor(k / 4));
        corners.forEach(([x, y], ci) => {
          for (let i = 0; i < per; i++) this._enqueue('lancer', x + rand(-30, 30), y + rand(-30, 30), 0.35 + ci * 0.12 + i * 0.1);
        });
        break;
      }
      case 'siege': {
        const edge = randInt(0, 3);
        const tanks = 3 + Math.min(3, Math.floor(k / 4));
        for (let i = 0; i < tanks; i++) {
          const [x, y] = this._edgePoint(edge, (i + 0.5) / tanks);
          this._enqueue('bulwark', x, y, 0.35 + i * 0.1);
        }
        const [hx, hy] = this._edgePoint((edge + 2) % 4, 0.5);
        if (n >= ENEMIES.hive.unlockRound) {
          this._enqueue('hive', hx, hy, 0.8);
          this._enqueue('hive', hx + 90, hy, 0.9);
        }
        break;
      }
      default: { // crossfire
        const corners = [[INSET, INSET], [ARENA.w - INSET, INSET], [INSET, ARENA.h - INSET], [ARENA.w - INSET, ARENA.h - INSET]];
        corners.forEach(([x, y], i) => this._enqueue('sentry', x, y, 0.35 + i * 0.12));
        for (let i = 0; i < 6 + Math.min(6, k - 5); i++) {
          const [x, y] = this._edgePoint(randInt(0, 3), rand(0.2, 0.8));
          this._enqueue('dart', x, y, 0.9 + i * 0.06);
        }
      }
    }
    game.onSetPiece(type);
  }
}
