// DOM layer: screens, HUD, announcements, settings. Crisp text lives here; everything
// that glows in-world is rendered by WebGL.

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const SHIP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21 L12 2 L21 21 L12 15.5 Z" fill="rgba(62,242,255,0.16)" stroke="#e6fdff" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.screens = {};
    for (const el of document.querySelectorAll('.screen')) this.screens[el.id.replace('screen-', '')] = el;
    this.current = 'boot';
    this.stack = [];
    this.handlers = {};
    this.audio = null;
    this.desktop = null;
    this.windowed = false;
    this.playing = false;
    this.el = {
      hud: $('hud'),
      score: $('hud-score'),
      mult: $('hud-mult'),
      multWrap: $('hud-mult').parentElement,
      best: $('hud-best'),
      level: $('hud-level'),
      lives: $('hud-lives'),
      weapon: $('hud-weapon'),
      surge: $('hud-surge'),
      surgeFill: $('hud-surge-fill'),
      surgeState: $('hud-surge-state'),
      announce: $('announce'),
      toast: $('toast'),
      fps: $('fps'),
      bootStatus: $('boot-status'),
      bootError: $('boot-error'),
      titleBest: $('title-best'),
      titlebar: $('titlebar'),
    };
    this.last = {};

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) this._action(btn.dataset.action);
      const win = e.target.closest('[data-win]');
      if (win) this._window(win.dataset.win);
    });
    document.addEventListener('pointerover', (e) => {
      const btn = e.target.closest('.btn, .seg button');
      if (btn && btn !== this._hovered) this.audio?.ui('move');
      this._hovered = btn;
    });
    document.addEventListener('keydown', (e) => {
      if (this.playing || !this.current) return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.moveFocus(1, e);
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.moveFocus(-1, e);
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  _action(name) {
    this.audio?.ui(name === 'back' || name === 'title' ? 'back' : 'select');
    if (name === 'help' || name === 'settings') this.open(name);
    else if (name === 'back') this.back();
    else this.handlers[name]?.();
  }

  _window(name) {
    const d = this.desktop;
    if (!d) return;
    if (name === 'fullscreen') d.toggleFullscreen();
    else if (name === 'minimize') d.minimize();
    else if (name === 'close') d.quit();
  }

  // --- screens --------------------------------------------------------------------------

  setScreen(name) {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('active', key === name);
    this.current = name;
    if (!name) this.stack.length = 0;
    this._updateTitlebar();
  }

  open(name) {
    if (this.current) this.stack.push(this.current);
    this.setScreen(name);
    this._focusFirst();
  }

  back() {
    if (this.stack.length) {
      this.setScreen(this.stack.pop());
      this._focusFirst();
    } else if (this.current === 'pause') {
      this.handlers.resume?.();
    }
  }

  hasFocus() {
    const a = document.activeElement;
    return !!(a && a !== document.body && this.screens[this.current]?.contains(a));
  }

  _buttons() {
    const s = this.screens[this.current];
    if (!s) return [];
    return [...s.querySelectorAll('button, input')].filter((b) => b.offsetParent !== null);
  }

  _focusFirst() {
    const b = this._buttons()[0];
    if (b && document.body.classList.contains('keyboard-nav')) b.focus();
  }

  moveFocus(dir, event) {
    const list = this._buttons();
    if (!list.length) return;
    const active = document.activeElement;
    if (active && active.type === 'range' && event) return; // let sliders use arrows
    event?.preventDefault();
    document.body.classList.add('keyboard-nav');
    let i = list.indexOf(active);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    list[i].focus();
    this.audio?.ui('move');
  }

  /** Gamepad menu navigation (D-pad / stick + A / Start). */
  pad(input) {
    if (this.playing || !this.current || !input.pad.connected) return;
    const p = input.padPressed;
    const stickY = input.pad.moveY;
    const now = performance.now();
    if (Math.abs(stickY) > 0.6 && now - (this._stickAt ?? 0) > 220) {
      this._stickAt = now;
      this.moveFocus(stickY > 0 ? 1 : -1);
    }
    if (p.has(12)) this.moveFocus(-1);
    if (p.has(13)) this.moveFocus(1);
    if (p.has(1)) this.back();
    if (p.has(0)) {
      const a = document.activeElement;
      if (a && this.screens[this.current]?.contains(a) && a.click) a.click();
      else this.screens[this.current]?.querySelector('.btn.primary')?.click();
    }
  }

  showHud(visible) {
    this.el.hud.hidden = !visible;
    if (visible) this.last = {};
  }

  setPlaying(playing) {
    this.playing = playing;
    document.body.classList.toggle('playing', playing);
    this._updateTitlebar();
  }

  // --- HUD ----------------------------------------------------------------------------------

  updateHud(s) {
    const L = this.last;
    const E = this.el;
    if (s.score !== L.score) E.score.textContent = fmt(s.score);
    if (s.best !== L.best) E.best.textContent = fmt(s.best);
    if (s.multiplier !== L.multiplier) {
      E.mult.textContent = `×${s.multiplier}`;
      if (L.multiplier !== undefined && s.multiplier > L.multiplier) {
        E.multWrap.classList.remove('bump');
        void E.multWrap.offsetWidth;
        E.multWrap.classList.add('bump');
      }
    }
    if (s.lives !== L.lives) {
      const slots = Math.max(3, s.lives);
      let html = '';
      for (let i = 0; i < slots; i++) html += SHIP_ICON.replace('<svg', i < s.lives ? '<svg' : '<svg class="lost"');
      E.lives.innerHTML = html;
    }
    if (s.weapon !== L.weapon) E.weapon.textContent = `WEAPON MK ${ROMAN[s.weapon] ?? s.weapon + 1}`;
    if (s.level !== L.level) E.level.textContent = `THREAT LV ${s.level}`;
    const surgePct = Math.floor(s.surge * 100);
    if (surgePct !== L.surgePct) {
      E.surgeFill.style.width = `${surgePct}%`;
      const ready = s.surge >= 1;
      E.surge.classList.toggle('ready', ready);
      E.surgeState.textContent = ready ? 'READY · SPACE' : `${surgePct}%`;
    }
    Object.assign(L, s);
    L.surgePct = surgePct;
  }

  announce(title, sub = '', kind = 'info') {
    const item = document.createElement('div');
    item.className = `announce-item ${kind}`;
    const h = document.createElement('h4');
    h.textContent = title;
    item.appendChild(h);
    if (sub) {
      const p = document.createElement('p');
      p.textContent = sub;
      item.appendChild(p);
    }
    const box = this.el.announce;
    box.appendChild(item);
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => item.remove(), 2500);
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
  }

  setFps(v) {
    if (this.el.fps.hidden) return;
    const n = Math.round(v);
    if (n !== this._fps) {
      this._fps = n;
      this.el.fps.textContent = `${n} FPS`;
    }
  }

  setFpsVisible(visible) {
    this.el.fps.hidden = !visible;
  }

  setBest(best) {
    this.el.titleBest.textContent = fmt(best);
  }

  showGameOver(st) {
    const $ = (id) => document.getElementById(id);
    $('over-score').textContent = fmt(st.score);
    $('over-best').hidden = !st.isBest;
    const m = Math.floor(st.time / 60);
    const s = Math.floor(st.time % 60);
    $('over-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('over-kills').textContent = fmt(st.kills);
    $('over-mult').textContent = `×${st.maxMult}`;
    $('over-acc').textContent = `${Math.round(st.accuracy * 100)}%`;
    $('over-level').textContent = String(st.level);
    $('over-bestscore').textContent = fmt(st.best);
    this.setBest(st.best);
    this.setScreen('over');
    this._focusFirst();
  }

  // --- boot ---------------------------------------------------------------------------------

  bootStatus(text) {
    this.el.bootStatus.textContent = text;
  }

  bootError(err) {
    const e = this.el.bootError;
    e.hidden = false;
    e.textContent = `${err?.message ?? err}`;
    this.el.bootStatus.textContent = 'BOOT FAILURE';
    this.setScreen('boot');
  }

  // --- settings -----------------------------------------------------------------------------

  bindSettings(settings, onChange) {
    const paintRange = (input) => input.style.setProperty('--fill', `${input.value}%`);
    for (const input of document.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      if (input.classList.contains('seg')) {
        const sync = () => {
          for (const b of input.querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === settings[key]);
        };
        sync();
        input.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          settings[key] = b.dataset.value;
          sync();
          onChange(settings);
        });
      } else if (input.type === 'range') {
        input.value = String(Math.round(settings[key] * 100));
        paintRange(input);
        input.addEventListener('input', () => {
          settings[key] = Number(input.value) / 100;
          paintRange(input);
          onChange(settings);
        });
      } else if (input.type === 'checkbox') {
        input.checked = !!settings[key];
        input.addEventListener('change', () => {
          settings[key] = input.checked;
          onChange(settings);
        });
      }
    }
  }

  // --- desktop shell ------------------------------------------------------------------------

  setDesktop(bridge) {
    this.desktop = bridge;
    document.body.classList.add('desktop');
  }

  setWindowed(windowed) {
    this.windowed = windowed;
    this._updateTitlebar();
  }

  _updateTitlebar() {
    if (!this.el.titlebar) return;
    this.el.titlebar.hidden = !(this.desktop && this.windowed && !this.playing);
  }
}
