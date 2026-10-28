const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// uiohook-napi é nativo e instala um hook global; nos testes basta um stub.
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'uiohook-napi') return { uIOhook: { on() {}, off() {}, start() {}, stop() {} }, UiohookKey: { F9: 67 } };
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
