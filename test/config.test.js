const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Config, sanitizePatch } = require('../src/main/config');

test('renderer não altera chaves fora da lista', () => {
  const { clean, rejected } = sanitizePatch({ theme: 'dark', pluginCatalogUrl: 'https://mal/x.json', enabledPlugins: ['x'] });
  assert.deepStrictEqual(clean, { theme: 'dark' });
  assert.deepStrictEqual(rejected.sort(), ['enabledPlugins', 'pluginCatalogUrl']);
});

test('aiBaseUrl só aceita http(s) e obsidianVault só pode ser limpo', () => {
  assert.deepStrictEqual(sanitizePatch({ aiBaseUrl: 'file:///C:/x' }).clean, {});
  assert.deepStrictEqual(sanitizePatch({ aiBaseUrl: 'https://api.x/v1' }).clean, { aiBaseUrl: 'https://api.x/v1' });
  assert.deepStrictEqual(sanitizePatch({ obsidianVault: 'C:\Windows' }).clean, {});
  assert.deepStrictEqual(sanitizePatch({ obsidianVault: '' }).clean, { obsidianVault: '' });
});

test('chave de IA vai cifrada para o disco e não chega ao renderer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sta-cfg-'));
  // Cifra de mentira (reversível) só para o teste.
  const cipher = { encrypt: (t) => Buffer.from([...t].reverse().join('')), decrypt: (b) => [...b.toString()].reverse().join('') };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ aiApiKey: 'sk-123' }));
  const c = new Config();
  c.init(dir, cipher);
  const disk = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!disk.includes('sk-123'), 'migrou o texto puro');
  assert.strictEqual(c.get().aiApiKey, 'sk-123');
  assert.strictEqual(c.getPublic().aiApiKey, '');
  assert.strictEqual(c.getPublic().aiApiKeySet, true);
  const c2 = new Config();
  c2.init(dir, cipher);
  assert.strictEqual(c2.get().aiApiKey, 'sk-123');
  fs.rmSync(dir, { recursive: true, force: true });
});
