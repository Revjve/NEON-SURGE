import { ARENA, FLUX, PALETTE } from '../config.js';
import { rand, TAU } from '../core/math.js';

/** Energy shards dropped by kills. Collecting them raises the score multiplier. */
export class Flux {
  constructor(capacity = 320) {
    this.items = Array.from({ length: capacity }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, spin: 0, age: 0 }));
    this.active = [];
  }

  clear() {
    for (const f of this.active) f.active = false;
    this.active.length = 0;
  }

  drop(x, y, count) {
    for (let i = 0; i < count; i++) {
      const f = this.items.find((it) => !it.active);
      if (!f) return;
      const a = rand(0, TAU);
      const s = rand(90, 260);
      Object.assign(f, { active: true, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: FLUX.life, spin: rand(0, TAU), age: 0 });
      this.active.push(f);
    }
  }

  update(dt, game) {
    const p = game.player;
    // Wave cleared: every shard is vacuumed to the ship.
    const vacuum = game.state === 'roundClear';
    const magnet = vacuum ? 5000 : (game.stats?.magnet ?? FLUX.magnetRadius) * (game.surgeWave ? 6 : 1);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.life -= dt;
      f.age += dt;
      f.spin += dt * 4;
      let drag = 2.4;
      if (p.alive && f.age > 0.25) {
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < FLUX.collectRadius + p.radius) {
          game.collectFlux(f);
          f.active = false;
        } else if (d < magnet) {
          const pull = vacuum ? 5200 : 3200 * (1 - d / magnet) + 900;
          f.vx += (dx / d) * pull * dt;
          f.vy += (dy / d) * pull * dt;
          drag = 3.2;
        }
      }
      const k = Math.exp(-drag * dt);
      f.vx *= k;
      f.vy *= k;
      f.x = Math.min(ARENA.w - 6, Math.max(6, f.x + f.vx * dt));
      f.y = Math.min(ARENA.h - 6, Math.max(6, f.y + f.vy * dt));
      if (vacuum) f.life = Math.max(f.life, 1);
      if (!f.active || f.life <= 0) {
        f.active = false;
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }
  }

  draw(layer, time) {
    for (const f of this.active) {
      const blink = f.life < 2 ? (Math.sin(time * 26) > 0 ? 1 : 0.2) : 1;
      const pulse = 0.85 + 0.15 * Math.sin(time * 8 + f.spin);
      layer.sprite('glow', f.x, f.y, 0, 24, PALETTE.flux, 0.45 * blink);
      layer.sprite('flux', f.x, f.y, f.spin, 8.5 * pulse, PALETTE.flux, 2.4 * blink);
    }
  }
}
