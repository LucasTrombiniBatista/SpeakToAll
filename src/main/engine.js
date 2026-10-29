// Motor de reconhecimento: instala whisper.cpp + modelos, mantém o whisper-server "quente"
// e oferece transcrição curta (HTTP) e longa (whisper-cli).
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');

const VERSION = 'v1.8.6';
const ZIPS = {
  cpu: { file: 'whisper-blas-bin-x64.zip', mb: 16 },
  cuda: { file: 'whisper-cublas-12.4.0-bin-x64.zip', mb: 439 },
};
const MODELS = [
  { id: 'tiny', sizeMb: 75 },
  { id: 'base', sizeMb: 142 },
  { id: 'small', sizeMb: 466 },
  { id: 'medium-q5_0', sizeMb: 514 },
  { id: 'large-v3-turbo-q5_0', sizeMb: 547, recommended: true },
];

const engine = new EventEmitter();
let paths = null;
let proc = null, port = 0, ready = false, current = { model: null, flavor: null };
let abort = null;

function init({ dataDir }) {
  paths = { bin: path.join(dataDir, 'bin', 'whisper'), models: path.join(dataDir, 'models') };
  fs.mkdirSync(paths.bin, { recursive: true });
  fs.mkdirSync(paths.models, { recursive: true });
  // Sobras de instalações cujo bin estava travado (ver clearBin)
  for (const e of fs.readdirSync(path.dirname(paths.bin))) {
    if (e.startsWith('whisper-old-')) try { fs.rmSync(path.join(path.dirname(paths.bin), e), { recursive: true, force: true }); } catch {}
  }
}

// O Windows segura o .exe/DLLs por alguns instantes após o kill; tenta de novo e, em último caso,
// move a pasta para o lado e limpa no próximo init().
function clearBin() {
  try {
    fs.rmSync(paths.bin, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
    try { fs.renameSync(paths.bin, `${paths.bin}-old-${Date.now()}`); } catch {
      throw new Error('Arquivos do motor em uso. Feche outras instâncias do SpeakToAll (ou o antivírus pode estar verificando) e tente de novo.');
    }
  }
  fs.mkdirSync(paths.bin, { recursive: true });
}

const modelPath = (id) => path.join(paths.models, `ggml-${id}.bin`);
const flavorFile = () => path.join(paths.bin, 'flavor.txt');
function installedFlavor() { try { return fs.readFileSync(flavorFile(), 'utf8').trim(); } catch { return null; } }

function findExe(name, dir = paths.bin) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name) return path.join(dir, e.name);
  for (const e of entries) if (e.isDirectory()) { const r = findExe(name, path.join(dir, e.name)); if (r) return r; }
  return null;
}

function status() {
  const flavor = installedFlavor();
  const model = current.model;
  const installed = !!(flavor && findExe('whisper-server.exe') && model && fs.existsSync(modelPath(model)));
  return { installed, ready, model, flavor };
}
const emitStatus = () => engine.emit('status', status());

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 8000 },
    (err, out) => resolve(err ? null : String(out))));
}

async function detectHardware() {
  const cpus = os.cpus();
  const threads = cpus.length;
  const cpu = `${(cpus[0]?.model || 'CPU').trim()} (${threads} threads)`;
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  const gpu = out && out.trim() ? out.trim().split(/\r?\n/)[0].trim() : null;
  const vramMb = gpu ? parseInt((gpu.split(',')[1] || '').replace(/\D/g, ''), 10) || 0 : 0;
  const recommendedFlavor = gpu ? 'cuda' : 'cpu';
  let recommendedModel = 'large-v3-turbo-q5_0';
  if (!gpu && (threads < 8 || ramGb < 8)) recommendedModel = ramGb < 6 ? 'base' : 'small';
  if (gpu && vramMb && vramMb < 2000) recommendedModel = 'small';
  return { cpu, ramGb, gpu, recommendedFlavor, recommendedModel };
}

