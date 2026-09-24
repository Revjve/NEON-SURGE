import { ARENA, ENEMIES, PALETTE } from '../config.js';
import { rand, randSign, angleDiff, TAU, clamp } from '../core/math.js';

const SPAWN_TIME = 0.6;

class Enemy {
  constructor() {
    this.active = false;
  }

  init(kind, x, y, hpMul, speedMul) {
    const d = ENEMIES[kind];
    this.kind = kind;
    this.def = d;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = d.radius;
    this.maxHp = Math.max(1, Math.round(d.hp * (kind === 'mite' || kind === 'dart' ? 1 : hpMul)));
    this.hp = this.maxHp;
    this.speed = d.speed * speedMul;
    this.mass = d.mass;
    this.age = 0;
    this.spawn = SPAWN_TIME;
    this.flash = 0;
    this.state = 0;
    this.stateT = 0;
    this.seed = rand(0, 1000);
    this.side = randSign();
    this.angle = rand(0, TAU);
    this.spin = 0;
    this.dirX = 1;
    this.dirY = 0;
    this.fireT = (d.fireInterval ?? 2) * rand(0.7, 1.2);
    this.charge = 0;
    this.dodgeT = 0;
    this.trailT = 0;
    this.dying = 0;
    this.active = true;
    return this;
  }
}

/** Steer velocity toward `speed` along (dx, dy) with exponential response. */
function steer(e, dx, dy, speed, response, dt) {
  const m = Math.hypot(dx, dy) || 1;
  const k = 1 - Math.exp(-response * dt);
  e.vx += ((dx / m) * speed - e.vx) * k;
  e.vy += ((dy / m) * speed - e.vy) * k;
}

export class Enemies {
  constructor(capacity = 260) {
    this.pool = Array.from({ length: capacity }, () => new Enemy());
    this.list = [];
  }

  get count() {
    return this.list.length;
  }

  clear() {
    for (const e of this.list) e.active = false;
    this.list.length = 0;
  }

  spawn(kind, x, y, hpMul = 1, speedMul = 1) {
    const e = this.pool.find((p) => !p.active);
    if (!e) return null;
    e.init(kind, clamp(x, 30, ARENA.w - 30), clamp(y, 30, ARENA.h - 30), hpMul, speedMul);
    this.list.push(e);
    return e;
  }

  remove(e) {
    e.active = false;
    const i = this.list.indexOf(e);
    if (i >= 0) {
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
  }

  update(dt, game) {
    const p = game.player;
    const tx = p.alive ? p.x : ARENA.w / 2;
    const ty = p.alive ? p.y : ARENA.h / 2;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.flash = Math.max(0, e.flash - dt);
      if (e.dying > 0) {
        e.dying -= dt;
        e.vx *= Math.exp(-4 * dt);
        e.vy *= Math.exp(-4 * dt);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.dying <= 0) game.killEnemy(e, 'cascade');
        continue;
      }
      if (e.spawn > 0) {
        e.spawn -= dt;
        e.spin += dt * 9;
        continue;
      }
      e.age += dt;
      BEHAVIOR[e.kind](e, dt, tx, ty, game);
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      const r = e.radius;
      if (e.x < r) { e.x = r; e.vx = Math.abs(e.vx) * 0.5; }
      if (e.x > ARENA.w - r) { e.x = ARENA.w - r; e.vx = -Math.abs(e.vx) * 0.5; }
      if (e.y < r) { e.y = r; e.vy = Math.abs(e.vy) * 0.5; }
      if (e.y > ARENA.h - r) { e.y = ARENA.h - r; e.vy = -Math.abs(e.vy) * 0.5; }
    }
    this._separate(game.hash);
  }

  /** Soft-body separation so swarms flow around each other instead of stacking. */
  _separate(hash) {
    for (const a of this.list) {
      if (a.spawn > 0) continue;
      const near = hash.query(a.x, a.y, a.radius + 48);
      for (let k = 0; k < near.length; k++) {
        const b = near[k];
        if (b === a || b.spawn > 0 || !b.active) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.92;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const wa = b.mass / (a.mass + b.mass);
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push * wa;
        a.y -= ny * push * wa;
        b.x += nx * push * (1 - wa);
        b.y += ny * push * (1 - wa);
      }
    }
  }

  draw(layer, time) {
    for (const e of this.list) DRAW[e.kind](layer, e, time);
  }
}

// ---------------------------------------------------------------------------------------
// Behaviours

