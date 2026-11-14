const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const K = { Escape: 1, A: 30, D: 32, Space: 57, F9: 67, Ctrl: 29, CtrlRight: 3613, Alt: 56, AltRight: 3640, Shift: 42, ShiftRight: 54, Meta: 3675, MetaRight: 3676 };
// uiohook-napi é nativo e instala um hook global; nos testes basta um stub.
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'uiohook-napi') return { uIOhook: { on() {}, off() {}, start() {}, stop() {} }, UiohookKey: K };
  return load.call(this, req, ...rest);
};
const hotkeys = require('../src/main/hotkeys');
Module._load = load;

function record() {
  const events = [];
  for (const ev of ['start', 'stop', 'lock', 'cancel']) hotkeys.on(ev, () => events.push(ev));
  return events;
}

test('reconfigurar durante uma gravação travada emite cancel', () => {
  hotkeys.removeAllListeners();
  const events = record();
  hotkeys.state = 'locked';
  hotkeys.configure({ mode: 'toggle' });
  assert.deepStrictEqual(events, ['cancel']);
  assert.strictEqual(hotkeys.state, 'idle');
});

test('reconfigurar parado não emite nada', () => {
  hotkeys.removeAllListeners();
  const events = record();
  hotkeys.configure({ mode: 'hold' });
  assert.deepStrictEqual(events, []);
});

test('comboLabel monta o rótulo com modificadores', () => {
  assert.strictEqual(hotkeys.comboLabel(67, { ctrl: true, shift: true }), 'Ctrl+Shift+F9');
});

const ev = (keycode, mods = {}) => ({ keycode, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });
const down = (k, m) => hotkeys._handleDown(ev(k, m));
const up = (k, m) => hotkeys._handleUp(ev(k, m));
function fresh(keys, opts = {}) {
  hotkeys.removeAllListeners();
  hotkeys.pressed.clear();
  hotkeys.reset();
  hotkeys.configure({ keys, mode: 'hold', tapToLock: false, ...opts });
  return record();
}

test('acorde de 2 teclas (Ctrl+Espaço) começa só com as duas e para ao soltar qualquer uma', () => {
  const events = fresh([K.Ctrl, K.Space]);
  down(K.Space); assert.deepStrictEqual(events, []);
  up(K.Space);
  down(K.Ctrl, { ctrl: true }); down(K.Space, { ctrl: true });
  assert.deepStrictEqual(events, ['start']);
  down(K.Space, { ctrl: true }); // auto-repeat
  up(K.Ctrl); up(K.Space);
  assert.deepStrictEqual(events, ['start', 'stop']);
});

test('acorde de 3 teclas com Ctrl direito e tecla extra bloqueando', () => {
  const events = fresh([K.Ctrl, K.Shift, K.D]);
  down(K.CtrlRight, { ctrl: true }); down(K.Shift, { ctrl: true, shift: true }); down(K.D, { ctrl: true, shift: true });
  assert.deepStrictEqual(events, ['start']);
  up(K.D); up(K.Shift); up(K.CtrlRight);
  down(K.Alt, { alt: true }); down(K.Ctrl, { ctrl: true, alt: true }); down(K.Shift, { ctrl: true, alt: true, shift: true }); down(K.D, { ctrl: true, alt: true, shift: true });
  assert.deepStrictEqual(events, ['start', 'stop']);
});

test('modo alternar: o acorde liga e desliga', () => {
  const events = fresh([K.Ctrl, K.Space], { mode: 'toggle' });
  down(K.Ctrl, { ctrl: true }); down(K.Space, { ctrl: true }); up(K.Space, { ctrl: true });
  down(K.Space, { ctrl: true });
  assert.deepStrictEqual(events, ['start', 'stop']);
});

test('modificador solto sem keyup é limpo pelas flags do evento', () => {
  const events = fresh([K.F9]);
  down(K.Ctrl, { ctrl: true }); // keyup perdido
  down(K.F9);
  assert.deepStrictEqual(events, ['start']);
});

test('captura junta até 3 teclas e ordena os modificadores primeiro', async () => {
  fresh([K.F9]);
  const p = hotkeys.captureNext();
  down(K.Space); down(K.Ctrl); up(K.Space); up(K.Ctrl);
  const res = await p;
  assert.deepStrictEqual(res.keys, [K.Ctrl, K.Space]);
  assert.strictEqual(res.label, 'Ctrl+Space');
  assert.strictEqual(res.typing, true);
});

test('captura recusa uma tecla que digita sozinha e aceita F9 sozinha', async () => {
  fresh([K.F9]);
  let p = hotkeys.captureNext();
  down(K.Space); up(K.Space);
  assert.strictEqual((await p).error, 'typing');
  p = hotkeys.captureNext();
  down(K.F9); up(K.F9);
  assert.deepStrictEqual((await p).keys, [K.F9]);
});

test('formato antigo vira lista de teclas', () => {
  assert.deepStrictEqual(hotkeys.keysFromLegacy(K.F9, { ctrl: true, shift: true }), [K.Ctrl, K.Shift, K.F9]);
  assert.deepStrictEqual(hotkeys.keysFromLegacy(K.Ctrl, { ctrl: true }), [K.Ctrl]);
});
