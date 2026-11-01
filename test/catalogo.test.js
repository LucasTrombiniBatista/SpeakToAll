const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../src/main/config');
const store = require('../src/main/plugins/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sta-'));

test('URL antiga do catálogo é migrada ao carregar', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ pluginCatalogUrl: 'https://raw.githubusercontent.com/speaktoall/plugins/main/plugins.json' }));
  assert.strictEqual(config.init(dir).pluginCatalogUrl, config.DEFAULTS.pluginCatalogUrl);
});

test('URL personalizada do catálogo é mantida', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ pluginCatalogUrl: 'https://exemplo.com/c.json' }));
  assert.strictEqual(config.init(dir).pluginCatalogUrl, 'https://exemplo.com/c.json');
});

function catalogWith(fetchImpl) {
  const real = global.fetch;
  global.fetch = fetchImpl;
  store.init({ baseDir: tmp(), plugins: { setBlocked() {} }, config: { get: () => ({ pluginCatalogUrl: 'https://x/c.json' }) } });
  return store.fetchCatalog().finally(() => { global.fetch = real; });
}

test('HTTP 404 é catálogo indisponível, não falta de conexão', async () => {
  const r = await catalogWith(async () => ({ ok: false, status: 404 }));
  assert.deepStrictEqual([r.offline, r.unavailable], [false, true]);
});

test('falha de rede é falta de conexão', async () => {
  const r = await catalogWith(async () => { throw new TypeError('fetch failed'); });
  assert.deepStrictEqual([r.offline, r.unavailable], [true, false]);
});