// Download com .part, progresso a cada 150 ms e cancelamento
async function download(url, dest, stage, onProgress, signal) {
  const part = dest + '.part';
  try {
    const res = await fetch(url, { signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const totalMb = Math.round(total / 1048576);
    let got = 0, last = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length;
        const now = Date.now();
        if (now - last >= 150) {
          last = now;
          onProgress?.({ stage, percent: total ? Math.floor((got / total) * 100) : 0, totalMb });
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part), { signal });
    onProgress?.({ stage, percent: 100, totalMb });
    fs.renameSync(part, dest);
  } catch (e) {
    try { fs.unlinkSync(part); } catch {}
    throw e;
  }
}

function expand(zip, dir) {
  return new Promise((resolve, reject) => {
    const cmd = `Expand-Archive -Force -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}'`;
    execFile('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true },
      (err, _o, se) => err ? reject(new Error(se || err.message)) : resolve());
  });
}

async function install({ flavor = 'cpu', model }, onProgress) {
  await stopAndWait(); // o Windows trava o .exe em uso
  abort = new AbortController();
  const { signal } = abort;
  try {
    if (installedFlavor() !== flavor || !findExe('whisper-server.exe') || !findExe('whisper-cli.exe')) {
      clearBin();
      const z = ZIPS[flavor] || ZIPS.cpu;
      const zip = path.join(paths.bin, z.file);
      await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/${z.file}`, zip, 'engine', onProgress, signal);
      await expand(zip, paths.bin);
      fs.unlinkSync(zip);
      if (!findExe('whisper-server.exe')) throw new Error('whisper-server.exe não encontrado no pacote');
      fs.writeFileSync(flavorFile(), flavor);
    }
    if (model && !fs.existsSync(modelPath(model))) {
      await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`, modelPath(model), 'model', onProgress, signal);
    }
    current = { model, flavor };
    onProgress?.({ stage: 'starting', percent: 100 });
    emitStatus();
  } finally { abort = null; }
}

function cancel() { abort?.abort(); }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function canConnect(p) {
  return new Promise((resolve) => {
    const c = net.connect(p, '127.0.0.1');
    c.once('connect', () => { c.destroy(); resolve(true); });
    c.once('error', () => resolve(false));
  });
}

// Padrão = núcleos físicos (assume hyperthreading): threads lógicas a mais deixam o whisper mais lento.
const defaultThreads = () => Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
// Limita ao padrão: configs antigas salvaram cpus - 2 (6 threads em 4 núcleos).
const threadsFor = (s) => Math.min(s.threads || defaultThreads(), defaultThreads());
// 'fast' = greedy; 'accurate' = beam search 5 (~3-5x mais lento na CPU).
const decodeArgs = (s) => (s.transcriptionQuality === 'accurate' ? ['-bs', '5', '-bo', '5'] : ['-bs', '1', '-bo', '1']);

// O whisper pode fechar um segmento no meio de uma palavra; a continuação vem sem espaço
// inicial. Juntar com o texto cru (sem trim) evita "be m" no lugar de "bem".
// Sem raw (segmento já aparado), assume fronteira de palavra.
const joinSegments = (segs) => segs.map((s) => s.raw ?? ` ${s.text ?? ''}`).join('').replace(/\s+/g, ' ').trim();

async function start(settings) {
  stop();
  current = { model: settings.model, flavor: installedFlavor() || settings.engineFlavor };
  const exe = findExe('whisper-server.exe');
  const m = modelPath(settings.model);
  if (!exe || !fs.existsSync(m)) { emitStatus(); throw new Error('Engine ou modelo não instalado'); }
  port = await freePort();
  const args = ['-m', m, '--host', '127.0.0.1', '--port', String(port), '-t', String(threadsFor(settings)),
    '-l', settings.language || 'auto', ...decodeArgs(settings), '-sow'];
  if (settings.initialPrompt) args.push('--prompt', settings.initialPrompt);
  const p = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
  proc = p;
  p.on('exit', () => { if (proc === p) { proc = null; ready = false; emitStatus(); } });
  emitStatus();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (proc !== p) throw new Error('whisper-server encerrou');
    if (await canConnect(port)) { ready = true; emitStatus(); return status(); }
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error('Timeout aguardando whisper-server');
}

function stop() {
  if (proc) { const p = proc; proc = null; try { p.kill(); } catch {} }
  if (ready) { ready = false; emitStatus(); }
}

// Como stop(), mas só resolve quando o processo realmente saiu (libera os arquivos no Windows)
function stopAndWait(timeoutMs = 5000) {
  const p = proc;
  const exited = p && p.exitCode === null && p.signalCode === null
    ? new Promise((r) => { p.once('exit', r); setTimeout(r, timeoutMs); })
    : Promise.resolve();
  stop();
  return exited;
}

async function restart(settings) { stop(); return start(settings); }

