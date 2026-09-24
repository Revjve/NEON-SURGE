import { easeOutBack } from '../core/math.js';

/** Floating in-world score numbers rendered from atlas glyphs (HDR, bloomed). */
export class Popups {
  constructor(atlas, capacity = 48) {
    this.atlas = atlas;
    this.items = [];
    for (let i = 0; i < capacity; i++) this.items.push({ active: false, text: '', x: 0, y: 0, vy: 0, life: 0, max: 1, color: 0xffffff, size: 1 });
  }

  add(x, y, text, color, size = 1) {
    let slot = this.items.find((p) => !p.active);
    if (!slot) slot = this.items.reduce((a, b) => (a.life < b.life ? a : b));
    Object.assign(slot, { active: true, text, x, y, vy: -70, life: 0.9, max: 0.9, color, size });
  }

  update(dt) {
    for (const p of this.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.y += p.vy * dt;
      p.vy *= Math.exp(-3 * dt);
    }
  }

  clear() {
    for (const p of this.items) p.active = false;
  }

  draw(layer) {
    const { frames, glyphs } = this.atlas;
    for (const p of this.items) {
      if (!p.active) continue;
      const age = p.max - p.life;
      const pop = easeOutBack(Math.min(1, age / 0.18), 2.4);
      const scale = 0.42 * p.size * pop;
      const fade = Math.min(1, p.life / 0.35);
      let width = 0;
      for (const ch of p.text) width += (glyphs[ch] ?? 20) * scale;
      let x = p.x - width / 2;
      for (const ch of p.text) {
        const frame = frames[`glyph_${ch}`];
        if (!frame) continue;
        const adv = glyphs[ch] * scale;
        layer.draw(frame, x + adv / 2, p.y, 0, scale, scale, p.color, 2.1 * fade);
        x += adv;
      }
    }
  }
}
