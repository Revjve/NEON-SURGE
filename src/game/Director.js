import { ARENA, DIRECTOR, ENEMIES } from '../config.js';
import { rand, randInt, pick } from '../core/math.js';

// How each archetype arrives: relative frequency, group size (grows with threat), spread.
const GROUPS = {
  dart: { weight: 10, size: (t) => randInt(3, 4 + Math.min(6, Math.floor(t))), spread: 60 },
  wisp: { weight: 6, size: (t) => randInt(2, 3 + Math.min(3, Math.floor(t / 2))), spread: 55 },
  lancer: { weight: 5, size: (t) => randInt(1, 2 + Math.min(2, Math.floor(t / 3))), spread: 90 },
  bulwark: { weight: 3, size: (t) => randInt(1, 1 + Math.min(2, Math.floor(t / 4))), spread: 110 },
  hive: { weight: 4, size: (t) => randInt(1, 2 + Math.min(1, Math.floor(t / 5))), spread: 90 },
  sentry: { weight: 3, size: (t) => randInt(1, 1 + Math.min(2, Math.floor(t / 5))), spread: 160 },
};

const INSET = 46;

/**
 * Spawn director. "Threat" rises with both score and survival time; it feeds the spawn
 * budget, the population cap, which archetypes unlock, and enemy speed / toughness.
 * Every `waveEvery` seconds it stages a telegraphed set-piece wave.
 */
export class Director {
  constructor() {
    this.reset();
  }

  reset() {
    this.time = 0;
    this.budget = DIRECTOR.openingBudget;
    this.threat = 0;
    this.level = 1;
    this.waveTimer = DIRECTOR.waveEvery;
    this.waveCount = 0;
    this.queue = [];
    this.pending = null;
  }

  get speedMul() {
    return 1 + DIRECTOR.speedPerThreat * Math.min(this.threat, DIRECTOR.speedThreatCap);
  }

  get hpMul() {
    return 1 + DIRECTOR.hpPerThreat * this.threat;
  }

  get maxAlive() {
    return Math.min(DIRECTOR.maxAliveCap, DIRECTOR.maxAliveBase + DIRECTOR.maxAlivePerThreat * this.threat);
  }

  update(dt, game) {
    this.time += dt;
    this.threat = Math.sqrt(game.progress / DIRECTOR.progressDiv) + this.time / DIRECTOR.timeDiv;
    const level = 1 + Math.floor(this.threat);
    if (level > this.level) {
      this.level = level;
      game.onThreatLevel(level);
    }

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        game.spawnEnemy(q.kind, q.x, q.y);
        this.queue.splice(i, 1);
      }
    }

    if (this.time < DIRECTOR.graceTime) return;

    const rate = Math.min(DIRECTOR.budgetMax, DIRECTOR.budgetBase + DIRECTOR.budgetPerThreat * this.threat);
    this.budget = Math.min(this.budget + rate * dt, 14);
    if (!this.pending) this.pending = this._pickGroup();
    const alive = game.enemies.count + this.queue.length;
    if (alive < this.maxAlive && this.budget >= this.pending.cost) {
      this.budget -= this.pending.cost;
      this._spawnGroup(game, this.pending.kind, this.pending.size);
      this.pending = null;
    }

    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = DIRECTOR.waveEvery;
      this._launchWave(game);
    }
  }

  _pickGroup() {
    const t = this.threat;
    let total = 0;
    const options = [];
    for (const kind in GROUPS) {
      if (ENEMIES[kind].unlock > t) continue;
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
    const size = GROUPS[kind].size(t);
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

  _launchWave(game) {
    this.waveCount++;
    const t = this.threat;
    const types = ['swarm', 'pincer'];
    if (t >= 1.5) types.push('lancers');
    if (t >= 2.5) types.push('siege');
    if (t >= 4) types.push('crossfire');
    const type = pick(types);
    const n = Math.floor(t);
    switch (type) {
      case 'swarm': {
        const per = 3 + Math.min(8, n);
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
        const per = 4 + Math.min(7, n);
        for (const edge of horizontal ? [1, 3] : [0, 2]) {
          for (let i = 0; i < per; i++) {
            const [x, y] = this._edgePoint(edge, (i + 0.5) / per);
            this._enqueue(i % 2 && t > 0.7 ? 'wisp' : 'dart', x, y, 0.35 + i * 0.08);
          }
        }
        break;
      }
      case 'lancers': {
        const corners = [[INSET, INSET], [ARENA.w - INSET, INSET], [INSET, ARENA.h - INSET], [ARENA.w - INSET, ARENA.h - INSET]];
        const per = 1 + Math.min(2, Math.floor(n / 3));
        corners.forEach(([x, y], ci) => {
          for (let i = 0; i < per; i++) this._enqueue('lancer', x + rand(-30, 30), y + rand(-30, 30), 0.35 + ci * 0.12 + i * 0.1);
        });
        break;
      }
      case 'siege': {
        const edge = randInt(0, 3);
        const tanks = 3 + Math.min(3, Math.floor(n / 3));
        for (let i = 0; i < tanks; i++) {
          const [x, y] = this._edgePoint(edge, (i + 0.5) / tanks);
          this._enqueue('bulwark', x, y, 0.35 + i * 0.1);
        }
        const [hx, hy] = this._edgePoint((edge + 2) % 4, 0.5);
        this._enqueue('hive', hx, hy, 0.8);
        this._enqueue('hive', hx + 90, hy, 0.9);
        break;
      }
      default: { // crossfire
        const corners = [[INSET, INSET], [ARENA.w - INSET, INSET], [INSET, ARENA.h - INSET], [ARENA.w - INSET, ARENA.h - INSET]];
        corners.forEach(([x, y], i) => this._enqueue('sentry', x, y, 0.35 + i * 0.12));
        for (let i = 0; i < 6; i++) {
          const [x, y] = this._edgePoint(randInt(0, 3), rand(0.2, 0.8));
          this._enqueue('dart', x, y, 0.9 + i * 0.06);
        }
      }
    }
    game.onWave(this.waveCount, type);
  }
}
