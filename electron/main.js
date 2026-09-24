'use strict';

// NEON SURGE — Electron shell for the Windows (.exe) build.
//
// The game is served from a private `app://neon-surge/` origin instead of file:// so ES
// modules, fetch and localStorage behave exactly as they do on a web server / itch.io.
// The window is frameless; it starts fullscreen (F11 or Alt+Enter toggles windowed mode)
// and remembers the player's choice and window bounds between sessions.

const { app, BrowserWindow, protocol, ipcMain, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SCHEME = 'app';
const HOST = 'neon-surge';
const ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = path.resolve(__dirname, '..'); // inside app.asar when packaged

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// PixiJS generates its uniform-sync functions at runtime, hence 'unsafe-eval'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

// Keep WebGL on older/blocklisted GPUs, let the soundtrack start without a click, and
// never throttle the game loop.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let win = null;

// --- window state ----------------------------------------------------------------------

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const state = { fullscreen: win.isFullScreen(), bounds: win.getNormalBounds() };
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

function boundsAreVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width - 64 && bounds.x + bounds.width > a.x + 64 && bounds.y >= a.y - 8 && bounds.y < a.y + a.height - 64);
}

// --- app:// protocol ---------------------------------------------------------------------

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      const ext = path.extname(file).toLowerCase();
      const headers = { 'content-type': MIME[ext] ?? 'application/octet-stream' };
      if (ext === '.html') headers['content-security-policy'] = CSP;
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// --- window ------------------------------------------------------------------------------

function toggleFullscreen() {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
}

function createWindow() {
  const state = loadState();
  const area = screen.getPrimaryDisplay().workAreaSize;
  const startWindowed = process.argv.includes('--windowed');
  const fullscreen = startWindowed ? false : state.fullscreen ?? true;
  const saved = state.bounds && boundsAreVisible(state.bounds) ? state.bounds : null;
  const width = saved?.width ?? Math.min(1600, Math.round(area.width * 0.8));
  const height = saved?.height ?? Math.min(900, Math.round(area.height * 0.8));

  win = new BrowserWindow({
    width,
    height,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 540,
    frame: false,
    fullscreen,
    fullscreenable: true,
    show: false,
    backgroundColor: '#03040b',
    title: 'Neon Surge',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  if (!saved) win.center();

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Never navigate away from the game or spawn new windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      toggleFullscreen();
    } else if (!app.isPackaged && input.control && input.shift && key === 'i') {
      win.webContents.toggleDevTools();
    } else if (!app.isPackaged && input.control && key === 'r') {
      win.webContents.reload();
    }
  });

  const notify = () => {
    if (!win.isDestroyed()) win.webContents.send('window:fullscreen-changed', win.isFullScreen());
  };
  win.on('enter-full-screen', notify);
  win.on('leave-full-screen', notify);
  win.on('close', saveState);
  win.on('closed', () => {
    win = null;
  });

  win.loadURL(`${ORIGIN}/index.html`);
}

// --- IPC (only from our own origin) ------------------------------------------------------

const trusted = (event) => {
  try {
    return new URL(event.senderFrame.url).origin === ORIGIN;
  } catch {
    return false;
  }
};

ipcMain.handle('window:toggle-fullscreen', (event) => (trusted(event) ? toggleFullscreen() : false));
ipcMain.handle('window:is-fullscreen', (event) => (trusted(event) && win ? win.isFullScreen() : false));
ipcMain.on('window:minimize', (event) => {
  if (trusted(event)) win?.minimize();
});
ipcMain.on('app:quit', (event) => {
  if (trusted(event)) app.quit();
});

// --- lifecycle ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.neonsurge.game');
    Menu.setApplicationMenu(null);
    registerAppProtocol();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
