import { ARENA } from '../config.js';

/** Uniform-grid broadphase over the arena, rebuilt every frame (cheap, allocation free). */
export class SpatialHash {
  constructor(cellSize = 96, pad = 200) {
    this.size = cellSize;
    this.pad = pad;
    this.cols = Math.ceil((ARENA.w + pad * 2) / cellSize);
    this.rows = Math.ceil((ARENA.h + pad * 2) / cellSize);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.used = [];
    this.result = [];
  }

  clear() {
    for (const c of this.used) this.cells[c].length = 0;
    this.used.length = 0;
  }

  _cell(x, y) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x + this.pad) / this.size)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor((y + this.pad) / this.size)));
    return cy * this.cols + cx;
  }

  insert(obj) {
    const c = this._cell(obj.x, obj.y);
    const bucket = this.cells[c];
    if (bucket.length === 0) this.used.push(c);
    bucket.push(obj);
  }

  /** Objects whose cell overlaps the circle's bounding box (caller does the exact test). */
  query(x, y, radius) {
    const out = this.result;
    out.length = 0;
    const s = this.size;
    const x0 = Math.max(0, Math.floor((x - radius + this.pad) / s));
    const x1 = Math.min(this.cols - 1, Math.floor((x + radius + this.pad) / s));
    const y0 = Math.max(0, Math.floor((y - radius + this.pad) / s));
    const y1 = Math.min(this.rows - 1, Math.floor((y + radius + this.pad) / s));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells[cy * this.cols + cx];
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
