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

// Instalação concorrente: o onboarding disparava start() e install() juntos e podia instalar duas vezes.
test('install em andamento: segunda chamada reaproveita a mesma e start() recusa', async () => {
  const fs = require('fs');
  const path = require('path');
  const engine = require('../src/main/engine');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sta-test-'));
  engine.init({ dataDir: dir });
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { ok: false, status: 503 }; };
  try {
    const a = engine.install({ flavor: 'cpu', model: 'tiny' });
    const b = engine.install({ flavor: 'cuda', model: 'tiny' });
    assert.strictEqual(a, b);
    assert.strictEqual(engine.isInstalling(), true);
    await assert.rejects(engine.start({ model: 'tiny' }), /andamento/);
    await assert.rejects(a, /HTTP 503/);
    assert.strictEqual(calls, 1);
    assert.strictEqual(engine.isInstalling(), false);
  } finally {
    global.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('código de bloqueio do Windows é o STATUS_SYSTEM_INTEGRITY_POLICY_VIOLATION', () => {
  assert.strictEqual(require('../src/main/engine').BLOCKED_BY_POLICY, 3236495362);
});
