import { STORAGE_KEYS } from '../config.js';

// Meta-progression: Neon Shards earned per run and the permanent Hangar upgrades bought
// with them. Everything here is defensive about storage: localStorage can be missing,
// blocked (sandboxed iframes, privacy modes), full, edited by hand or written by another tab.

const SAVE_VERSION = 1;
const MAX_SHARDS = 1e9;

/** Permanent upgrades. `apply(stats, level)` runs before any in-run upgrade. */
export const SHOP = [
  {
    id: 'hull', name: 'REINFORCED HULL', desc: 'Start every run with extra hull plating.',
    max: 5, base: 60, growth: 1.75, effect: (n) => `+${n} MAX HULL`,
    apply: (s, n) => { s.maxHull += n; },
  },
  {
    id: 'damage', name: 'PLASMA TUNING', desc: 'Permanently hotter plasma. Stacks with every damage mod.',
    max: 10, base: 40, growth: 1.4, effect: (n) => `+${n * 10}% DAMAGE`,
    apply: (s, n) => { s.damage *= 1 + 0.1 * n; },
  },
  {
    id: 'speed', name: 'THRUSTER TUNING', desc: 'Faster base movement speed.',
    max: 6, base: 35, growth: 1.45, effect: (n) => `+${n * 5}% MOVE SPEED`,
    apply: (s, n) => { s.moveSpeed *= 1 + 0.05 * n; },
  },
  {
    id: 'fireRate', name: 'CYCLIC RATE', desc: 'Faster base rate of fire.',
    max: 8, base: 45, growth: 1.42, effect: (n) => `+${n * 6}% FIRE RATE`,
    apply: (s, n) => { s.fireRate *= 1 + 0.06 * n; },
  },
  {
    id: 'shards', name: 'SHARD SIPHON', desc: 'Currency multiplier: earn more Neon Shards from every run.',
    max: 8, base: 50, growth: 1.55, effect: (n) => `×${(1 + 0.15 * n).toFixed(2)} SHARDS`,
    apply: (s, n) => { s.shardMul *= 1 + 0.15 * n; },
  },
  {
    id: 'surge', name: 'SURGE PRIMER', desc: 'Start runs with Surge pre-charged; it also charges faster.',
    max: 5, base: 40, growth: 1.5, effect: (n) => `${n * 20}% START · +${n * 10}% GAIN`,
    apply: (s, n) => { s.startSurge += 0.2 * n; s.surgeGain *= 1 + 0.1 * n; },
  },
  {
    id: 'reroll', name: 'REROLL MATRIX', desc: 'Reroll the upgrade offer. Charges refill every run.',
    max: 3, base: 90, growth: 2, effect: (n) => `${n} REROLL${n === 1 ? '' : 'S'} / RUN`,
    apply: (s, n) => { s.rerolls += n; },
  },
  {
    id: 'luck', name: 'FORTUNE ENGINE', desc: 'Rare and epic upgrades are offered more often.',
    max: 5, base: 70, growth: 1.6, effect: (n) => `+${n * 20}% RARE ODDS`,
    apply: (s, n) => { s.luck += n; },
  },
];

export const SHOP_BY_ID = Object.fromEntries(SHOP.map((item) => [item.id, item]));

export function shopCost(item, level) {
  return Math.round(item.base * Math.pow(item.growth, level));
}

/** Non-negative integer or 0 (rejects strings, NaN, Infinity, negatives). */
function int(v, max = MAX_SHARDS) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;
}

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function blankSave() {
  return {
    v: SAVE_VERSION,
    shards: 0,
    levels: Object.fromEntries(SHOP.map((item) => [item.id, 0])),
    stats: { runs: 0, bestWave: 0, bestScore: 0, totalKills: 0, totalShards: 0 },
  };
}

/** Rebuild a save from untrusted JSON: known fields only, every number validated and clamped. */
export function sanitizeSave(raw) {
  const out = blankSave();
  if (!isObject(raw)) return out;
  out.shards = int(raw.shards);
  const levels = isObject(raw.levels) ? raw.levels : {};
  for (const item of SHOP) out.levels[item.id] = Math.min(item.max, int(levels[item.id]));
  const stats = isObject(raw.stats) ? raw.stats : {};
  for (const key of Object.keys(out.stats)) out.stats[key] = int(stats[key], Number.MAX_SAFE_INTEGER);
  return out;
}

