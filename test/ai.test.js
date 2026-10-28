const test = require('node:test');
const assert = require('node:assert');
const { extractJson } = require('../src/main/ai');

test('extractJson lê JSON dentro de cerca de código', () => {
  assert.deepStrictEqual(extractJson('```json\n{"a":"}"}\n```'), { a: '}' });
});

test('extractJson pula um {…} inválido antes do JSON', () => {
  assert.deepStrictEqual(extractJson('{nota} {"a":1}'), { a: 1 });
});

test('extractJson devolve null sem JSON', () => {
  assert.strictEqual(extractJson('nada aqui'), null);
});
