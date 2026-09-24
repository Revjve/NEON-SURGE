import { BASE_STATS, PALETTE } from '../config.js';
import { SHOP } from './Meta.js';

// In-run upgrades. Nothing here mutates game objects directly: every upgrade is a pure
// modifier `apply(stats, stacks)` over a flat stats table. The table is rebuilt from
// scratch (BASE_STATS -> Hangar levels -> upgrade stacks, in a fixed order) whenever the
// build changes, so any combination stacks deterministically and nothing can drift.
//
// Bullet behaviour is then baked into a single *shot profile* that every projectile the
// player owns references: main-gun bolts, multishot extras, drone bolts and shrapnel.
// That is what makes the mods synergise, e.g. with SPLIT BARREL + VOLATILE ROUNDS every
// extra bolt explodes, and with FRAGMENTATION the shards pierce, bounce and explode too.

export const RARITY = {
  common: { label: 'COMMON', weight: 100, luck: 0, minRound: 1, color: PALETTE.rarity.common },
  rare: { label: 'RARE', weight: 40, luck: 9, minRound: 1, color: PALETTE.rarity.rare },
  epic: { label: 'EPIC', weight: 13, luck: 5, minRound: 3, color: PALETTE.rarity.epic },
};

const pct = (v) => `${Math.round(v * 100)}%`;

