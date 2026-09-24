import { pixiSource, PIXI_VERSION } from './lib/pixi.js';
import { Pipeline } from './render/Pipeline.js';
import { Atlas } from './render/Atlas.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Input } from './core/Input.js';
import { UI } from './ui/UI.js';
import { Game } from './game/Game.js';
import { Meta } from './game/Meta.js';
import { loadSettings, saveSettings } from './ui/settings.js';

window.__NEON_BOOTED__ = true;

const params = new URLSearchParams(location.search);
const debug = { god: params.has('god'), enabled: params.has('debug') };
const desktop = window.neonDesktop ?? null;

async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const faces = ['900 52px Orbitron', '700 16px Orbitron', '500 16px Rajdhani', '700 16px Rajdhani'];
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))), timeout]);
}

async function toggleFullscreen() {
  if (desktop) return desktop.toggleFullscreen();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (err) {
    console.warn('[neon-surge] fullscreen unavailable:', err);
  }
  return undefined;
}

async function boot() {
  const ui = new UI();
  ui.bootStatus('LOADING');
  await loadFonts();

  ui.bootStatus('COMPILING SHADERS');
  const stage = document.getElementById('stage');
  const pipeline = await Pipeline.create(stage);
  const atlas = new Atlas().build();
  const audio = new AudioEngine();
  const input = new Input(stage);
  const settings = loadSettings();
  const meta = new Meta(); // Neon Shards + Hangar levels (localStorage, validated)
  ui.audio = audio;

  const game = new Game({ pipeline, atlas, audio, input, ui, settings, meta, debug });

  ui.on('play', () => game.startRun());
  ui.on('hangar', () => game.openHangar(null));
  ui.on('resume', () => game.resume());
  ui.on('abandon', () => game.abandonRun());
  ui.on('title', () => game.toTitle());
  ui.on('pick', (i) => game.pickUpgrade(i));
  ui.on('reroll', () => game.rerollUpgrades());
  ui.on('buy', (id) => game.buy(id));
  ui.on('resetProgress', () => {
    game.resetProgress();
    ui.back();
  });
  ui.on('fullscreen', () => toggleFullscreen());
  ui.on('quit', () => desktop?.quit());
  // Wallet changed (purchase, reset, or another tab): keep every visible number honest.
  meta.subscribe((reason) => {
    ui.refreshWallet(meta);
    if (reason !== 'buy' && game.state === 'hangar') ui.renderShop(meta);
  });
  ui.bindSettings(settings, (s) => {
    game.applySettings(s);
    saveSettings(s);
  });

  if (desktop) {
    ui.setDesktop(desktop);
    desktop.onFullscreenChange((fs) => ui.setWindowed(!fs));
    desktop.isFullscreen().then((fs) => ui.setWindowed(!fs));
  }

  // Audio: the desktop build may autoplay; browsers need a first user gesture.
  const unlockAudio = () => {
    audio.unlock();
    if (audio.music && (game.state === 'title' || game.state === 'hangar')) audio.music.start();
    if (audio.ready) {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    }
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  if (desktop) unlockAudio();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !e.repeat) toggleFullscreen();
  });
  window.addEventListener('resize', () => game.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });
  window.addEventListener('blur', () => game.pause());

  if (debug.enabled) window.NEON = game;
  if (!meta.persistent) console.warn('[neon-surge] storage unavailable: progress is kept for this session only');
  console.info(`[neon-surge] PixiJS ${PIXI_VERSION} (${pixiSource}), ${pipeline.hdr ? 'HDR' : 'LDR'} pipeline`);

  let failed = false;
  const loop = (now) => {
    requestAnimationFrame(loop);
    try {
      game.frame(now);
    } catch (err) {
      if (!failed) {
        failed = true;
        console.error('[neon-surge] frame error', err);
      }
    }
  };
  game.toTitle();
  window.__NEON_READY__ = true;
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  if (window.__neonBootError) window.__neonBootError(err?.message ?? String(err));
});
