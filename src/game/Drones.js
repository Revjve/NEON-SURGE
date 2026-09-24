import { PALETTE } from '../config.js';
import { TAU, damp, lerpAngle } from '../core/math.js';

const ORBIT = 82;
const RANGE = 760;
const COLOR = 0x9dfcff;

/**
 * GUARDIAN DRONE upgrade: satellites that orbit the ship and fire the build's shot
 * profile at the nearest enemy, so they inherit every bullet mod.
 */
export class Drones {
  constructor() {
    this.list = [];
    this.near = [];
    this.spin = 0;
  }

  /** Match the drone count to the current build. New drones deploy from the ship. */
  sync(count, x, y) {
    while (this.list.length < count) {
      this.list.push({ x, y, aim: 0, cooldown: Math.random() * 0.3, flash: 0, target: null, seekT: 0, deploy: 1 });
    }
    this.list.length = Math.min(this.list.length, count);
  }

  clear() {
    this.list.length = 0;
  }

  /** Snap every drone back onto the ship (new run / round). */
  recall(x, y) {
    for (const d of this.list) {
      d.x = x;
      d.y = y;
      d.target = null;
    }
  }

  _seek(d, hash) {
    const cand = hash.query(d.x, d.y, RANGE, this.near);
    let best = null;
    let bestD = RANGE * RANGE;
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (!e.active || e.spawn > 0 || e.dying > 0) continue;
      const d2 = (e.x - d.x) ** 2 + (e.y - d.y) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    return best;
  }

  update(dt, game, canFire) {
    const n = this.list.length;
    const p = game.player;
    if (!n || !p.alive) return;
    this.spin += dt * 2.1;
    const rate = Math.max(1.6, game.stats.fireRate * 0.38);
    for (let i = 0; i < n; i++) {
      const d = this.list[i];
      const a = this.spin + (i / n) * TAU;
      d.x = damp(d.x, p.x + Math.cos(a) * ORBIT, 16, dt);
      d.y = damp(d.y, p.y + Math.sin(a) * ORBIT * 0.9, 16, dt);
      d.flash = Math.max(0, d.flash - dt * 7);
      d.deploy = Math.max(0, d.deploy - dt * 2);
      d.cooldown -= dt;
      d.seekT -= dt;
      const t = d.target;
      if (d.seekT <= 0 || (t && (!t.active || t.dying > 0))) {
        d.seekT = 0.12;
        d.target = this._seek(d, game.hash);
      }
      if (!d.target) {
        d.cooldown = Math.max(d.cooldown, 0);
        d.aim = lerpAngle(d.aim, a, 1 - Math.exp(-6 * dt));
        continue;
      }
      d.aim = lerpAngle(d.aim, Math.atan2(d.target.y - d.y, d.target.x - d.x), 1 - Math.exp(-20 * dt));
      if (canFire && d.cooldown <= 0) {
        d.cooldown += 1 / rate;
        if (d.cooldown < 0) d.cooldown = 0;
        d.flash = 1;
        game.fireDrone(d);
      }
    }
  }

  draw(layer, time) {
    for (const d of this.list) {
      const appear = 1 - d.deploy;
      const heat = d.flash;
      layer.sprite('glow', d.x, d.y, 0, 26 + heat * 10, COLOR, (0.35 + heat * 0.3) * appear);
      layer.sprite('droneGlow', d.x, d.y, d.aim, 15, COLOR, 0.9 * appear);
      layer.sprite('drone', d.x, d.y, d.aim, 14, PALETTE.playerCore, (1.6 + heat) * appear);
      layer.sprite('dot', d.x, d.y, 0, 3.5, PALETTE.white, (1.8 + Math.sin(time * 9 + d.x * 0.01) * 0.4) * appear);
    }
  }
}
