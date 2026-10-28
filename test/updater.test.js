const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Updater } = require('../src/main/updater');

function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.calls = [];
  au.checkForUpdates = async () => { au.calls.push('check'); };
  au.downloadUpdate = async () => { au.calls.push('download'); };
  au.quitAndInstall = (...args) => { au.calls.push(['install', ...args]); };
  return au;
}

function setup() {
  const au = fakeAutoUpdater();
  const notified = [];
  const u = new Updater();
  u.init({ autoUpdater: au, enabled: true, notify: (kind) => notified.push(kind) });
  return { u, au, notified };
}

const tick = () => new Promise((r) => setImmediate(r));

test('fora do app instalado fica unsupported e não checa', async () => {
  const u = new Updater();
  u.init({ autoUpdater: null, enabled: false, notify: () => {} });
  assert.strictEqual(u.status().state, 'unsupported');
  await u.check();
  assert.strictEqual(u.status().state, 'unsupported');
});

test('nova versão é baixada em segundo plano e avisa quando pronta', async () => {
  const { u, au, notified } = setup();
  au.emit('update-available', { version: '0.2.0' });
  await tick();
  assert.deepStrictEqual(au.calls, ['download']);
  assert.deepStrictEqual(notified, []);
  au.emit('update-downloaded', { version: '0.2.0' });
  assert.deepStrictEqual(notified, ['downloaded']);
  assert.strictEqual(u.status().state, 'downloaded');
  assert.strictEqual(u.status().version, '0.2.0');
});

test('instalação é silenciosa e reabre o app', async () => {
  const { u, au } = setup();
  u.install(); // nada baixado ainda: ignora
  assert.deepStrictEqual(au.calls, []);
  au.emit('update-available', { version: '0.2.0' });
  au.emit('update-downloaded', { version: '0.2.0' });
  u.install();
  assert.deepStrictEqual(au.calls.at(-1), ['install', true, true]);
});

test('checagem manual sem update avisa o usuário; automática não', async () => {
  const { u, au, notified } = setup();
  await u.check(false);
  au.emit('update-not-available');
  assert.deepStrictEqual(notified, []);
  await u.check(true);
  au.emit('update-not-available');
  assert.deepStrictEqual(notified, ['latest']);
  assert.strictEqual(u.status().state, 'latest');
});