const BEHAVIOR = {
  dart(e, dt, tx, ty) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const m = Math.hypot(dx, dy) || 1;
    const wob = Math.sin(e.age * 5 + e.seed) * 0.28;
    steer(e, dx / m - (dy / m) * wob, dy / m + (dx / m) * wob, e.speed, 3.1, dt);
    e.angle = Math.atan2(e.vy, e.vx);
  },

  wisp(e, dt, tx, ty, game) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const base = Math.atan2(dy, dx) + Math.sin(e.age * 3.1 + e.seed) * 0.95;
    steer(e, Math.cos(base), Math.sin(base), e.speed, 2.6, dt);
    e.spin += dt * 5.5;
    // Jink away from incoming bolts.
    e.dodgeT -= dt;
    if (e.dodgeT <= 0) {
      for (const b of game.bullets.active) {
        const bx = e.x - b.x;
        const by = e.y - b.y;
        const d2 = bx * bx + by * by;
        if (d2 > 150 * 150) continue;
        const along = (bx * b.vx + by * b.vy) / 1650;
        if (along <= 0) continue;
        const perp = Math.abs(bx * b.vy - by * b.vx) / 1650;
        if (perp < 38) {
          // Side-step away from the bolt's line of travel.
          const s = (bx * b.vy - by * b.vx) > 0 ? -1 : 1;
          e.vx += (-b.vy / 1650) * s * 520;
          e.vy += (b.vx / 1650) * s * 520;
          e.dodgeT = 0.45;
          break;
        }
      }
    }
  },

  lancer(e, dt, tx, ty, game) {
    e.stateT += dt;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    switch (e.state) {
      case 0: // approach
        steer(e, dx, dy, e.speed, 2.2, dt);
        e.angle += angleDiff(e.angle, Math.atan2(dy, dx)) * (1 - Math.exp(-6 * dt));
        if ((dist < 600 && e.age > 0.6) || e.stateT > 3) {
          e.state = 1;
          e.stateT = 0;
          game.audio.charge(game.fx.pan(e.x));
        }
        break;
      case 1: { // lock on & telegraph
        const k = Math.exp(-7 * dt);
        e.vx *= k;
        e.vy *= k;
        e.charge = Math.min(1, e.stateT / 0.75);
        if (e.stateT < 0.55) {
          e.dirX = dx / dist;
          e.dirY = dy / dist;
        }
        e.angle += angleDiff(e.angle, Math.atan2(e.dirY, e.dirX)) * (1 - Math.exp(-14 * dt));
        if (e.stateT >= 0.75) {
          e.state = 2;
          e.stateT = 0;
          const dash = e.def.dashSpeed * game.director.speedMul;
          e.vx = e.dirX * dash;
          e.vy = e.dirY * dash;
          game.grid.explode(e.x, e.y, 6, 160, 0.4);
        }
        break;
      }
      case 2: // dash
        e.charge = 0;
        e.trailT -= dt;
        if (e.trailT <= 0) {
          e.trailT = 0.022;
          game.fx.afterimage(game.fx.p.id('lancer'), e.x, e.y, e.angle, e.radius, e.def.color);
        }
        game.grid.push(e.x, e.y, e.dirX, e.dirY, 1.6, 90);
        {
          const r = e.radius + 2;
          const hitWall = e.x <= r || e.x >= ARENA.w - r || e.y <= r || e.y >= ARENA.h - r;
          if (hitWall && e.stateT > 0.05) {
            game.fx.wallImpact(e.x, e.y, -e.dirX, -e.dirY, e.def.color);
            game.camera.addTrauma(0.12, 0.5);
          }
          if (e.stateT > 0.48 || (hitWall && e.stateT > 0.05)) {
            e.state = 3;
            e.stateT = 0;
          }
        }
        break;
      default: { // recover
        const k = Math.exp(-4.5 * dt);
        e.vx *= k;
        e.vy *= k;
        if (e.stateT > 0.6) {
          e.state = 0;
          e.stateT = 0;
        }
      }
    }
  },

  bulwark(e, dt, tx, ty) {
    steer(e, tx - e.x, ty - e.y, e.speed, 1.1, dt);
    e.spin += dt * 0.7;
  },

  hive(e, dt, tx, ty) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const m = Math.hypot(dx, dy) || 1;
    const wob = Math.sin(e.age * 1.7 + e.seed) * 0.5;
    steer(e, dx / m - (dy / m) * wob, dy / m + (dx / m) * wob, e.speed, 1.7, dt);
    e.spin += dt * 1.5;
  },

  mite(e, dt, tx, ty) {
    const jx = Math.sin(e.age * 13 + e.seed) * 0.5;
    const jy = Math.cos(e.age * 11 + e.seed * 1.3) * 0.5;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const m = Math.hypot(dx, dy) || 1;
    steer(e, dx / m + jx, dy / m + jy, e.speed, e.age < 0.35 ? 0.6 : 4.2, dt);
    e.angle = Math.atan2(e.vy, e.vx);
  },

  sentry(e, dt, tx, ty, game) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    let mx;
    let my;
    if (dist > 500) {
      mx = nx;
      my = ny;
    } else if (dist < 340) {
      mx = -nx;
      my = -ny;
    } else {
      mx = -ny * e.side + nx * 0.15;
      my = nx * e.side + ny * 0.15;
    }
    steer(e, mx, my, e.speed, 2, dt);
    e.spin += dt * 1.2;
    e.angle += angleDiff(e.angle, Math.atan2(dy, dx)) * (1 - Math.exp(-5 * dt));
    if (Math.random() < dt * 0.25) e.side = -e.side;

    e.fireT -= dt;
    e.charge = e.fireT < 0.5 ? 1 - e.fireT / 0.5 : 0;
    if (e.fireT <= 0 && game.player.alive) {
      e.fireT = (e.def.fireInterval / (1 + game.director.threat * 0.05)) * rand(0.85, 1.2);
      const spread = game.director.threat > 6 ? [-0.22, 0, 0.22] : [0];
      const speed = 330 + Math.min(150, game.director.threat * 14);
      const nose = e.radius + 8;
      const ox = e.x + Math.cos(e.angle) * nose;
      const oy = e.y + Math.sin(e.angle) * nose;
      for (const s of spread) game.orbs.spawn(ox, oy, e.angle + s, speed);
      game.fx.enemyShot(ox, oy, e.angle, game.orbs.color);
      game.audio.orbFire(game.fx.pan(e.x));
      e.vx -= Math.cos(e.angle) * 120;
      e.vy -= Math.sin(e.angle) * 120;
    }
  },
};

