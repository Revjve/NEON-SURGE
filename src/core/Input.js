// Unified input: keyboard (layout-independent physical keys), mouse and gamepads.

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
// Keys whose default action would scroll the page. Inside an embed (itch.io) a scroll the
// game iframe can't perform chains up to the host page, so these are always swallowed
// (except while a form control such as a settings slider has focus).
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
const DEADZONE = 0.22;

function radial(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0, 0];
  const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * k, y * k, Math.min(1, m)];
}

export class Input {
  constructor(surface) {
    this.surface = surface;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.mouseDown = false;
    this.rightDown = false;
    this.rightPressed = false;
    this.device = 'mouse'; // 'mouse' | 'gamepad'
    this.pad = { connected: false, moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimMag: 0, fire: false, surge: false };
    this.padPrev = [];
    this.padPressed = new Set();
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      // Stop the page (or an itch.io iframe) from scrolling, but keep menus keyboard-usable.
      if (BLOCK_DEFAULT.has(e.code) && !isInteractive(e)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.device = 'mouse';
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (e.movementX || e.movementY) this.device = 'mouse';
    });
    surface.addEventListener('pointerdown', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.device = 'mouse';
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) {
        this.rightDown = true;
        this.rightPressed = true;
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  releaseAll() {
    this.down.clear();
    this.mouseDown = false;
    this.rightDown = false;
  }

  /** Poll gamepads once per frame (the Gamepad API has no events for axes). */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        gp = p;
        break;
      }
      if (p && p.connected && !gp) gp = p;
    }
    const pad = this.pad;
    this.padPressed.clear();
    if (!gp) {
      pad.connected = false;
      return;
    }
    pad.connected = true;
    const ax = gp.axes;
    const [mx, my] = radial(ax[0] ?? 0, ax[1] ?? 0);
    const [aimX, aimY, aimMag] = radial(ax[2] ?? 0, ax[3] ?? 0);
    pad.moveX = mx;
    pad.moveY = my;
    pad.aimX = aimX;
    pad.aimY = aimY;
    pad.aimMag = aimMag;
    const b = gp.buttons;
    const val = (i) => (b[i] ? b[i].value > 0.35 || b[i].pressed : false);
    pad.fire = val(7) || val(5) || aimMag > 0.3;
    pad.surge = val(6) || val(4) || val(0);
    for (let i = 0; i < b.length; i++) {
      const now = val(i);
      if (now && !this.padPrev[i]) this.padPressed.add(i);
      this.padPrev[i] = now;
    }
    if (mx || my || aimMag || this.padPressed.size) this.device = 'gamepad';
  }

  /** Movement vector, length <= 1. */
  move(out) {
    let x = 0;
    let y = 0;
    for (const code in MOVE_KEYS) {
      if (this.down.has(code)) {
        x += MOVE_KEYS[code][0];
        y += MOVE_KEYS[code][1];
      }
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    if (this.pad.connected && (this.pad.moveX || this.pad.moveY)) {
      x = this.pad.moveX;
      y = this.pad.moveY;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  get firing() {
    return this.mouseDown || (this.pad.connected && this.pad.fire);
  }

  /** Edge-triggered action queries. */
  surgePressed() {
    return this.pressed.has('Space') || this.rightPressed || this.padPressed.has(6) || this.padPressed.has(4) || this.padPressed.has(0);
  }

  pausePressed() {
    return this.pressed.has('Escape') || this.pressed.has('KeyP') || this.padPressed.has(9);
  }

  confirmPressed() {
    return this.pressed.has('Enter') || this.pressed.has('NumpadEnter') || this.padPressed.has(9);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.rightPressed = false;
  }
}

function isInteractive(e) {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'SELECT');
}