export const UPGRADES = [
  // --- weapon ------------------------------------------------------------------------
  {
    id: 'multishot', name: 'SPLIT BARREL', rarity: 'rare', tag: 'WEAPON', max: 6,
    desc: '+1 bolt per volley, fanned out.',
    synergy: 'Every extra bolt carries all of your bullet mods.',
    pairs: ['explosive', 'pierce', 'chain', 'crit', 'shrapnel'],
    stat: (s) => `${s.projectiles} BOLT${s.projectiles > 1 ? 'S' : ''} / VOLLEY`,
    apply: (s, n) => { s.projectiles += n; },
  },
  {
    id: 'firerate', name: 'OVERCLOCK', rarity: 'common', tag: 'WEAPON', max: 8,
    desc: '+20% fire rate.',
    pairs: ['multishot', 'chain', 'crit'],
    stat: (s) => `${s.fireRate.toFixed(1)} VOLLEYS / SEC`,
    apply: (s, n) => { s.fireRate *= 1 + 0.2 * n; },
  },
  {
    id: 'damage', name: 'PLASMA CORE', rarity: 'common', tag: 'WEAPON', max: 8,
    desc: '+25% bolt damage.',
    synergy: 'Blasts, arcs, shards and drones all scale off bolt damage.',
    pairs: ['explosive', 'chain', 'shrapnel', 'drone'],
    stat: (s) => `${s.damage.toFixed(2)} DAMAGE`,
    apply: (s, n) => { s.damage *= 1 + 0.25 * n; },
  },
  {
    id: 'explosive', name: 'VOLATILE ROUNDS', rarity: 'rare', tag: 'WEAPON', max: 4,
    desc: 'Enemies killed by your projectiles detonate, dealing AoE damage. Stacks grow the blast.',
    synergy: 'Works on every bolt, shard, arc and drone kill.',
    pairs: ['multishot', 'pierce', 'shrapnel', 'cascade', 'bounce'],
    stat: (s) => (s.explosive ? `${Math.round(s.blastRadius)}u BLAST · ${pct(s.blastMul)} DMG` : 'NO BLAST'),
    apply: (s, n) => { s.explosive += n; },
  },
  {
    id: 'bounce', name: 'RICOCHET', rarity: 'common', tag: 'WEAPON', max: 4,
    desc: 'Bolts bounce off the arena walls (+1 bounce, +30% range).',
    synergy: 'Pairs with Phase Rounds and Seeker Guidance for bolts that never stop.',
    pairs: ['pierce', 'homing', 'multishot'],
    stat: (s) => `${s.bounces} BOUNCE${s.bounces === 1 ? '' : 'S'}`,
    apply: (s, n) => { s.bounces += n; s.range *= 1 + 0.3 * n; },
  },
  {
    id: 'pierce', name: 'PHASE ROUNDS', rarity: 'common', tag: 'WEAPON', max: 5,
    desc: 'Bolts pass through +1 more enemy.',
    pairs: ['multishot', 'explosive', 'bounce', 'chain'],
    stat: (s) => `PIERCES ${s.pierce}`,
    apply: (s, n) => { s.pierce += n; },
  },
  {
    id: 'velocity', name: 'RAIL ACCELERATOR', rarity: 'common', tag: 'WEAPON', max: 4,
    desc: '+25% bolt speed, +20% range, +10% damage.',
    pairs: ['pierce', 'bounce'],
    stat: (s) => `${Math.round(s.bulletSpeed)} U/S`,
    apply: (s, n) => { s.bulletSpeed *= 1 + 0.25 * n; s.range *= 1 + 0.2 * n; s.damage *= 1 + 0.1 * n; },
  },
  {
    id: 'caliber', name: 'HEAVY CALIBER', rarity: 'common', tag: 'WEAPON', max: 3,
    desc: '+35% bolt size, +25% damage, but -6% fire rate.',
    pairs: ['pierce', 'multishot'],
    stat: (s) => `SIZE ×${s.bulletSize.toFixed(2)}`,
    apply: (s, n) => { s.bulletSize *= 1 + 0.35 * n; s.damage *= 1 + 0.25 * n; s.fireRate *= 1 - 0.06 * n; },
  },
  {
    id: 'chain', name: 'ARC COIL', rarity: 'rare', tag: 'WEAPON', max: 4,
    desc: 'Every hit arcs lightning to +1 nearby enemy for 50% damage.',
    synergy: 'Arc kills trigger Volatile Rounds and Fragmentation.',
    pairs: ['multishot', 'firerate', 'explosive', 'shrapnel'],
    stat: (s) => `${s.chain} ARC JUMP${s.chain === 1 ? '' : 'S'}`,
    apply: (s, n) => { s.chain += n; },
  },
  {
    id: 'crit', name: 'OVERCHARGE', rarity: 'common', tag: 'WEAPON', max: 5,
    desc: '+10% critical chance, +25% critical damage.',
    pairs: ['multishot', 'firerate'],
    stat: (s) => `${pct(s.critChance)} CRIT · ×${s.critMult.toFixed(2)}`,
    apply: (s, n) => { s.critChance += 0.1 * n; s.critMult += 0.25 * n; },
  },
  {
    id: 'homing', name: 'SEEKER GUIDANCE', rarity: 'rare', tag: 'WEAPON', max: 3,
    desc: 'Bolts curve toward nearby enemies. Stacks turn harder and see further.',
    pairs: ['bounce', 'pierce', 'multishot'],
    stat: (s) => `TRACKING LV ${s.homing}`,
    apply: (s, n) => { s.homing += n; },
  },
  {
    id: 'shrapnel', name: 'FRAGMENTATION', rarity: 'epic', tag: 'WEAPON', max: 3,
    desc: 'Kills burst into shards that inherit all bullet mods (55% damage).',
    synergy: 'Shards pierce, bounce, arc, crit and explode.',
    pairs: ['explosive', 'pierce', 'bounce', 'chain'],
    stat: (s) => (s.shrapnel ? `${s.shrapnelCount} SHARDS / KILL` : 'NO SHARDS'),
    apply: (s, n) => { s.shrapnel += n; },
  },
  {
    id: 'cascade', name: 'CHAIN REACTION', rarity: 'epic', tag: 'WEAPON', max: 1, requires: 'explosive',
    desc: 'Enemies killed by a blast detonate as well (weaker each link).',
    synergy: 'Requires Volatile Rounds. Turns swarms into fireworks.',
    pairs: ['explosive', 'multishot'],
    stat: (s) => (s.cascade ? 'CASCADE ONLINE' : 'OFFLINE'),
    apply: (s) => { s.cascade = 1; },
  },
  {
    id: 'drone', name: 'GUARDIAN DRONE', rarity: 'epic', tag: 'WEAPON', max: 3,
    desc: '+1 orbiting drone that fires your bolts (60% damage) at the nearest enemy.',
    synergy: 'Drones inherit every bullet mod and half your multishot.',
    pairs: ['explosive', 'chain', 'homing', 'multishot'],
    stat: (s) => `${s.drones} DRONE${s.drones === 1 ? '' : 'S'}`,
    apply: (s, n) => { s.drones += n; },
  },

  // --- defense -----------------------------------------------------------------------
  {
    id: 'hull', name: 'HULL PLATING', rarity: 'common', tag: 'DEFENSE', max: 5,
    desc: '+1 max hull and repair 1 hull now.',
    pairs: ['repair'],
    stat: (s) => `${s.maxHull} MAX HULL`,
    apply: (s, n) => { s.maxHull += n; },
  },
  {
    id: 'repair', name: 'NANITE SWARM', rarity: 'rare', tag: 'DEFENSE', max: 2,
    desc: 'Repair +1 hull after every cleared wave.',
    pairs: ['hull'],
    stat: (s) => `+${s.repair} HULL / WAVE`,
    apply: (s, n) => { s.repair += n; },
  },
  {
    id: 'shield', name: 'DEFLECTOR', rarity: 'rare', tag: 'DEFENSE', max: 2,
    desc: 'A shield charge absorbs +1 hit every wave.',
    pairs: ['hull'],
    stat: (s) => `${s.shield} CHARGE${s.shield === 1 ? '' : 'S'} / WAVE`,
    apply: (s, n) => { s.shield += n; },
  },

  // --- utility -----------------------------------------------------------------------
  {
    id: 'speed', name: 'AFTERBURNERS', rarity: 'common', tag: 'UTILITY', max: 4,
    desc: '+12% movement speed.',
    stat: (s) => `${Math.round(s.moveSpeed)} U/S`,
    apply: (s, n) => { s.moveSpeed *= 1 + 0.12 * n; },
  },
  {
    id: 'magnet', name: 'FLUX MAGNET', rarity: 'common', tag: 'UTILITY', max: 3,
    desc: '+60% flux pickup range and +25% flux drop chance.',
    pairs: ['surge'],
    stat: (s) => `${Math.round(s.magnet)}u RANGE`,
    apply: (s, n) => { s.magnet *= 1 + 0.6 * n; s.fluxBonus += 0.25 * n; },
  },
  {
    id: 'surge', name: 'SURGE CAPACITOR', rarity: 'common', tag: 'UTILITY', max: 4,
    desc: 'Surge charges 35% faster.',
    pairs: ['magnet'],
    stat: (s) => `×${s.surgeGain.toFixed(2)} CHARGE`,
    apply: (s, n) => { s.surgeGain *= 1 + 0.35 * n; },
  },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Offered only when every regular upgrade is maxed out (or excluded by a reroll). */
export const CACHE_OFFER = {
  id: 'cache', name: 'SHARD CACHE', rarity: 'rare', tag: 'UTILITY', max: Infinity,
  desc: '+30 bonus Neon Shards at the end of the run.',
  stat: () => '+30 SHARDS',
  apply: () => {},
};

/**
 * Full stat table for a build. `metaLevels` are Hangar levels, `stacks` maps upgrade id
 * to how many times it was picked this run.
 */
export function computeStats(metaLevels = {}, stacks = {}) {
  const s = { ...BASE_STATS };
  for (const item of SHOP) {
    const n = metaLevels[item.id] | 0;
    if (n > 0) item.apply(s, n);
  }
  for (const u of UPGRADES) {
    const n = Math.min(u.max, stacks[u.id] | 0);
    if (n > 0) u.apply(s, n);
  }
  // Hard caps keep degenerate builds playable (and the frame rate intact).
  s.projectiles = Math.min(12, s.projectiles);
  s.fireRate = Math.min(30, s.fireRate);
  s.critChance = Math.min(0.75, s.critChance);
  s.maxHull = Math.min(12, s.maxHull);
  s.startSurge = Math.min(1, s.startSurge);
  // Derived values.
  s.blastRadius = s.explosive ? 85 + 25 * (s.explosive - 1) : 0;
  s.blastMul = s.explosive ? 0.8 + 0.3 * (s.explosive - 1) : 0;
  s.chainMul = 0.5;
  s.chainRange = 250;
  s.turnRate = 3.2 * s.homing;
  s.seekRadius = 320 + 70 * s.homing;
  s.shrapnelCount = s.shrapnel ? s.shrapnel + 1 : 0;
  s.shrapnelMul = 0.55;
  return s;
}

/** The shared projectile profile every player-owned bolt references. */
export function buildShot(s) {
  let color = PALETTE.bullet;
  if (s.explosive) color = 0xffb45a;
  else if (s.chain) color = PALETTE.arc;
  else if (s.homing) color = 0x8dffc0;
  else if (s.critChance >= 0.2) color = 0xff9df0;
  return {
    damage: s.damage,
    speed: s.bulletSpeed,
    life: s.range / s.bulletSpeed,
    radius: 7 * s.bulletSize,
    size: s.bulletSize,
    pierce: s.pierce,
    bounces: s.bounces,
    explosive: s.explosive,
    blastRadius: s.blastRadius,
    blastMul: s.blastMul,
    cascade: s.cascade,
    chain: s.chain,
    chainMul: s.chainMul,
    chainRange: s.chainRange,
    critChance: s.critChance,
    critMult: s.critMult,
    homing: s.homing,
    turnRate: s.turnRate,
    seekRadius: s.seekRadius,
    shrapnel: s.shrapnelCount,
    shrapnelMul: s.shrapnelMul,
    color,
  };
}

function available(u, stacks, round) {
  if ((stacks[u.id] | 0) >= u.max) return false;
  if (u.requires && !(stacks[u.requires] > 0)) return false;
  return round >= RARITY[u.rarity].minRound;
}

function weightOf(u, stacks, luck) {
  const r = RARITY[u.rarity];
  let w = r.weight + r.luck * luck;
  // Synergy steering: things that combine with what you already own show up more.
  if (u.pairs && u.pairs.some((id) => stacks[id] > 0)) w *= 1.6;
  if (u.requires) w *= 1.5; // unlocked finishers deserve to be seen
  return w;
}

function weightedPick(pool, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return pool.length - 1;
}

/**
 * Roll `count` distinct offers, weighted by rarity (+luck) and synergy with the current
 * build. At least one WEAPON upgrade is guaranteed whenever one is available.
 */
export function rollOffers(stacks, { count = 3, luck = 0, round = 1, exclude = [] } = {}) {
  let pool = UPGRADES.filter((u) => available(u, stacks, round) && !exclude.includes(u.id));
  if (pool.length < count) {
    // Rerolled into a corner: allow the excluded ones back rather than show fewer cards.
    pool = UPGRADES.filter((u) => available(u, stacks, round));
  }
  const weights = pool.map((u) => weightOf(u, stacks, luck));
  const offers = [];
  while (offers.length < count && pool.length) {
    const i = weightedPick(pool, weights);
    offers.push(pool[i]);
    pool.splice(i, 1);
    weights.splice(i, 1);
  }
  if (offers.length && !offers.some((u) => u.tag === 'WEAPON')) {
    const weapons = pool.filter((u) => u.tag === 'WEAPON');
    if (weapons.length) {
      const i = weightedPick(weapons, weapons.map((u) => weightOf(u, stacks, luck)));
      offers[offers.length - 1] = weapons[i];
    }
  }
  while (offers.length < count) offers.push(CACHE_OFFER);
  return offers;
}
