// Central tuning file. Every gameplay / feel number lives here so balancing never means
// hunting through systems.

export const ARENA = { w: 1920, h: 1080 };

export const CAMERA = {
  margin: 70, // world units visible around the arena edge
  follow: 0.055, // how much the camera leans toward the player (0 = locked)
  maxShake: 34, // px (in 1080p reference space) at trauma 1
  maxShakeRot: 0.045, // radians at trauma 1
  traumaDecay: 1.35, // trauma units per second
};

export const PALETTE = {
  player: 0x3ef2ff,
  playerCore: 0xe6fdff,
  shield: 0x7ab8ff,
  border: 0x3350ff,
  borderHot: 0x9d7bff,
  flux: 0xffc94a,
  surge: 0x8f6bff,
  danger: 0xff2255,
  white: 0xffffff,
  bullet: 0x78f5ff,
  purge: 0xffd66b,
  repair: 0x7dff9a,
  arc: 0xb49dff,
  rarity: { common: 0x3ef2ff, rare: 0xb36bff, epic: 0xffc94a },
};

export const PLAYER = {
  hitRadius: 12,
  size: 34, // visual half-size in world units
  response: 13, // velocity smoothing (higher = snappier)
  invulnTime: 2.2, // after losing hull
  shieldInvuln: 1.0, // after a Deflector charge absorbs a hit
};

// Base loadout before permanent (meta) and in-run (upgrade) modifiers. Stats are always
// recomputed from this table, so upgrades stack deterministically in any order.
export const BASE_STATS = {
  maxHull: 3,
  moveSpeed: 560,
  fireRate: 8.5, // volleys per second
  projectiles: 1, // bolts per volley
  damage: 1,
  bulletSpeed: 1650,
  range: 1550, // world units a bolt travels before fizzling
  bulletSize: 1,
  pierce: 0,
  bounces: 0,
  explosive: 0,
  cascade: 0,
  chain: 0,
  critChance: 0,
  critMult: 2.5,
  homing: 0,
  shrapnel: 0,
  drones: 0,
  shield: 0, // hits absorbed per wave
  repair: 0, // hull repaired after each wave
  magnet: 190,
  fluxBonus: 0, // extra flux drop chance
  surgeGain: 1,
  startSurge: 0,
  shardMul: 1,
  rerolls: 0,
  luck: 0,
};

export const SURGE = {
  speed: 2100, // shock front speed (world units / s)
  maxRadius: 2400,
  fluxGain: 0.0025,
};

export const FLUX = {
  magnetRadius: 190,
  collectRadius: 28,
  life: 7.5,
  maxMultiplier: 99,
};

// Enemy archetypes. `cost` is spent from the director's spawn budget; `hpScale` controls
// how strongly the per-round HP multiplier applies (fodder scales slower). Darts start just
// under one bolt of damage: they stay one-shot for the first waves, and damage upgrades
// are what keep them one-shot later (a satisfying breakpoint to chase).
export const ENEMIES = {
  dart: {
    label: 'DART', color: 0xff2bd6, radius: 21, hp: 0.8, speed: 285, accel: 1150,
    score: 50, flux: 0.5, cost: 1, mass: 1, surge: 0.007, unlockRound: 1, hpScale: 0.6,
  },
  wisp: {
    label: 'WISP', color: 0x4d8bff, radius: 20, hp: 2, speed: 235, accel: 900,
    score: 100, flux: 0.6, cost: 1.5, mass: 0.8, surge: 0.009, unlockRound: 2, hpScale: 0.9,
  },
  lancer: {
    label: 'LANCER', color: 0xc6ff2e, radius: 23, hp: 3, speed: 150, accel: 700,
    dashSpeed: 1250, score: 175, flux: 1, cost: 2.5, mass: 1.2, surge: 0.013, unlockRound: 3, hpScale: 1,
  },
  bulwark: {
    label: 'BULWARK', color: 0xff7a1a, radius: 44, hp: 14, speed: 82, accel: 260,
    score: 350, flux: 3, cost: 4.5, mass: 7, surge: 0.035, unlockRound: 4, hpScale: 1,
  },
  hive: {
    label: 'HIVE', color: 0xa45cff, radius: 32, hp: 5, speed: 118, accel: 420,
    score: 200, flux: 1, cost: 3, mass: 2.5, surge: 0.013, unlockRound: 5, hpScale: 1, splits: 4,
  },
  mite: {
    label: 'MITE', color: 0xe07bff, radius: 13, hp: 0.6, speed: 360, accel: 1400,
    score: 25, flux: 0.2, cost: 0, mass: 0.6, surge: 0.003, unlockRound: Infinity, hpScale: 0.5,
  },
  sentry: {
    label: 'SENTRY', color: 0xff2d55, radius: 29, hp: 7, speed: 165, accel: 500,
    score: 300, flux: 2, cost: 4, mass: 3, surge: 0.025, unlockRound: 6, hpScale: 1, fireInterval: 2.3,
  },
};

// Timed rounds. Difficulty is a function of the round number only; the player's power
// comes from the upgrades picked between rounds.
export const ROUNDS = {
  firstDuration: 25, // seconds
  durationStep: 2,
  maxDuration: 45,
  grace: 1.2, // quiet seconds at the start of each round
  openingBudget: 3.5,
  budgetBase: 1.6, // spawn budget per second in round 1
  budgetPerRound: 0.6,
  budgetMax: 14,
  maxAliveBase: 20,
  maxAlivePerRound: 7.5,
  maxAliveCap: 170,
  speedPerRound: 0.035,
  speedRoundCap: 14,
  hpLinear: 0.14, // enemy HP x (1 + a*k + b*k^2), k = round - 1
  hpQuadratic: 0.012,
  eliteEvery: 5, // every Nth round has an elite that must die before the round ends
  eliteHp: 4, // elite HP = (base hp + 6) x round HP multiplier x this
  eliteSize: 1.75,
  clearTime: 1.8, // round-clear celebration before the upgrade screen
};

export const QUALITY = {
  high: { maxDpr: 2, renderScale: 1, bloomMips: 6, particles: 1, grid: 1 },
  medium: { maxDpr: 1.5, renderScale: 0.85, bloomMips: 5, particles: 0.7, grid: 1 },
  low: { maxDpr: 1, renderScale: 0.7, bloomMips: 4, particles: 0.45, grid: 1 },
};

export const STORAGE_KEYS = {
  settings: 'neon-surge.settings.v1',
  meta: 'neon-surge.meta.v1',
  legacyBest: 'neon-surge.best.v1', // high score from the pre-roguelite build (migrated once)
};
