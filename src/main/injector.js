// Injeção de texto: um powershell.exe persistente (injector.ps1) com SendInput via P/Invoke.
// Protocolo de linhas: PING | PASTE | TYPE <base64>, respostas OK / ERR <msg>.
const { spawn } = require('child_process');
const path = require('path');

// Dentro do asar o powershell não consegue ler o .ps1 → usar a cópia desempacotada.
const SCRIPT = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'injector.ps1');
const CMD_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
let buffer = '';
let pending = [];          // resolvedores aguardando resposta, em ordem
let queue = Promise.resolve();
let stopping = false;

function start() {
  if (proc) return;
  stopping = false;
  buffer = '';
  const p = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  proc = p;
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const waiter = pending.shift();
      if (waiter) waiter(line);
    }
  });
  p.stderr.on('data', (d) => console.error('[injector]', String(d).trim()));
  p.on('error', (err) => console.error('[injector] spawn error', err));
  p.on('exit', (code) => {
    if (proc === p) proc = null;
    const waiters = pending; pending = [];
    for (const w of waiters) w(`ERR process exited (${code})`);
    if (!stopping) console.warn('[injector] process exited, will restart on next command');
  });
}

function rawSend(line) {
  return new Promise((resolve, reject) => {
    if (!proc) start();
    let done = false;
    const timer = setTimeout(() => {
      if (done) return; done = true;
      const idx = pending.indexOf(waiter);
      if (idx >= 0) pending.splice(idx, 1);
      // Processo travado: mata para reiniciar no próximo comando.
      try { proc && proc.kill(); } catch {}
      reject(new Error('injector timeout'));
    }, CMD_TIMEOUT_MS);
    const waiter = (reply) => {
      if (done) return; done = true;
      clearTimeout(timer);
      if (reply.startsWith('OK')) resolve(reply);
      else reject(new Error(reply.replace(/^ERR\s*/, '') || 'injector error'));
    };
    pending.push(waiter);
    try { proc.stdin.write(line + '\n'); } catch (e) { waiter('ERR ' + e.message); }
  });
}

// Serializa os comandos (texto, clipboard e teclas não podem se intercalar).
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function send(line) { return enqueue(() => rawSend(line)); }

// onPasted avisa assim que o Ctrl+V sai; a restauração continua na fila sem segurar o ditado.
async function pasteText(text, onPasted) {
  const { clipboard } = require('electron');
  const prevText = clipboard.readText();
  const prevImage = clipboard.readImage();
  const hadImage = prevImage && !prevImage.isEmpty();
  clipboard.writeText(text);
  await sleep(30);
  try {
    await rawSend('PASTE');
    onPasted?.();
  } finally {
    // Esperar antes de restaurar, senão o app destino cola o conteúdo antigo.
    await sleep(350);
    try {
      if (hadImage) clipboard.writeImage(prevImage);
      else if (prevText) clipboard.writeText(prevText);
      else clipboard.clear();
    } catch {}
  }
}

async function inject(text, mode = 'paste') {
  if (!text) return;
  if (mode === 'type') {
    return send('TYPE ' + Buffer.from(String(text), 'utf8').toString('base64'));
  }
  return new Promise((resolve, reject) => {
    enqueue(() => pasteText(String(text), resolve)).then(resolve, reject);
  });
}

function stop() {
  stopping = true;
  if (!proc) return;
  const p = proc;
  proc = null;
  try { p.stdin.write('EXIT\n'); p.stdin.end(); } catch {}
  setTimeout(() => { try { p.kill(); } catch {} }, 500);
}

module.exports = { start, stop, inject, SCRIPT };
