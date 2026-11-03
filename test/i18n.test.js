const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pt = JSON.parse(read('src/common/locales/pt-BR.json'));
const en = JSON.parse(read('src/common/locales/en.json'));
const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

test('pt-BR e en têm as mesmas chaves e variáveis', () => {
  assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(pt).sort());
  for (const k of Object.keys(pt)) assert.strictEqual(vars(en[k]), vars(pt[k]), k);
});

test('toda chave usada na interface existe no dicionário', () => {
  const html = read('src/renderer/main/index.html');
  const used = [...html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria)?="([^"]+)"/g)].map((m) => m[1]);
  const js = ['src/renderer/main/main.js', 'src/main/tray.js', 'src/main/main.js', 'src/main/dictation.js', 'src/main/windows.js']
    .flatMap((f) => [...read(f).matchAll(/\bt\('([\w.-]+)'/g)].map((m) => m[1]));
  for (const k of [...used, ...js]) assert.ok(k in pt, `chave ausente: ${k}`);
});
