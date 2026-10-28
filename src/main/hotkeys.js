// Hotkey global push-to-talk via uIOhook (hook passivo: só observa, não bloqueia a tecla).
// Estados: idle → held → locked. Emite 'start' | 'stop' | 'lock' | 'cancel'.
const { EventEmitter } = require('events');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const TAP_MS = 350;        // soltar antes disso = toque rápido → locked
const RELOCK_GUARD_MS = 300; // em locked, só aceita novo toque após isso
const DEFAULT_KEYCODE = UiohookKey.F9; // 67

const MODIFIER_KEYS = {
  [UiohookKey.Ctrl]: 'ctrl', [UiohookKey.CtrlRight]: 'ctrl',
  [UiohookKey.Alt]: 'alt', [UiohookKey.AltRight]: 'alt',
  [UiohookKey.Shift]: 'shift', [UiohookKey.ShiftRight]: 'shift',
  [UiohookKey.Meta]: 'meta', [UiohookKey.MetaRight]: 'meta',
};

const PRETTY = {
  Ctrl: 'Ctrl', CtrlRight: 'Ctrl Direito', Alt: 'Alt', AltRight: 'AltGr',
  Shift: 'Shift', ShiftRight: 'Shift Direito', Meta: 'Win', MetaRight: 'Win Direito',
  Escape: 'Esc', ArrowLeft: '←', ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓',
  Backquote: '`', Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.',
  Slash: '/', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'",
};

// keycode → label (F1–F24, letras, dígitos, Space e demais teclas do UiohookKey)
const KEY_LABELS = {};
for (const [name, code] of Object.entries(UiohookKey)) {
  if (KEY_LABELS[code]) continue;
  KEY_LABELS[code] = PRETTY[name] || name;
}

function keycodeToLabel(keycode) {
  return KEY_LABELS[keycode] || `Key${keycode}`;
}

function comboLabel(keycode, modifiers = {}) {
  const own = MODIFIER_KEYS[keycode];
  const parts = [];
  if (modifiers.ctrl && own !== 'ctrl') parts.push('Ctrl');
  if (modifiers.alt && own !== 'alt') parts.push('Alt');
  if (modifiers.shift && own !== 'shift') parts.push('Shift');
  if (modifiers.meta && own !== 'meta') parts.push('Win');
  parts.push(keycodeToLabel(keycode));
  return parts.join('+');
}

class Hotkeys extends EventEmitter {
  constructor() {
    super();
    this.keycode = DEFAULT_KEYCODE;
    this.modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    this.mode = 'hold';
    this.tapToLock = true;
    this.enabled = true;
    this.state = 'idle';
    this.started = false;
    this.keyDown = false;     // tecla da hotkey fisicamente pressionada (filtra auto-repeat)
    this.pressedAt = 0;
    this.lockedAt = 0;
    this._capture = null;     // { resolve, pendingModifier }
    this._onDown = (e) => this._handleDown(e);
    this._onUp = (e) => this._handleUp(e);
  }

  configure({ keycode, modifiers, mode, tapToLock } = {}) {
    if (Number.isInteger(keycode)) this.keycode = keycode;
    if (modifiers) this.modifiers = { ctrl: !!modifiers.ctrl, alt: !!modifiers.alt, shift: !!modifiers.shift, meta: !!modifiers.meta };
    if (mode === 'hold' || mode === 'toggle') this.mode = mode;
    if (typeof tapToLock === 'boolean') this.tapToLock = tapToLock;
    this._abort();
  }

  start() {
    if (this.started) return;
    uIOhook.on('keydown', this._onDown);
    uIOhook.on('keyup', this._onUp);
    uIOhook.start();
    this.started = true;
  }

  stop() {
    if (!this.started) return;
    uIOhook.off('keydown', this._onDown);
    uIOhook.off('keyup', this._onUp);
    try { uIOhook.stop(); } catch {}
    this.started = false;
    this.reset();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.reset();
  }

  reset() {
    this.state = 'idle';
    this.pressedAt = 0;
    this.lockedAt = 0;
  }

  // Zera o estado avisando o ditado, para não deixar uma gravação órfã.
  _abort() {
    if (this.state !== 'idle') { this.reset(); this.emit('cancel'); }
  }

  getLabel() { return comboLabel(this.keycode, this.modifiers); }

  _modsMatch(e) {
    const own = MODIFIER_KEYS[this.keycode];
    for (const m of ['ctrl', 'alt', 'shift', 'meta']) {
      if (m === own) continue;
      if (!!e[m + 'Key'] !== this.modifiers[m]) return false;
    }
    return true;
  }

  _handleDown(e) {
    if (this._capture) return this._captureDown(e);
    if (!this.enabled) return;

    if (e.keycode === UiohookKey.Escape) {
      if (this.state !== 'idle') { this.reset(); this.emit('cancel'); }
      return;
    }
    if (e.keycode !== this.keycode) return;
    if (this.keyDown) return; // auto-repeat
    this.keyDown = true;
    if (!this._modsMatch(e) && this.state === 'idle') return;

    const now = Date.now();
    if (this.state === 'idle') {
      this.state = 'held';
      this.pressedAt = now;
      this.emit('start');
    } else if (this.state === 'locked') {
      if (now - this.lockedAt < RELOCK_GUARD_MS) return;
      this.reset();
      this.emit('stop');
    } else if (this.state === 'held' && this.mode === 'toggle') {
      this.reset();
      this.emit('stop');
    }
  }

  _handleUp(e) {
    if (this._capture) return this._captureUp(e);
    if (e.keycode !== this.keycode) return;
    this.keyDown = false;
    if (!this.enabled || this.mode !== 'hold' || this.state !== 'held') return;
    const dur = Date.now() - this.pressedAt;
    if (this.tapToLock && dur < TAP_MS) {
      this.state = 'locked';
      this.lockedAt = Date.now();
      this.emit('lock');
    } else {
      this.reset();
      this.emit('stop');
    }
  }

  // Captura a próxima tecla (para a tela de configurações). Esc → null.
  captureNext() {
    if (this._capture) this._capture.resolve(null);
    if (!this.started) this.start();
    return new Promise((resolve) => {
      this._capture = { resolve, pendingModifier: null };
    });
  }

  _finishCapture(result) {
    const c = this._capture;
    this._capture = null;
    this.keyDown = false;
    this._abort();
    c.resolve(result);
  }

  _captureDown(e) {
    if (e.keycode === UiohookKey.Escape) return this._finishCapture(null);
    if (MODIFIER_KEYS[e.keycode]) {
      if (!this._capture.pendingModifier) this._capture.pendingModifier = e.keycode;
      return;
    }
    const modifiers = { ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey };
    this._finishCapture({ label: comboLabel(e.keycode, modifiers), keycode: e.keycode, modifiers });
  }

  _captureUp(e) {
    // Modificador pressionado e solto sozinho → usa ele como a própria tecla.
    if (MODIFIER_KEYS[e.keycode] && this._capture.pendingModifier === e.keycode) {
      const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
      this._finishCapture({ label: keycodeToLabel(e.keycode), keycode: e.keycode, modifiers });
    }
  }
}

const hotkeys = new Hotkeys();
module.exports = hotkeys;
module.exports.keycodeToLabel = keycodeToLabel;
module.exports.comboLabel = comboLabel;
module.exports.KEY_LABELS = KEY_LABELS;
module.exports.DEFAULT_KEYCODE = DEFAULT_KEYCODE;
