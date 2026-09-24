import { icon } from './icons.js';
import { SHOP, shopCost, formatTime } from '../game/Meta.js';

// The DOM UI layer (#ui-layer): every screen, the HUD, announcements and the floating
// combat text. Nothing in here touches the WebGL canvas, so all text is crisp at any
// resolution / DPI and styled with CSS.

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const PICK_LOCK_MS = 550; // ignore clicks right after the cards appear (you were firing)

/** Tiny element builder: text always goes through textContent. */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.layer = $('ui-layer');
    this.screens = {};
    for (const el of document.querySelectorAll('.screen')) this.screens[el.id.replace('screen-', '')] = el;
    this.current = 'boot';
    this.stack = [];
    this.handlers = {};
    this.audio = null;
    this.desktop = null;
    this.windowed = false;
    this.playing = false;
    this.pickLocked = false;
    this.picking = false;
    this.tallyRaf = 0;
    this.el = {
      popups: $('popups'),
      hud: $('hud'),
      score: $('hud-score'),
      mult: $('hud-mult'),
      multWrap: $('hud-mult').parentElement,
      best: $('hud-best'),
      shards: $('hud-shards'),
      wave: $('hud-wave'),
      timer: $('hud-timer'),
      timerFill: $('hud-timer-fill'),
      timerText: $('hud-timer-text'),
      hull: $('hud-hull'),
      shield: $('hud-shield'),
      build: $('hud-build'),
      surge: $('hud-surge'),
      surgeFill: $('hud-surge-fill'),
      surgeState: $('hud-surge-state'),
      announce: $('announce'),
      toast: $('toast'),
      fps: $('fps'),
      bootStatus: $('boot-status'),
      bootError: $('boot-error'),
      titleShards: $('title-shards'),
      titleWave: $('title-wave'),
      titleBest: $('title-best'),
      titleBadge: $('title-affordable'),
      upKicker: $('up-kicker'),
      upCards: $('up-cards'),
      upReroll: $('up-reroll'),
      upRerolls: $('up-rerolls'),
      upBuild: $('up-build'),
      pauseBuild: $('pause-build'),
      hangarShards: $('hangar-shards'),
      shop: $('shop'),
      summary: $('run-summary'),
      saveWarning: $('save-warning'),
      titlebar: $('titlebar'),
    };
    this.last = {};

    document.addEventListener('click', (e) => {
      const card = e.target.closest('[data-pick]');
      if (card) {
        this.pickCard(Number(card.dataset.pick));
        return;
      }
      const buy = e.target.closest('[data-buy]');
      if (buy) {
        this.handlers.buy?.(buy.dataset.buy);
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (btn && !btn.disabled) this._action(btn.dataset.action);
      const win = e.target.closest('[data-win]');
      if (win) this._window(win.dataset.win);
    });
    document.addEventListener('pointerover', (e) => {
      const btn = e.target.closest('.btn, .seg button, .card, .shop-item');
      if (btn && btn !== this._hovered) this.audio?.ui('move');
      this._hovered = btn;
    });
    document.addEventListener('keydown', (e) => {
      if (this.playing || !this.current) return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'ArrowRight' || e.code === 'KeyD') this.moveFocus(1, e);
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ArrowLeft' || e.code === 'KeyA') this.moveFocus(-1, e);
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  _action(name) {
    this.audio?.ui(name === 'back' || name === 'title' ? 'back' : 'select');
    if (name === 'help' || name === 'settings' || name === 'confirm') this.open(name);
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
    this.layer.classList.toggle('menu-open', !!name);
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
    return [...s.querySelectorAll('button, input')].filter((b) => b.offsetParent !== null && !b.disabled);
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

  /** Gamepad menu navigation (D-pad / stick + A / B / Start). */
  pad(input) {
    if (this.playing || !this.current || !input.pad.connected) return;
    const p = input.padPressed;
    const { moveX, moveY } = input.pad;
    const now = performance.now();
    const axis = Math.abs(moveX) > Math.abs(moveY) ? moveX : moveY;
    if (Math.abs(axis) > 0.6 && now - (this._stickAt ?? 0) > 220) {
      this._stickAt = now;
      this.moveFocus(axis > 0 ? 1 : -1);
    }
    if (p.has(12) || p.has(14)) this.moveFocus(-1);
    if (p.has(13) || p.has(15)) this.moveFocus(1);
    if (p.has(1)) this.back();
    if (p.has(0)) {
      const a = document.activeElement;
      const primary = this.screens[this.current]?.querySelector('.btn.primary');
      if (a && this.screens[this.current]?.contains(a) && a.click) a.click();
      else if (primary) primary.click();
      else this.moveFocus(1); // e.g. upgrade cards: first press selects a card
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

  // --- title ----------------------------------------------------------------------------

  showTitle(meta) {
    this.refreshWallet(meta);
    this.setScreen('title');
    this._focusFirst();
  }

  /** Wallet / records wherever they are shown. Safe to call any time. */
  refreshWallet(meta) {
    const E = this.el;
    E.titleShards.textContent = fmt(meta.shards);
    E.titleWave.textContent = String(meta.records.bestWave);
    E.titleBest.textContent = fmt(meta.records.bestScore);
    E.hangarShards.textContent = fmt(meta.shards);
    const affordable = SHOP.some((item) => {
      const c = meta.cost(item.id);
      return c !== null && c <= meta.shards;
    });
    E.titleBadge.hidden = !affordable;
  }

  // --- upgrade selection -------------------------------------------------------------------

  showUpgrades(view, rerolled = false) {
    const E = this.el;
    E.upKicker.textContent = `WAVE ${view.round} CLEARED`;
    E.upCards.replaceChildren(...view.offers.map((o, i) => this._card(o, i)));
    E.upRerolls.textContent = String(view.rerolls);
    E.upReroll.disabled = view.rerolls <= 0;
    this.updateBuild(view.build);
    this.picking = false;
    this.pickLocked = true;
    E.upCards.classList.add('locked');
    E.upCards.classList.toggle('rerolled', rerolled);
    if (this.current !== 'upgrade') this.setScreen('upgrade');
    clearTimeout(this._pickTimer);
    this._pickTimer = setTimeout(() => {
      this.pickLocked = false;
      E.upCards.classList.remove('locked');
      this._focusFirst();
    }, rerolled ? 180 : PICK_LOCK_MS);
  }

  _card(o, i) {
    const card = h('button', `card r-${o.rarity}`);
    card.type = 'button';
    card.dataset.pick = String(i);
    card.style.setProperty('--i', String(i));
    card.setAttribute('aria-label', `${o.name}. ${o.desc}`);

    const top = h('div', 'card-top');
    top.append(h('span', 'card-key', String(i + 1)), h('span', 'card-rarity', `${o.rarityLabel} · ${o.tag}`));
    const art = h('div', 'card-art');
    art.innerHTML = icon(o.id, 'card-icon'); // static markup from icons.js
    const lvl = h('div', 'card-level');
    if (Number.isFinite(o.max)) {
      for (let k = 0; k < o.max; k++) lvl.append(h('i', k < o.level ? 'on' : k === o.level ? 'next' : ''));
    }
    card.append(top, art, h('div', 'card-name', o.name), lvl, h('p', 'card-desc', o.desc));
    const delta = h('div', 'card-delta');
    if (o.before) delta.append(h('span', 'was', o.before), h('span', 'arrow', '→'));
    delta.append(h('span', 'now', o.after));
    card.append(delta);
    if (o.synergy) card.append(h('p', 'card-synergy', o.synergy));
    return card;
  }

  /** Click / key / pad pick with a short "chosen" animation before the game resumes. */
  pickCard(index) {
    if (this.current !== 'upgrade' || this.pickLocked || this.picking) return;
    const cards = [...this.el.upCards.children];
    const card = cards[index];
    if (!card) return;
    this.picking = true;
    cards.forEach((c, i) => c.classList.add(i === index ? 'chosen' : 'rejected'));
    setTimeout(() => this.handlers.pick?.(index), 340);
  }

  /** Build chips in the HUD, on the upgrade screen and in the pause menu. */
  updateBuild(chips) {
    const make = () => chips.map((c) => {
      const chip = h('span', `chip r-${c.rarity}`);
      chip.title = c.name;
      chip.innerHTML = icon(c.id, 'chip-icon');
      if (c.n > 1) chip.append(h('b', null, `×${c.n}`));
      return chip;
    });
    for (const el of [this.el.build, this.el.upBuild, this.el.pauseBuild]) el?.replaceChildren(...make());
  }

  // --- hangar / shop ---------------------------------------------------------------------

  showHangar(meta, summary) {
    const E = this.el;
    E.summary.hidden = !summary;
    E.saveWarning.hidden = meta.persistent;
    cancelAnimationFrame(this.tallyRaf);
    if (summary) {
      this._fillSummary(summary);
      this._tally(meta, summary.rewards.total);
    } else {
      E.hangarShards.textContent = fmt(meta.shards);
    }
    this.renderShop(meta);
    this.refreshWallet(meta);
    if (summary) E.hangarShards.textContent = fmt(meta.shards - summary.rewards.total);
    this.stack.length = 0;
    this.setScreen('hangar');
    this._focusFirst();
  }

  _fillSummary(s) {
    const $ = (id) => document.getElementById(id);
    $('rs-reason').textContent = s.reason === 'abandoned' ? 'RUN ABANDONED' : 'SIGNAL LOST';
    $('rs-wave').textContent = `WAVE ${s.wave}`;
    $('rs-score').textContent = fmt(s.score);
    $('rs-time').textContent = formatTime(s.time);
    $('rs-kills').textContent = fmt(s.kills);
    $('rs-mult').textContent = `×${s.maxMult}`;
    const badges = $('rs-badges');
    badges.replaceChildren();
    if (s.newBestWave) badges.append(h('span', 'badge', 'NEW BEST WAVE'));
    if (s.newBestScore) badges.append(h('span', 'badge', 'NEW BEST SCORE'));
    const rows = $('rs-rewards');
    rows.replaceChildren(...s.rewards.rows.map((r, i) => {
      const li = h('li');
      li.style.setProperty('--i', String(i));
      li.append(h('span', 'rw-label', r.label), h('span', 'rw-detail', r.detail), h('b', 'rw-value', `+${fmt(r.value)}`));
      return li;
    }));
    if (s.rewards.mul > 1) {
      const li = h('li', 'mul');
      li.style.setProperty('--i', String(s.rewards.rows.length));
      li.append(h('span', 'rw-label', 'SHARD SIPHON'), h('span', 'rw-detail', ''), h('b', 'rw-value', `×${s.rewards.mul.toFixed(2)}`));
      rows.append(li);
    }
    $('rs-total').textContent = '+0';
    const build = $('rs-build');
    build.replaceChildren();
    for (const c of s.build) {
      const chip = h('span', `chip r-${c.rarity}`);
      chip.title = c.name;
      chip.innerHTML = icon(c.id, 'chip-icon');
      if (c.n > 1) chip.append(h('b', null, `×${c.n}`));
      build.append(chip);
    }
  }

  /** Count the reward up and pour it into the wallet. */
  _tally(meta, total) {
    const totalEl = document.getElementById('rs-total');
    const wallet = this.el.hangarShards;
    const start = meta.shards - total;
    const delay = 700;
    const dur = Math.min(1600, 500 + total * 6);
    const t0 = performance.now();
    let lastShown = -1;
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - t0 - delay) / dur));
      const k = 1 - (1 - t) ** 3;
      const v = Math.round(total * k);
      if (v !== lastShown) {
        if (lastShown >= 0) this.audio?.tally(t);
        lastShown = v;
        totalEl.textContent = `+${fmt(v)}`;
        wallet.textContent = fmt(start + v);
      }
      if (t < 1) this.tallyRaf = requestAnimationFrame(step);
      else {
        wallet.textContent = fmt(meta.shards);
        wallet.parentElement.classList.remove('pour');
        void wallet.offsetWidth;
        wallet.parentElement.classList.add('pour');
      }
    };
    this.tallyRaf = requestAnimationFrame(step);
  }

  renderShop(meta, focusId = null) {
    const nodes = SHOP.map((item) => {
      const level = meta.level(item.id);
      const maxed = level >= item.max;
      const cost = maxed ? null : shopCost(item, level);
      const btn = h('button', 'shop-item');
      btn.type = 'button';
      btn.dataset.buy = item.id;
      btn.classList.toggle('maxed', maxed);
      btn.classList.toggle('poor', !maxed && cost > meta.shards);
      const art = h('div', 'si-art');
      art.innerHTML = icon(item.id, 'si-icon');
      const pips = h('div', 'si-pips');
      for (let k = 0; k < item.max; k++) pips.append(h('i', k < level ? 'on' : ''));
      const effect = h('div', 'si-effect');
      if (level > 0) effect.append(h('span', 'was', item.effect(level)));
      if (!maxed) {
        if (level > 0) effect.append(h('span', 'arrow', '→'));
        effect.append(h('span', 'now', item.effect(level + 1)));
      }
      const price = h('div', 'si-cost');
      if (maxed) price.textContent = 'MAXED';
      else price.innerHTML = `${icon('shards', 'shard-ico')}<b></b>`;
      if (!maxed) price.querySelector('b').textContent = fmt(cost);
      btn.append(art, h('div', 'si-name', item.name), h('p', 'si-desc', item.desc), pips, effect, price);
      btn.setAttribute('aria-label', `${item.name}, level ${level} of ${item.max}${maxed ? ', maxed' : `, costs ${cost} shards`}`);
      return btn;
    });
    this.el.shop.replaceChildren(...nodes);
    if (focusId) this.el.shop.querySelector(`[data-buy="${focusId}"]`)?.focus({ preventScroll: true });
  }

  refreshHangar(meta, boughtId) {
    cancelAnimationFrame(this.tallyRaf);
    const keyboard = document.activeElement?.dataset?.buy === boughtId;
    this.renderShop(meta, keyboard ? boughtId : null);
    this.refreshWallet(meta);
    const item = this.el.shop.querySelector(`[data-buy="${boughtId}"]`);
    item?.classList.add('bought');
    this.el.saveWarning.hidden = meta.persistent;
  }

  shopDenied(id, reason) {
    const item = this.el.shop.querySelector(`[data-buy="${id}"]`);
    if (item) {
      item.classList.remove('denied');
      void item.offsetWidth;
      item.classList.add('denied');
    }
    this.toast(reason === 'max' ? 'ALREADY MAXED' : 'NOT ENOUGH NEON SHARDS');
  }

  // --- HUD ----------------------------------------------------------------------------------

  updateHud(s) {
    const L = this.last;
    const E = this.el;
    if (s.score !== L.score) E.score.textContent = fmt(s.score);
    if (s.best !== L.best) E.best.textContent = fmt(s.best);
    if (s.shards !== L.shards) E.shards.textContent = `+${fmt(s.shards)}`;
    if (s.multiplier !== L.multiplier) {
      E.mult.textContent = `×${s.multiplier}`;
      if (L.multiplier !== undefined && s.multiplier > L.multiplier) {
        E.multWrap.classList.remove('bump');
        void E.multWrap.offsetWidth;
        E.multWrap.classList.add('bump');
      }
    }
    if (s.wave !== L.wave) E.wave.textContent = String(s.wave);
    const frac = Math.round(s.timeFrac * 400) / 400;
    if (frac !== L.frac) E.timerFill.style.transform = `scaleX(${frac})`;
    const timerState = s.cleared ? 'cleared' : s.overtime ? 'overtime' : s.timeLeft <= 5 ? 'low' : '';
    if (s.timeLeft !== L.timeLeft || timerState !== L.timerState) {
      E.timerText.textContent = s.cleared ? 'WAVE CLEARED' : s.overtime ? 'DESTROY THE ELITE' : formatTime(s.timeLeft);
    }
    if (timerState !== L.timerState) E.timer.dataset.state = timerState;
    if (s.hull !== L.hull || s.maxHull !== L.maxHull) {
      const pips = [];
      for (let i = 0; i < s.maxHull; i++) pips.push(h('i', i < s.hull ? 'on' : ''));
      E.hull.replaceChildren(...pips);
      E.hull.classList.toggle('critical', s.hull === 1);
    }
    if (s.shield !== L.shield || s.maxShield !== L.maxShield) {
      const pips = [];
      for (let i = 0; i < s.maxShield; i++) pips.push(h('i', i < s.shield ? 'on' : ''));
      E.shield.replaceChildren(...pips);
    }
    const surgePct = Math.floor(s.surge * 100);
    if (surgePct !== L.surgePct) {
      E.surgeFill.style.transform = `scaleX(${surgePct / 100})`;
      const ready = s.surge >= 1;
      E.surge.classList.toggle('ready', ready);
      E.surgeState.textContent = ready ? 'READY · SPACE' : `${surgePct}%`;
    }
    Object.assign(L, s);
    L.surgePct = surgePct;
    L.frac = frac;
    L.timerState = timerState;
  }

  announce(title, sub = '', kind = 'info') {
    const item = h('div', `announce-item ${kind}`);
    item.append(h('h4', null, title));
    if (sub) item.append(h('p', null, sub));
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
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
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
