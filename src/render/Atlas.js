import { CanvasSource, Texture, Rectangle } from '../lib/pixi.js';

// Every sprite in the game is procedurally painted into one mip-mapped atlas at boot, in
// pure white. Colour and HDR intensity are applied per-sprite at draw time, which keeps
// the whole world renderable in a couple of draw calls.

const SIZE = 2048;
const PAD = 6;
const SHAPE = 128; // shape frame size
const R = 40; // reference radius of shapes inside a SHAPE frame

class ShelfPacker {
  constructor(size) {
    this.size = size;
    this.x = PAD;
    this.y = PAD;
    this.rowH = 0;
  }

  alloc(w, h) {
    if (this.x + w + PAD > this.size) {
      this.x = PAD;
      this.y += this.rowH + PAD;
      this.rowH = 0;
    }
    if (this.y + h + PAD > this.size) throw new Error('Atlas overflow');
    const slot = { x: this.x, y: this.y };
    this.x += w + PAD;
    this.rowH = Math.max(this.rowH, h);
    return slot;
  }
}

// --- Canvas helpers ---------------------------------------------------------------------

function radial(ctx, cx, cy, radius, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  for (const [t, a] of stops) g.addColorStop(t, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Paint only the blurred shadow of `fn` (shape drawn far off-canvas, shadow offset back). */
function shadowOnly(ctx, blur, alpha, fn) {
  ctx.save();
  ctx.shadowColor = `rgba(255,255,255,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 8192;
  ctx.translate(-8192, 0);
  fn(ctx);
  ctx.restore();
}

function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

function regular(n, radius, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

function strokePaths(ctx, paths, width) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#fff';
  for (const p of paths) {
    ctx.lineWidth = (p.w ?? 1) * width;
    if (p.circle) {
      ctx.beginPath();
      ctx.arc(p.circle[0], p.circle[1], p.circle[2], 0, Math.PI * 2);
    } else {
      poly(ctx, p.pts, p.close ?? true);
    }
    if (p.fill) {
      ctx.fillStyle = `rgba(255,255,255,${p.fill})`;
      ctx.fill();
    }
    ctx.stroke();
  }
}

// --- Shape library (all point toward +x, centred on 0,0, nominal radius R) --------------

const SHAPES = {
  ship: [
    { pts: [[44, 0], [-30, 30], [-14, 0], [-30, -30]], fill: 0.12 },
    { pts: [[20, 0], [-6, 11]], close: false, w: 0.55 },
    { pts: [[20, 0], [-6, -11]], close: false, w: 0.55 },
  ],
  dart: [
    { pts: [[42, 0], [-26, 28], [-26, -28]], fill: 0.1 },
    { pts: [[16, 0], [-12, 12], [-12, -12]], w: 0.6 },
  ],
  wisp: [
    { pts: [[0, 0], [38, -10], [30, 14]], fill: 0.12 },
    { pts: [[0, 0], [10, 38], [-14, 30]], fill: 0.12 },
    { pts: [[0, 0], [-38, 10], [-30, -14]], fill: 0.12 },
    { pts: [[0, 0], [-10, -38], [14, -30]], fill: 0.12 },
  ],
  lancer: [
    { pts: [[46, 0], [0, 13], [-32, 0], [0, -13]], fill: 0.1 },
    { pts: [[26, 0], [-18, 0]], close: false, w: 0.55 },
  ],
  bulwark: [{ pts: regular(6, 42), w: 1.35, fill: 0.08 }],
  bulwarkCore: [
    { pts: regular(6, 22, Math.PI / 6), w: 0.9 },
    { circle: [0, 0, 6], w: 0.8, fill: 0.9 },
  ],
  hive: [{ pts: regular(4, 42, Math.PI / 4), w: 1.1, fill: 0.08 }],
  hiveCore: [
    { pts: regular(4, 8, Math.PI / 4).map(([x, y]) => [x + 13, y + 13]), w: 0.6 },
    { pts: regular(4, 8, Math.PI / 4).map(([x, y]) => [x - 13, y + 13]), w: 0.6 },
    { pts: regular(4, 8, Math.PI / 4).map(([x, y]) => [x + 13, y - 13]), w: 0.6 },
    { pts: regular(4, 8, Math.PI / 4).map(([x, y]) => [x - 13, y - 13]), w: 0.6 },
  ],
  mite: [{ pts: [[40, 0], [-24, 30], [-12, 0], [-24, -30]], w: 1.3, fill: 0.2 }],
  sentry: [
    { circle: [0, 0, 34], w: 1 },
    { pts: regular(3, 20), w: 0.8, fill: 0.15 },
    { pts: [[34, 0], [46, 0]], close: false, w: 1.1 },
  ],
  flux: [{ pts: [[40, 0], [0, 26], [-40, 0], [0, -26]], w: 1.6, fill: 0.35 }],
  drone: [
    { pts: [[40, 0], [0, 22], [-24, 0], [0, -22]], w: 1.4, fill: 0.18 },
    { pts: [[40, 0], [8, 0]], close: false, w: 0.9 },
  ],
  shield: [{ pts: regular(6, 40, Math.PI / 6), w: 0.55 }],
  reticle: [
    { circle: [0, 0, 22], w: 0.7 },
    { pts: [[30, 0], [44, 0]], close: false, w: 0.9 },
    { pts: [[-30, 0], [-44, 0]], close: false, w: 0.9 },
    { pts: [[0, 30], [0, 44]], close: false, w: 0.9 },
    { pts: [[0, -30], [0, -44]], close: false, w: 0.9 },
    { circle: [0, 0, 2.5], w: 1, fill: 1 },
  ],
};

export class Atlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.packer = new ShelfPacker(SIZE);
    this.rects = new Map();
    this.frames = {};
    /** Reference radius (px) of each frame, used to scale sprites to world sizes. */
    this.ref = {};
    this.texture = null;
  }

  _add(name, w, h, ref, draw) {
    const { x, y } = this.packer.alloc(w, h);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    draw(ctx, w, h);
    ctx.restore();
    this.rects.set(name, { x, y, w, h });
    this.ref[name] = ref;
  }

  // No text is ever painted here: all lettering (HUD, menus, combat numbers) is crisp
  // HTML in the #ui-layer overlay.
  build() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Soft light blobs --------------------------------------------------------------
    this._add('glow', 128, 128, 64, (c) =>
      radial(c, 64, 64, 64, [[0, 1], [0.1, 0.82], [0.28, 0.42], [0.5, 0.15], [0.75, 0.04], [1, 0]]));
    this._add('dot', 32, 32, 16, (c) =>
      radial(c, 16, 16, 16, [[0, 1], [0.3, 0.9], [0.6, 0.3], [1, 0]]));
    this._add('spark', 128, 32, 64, (c) => {
      c.translate(64, 16);
      c.scale(3.8, 1);
      radial(c, 0, 0, 16, [[0, 1], [0.25, 0.75], [0.6, 0.2], [1, 0]]);
    });
    this._add('beam', 64, 32, 16, (c) => {
      for (let yy = 0; yy < 32; yy++) {
        const d = (yy + 0.5 - 16) / 16;
        const a = Math.exp(-d * d * 30) * 0.9 + Math.exp(-d * d * 5) * 0.28;
        c.fillStyle = `rgba(255,255,255,${Math.min(1, a)})`;
        c.fillRect(0, yy, 64, 1);
      }
    });
    this._add('flare', 128, 128, 64, (c) => {
      c.translate(64, 64);
      for (const rot of [0, Math.PI / 2]) {
        c.save();
        c.rotate(rot);
        c.scale(5.2, 0.55);
        radial(c, 0, 0, 12, [[0, 1], [0.35, 0.5], [1, 0]]);
        c.restore();
      }
      radial(c, 0, 0, 22, [[0, 1], [0.3, 0.6], [1, 0]]);
    });
    this._add('ring', 128, 128, 52, (c) => {
      const draw = (k) => { k.lineWidth = 5; k.strokeStyle = '#fff'; k.beginPath(); k.arc(64, 64, 52, 0, Math.PI * 2); k.stroke(); };
      shadowOnly(c, 10, 0.9, draw);
      draw(c);
    });
    this._add('ringThin', 256, 256, 116, (c) => {
      const draw = (k) => { k.lineWidth = 3; k.strokeStyle = '#fff'; k.beginPath(); k.arc(128, 128, 116, 0, Math.PI * 2); k.stroke(); };
      shadowOnly(c, 12, 1, draw);
      draw(c);
    });
    this._add('ringFine', 512, 512, 244, (c) => {
      const draw = (k) => { k.lineWidth = 2.5; k.strokeStyle = '#fff'; k.beginPath(); k.arc(256, 256, 244, 0, Math.PI * 2); k.stroke(); };
      shadowOnly(c, 8, 1, draw);
      draw(c);
    });
    this._add('shard', 48, 48, 16, (c) => {
      c.translate(24, 24);
      const tri = [[16, 0], [-10, 10], [-7, -12]];
      shadowOnly(c, 6, 0.8, (k) => { k.lineWidth = 4; k.strokeStyle = '#fff'; poly(k, tri); k.stroke(); });
      c.lineJoin = 'round';
      c.lineWidth = 3;
      c.strokeStyle = '#fff';
      poly(c, tri);
      c.stroke();
    });
    this._add('tri', 32, 32, 12, (c) => {
      c.translate(16, 16);
      c.fillStyle = '#fff';
      poly(c, [[12, 0], [-8, 9], [-8, -9]]);
      c.fill();
    });
    this._add('sq', 16, 16, 5, (c) => {
      c.fillStyle = '#fff';
      c.fillRect(3, 3, 10, 10);
    });
    this._add('bullet', 96, 32, 16, (c) => {
      c.translate(48, 16);
      c.save();
      c.scale(2.6, 1);
      radial(c, 0, 0, 16, [[0, 1], [0.3, 0.85], [0.65, 0.25], [1, 0]]);
      c.restore();
      c.fillStyle = '#fff';
      c.beginPath();
      c.ellipse(4, 0, 24, 3.4, 0, 0, Math.PI * 2);
      c.fill();
    });

    // Vector shapes: crisp line art + a matching pre-blurred halo --------------------
    for (const [name, paths] of Object.entries(SHAPES)) {
      this._add(name, SHAPE, SHAPE, R, (c) => {
        c.translate(SHAPE / 2, SHAPE / 2);
        shadowOnly(c, 5, 0.9, (k) => strokePaths(k, paths, 5));
        strokePaths(c, paths, 4.5);
      });
      this._add(`${name}Glow`, SHAPE, SHAPE, R, (c) => {
        c.translate(SHAPE / 2, SHAPE / 2);
        shadowOnly(c, 16, 1, (k) => strokePaths(k, paths, 11));
      });
    }

    const source = new CanvasSource({
      resource: this.canvas,
      autoGenerateMipmaps: true,
      mipLevelCount: Math.log2(SIZE) + 1,
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
    });
    this.texture = new Texture({ source });
    for (const [name, r] of this.rects) {
      this.frames[name] = new Texture({ source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
    }
    return this;
  }
}
