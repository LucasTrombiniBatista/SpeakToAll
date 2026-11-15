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
    const a = engine.install({ model: 'tiny' });
    const b = engine.install({ model: 'base' });
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

test('todo modelo tem repositório CTranslate2 e o small é o recomendado', () => {
  const { MODELS } = require('../src/main/engine');
  for (const m of MODELS) assert.match(m.repo, /faster-whisper/, m.id);
  assert.strictEqual(MODELS.find((m) => m.recommended).id, 'small');
});
