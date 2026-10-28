const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const { joinSegments, threadsFor } = require('../src/main/engine');

test('joinSegments não separa palavra cortada entre segmentos', () => {
  const segs = [' Olá', ' tudo', ' be', 'm?'].map((raw) => ({ raw, text: raw.trim() }));
  assert.strictEqual(joinSegments(segs), 'Olá tudo bem?');
});

test('joinSegments sem raw separa por espaço', () => {
  assert.strictEqual(joinSegments([{ text: 'Olá' }, { text: 'mundo' }]), 'Olá mundo');
});

test('threadsFor não passa dos núcleos físicos', () => {
  const max = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
  assert.strictEqual(threadsFor({ threads: 64 }), max);
  assert.strictEqual(threadsFor({ threads: 0 }), max);
  assert.strictEqual(threadsFor({ threads: 1 }), 1);
});
