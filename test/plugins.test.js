const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createApi } = require('../src/main/plugins/api');
const { validateManifest } = require('../src/main/plugins');
const { normalize, verifyFiles } = require('../src/main/plugins/store');

const notes = { list: () => [], get: () => null, create: () => ({}), update: () => ({}) };
const config = { get: () => ({ theme: 'dark', aiApiKey: 'segredo' }) };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const manifest = { id: 'teste', name: 'T', version: '1.0.0', minAppVersion: '0.1.0', author: 'a', description: 'd' };

test('API recusa escrever notas sem notes:write', () => {
  const api = createApi({ appVersion: '0.1.0', notes, config, pluginId: 'p', permissions: ['notes:read'] });
  assert.doesNotThrow(() => api.notes.list());
  assert.throws(() => api.notes.update('x', {}), /notes:write/);
});

test('permissão antiga "notes" vale leitura e escrita', () => {
  const api = createApi({ appVersion: '0.1.0', notes, config, pluginId: 'p', permissions: ['notes'] });
  assert.doesNotThrow(() => api.notes.create({}));
});

test('getSettings nunca expõe a chave de IA', () => {
  const api = createApi({ appVersion: '0.1.0', notes, config });
  assert.strictEqual(api.getSettings().aiApiKey, undefined);
});

test('manifest com permissão desconhecida é recusado', () => {
  assert.throws(() => validateManifest({ ...manifest, permissions: ['fs'] }, { appVersion: '0.1.0' }), /desconhecida/);
  assert.doesNotThrow(() => validateManifest({ ...manifest, permissions: ['text'] }, { appVersion: '0.1.0' }));
});

test('catálogo sem versão ou sha256 não é instalável', () => {
  const base = { id: 'teste', repo: 'a/b', name: 'T' };
  const ok = { ...base, version: '1.0.0', sha256: { 'manifest.json': sha('m'), 'main.js': sha('j') } };
  assert.deepStrictEqual(normalize([base, { ...base, version: '1.0.0' }]).plugins, []);
  assert.strictEqual(normalize([ok]).plugins.length, 1);
});

test('verifyFiles recusa arquivo alterado', () => {
  const expected = { 'manifest.json': sha('m'), 'main.js': sha('j') };
  assert.doesNotThrow(() => verifyFiles({ 'manifest.json': Buffer.from('m'), 'main.js': Buffer.from('j') }, expected));
  assert.throws(() => verifyFiles({ 'manifest.json': Buffer.from('m'), 'main.js': Buffer.from('mal') }, expected), /main\.js/);
});
