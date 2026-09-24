import { easeOutBack } from '../core/math.js';

/**
 * Floating combat text (score, crits, multiplier milestones) as pooled DOM elements in
 * the UI layer. Text stays razor sharp at any resolution: the elements are positioned
 * each frame by projecting their world position through the camera (shake included),
 * so they still ride the screen shake with the rest of the world.
 */
export class FloatText {
  constructor(root, capacity = 40) {
    this.root = root;
    this.items = [];
    this.pt = { x: 0, y: 0 };
    for (let i = 0; i < capacity; i++) {
      const el = document.createElement('div');
      el.className = 'pop';
      root.appendChild(el);
      this.items.push({ el, active: false, shown: false, x: 0, y: 0, vy: 0, life: 0, max: 1, size: 1, kind: '' });
    }
  }

  /** kind: 'score' | 'big' | 'crit' | 'mult' | 'heal' | 'shield' | 'elite' | 'shards' */
  add(x, y, text, kind = 'score', size = 1) {
    let slot = null;
    for (const p of this.items) {
      if (!p.active) {
        slot = p;
        break;
      }
      if (!slot || p.life < slot.life) slot = p; // recycle the oldest
    }
    const life = kind === 'elite' || kind === 'mult' ? 1.3 : kind === 'crit' ? 0.7 : 0.9;
    Object.assign(slot, { active: true, x, y, vy: kind === 'crit' ? -110 : -70, life, max: life, size });
    if (slot.kind !== kind) {
      slot.el.className = `pop ${kind}`;
      slot.kind = kind;
    }
    slot.el.textContent = text;
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
    this.render(null, 1);
  }

  /** @param pxPerCss scene-target pixels per CSS pixel */
  render(camera, pxPerCss) {
    const pt = this.pt;
    for (const p of this.items) {
      if (!p.active) {
        if (p.shown) {
          p.el.style.opacity = '0';
          p.shown = false;
        }
        continue;
      }
      camera.project(p.x, p.y, pt);
      const age = p.max - p.life;
      const pop = easeOutBack(Math.min(1, age / 0.18), 2.4);
      const fade = Math.min(1, p.life / 0.35);
      const zoom = camera.scale / pxPerCss; // world units -> CSS px, so text scales with the arena
      const scale = p.size * pop * Math.max(0.55, Math.min(1.4, zoom * 1.6));
      p.el.style.transform = `translate3d(${(pt.x / pxPerCss).toFixed(1)}px, ${(pt.y / pxPerCss).toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      p.el.style.opacity = fade.toFixed(3);
      p.shown = true;
    }
  }
}
