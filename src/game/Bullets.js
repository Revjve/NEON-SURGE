import { ARENA, WEAPON, PALETTE } from '../config.js';

const MAX_ENEMY_RADIUS = 48;

/** Player plasma bolts. Segment-vs-circle tests so fast bolts never tunnel. */
export class PlayerBullets {
  constructor(capacity = 420) {
    this.items = Array.from({ length: capacity }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, angle: 0, life: 0, pierce: 0, color: 0, lastHit: null, age: 0,
    }));
    this.active = [];
  }

  clear() {
    for (const b of this.active) b.active = false;
    this.active.length = 0;
  }

  spawn(x, y, angle, speed, pierce, color) {
    const b = this.items.find((it) => !it.active);
    if (!b) return null;
    b.active = true;
    b.x = x;
    b.y = y;
    b.angle = angle;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.life = WEAPON.bulletLife;
    b.pierce = pierce;
    b.color = color;
    b.lastHit = null;
    b.age = 0;
    this.active.push(b);
    return b;
  }

  update(dt, game) {
    const list = this.active;
    const hash = game.hash;
    const R = WEAPON.bulletRadius;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const x0 = b.x;
      const y0 = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.age += dt;
      let dead = b.life <= 0;

      // Arena walls.
      if (!dead && (b.x < 0 || b.x > ARENA.w || b.y < 0 || b.y > ARENA.h)) {
        const hx = Math.min(ARENA.w, Math.max(0, b.x));
        const hy = Math.min(ARENA.h, Math.max(0, b.y));
        const nx = b.x < 0 ? 1 : b.x > ARENA.w ? -1 : 0;
        const ny = b.y < 0 ? 1 : b.y > ARENA.h ? -1 : 0;
        game.fx.wallImpact(hx, hy, nx, ny, b.color);
        dead = true;
      }

      // Enemies along the swept segment.
      if (!dead) {
        const sx = b.x - x0;
        const sy = b.y - y0;
        const segLen2 = sx * sx + sy * sy || 1;
        const cand = hash.query((x0 + b.x) / 2, (y0 + b.y) / 2, Math.sqrt(segLen2) / 2 + R + MAX_ENEMY_RADIUS);
        let best = null;
        let bestT = 2;
        for (let k = 0; k < cand.length; k++) {
          const e = cand[k];
          if (!e.active || e.spawn > 0 || e.dying > 0 || e === b.lastHit) continue;
          let t = ((e.x - x0) * sx + (e.y - y0) * sy) / segLen2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = x0 + sx * t - e.x;
          const cy = y0 + sy * t - e.y;
          const rr = e.radius + R;
          if (cx * cx + cy * cy <= rr * rr && t < bestT) {
            best = e;
            bestT = t;
          }
        }
        if (best) {
          const hx = x0 + sx * bestT;
          const hy = y0 + sy * bestT;
          game.bulletHitEnemy(b, best, hx, hy);
          if (b.pierce > 0) {
            b.pierce--;
            b.lastHit = best;
          } else {
            dead = true;
          }
        }
      }

      // Enemy orbs can be shot down.
      if (!dead) {
        const orb = game.orbs.hitTest(b.x, b.y, R);
        if (orb) {
          game.orbs.pop(orb, game);
          dead = true;
        }
      }

      if (dead) {
        b.active = false;
        list[i] = list[list.length - 1];
        list.pop();
      } else if ((b.age * 60) % 2 < 1) {
        // Plasma drags the lattice along with it.
        game.grid.push(b.x, b.y, b.vx / 1650, b.vy / 1650, 0.55, 70);
      }
    }
  }

  draw(layer, atlas) {
    const frame = atlas.frames.bullet;
    for (const b of this.active) {
      const grow = Math.min(1, b.age * 25);
      layer.draw(frame, b.x, b.y, b.angle, 0.78 * grow, 0.62, b.color, 3.4);
    }
  }
}

/** Hostile energy orbs fired by Sentries. */
export class EnemyShots {
  constructor(capacity = 160) {
    this.items = Array.from({ length: capacity }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, t: 0 }));
    this.active = [];
    this.radius = 10;
    this.color = 0xff4d6d;
  }

  clear() {
    for (const o of this.active) o.active = false;
    this.active.length = 0;
  }

  spawn(x, y, angle, speed) {
    const o = this.items.find((it) => !it.active);
    if (!o) return;
    Object.assign(o, { active: true, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 6, t: 0 });
    this.active.push(o);
  }

  hitTest(x, y, r) {
    const rr = r + this.radius;
    for (const o of this.active) {
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy < rr * rr) return o;
    }
    return null;
  }

  pop(o, game) {
    if (!o.active) return;
    game.fx.orbPop(o.x, o.y, this.color);
    o.active = false;
    const i = this.active.indexOf(o);
    if (i >= 0) {
      this.active[i] = this.active[this.active.length - 1];
      this.active.pop();
    }
  }

  update(dt, game) {
    const p = game.player;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.life -= dt;
      o.t += dt;
      const out = o.x < -20 || o.x > ARENA.w + 20 || o.y < -20 || o.y > ARENA.h + 20;
      if (o.life <= 0 || out) {
        o.active = false;
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }
      if (p.alive && p.invuln <= 0) {
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        const rr = this.radius * 0.8 + p.radius;
        if (dx * dx + dy * dy < rr * rr) {
          this.pop(o, game);
          game.hurtPlayer(); // clears every orb, so stop iterating this frame
          return;
        }
      }
    }
  }

  draw(layer) {
    for (const o of this.active) {
      const pulse = 0.8 + 0.2 * Math.sin(o.t * 22);
      layer.sprite('glow', o.x, o.y, 0, 34 * pulse, this.color, 0.9);
      layer.sprite('ring', o.x, o.y, o.t * 6, 11, this.color, 2.2);
      layer.sprite('dot', o.x, o.y, 0, 7, PALETTE.white, 2.6 * pulse);
    }
  }
}
