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

// Lado direito conta como a mesma tecla do esquerdo (Ctrl, Alt, Shift, Win).
const SIDE = {
  [UiohookKey.CtrlRight]: UiohookKey.Ctrl, [UiohookKey.AltRight]: UiohookKey.Alt,
  [UiohookKey.ShiftRight]: UiohookKey.Shift, [UiohookKey.MetaRight]: UiohookKey.Meta,
};
const norm = (code) => SIDE[code] ?? code;
const MOD_ORDER = [UiohookKey.Ctrl, UiohookKey.Alt, UiohookKey.Shift, UiohookKey.Meta];
const MAX_KEYS = 3;

// Teclas que também digitam algo no app em foco (o hook é passivo e não as bloqueia).
function isTyping(code) {
  return code === UiohookKey.Space || keycodeToLabel(code).length === 1;
}

function keysFromLegacy(keycode, modifiers = {}) {
  const own = MODIFIER_KEYS[keycode];
  const keys = [];
  for (const [m, code] of [['ctrl', UiohookKey.Ctrl], ['alt', UiohookKey.Alt], ['shift', UiohookKey.Shift], ['meta', UiohookKey.Meta]]) {
    if (modifiers[m] && own !== m) keys.push(code);
  }
  keys.push(keycode);
  return keys;
}

// Modificadores primeiro (Ctrl, Alt, Shift, Win), depois as demais na ordem em que foram apertadas.
function sortKeys(keys) {
  const mods = MOD_ORDER.filter((m) => keys.some((k) => norm(k) === m));
  const rest = keys.filter((k) => !MOD_ORDER.includes(norm(k)));
  return [...mods, ...rest];
}

function keysLabel(keys) {
  if (keys.length === 1) return keycodeToLabel(keys[0]);
  return sortKeys(keys).map((k) => keycodeToLabel(norm(k))).join('+');
}

// Compatível com o formato antigo (uma tecla + modificadores).
function comboLabel(keycode, modifiers = {}) {
  return keysLabel(keysFromLegacy(keycode, modifiers));
}

// Atalho de 1 a 3 teclas. Dispara quando todas estão apertadas (e nenhuma outra);
// no modo segurar, soltar qualquer uma delas encerra.
class Hotkeys extends EventEmitter {
  constructor() {
    super();
    this.keys = [DEFAULT_KEYCODE];
    this.mode = 'hold';
    this.tapToLock = true;
    this.enabled = true;
    this.state = 'idle';
    this.started = false;
    this.pressed = new Set(); // teclas físicas pressionadas agora (filtra auto-repeat)
    this.pressedAt = 0;
    this.lockedAt = 0;
    this._capture = null;     // { resolve, held, best }
    this._onDown = (e) => this._handleDown(e);
    this._onUp = (e) => this._handleUp(e);
  }

  configure({ keys, keycode, modifiers, mode, tapToLock } = {}) {
    if (Array.isArray(keys) && keys.length && keys.every(Number.isInteger)) this.keys = [...new Set(keys.map(norm))].slice(0, MAX_KEYS);
    else if (Number.isInteger(keycode)) this.keys = keysFromLegacy(keycode, modifiers).map(norm);
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

  getLabel() { return keysLabel(this.keys); }

  // Keyups perdidos (ex.: Win+L bloqueia a tela) deixariam teclas "presas"; as flags de
  // modificador do próprio evento corrigem isso.
  _prune(e) {
    const flags = { [UiohookKey.Ctrl]: e.ctrlKey, [UiohookKey.Alt]: e.altKey, [UiohookKey.Shift]: e.shiftKey, [UiohookKey.Meta]: e.metaKey };
    for (const [code, on] of Object.entries(flags)) if (on === false) this.pressed.delete(Number(code));
  }

  _chordDown() {
    return this.pressed.size === this.keys.length && this.keys.every((k) => this.pressed.has(k));
  }

  _handleDown(e) {
    const k = norm(e.keycode);
    if (this._capture) return this._captureDown(k);
    if (this.pressed.has(k)) return; // auto-repeat
    this._prune(e);
    this.pressed.add(k);
    if (!this.enabled) return;
    if (k === UiohookKey.Escape) {
      if (this.state !== 'idle') { this.reset(); this.emit('cancel'); }
      return;
    }
    if (!this.keys.includes(k) || !this._chordDown()) return;

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
    const k = norm(e.keycode);
    this.pressed.delete(k);
    if (this._capture) return this._captureUp(k);
    if (!this.keys.includes(k)) return;
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

  // Captura a próxima combinação (para a tela de configurações): junta até 3 teclas e termina
  // quando todas são soltas. Esc → null. Uma tecla que digita texto sozinha → { error: 'typing' }.
  captureNext() {
    if (this._capture) this._capture.resolve(null);
    if (!this.started) this.start();
    return new Promise((resolve) => {
      this._capture = { resolve, held: [], best: [] };
    });
  }

  _finishCapture(result) {
    const c = this._capture;
    this._capture = null;
    this.pressed.clear();
    this._abort();
    c.resolve(result);
  }

  _captureDown(k) {
    if (k === UiohookKey.Escape) return this._finishCapture(null);
    const c = this._capture;
    if (c.held.includes(k) || c.held.length >= MAX_KEYS) return;
    c.held.push(k);
    if (c.held.length > c.best.length) c.best = [...c.held];
  }

  _captureUp(k) {
    const c = this._capture;
    c.held = c.held.filter((x) => x !== k);
    if (c.held.length || !c.best.length) return;
    const keys = sortKeys(c.best);
    if (keys.length === 1 && isTyping(keys[0])) return this._finishCapture({ error: 'typing', label: keysLabel(keys) });
    this._finishCapture({ label: keysLabel(keys), keys, typing: keys.some(isTyping) });
  }
}

const hotkeys = new Hotkeys();
module.exports = hotkeys;
module.exports.keycodeToLabel = keycodeToLabel;
module.exports.comboLabel = comboLabel;
module.exports.keysLabel = keysLabel;
module.exports.keysFromLegacy = keysFromLegacy;
module.exports.isTyping = isTyping;
module.exports.KEY_LABELS = KEY_LABELS;
module.exports.DEFAULT_KEYCODE = DEFAULT_KEYCODE;