// ---------------------------------------------------------------------------------------
// Visuals

function body(layer, e, shape, rot, scale = 1) {
  const c = e.def.color;
  const spawning = e.spawn > 0 ? e.spawn / SPAWN_TIME : 0;
  const appear = 1 - spawning;
  const r = e.radius * scale * (1 + spawning * 2.2);
  const flicker = spawning > 0 ? 0.55 + 0.45 * Math.sin(e.spawn * 60) : 1;
  const hit = e.flash > 0 ? 1 : 0;
  const tint = hit ? PALETTE.white : c;
  layer.sprite('glow', e.x, e.y, 0, r * 2.3, c, (0.32 + hit * 0.4) * appear * flicker);
  layer.sprite(`${shape}Glow`, e.x, e.y, rot, r * 1.06, c, (0.95 + hit) * appear * flicker);
  layer.sprite(shape, e.x, e.y, rot, r, tint, (2.1 + hit * 2) * flicker * (0.35 + appear * 0.65));
  return r;
}

const DRAW = {
  dart(layer, e) {
    body(layer, e, 'dart', e.spawn > 0 ? e.spin : e.angle);
  },

  wisp(layer, e) {
    body(layer, e, 'wisp', e.spin);
  },

  lancer(layer, e) {
    body(layer, e, 'lancer', e.spawn > 0 ? e.spin : e.angle);
    if (e.state === 1) {
      const c = e.charge;
      const len = 900 * Math.min(1, c * 1.6);
      const pulse = 0.6 + 0.4 * Math.sin(e.stateT * 40);
      layer.line(e.x, e.y, e.x + e.dirX * len, e.y + e.dirY * len, 1.5 + c * 2.5, e.def.color, (0.18 + c * 0.7) * pulse);
      layer.sprite('glow', e.x + e.dirX * e.radius, e.y + e.dirY * e.radius, 0, 12 + c * 26, PALETTE.white, 0.6 + c * 1.6);
    } else if (e.state === 2) {
      layer.sprite('glow', e.x, e.y, 0, e.radius * 3.2, e.def.color, 1.1);
    }
  },

  bulwark(layer, e, time) {
    const lowHp = e.hp / e.maxHp;
    const r = body(layer, e, 'bulwark', e.spin);
    const flick = lowHp < 0.4 ? 0.6 + 0.4 * Math.sin(time * 30 + e.seed) : 1;
    layer.sprite('bulwarkCoreGlow', e.x, e.y, -e.spin * 2.2, r * 1.05, e.def.color, 0.9 * flick);
    layer.sprite('bulwarkCore', e.x, e.y, -e.spin * 2.2, r, e.flash > 0 ? PALETTE.white : 0xffd29a, (1.7 + (1 - lowHp) * 1.2) * flick);
  },

  hive(layer, e) {
    const r = body(layer, e, 'hive', e.spin);
    layer.sprite('hiveCore', e.x, e.y, -e.spin * 1.7, r, 0xe4c6ff, 1.9);
  },

  mite(layer, e) {
    body(layer, e, 'mite', e.spawn > 0 ? e.spin : e.angle);
  },

  sentry(layer, e) {
    const r = body(layer, e, 'sentry', e.angle);
    if (e.charge > 0 && e.spawn <= 0) {
      const nx = e.x + Math.cos(e.angle) * (r + 8);
      const ny = e.y + Math.sin(e.angle) * (r + 8);
      layer.sprite('glow', nx, ny, 0, 10 + e.charge * 30, 0xff4d6d, 0.5 + e.charge * 2);
      layer.sprite('ring', e.x, e.y, e.spin, r * (1.9 - e.charge * 0.7), 0xff4d6d, e.charge * 1.4);
    }
  },
};
