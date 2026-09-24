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
  bulletByLevel: [0x78f5ff, 0x9dfbff, 0xc9fbff, 0xfff1a8, 0xffd0f5],
};

export const PLAYER = {
  hitRadius: 12,
  size: 34, // visual half-size in world units
  maxSpeed: 560,
  response: 13, // velocity smoothing (higher = snappier)
  lives: 3,
  maxLives: 5,
  invulnTime: 2.6,
  // Bonus ships at progress 15k, 45k, 90k, 150k... (gaps grow by this step each time)
  extraLifeStep: 15000,
};

export const WEAPON = {
  bulletSpeed: 1650,
  bulletLife: 0.95,
  bulletRadius: 7,
  // Progress thresholds (un-multiplied kill value) unlock stronger patterns.
  // pattern entries: [angleDeg, lateralOffset]
  levels: [
    { progress: 0, rate: 10, pierce: 0, pattern: [[0, 0]] },
    { progress: 1500, rate: 11, pierce: 0, pattern: [[0, -7], [0, 7]] },
    { progress: 5000, rate: 12, pierce: 0, pattern: [[-4.5, 0], [0, 0], [4.5, 0]] },
    { progress: 12000, rate: 13, pierce: 0, pattern: [[-7.5, 0], [0, -7], [0, 7], [7.5, 0]] },
    { progress: 25000, rate: 14, pierce: 1, pattern: [[-11, 0], [-5.5, 0], [0, 0], [5.5, 0], [11, 0]] },
  ],
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

// Enemy archetypes. `cost` is spent from the director's spawn budget.
export const ENEMIES = {
  dart: {
    label: 'DART', color: 0xff2bd6, radius: 21, hp: 1, speed: 285, accel: 1150,
    score: 50, flux: 0.5, cost: 1, mass: 1, surge: 0.007, unlock: 0,
  },
  wisp: {
    label: 'WISP', color: 0x4d8bff, radius: 20, hp: 2, speed: 235, accel: 900,
    score: 100, flux: 0.6, cost: 1.5, mass: 0.8, surge: 0.009, unlock: 0.7,
  },
  lancer: {
    label: 'LANCER', color: 0xc6ff2e, radius: 23, hp: 3, speed: 150, accel: 700,
    dashSpeed: 1250, score: 175, flux: 1, cost: 2.5, mass: 1.2, surge: 0.013, unlock: 1.5,
  },
  bulwark: {
    label: 'BULWARK', color: 0xff7a1a, radius: 44, hp: 14, speed: 82, accel: 260,
    score: 350, flux: 3, cost: 4.5, mass: 7, surge: 0.035, unlock: 2.2,
  },
  hive: {
    label: 'HIVE', color: 0xa45cff, radius: 32, hp: 5, speed: 118, accel: 420,
    score: 200, flux: 1, cost: 3, mass: 2.5, surge: 0.013, unlock: 3.0, splits: 4,
  },
  mite: {
    label: 'MITE', color: 0xe07bff, radius: 13, hp: 1, speed: 360, accel: 1400,
    score: 25, flux: 0.2, cost: 0, mass: 0.6, surge: 0.003, unlock: Infinity,
  },
  sentry: {
    label: 'SENTRY', color: 0xff2d55, radius: 29, hp: 7, speed: 165, accel: 500,
    score: 300, flux: 2, cost: 4, mass: 3, surge: 0.025, unlock: 3.8, fireInterval: 2.3,
  },
};

export const DIRECTOR = {
  graceTime: 1.5, // quiet seconds at the start of a run
  openingBudget: 3.5, // budget banked at the start so the first pack arrives immediately
  // threat = sqrt(progress / progressDiv) + time / timeDiv, where progress is the
  // un-multiplied value of every kill (so it tracks score without exploding with it).
  progressDiv: 3000,
  timeDiv: 100,
  budgetBase: 2.0,
  budgetPerThreat: 0.85,
  budgetMax: 15,
  maxAliveBase: 26,
  maxAlivePerThreat: 11,
  maxAliveCap: 180,
  speedPerThreat: 0.05,
  speedThreatCap: 14,
  hpPerThreat: 0.14,
  waveEvery: 30, // seconds between set-piece waves
};

export const QUALITY = {
  high: { maxDpr: 2, renderScale: 1, bloomMips: 6, particles: 1, grid: 1 },
  medium: { maxDpr: 1.5, renderScale: 0.85, bloomMips: 5, particles: 0.7, grid: 1 },
  low: { maxDpr: 1, renderScale: 0.7, bloomMips: 4, particles: 0.45, grid: 1 },
};

export const STORAGE_KEYS = {
  settings: 'neon-surge.settings.v1',
  best: 'neon-surge.best.v1',
};
