import { ARENA, PLAYER, PALETTE, WEAPON } from '../config.js';
import { clamp, lerpAngle } from '../core/math.js';

const DEG = Math.PI / 180;

export class Player {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.reset();
  }

  reset() {
    this.x = ARENA.w / 2;
    this.y = ARENA.h / 2;
    this.vx = 0;
    this.vy = 0;
    this.aim = -Math.PI / 2;
    this.heading = -Math.PI / 2;
    this.alive = true;
    this.visible = true;
    this.invuln = 0;
    this.cooldown = 0;
    this.weapon = 0;
    this.thrust = 0;
    this.fireHeat = 0; // visual recoil glow
    this.spawnFx = 1; // materialise animation 1 -> 0
    this.time = 0;
    this.barrel = 0;
  }

  get radius() {
    return PLAYER.hitRadius;
  }

  /** Movement + aiming. `aimX/aimY` is the world-space aim target (mouse) or null. */
  update(dt, input, aimX, aimY) {
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireHeat = Math.max(0, this.fireHeat - dt * 6);
    this.spawnFx = Math.max(0, this.spawnFx - dt * 2.2);
    if (!this.alive) return;

    const m = input.move(this.move);
    const k = 1 - Math.exp(-PLAYER.response * dt);
    this.vx += (m.x * PLAYER.maxSpeed - this.vx) * k;
    this.vy += (m.y * PLAYER.maxSpeed - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const pad = PLAYER.size * 0.6;
    if (this.x < pad) { this.x = pad; this.vx = Math.max(0, this.vx); }
    if (this.x > ARENA.w - pad) { this.x = ARENA.w - pad; this.vx = Math.min(0, this.vx); }
    if (this.y < pad) { this.y = pad; this.vy = Math.max(0, this.vy); }
    if (this.y > ARENA.h - pad) { this.y = ARENA.h - pad; this.vy = Math.min(0, this.vy); }

    const speed = Math.hypot(this.vx, this.vy);
    this.thrust = clamp(speed / PLAYER.maxSpeed, 0, 1);

    if (input.device === 'gamepad' && input.pad.connected) {
      if (input.pad.aimMag > 0.2) this.aim = Math.atan2(input.pad.aimY, input.pad.aimX);
      else if (speed > 40) this.aim = Math.atan2(this.vy, this.vx);
    } else if (aimX !== null) {
      const dx = aimX - this.x;
      const dy = aimY - this.y;
      if (dx * dx + dy * dy > 16) this.aim = Math.atan2(dy, dx);
    }
    this.heading = lerpAngle(this.heading, this.aim, 1 - Math.exp(-28 * dt));
  }

  /**
   * Fire the current weapon pattern. `emit(x, y, angle, speed, pierce, color)` spawns a
   * bullet. Returns the number of volleys fired this frame.
   */
  tryFire(dt, firing, emit) {
    this.cooldown -= dt;
    if (!this.alive || !firing) {
      this.cooldown = Math.max(this.cooldown, 0);
      return 0;
    }
    const lvl = WEAPON.levels[this.weapon];
    let volleys = 0;
    while (this.cooldown <= 0) {
      this.cooldown += 1 / lvl.rate;
      volleys++;
      const ca = Math.cos(this.heading);
      const sa = Math.sin(this.heading);
      const nose = PLAYER.size * 0.9;
      const color = PALETTE.bulletByLevel[this.weapon];
      for (const [deg, lateral] of lvl.pattern) {
        const a = this.heading + deg * DEG + (Math.random() - 0.5) * 1.6 * DEG;
        const bx = this.x + ca * nose - sa * lateral;
        const by = this.y + sa * nose + ca * lateral;
        emit(bx, by, a, WEAPON.bulletSpeed, lvl.pierce, color);
      }
      this.fireHeat = 1;
      this.barrel ^= 1;
      if (volleys > 2) break;
    }
    return volleys;
  }

  draw(layer, time) {
    if (!this.alive || !this.visible) return;
    const blink = this.invuln > 0 ? (Math.sin(time * 38) > -0.2 ? 1 : 0.25) : 1;
    const appear = 1 - this.spawnFx;
    const r = PLAYER.size * (1 + this.spawnFx * 1.4);
    const c = PALETTE.player;
    const heat = this.fireHeat;
    layer.sprite('glow', this.x, this.y, 0, r * 2, c, (0.16 + heat * 0.08) * blink * appear);
    layer.sprite('shipGlow', this.x, this.y, this.heading, r * 1.08, c, (0.85 + heat * 0.25) * blink * appear);
    layer.sprite('ship', this.x, this.y, this.heading, r, PALETTE.playerCore, (1.7 + heat * 0.4) * blink * appear);
    // Engine core: burns hotter when thrusting.
    const ex = this.x - Math.cos(this.heading) * r * 0.36;
    const ey = this.y - Math.sin(this.heading) * r * 0.36;
    layer.sprite('dot', ex, ey, 0, 5 + this.thrust * 4, 0xbff8ff, (1.6 + this.thrust * 2) * blink * appear);
    if (this.invuln > 0) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 12);
      layer.sprite('shield', this.x, this.y, time * 1.5, r * 1.45, PALETTE.shield, 1.3 * pulse * Math.min(1, this.invuln));
      layer.sprite('shieldGlow', this.x, this.y, time * 1.5, r * 1.5, PALETTE.shield, 0.6 * pulse * Math.min(1, this.invuln));
    }
  }

  /** Aim guide: faint dotted sight line toward the aim direction. */
  drawSight(layer) {
    if (!this.alive) return;
    const ca = Math.cos(this.heading);
    const sa = Math.sin(this.heading);
    for (let i = 0; i < 6; i++) {
      const d = 70 + i * 34;
      layer.sprite('dot', this.x + ca * d, this.y + sa * d, 0, 2.2, PALETTE.player, 0.35 * (1 - i / 6));
    }
  }
}
