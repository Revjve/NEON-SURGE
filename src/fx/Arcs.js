import { PALETTE } from '../config.js';

/**
 * Short-lived lightning arcs (ARC COIL upgrade). Each arc is re-jittered every frame so
 * it crackles, and drawn as a chain of glowing beam segments in the world layer.
 */
export class Arcs {
  constructor(capacity = 96) {
    this.items = Array.from({ length: capacity }, () => ({ active: false, x1: 0, y1: 0, x2: 0, y2: 0, life: 0, max: 1, color: 0 }));
    this.next = 0;
  }

  add(x1, y1, x2, y2, color = PALETTE.arc, life = 0.16) {
    // Ring buffer: when saturated the oldest arc is recycled.
    const a = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    a.active = true;
    a.x1 = x1;
    a.y1 = y1;
    a.x2 = x2;
    a.y2 = y2;
    a.life = life;
    a.max = life;
    a.color = color;
  }

  clear() {
    for (const a of this.items) a.active = false;
  }

  update(dt) {
    for (const a of this.items) {
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) a.active = false;
    }
  }

  draw(layer) {
    for (const a of this.items) {
      if (!a.active) continue;
      const k = a.life / a.max;
      const dx = a.x2 - a.x1;
      const dy = a.y2 - a.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const segs = Math.max(3, Math.min(9, Math.round(len / 34)));
      const amp = Math.min(26, len * 0.14);
      let px = a.x1;
      let py = a.y1;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const j = i === segs ? 0 : (Math.random() * 2 - 1) * amp * Math.sin(t * Math.PI);
        const x = a.x1 + dx * t + nx * j;
        const y = a.y1 + dy * t + ny * j;
        layer.line(px, py, x, y, 5.5, a.color, 1.1 * k);
        layer.line(px, py, x, y, 1.6, PALETTE.white, 2.4 * k);
        px = x;
        py = y;
      }
      layer.sprite('glow', a.x2, a.y2, 0, 30, a.color, 1.2 * k);
    }
  }
}
