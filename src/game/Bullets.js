import { ARENA, PALETTE } from '../config.js';
import { angleDiff } from '../core/math.js';

const MAX_ENEMY_RADIUS = 80; // elites are big

/**
 * Player projectiles. Every bolt references the build's shared shot profile (damage,
 * pierce, bounces, explosive, homing...) plus a few per-bolt values, so main-gun bolts,
 * multishot extras, drone bolts and shrapnel all carry the same mods. Collision uses a
 * swept segment-vs-circle test so fast bolts never tunnel.
 */
export class PlayerBullets {
  constructor(capacity = 1400) {
    this.items = Array.from({ length: capacity }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, angle: 0, speed: 0, life: 0, age: 0, radius: 7, size: 1,
      pierce: 0, bounces: 0, gen: 0, dmgMul: 1, color: 0, lastHit: null, shot: null, target: null, seekT: 0,
    }));
    this.free = this.items.slice().reverse();
    this.active = [];
    this.near = [];
    this.seekNear = [];
  }

  clear() {
    for (const b of this.active) this._release(b);
    this.active.length = 0;
  }

  _release(b) {
    b.active = false;
    b.shot = null;
    b.target = null;
    b.lastHit = null;
    this.free.push(b);
  }

  /**
   * @param shot    shot profile from buildShot()
   * @param gen     0 = fired bolt, 1 = shrapnel (does not fragment again)
   * @param dmgMul  damage scale (drones, shrapnel)
   */
  spawn(x, y, angle, shot, gen = 0, dmgMul = 1, lifeMul = 1, sizeMul = 1) {
    const b = this.free.pop();
    if (!b) return null;
    b.active = true;
    b.x = x;
    b.y = y;
    b.angle = angle;
    b.speed = shot.speed;
    b.vx = Math.cos(angle) * shot.speed;
    b.vy = Math.sin(angle) * shot.speed;
    b.life = shot.life * lifeMul;
    b.age = 0;
    b.size = shot.size * sizeMul;
    b.radius = shot.radius * sizeMul;
    b.pierce = shot.pierce;
    b.bounces = shot.bounces;
    b.gen = gen;
    b.dmgMul = dmgMul;
    b.color = shot.color;
    b.shot = shot;
    b.lastHit = null;
    b.target = null;
    b.seekT = 0;
    this.active.push(b);
    return b;
  }

  _remove(i) {
    const list = this.active;
    this._release(list[i]);
    list[i] = list[list.length - 1];
    list.pop();
  }

  /** Nearest valid target for a homing bolt, favouring what is in front of it. */
  _seek(b, hash) {
    const shot = b.shot;
    const cand = hash.query(b.x, b.y, shot.seekRadius, this.seekNear);
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const r2 = shot.seekRadius * shot.seekRadius;
    let best = null;
    let bestScore = Infinity;
    for (let k = 0; k < cand.length; k++) {
      const e = cand[k];
      if (!e.active || e.spawn > 0 || e.dying > 0 || e === b.lastHit) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const ahead = dx * ca + dy * sa;
      const score = ahead < 0 ? d2 * 5 : d2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  update(dt, game) {
    const list = this.active;
    const hash = game.hash;
    const W = ARENA.w;
    const H = ARENA.h;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const shot = b.shot;

      // Seeker guidance: re-acquire periodically, turn at a capped rate.
      if (shot.homing > 0 && b.age > 0.04) {
        b.seekT -= dt;
        const t = b.target;
        if (b.seekT <= 0 || (t && (!t.active || t.dying > 0))) {
          b.seekT = 0.07;
          b.target = this._seek(b, hash);
        }
        if (b.target) {
          const want = Math.atan2(b.target.y - b.y, b.target.x - b.x);
          const d = angleDiff(b.angle, want);
          const turn = shot.turnRate * dt;
          b.angle += d > turn ? turn : d < -turn ? -turn : d;
          b.vx = Math.cos(b.angle) * b.speed;
          b.vy = Math.sin(b.angle) * b.speed;
        }
      }

      const x0 = b.x;
      const y0 = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.age += dt;
      let dead = b.life <= 0;

      // Arena walls: ricochet if the bolt has bounces left, otherwise splash.
      if (!dead && (b.x < 0 || b.x > W || b.y < 0 || b.y > H)) {
        const hx = b.x < 0 ? 0 : b.x > W ? W : b.x;
        const hy = b.y < 0 ? 0 : b.y > H ? H : b.y;
        const nx = b.x < 0 ? 1 : b.x > W ? -1 : 0;
        const ny = b.y < 0 ? 1 : b.y > H ? -1 : 0;
        if (b.bounces > 0) {
          b.bounces--;
          if (b.x < 0) { b.x = -b.x; b.vx = Math.abs(b.vx); } else if (b.x > W) { b.x = 2 * W - b.x; b.vx = -Math.abs(b.vx); }
          if (b.y < 0) { b.y = -b.y; b.vy = Math.abs(b.vy); } else if (b.y > H) { b.y = 2 * H - b.y; b.vy = -Math.abs(b.vy); }
          b.angle = Math.atan2(b.vy, b.vx);
          b.lastHit = null;
          b.target = null;
          b.seekT = 0;
          game.fx.bounce(hx, hy, nx, ny, b.color);
        } else {
          game.fx.wallImpact(hx, hy, nx, ny, b.color);
          dead = true;
        }
      }

      // Enemies along the swept segment.
      if (!dead) {
        const R = b.radius;
        const sx = b.x - x0;
        const sy = b.y - y0;
        const segLen2 = sx * sx + sy * sy || 1;
        const cand = hash.query((x0 + b.x) / 2, (y0 + b.y) / 2, Math.sqrt(segLen2) / 2 + R + MAX_ENEMY_RADIUS, this.near);
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
          game.bulletHitEnemy(b, best, x0 + sx * bestT, y0 + sy * bestT);
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
        const orb = game.orbs.hitTest(b.x, b.y, b.radius);
        if (orb) {
          game.orbs.pop(orb, game);
          if (b.pierce > 0) b.pierce--;
          else dead = true;
        }
      }

      if (dead) {
        this._remove(i);
      } else if ((b.age * 60) % 2 < 1) {
        // Plasma drags the lattice along with it.
        game.grid.push(b.x, b.y, b.vx / 1650, b.vy / 1650, 0.55 * Math.min(1.6, b.size), 70);
      }
    }
  }

  draw(layer, atlas) {
    const frame = atlas.frames.bullet;
    for (const b of this.active) {
      const grow = Math.min(1, b.age * 25);
      const s = b.size;
      layer.draw(frame, b.x, b.y, b.angle, 0.78 * grow * s, 0.62 * s, b.color, b.gen ? 2.6 : 3.4);
      if (b.shot.explosive && !b.gen) layer.sprite('dot', b.x, b.y, 0, 5 * s, 0xfff0d0, 1.4);
    }
  }
}

/** Hostile energy orbs fired by Sentries. */
export class EnemyShots {
  constructor(capacity = 200) {
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

  /** Pop every orb within `radius` of (x, y) (shield blocks, purges). */
  popWithin(x, y, radius, game) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < radius * radius) this.pop(o, game);
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
          game.hurtPlayer(); // may clear orbs, so stop iterating this frame
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