async function transcribe(wav, { language } = {}) {
  if (!ready) throw new Error('Engine não está pronto');
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  fd.append('temperature_inc', '0'); // sem fallback: re-decodificar multiplica o tempo do ditado
  if (language) fd.append('language', language);
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}`);
  const j = await res.json();
  const segments = (j.segments || []).map((s) => ({
    t0: Math.round((s.start ?? 0) * 1000), t1: Math.round((s.end ?? 0) * 1000), raw: String(s.text || ''), text: String(s.text || '').trim(),
  }));
  return { text: String(j.text ?? joinSegments(segments)).trim(), segments, language: j.language || language };
}

const toMs = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
const SEG_RE = /^\[(\d+):(\d+):(\d+)\.(\d+)\s*-->\s*(\d+):(\d+):(\d+)\.(\d+)\]\s*(.*)$/;

function transcribeFile(wavPath, opts = {}, onSegment, onProgress) {
  let child = null, cancelled = false;
  const promise = new Promise((resolve, reject) => {
    const exe = findExe('whisper-cli.exe');
    const model = opts.model || current.model;
    if (!exe || !model || !fs.existsSync(modelPath(model))) return reject(new Error('Engine ou modelo não instalado'));
    const base = wavPath.replace(/\.[^.\\/]+$/, '') + '.stt';
    const args = ['-m', modelPath(model), '-f', wavPath, '-l', opts.language || 'auto', '-t', String(threadsFor(opts)),
      '-oj', '-of', base, '-pp', '-np', ...decodeArgs(opts), '-sow'];
    if (opts.initialPrompt) args.push('--prompt', opts.initialPrompt);
    child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
    const segments = [];
    const lineReader = () => {
      let rest = '';
      return (chunk) => {
        rest += chunk.toString('utf8');
        const lines = rest.split(/\r?\n/);
        rest = lines.pop();
        for (const l of lines) {
          const m = SEG_RE.exec(l.trim());
          if (m) {
            const seg = { t0: toMs(m[1], m[2], m[3], m[4]), t1: toMs(m[5], m[6], m[7], m[8]), text: m[9].trim() };
            segments.push(seg); onSegment?.(seg);
          }
          const p = /progress\s*=\s*(\d+)%/.exec(l);
          if (p) onProgress?.(Number(p[1]));
        }
      };
    };
    child.stdout.on('data', lineReader());
    child.stderr.on('data', lineReader());
    child.on('error', reject);
    child.on('close', (code) => {
      if (cancelled) return reject(new Error('cancelled'));
      const jsonFile = base + '.json';
      let result = null;
      try {
        const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const segs = (j.transcription || []).map((s) => ({ t0: s.offsets?.from ?? 0, t1: s.offsets?.to ?? 0, raw: String(s.text || ''), text: String(s.text || '').trim() }));
        result = { text: joinSegments(segs), segments: segs };
      } catch {}
      try { fs.unlinkSync(jsonFile); } catch {}
      if (!result && code !== 0) return reject(new Error(`whisper-cli saiu com código ${code}`));
      resolve(result || { text: joinSegments(segments), segments });
    });
  });
  return { promise, cancel: () => { cancelled = true; try { child?.kill(); } catch {} } };
}

// Pós-processamento chinês (OpenCC carregado sob demanda)
let cc = null;
function postProcess(text, language, chineseVariant) {
  if (!text || !(language || '').startsWith('zh')) return text;
  if (chineseVariant === 'traditional' || chineseVariant === 'simplified') {
    if (!cc) {
      const OpenCC = require('opencc-js');
      cc = { traditional: OpenCC.Converter({ from: 'cn', to: 'twp' }), simplified: OpenCC.Converter({ from: 'twp', to: 'cn' }) };
    }
    text = cc[chineseVariant](text);
  }
  const map = { ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；' };
  return text.replace(/([㐀-鿿豈-﫿])\s*([,.?!:;])/g, (_m, c, p) => c + map[p]);
}

function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[(（*]\s*(music|música|musica|música de fundo|applause|aplausos|laughter|risos|silence|silêncio|noise|ruído|inaudible|inaudível|speaking in foreign language|音乐|掌声|笑声)[^)）*]{0,20}[)）*]/giu, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

process.on('exit', () => { try { proc?.kill(); } catch {} });

Object.assign(engine, {
  MODELS, init, detectHardware, install, cancel, start, stop, restart, status,
  transcribe, transcribeFile, postProcess, cleanTranscript, freePort, joinSegments, threadsFor,
});
module.exports = engine;