/** localStorage if it exists *and* accepts writes, otherwise null (in-memory fallback). */
function probeStorage() {
  try {
    const s = window.localStorage; // the getter itself throws in some sandboxed iframes
    const k = '__neon_surge_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export class Meta {
  constructor({ storage = probeStorage(), key = STORAGE_KEYS.meta } = {}) {
    this.storage = storage;
    this.key = key;
    this.persistent = !!storage; // false => progress lives only for this session
    this.error = null;
    this.listeners = new Set();
    this.data = this._read();
    if (storage && typeof window !== 'undefined') {
      // Another tab/window saved: adopt its data instead of overwriting it later.
      window.addEventListener('storage', (e) => {
        if (e.key !== this.key) return;
        this.data = this._read();
        this._emit('external');
      });
    }
  }

  // --- storage ------------------------------------------------------------------------

  _read() {
    if (!this.storage) return this.data ?? blankSave();
    let text = null;
    try {
      text = this.storage.getItem(this.key);
    } catch (err) {
      this._fail(err);
      return this.data ?? blankSave();
    }
    if (text === null) return this._fresh();
    try {
      return sanitizeSave(JSON.parse(text));
    } catch (err) {
      // Unparseable save: keep a copy for recovery instead of silently destroying it.
      console.warn('[neon-surge] save data is corrupted; backed up and reset', err);
      try {
        this.storage.setItem(`${this.key}.corrupt`, text);
      } catch {
        /* no room for the backup */
      }
      const fresh = blankSave();
      this._write(fresh);
      return fresh;
    }
  }

  /** First launch: carry the high score over from the pre-roguelite build. */
  _fresh() {
    const fresh = blankSave();
    try {
      const legacy = Number(this.storage.getItem(STORAGE_KEYS.legacyBest));
      if (Number.isFinite(legacy) && legacy > 0) fresh.stats.bestScore = int(legacy, Number.MAX_SAFE_INTEGER);
    } catch {
      /* ignore */
    }
    return fresh;
  }

  _write(data) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
      this.persistent = true;
      this.error = null;
      return true;
    } catch (err) {
      this._fail(err); // quota exceeded / revoked permission: keep playing in memory
      return false;
    }
  }

  _fail(err) {
    this.persistent = false;
    this.error = err?.name ?? 'StorageError';
    console.warn('[neon-surge] progress could not be saved:', err);
  }

  /** Re-read before every mutation so a stale tab never clobbers newer progress. */
  _sync() {
    if (this.storage) this.data = this._read();
  }

  save() {
    return this._write(this.data);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(reason) {
    for (const fn of this.listeners) fn(reason, this);
  }

  // --- queries ------------------------------------------------------------------------

  get shards() {
    return this.data.shards;
  }

  get levels() {
    return this.data.levels;
  }

  get records() {
    return this.data.stats;
  }

  level(id) {
    return this.data.levels[id] ?? 0;
  }

  /** Cost of the next level, or null when maxed / unknown. */
  cost(id) {
    const item = SHOP_BY_ID[id];
    if (!item) return null;
    const lvl = this.level(id);
    return lvl >= item.max ? null : shopCost(item, lvl);
  }

  // --- mutations ----------------------------------------------------------------------

  buy(id) {
    const item = SHOP_BY_ID[id];
    if (!item) return { ok: false, reason: 'unknown' };
    this._sync();
    const lvl = this.level(id);
    if (lvl >= item.max) return { ok: false, reason: 'max' };
    const cost = shopCost(item, lvl);
    if (this.data.shards < cost) return { ok: false, reason: 'funds', cost };
    this.data.shards -= cost;
    this.data.levels[id] = lvl + 1;
    const saved = this.save();
    this._emit('buy');
    return { ok: true, level: lvl + 1, cost, saved };
  }

  /** Bank a finished run: shards + lifetime records in a single write. */
  commitRun({ shards = 0, wave = 0, score = 0, kills = 0 }) {
    this._sync();
    const d = this.data;
    const earned = int(shards);
    d.shards = Math.min(MAX_SHARDS, d.shards + earned);
    const st = d.stats;
    const newBestWave = int(wave) > st.bestWave;
    const newBestScore = int(score, Number.MAX_SAFE_INTEGER) > st.bestScore;
    st.runs += 1;
    st.totalKills += int(kills, Number.MAX_SAFE_INTEGER);
    st.totalShards += earned;
    if (newBestWave) st.bestWave = int(wave);
    if (newBestScore) st.bestScore = int(score, Number.MAX_SAFE_INTEGER);
    const saved = this.save();
    this._emit('run');
    return { newBestWave, newBestScore, saved };
  }

  reset() {
    this.data = blankSave();
    const saved = this.save();
    this._emit('reset');
    return saved;
  }
}

// --- run rewards ------------------------------------------------------------------------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Neon Shards for a run. Survival time and waves carry most of the value so that a run
 * always pays out something, score adds a (square-rooted) bonus, and elites pay a bounty.
 */
export function computeRewards({ time = 0, wavesCleared = 0, score = 0, eliteKills = 0, bonus = 0 } = {}, shardMul = 1) {
  const t = num(time);
  const rows = [
    { id: 'time', label: 'SURVIVAL', detail: formatTime(t), value: Math.floor(t * 0.4) },
    { id: 'waves', label: 'WAVES CLEARED', detail: String(Math.floor(num(wavesCleared))), value: Math.floor(num(wavesCleared)) * 8 },
    { id: 'score', label: 'SCORE BONUS', detail: Math.floor(num(score)).toLocaleString('en-US'), value: Math.floor(Math.sqrt(num(score)) * 0.08) },
    { id: 'elites', label: 'ELITE BOUNTIES', detail: String(Math.floor(num(eliteKills))), value: Math.floor(num(eliteKills)) * 15 },
  ];
  if (num(bonus)) rows.push({ id: 'bonus', label: 'SHARD CACHES', detail: '', value: Math.floor(num(bonus)) });
  const base = rows.reduce((a, r) => a + r.value, 0);
  const mul = Math.max(1, num(shardMul) || 1);
  return { rows, base, mul, total: Math.round(base * mul) };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
