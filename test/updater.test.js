const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Updater } = require('../src/main/updater');

function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.calls = [];
  au.checkForUpdates = async () => { au.calls.push('check'); };
  au.downloadUpdate = async () => { au.calls.push('download'); };
  au.quitAndInstall = () => { au.calls.push('install'); };
  return au;
}

function setup(answer = true) {
  const au = fakeAutoUpdater();
  const asked = [];
  const u = new Updater();
  u.init({ autoUpdater: au, enabled: true, ask: async (kind) => { asked.push(kind); return answer; } });
  return { u, au, asked };
}

const tick = () => new Promise((r) => setImmediate(r));

test('fora do app instalado fica unsupported e não checa', async () => {
  const u = new Updater();
  u.init({ autoUpdater: null, enabled: false, ask: async () => true });
  assert.strictEqual(u.status().state, 'unsupported');
  await u.check();
  assert.strictEqual(u.status().state, 'unsupported');
});

test('não baixa sozinho: autoDownload desligado', () => {
  const { au } = setup();
  assert.strictEqual(au.autoDownload, false);
});

test('usuário aceita: baixa e depois instala', async () => {
  const { u, au, asked } = setup(true);
  au.emit('update-available', { version: '0.2.0' });
  await tick();
  assert.deepStrictEqual(au.calls, ['download']);
  au.emit('update-downloaded', { version: '0.2.0' });
  await tick();
  assert.deepStrictEqual(asked, ['available', 'downloaded']);
  assert.deepStrictEqual(au.calls, ['download', 'install']);
  assert.strictEqual(u.status().version, '0.2.0');
});

test('usuário recusa: nada é baixado', async () => {
  const { u, au } = setup(false);
  au.emit('update-available', { version: '0.2.0' });
  await tick();
  assert.deepStrictEqual(au.calls, []);
  assert.strictEqual(u.status().state, 'available');
});

test('checagem manual sem update avisa o usuário; automática não', async () => {
  const { u, au, asked } = setup();
  await u.check(false);
  au.emit('update-not-available');
  assert.deepStrictEqual(asked, []);
  await u.check(true);
  au.emit('update-not-available');
  assert.deepStrictEqual(asked, ['latest']);
  assert.strictEqual(u.status().state, 'latest');
});
