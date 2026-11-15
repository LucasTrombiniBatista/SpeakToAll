// Motor de reconhecimento: faster-whisper (CTranslate2) rodando num Python embutido.
// Instala o runtime + modelos, mantém o servidor local "quente" para o ditado e transcreve
// arquivos longos (importação/reunião) num processo à parte.
//
// Por que não o whisper.cpp: no Windows 11 com o Controle Inteligente de Aplicativos ligado, o
// whisper-server.exe (sem assinatura) é bloqueado. O python.exe oficial é assinado e o
// ctranslate2.dll é liberado pela reputação do arquivo (ver docs/arquitetura.md).
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');

// Runtime publicado pelo workflow fw-runtime.yml; subir a versão faz o app baixá-lo de novo uma vez.
const RUNTIME_VERSION = 'v1';
const RUNTIME_URL = `https://github.com/LucasTrombiniBatista/SpeakToAll/releases/download/fw-runtime-${RUNTIME_VERSION}/sta-fw-runtime-win64.zip`;
const RUNTIME_MB = 96;

// Os ids continuam os de antes (ficam salvos em settings.json); os arquivos são CTranslate2.
const MODELS = [
  { id: 'tiny', repo: 'Systran/faster-whisper-tiny', sizeMb: 75 },
  { id: 'base', repo: 'Systran/faster-whisper-base', sizeMb: 145 },
  { id: 'small', repo: 'Systran/faster-whisper-small', sizeMb: 464, recommended: true },
  { id: 'medium-q5_0', repo: 'Systran/faster-whisper-medium', sizeMb: 1530 },
  { id: 'large-v3-turbo-q5_0', repo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo', sizeMb: 1620 },
];
const modelSpec = (id) => MODELS.find((m) => m.id === id);

const engine = new EventEmitter();
let paths = null;
let proc = null, port = 0, ready = false, current = { model: null };
let abort = null;
let installing = null; // promise da instalação em andamento

// Código de saída do Windows quando uma política de integridade bloqueia um executável
// (STATUS_SYSTEM_INTEGRITY_POLICY_VIOLATION). Não deveria acontecer com o python.exe assinado.
const BLOCKED_BY_POLICY = 0xC0E90002;

function init({ dataDir }) {
  paths = { bin: path.join(dataDir, 'bin'), fw: path.join(dataDir, 'bin', 'fw'), models: path.join(dataDir, 'models') };
  fs.mkdirSync(paths.models, { recursive: true });
  removeLegacy();
}

// Até a 0.1.11 o motor era o whisper.cpp: apaga o executável e os modelos ggml (centenas de MB a GB).
function removeLegacy() {
  const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); console.warn('[engine] removido', p); } catch {} };
  try {
    for (const e of fs.readdirSync(paths.bin)) if (e === 'whisper' || e.startsWith('whisper-old-')) rm(path.join(paths.bin, e));
  } catch {}
  try {
    for (const e of fs.readdirSync(paths.models)) if (/^ggml-.*\.bin(\.part)?$/.test(e)) rm(path.join(paths.models, e));
  } catch {}
}

const python = () => path.join(paths.fw, 'python', 'python.exe');
const server = () => path.join(paths.fw, 'server.py');
const modelDir = (id) => path.join(paths.models, `fw-${id}`);
function runtimeOk() {
  try {
    return fs.readFileSync(path.join(paths.fw, 'VERSION'), 'utf8').trim() === RUNTIME_VERSION
      && fs.existsSync(python()) && fs.existsSync(server());
  } catch { return false; }
}
const modelOk = (id) => fs.existsSync(path.join(modelDir(id), 'model.bin')) && fs.existsSync(path.join(modelDir(id), 'config.json'));

function status() {
  const model = current.model;
  return { installed: !!(runtimeOk() && model && modelOk(model)), ready, model };
}
const emitStatus = () => engine.emit('status', status());

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 8000 },
    (err, out) => resolve(err ? null : String(out))));
}

// Recomenda o modelo pela CPU/RAM (o motor roda só na CPU). A GPU aparece só como informação.
async function detectHardware() {
  const cpus = os.cpus();
  const threads = cpus.length;
  const cpu = `${(cpus[0]?.model || 'CPU').trim()} (${threads} threads)`;
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const out = await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);
  const gpu = out && out.trim() ? out.trim().split(/\r?\n/)[0].trim() : null;
  // Na CPU, o large-v3-turbo leva quase o tempo do próprio áudio; o small transcreve ~4x mais rápido.
  const recommendedModel = ramGb < 6 || threads < 4 ? 'base' : 'small';
  return { cpu, ramGb, gpu, recommendedModel };
}

// Antivírus e proxies que inspecionam HTTPS instalam a própria raiz no Windows; o fetch do Node só
// confia na lista dele e falha com SELF_SIGNED_CERT_IN_CHAIN. Soma as raízes do Windows às padrão.
// O net.fetch do Chromium já confia nelas, mas baixa ~50x mais devagar: fica só como reserva.
let systemCaLoaded = false;
function trustSystemCa() {
  if (systemCaLoaded) return;
  systemCaLoaded = true;
  try {
    const tls = require('tls');
    if (tls.setDefaultCACertificates && tls.getCACertificates) {
      tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]);
    }
  } catch (e) { console.warn('[engine] certificados do sistema', e.message); }
}

const CERT_ERRORS = /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/;
async function webFetch(url, opts) {
  trustSystemCa();
  try {
    return await fetch(url, opts);
  } catch (e) {
    let electronNet = null;
    try { electronNet = require('electron').net; } catch {}
    if (!electronNet?.fetch || !CERT_ERRORS.test(e.cause?.code || '')) throw e;
    console.warn('[engine] fetch do Node recusou o certificado; usando a rede do Chromium', url);
    return electronNet.fetch(url, opts);
  }
}

// Download com .part, progresso a cada 150 ms e cancelamento. expectedMb: tamanho conhecido,
// usado quando o servidor não manda content-length, para a barra não ficar parada em 0%.
async function download(url, dest, stage, onProgress, signal, expectedMb = 0) {
  const part = dest + '.part';
  try {
    const res = await webFetch(url, { signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const total = Number(res.headers.get('content-length')) || expectedMb * 1048576;
    const totalMb = Math.round(total / 1048576);
    let got = 0, last = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length;
        const now = Date.now();
        if (now - last >= 150) {
          last = now;
          onProgress?.({ stage, percent: total ? Math.min(99, Math.floor((got / total) * 100)) : 0, totalMb });
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

// Uma instalação por vez: uma segunda chamada recebe a mesma promise (o onboarding podia disparar
// duas, e a segunda apagava os arquivos que a primeira estava usando).
function install(opts, onProgress) {
  if (!installing) installing = doInstall(opts, onProgress).finally(() => { installing = null; });
  return installing;
}
const isInstalling = () => !!installing;

// Runtime: zip do Release (ou STA_FW_RUNTIME_ZIP, um zip local, para testar antes de publicar).
async function installRuntime(onProgress, signal) {
  if (runtimeOk()) return;
  await stopAndWait(); // o Windows trava o python.exe em uso
  fs.rmSync(paths.fw, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  fs.mkdirSync(paths.fw, { recursive: true });
  const zip = path.join(paths.fw, 'runtime.zip');
  if (process.env.STA_FW_RUNTIME_ZIP) {
    fs.copyFileSync(process.env.STA_FW_RUNTIME_ZIP, zip);
    onProgress?.({ stage: 'engine', percent: 100, totalMb: RUNTIME_MB });
  } else {
    await download(RUNTIME_URL, zip, 'engine', onProgress, signal, RUNTIME_MB);
  }
  await expand(zip, paths.fw);
  fs.unlinkSync(zip);
  if (!runtimeOk()) throw new Error('Pacote do motor incompleto');
}

// Modelo CTranslate2: lista os arquivos do repositório e baixa os pequenos primeiro; o model.bin
// (quase todo o tamanho) por último, com progresso. A pasta só conta como pronta com o model.bin.
async function installModel(model, onProgress, signal) {
  if (modelOk(model)) return;
  const spec = modelSpec(model);
  if (!spec) throw new Error(`Modelo desconhecido: ${model}`);
  const res = await webFetch(`https://huggingface.co/api/models/${spec.repo}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao listar ${spec.repo}`);
  const files = ((await res.json()).siblings || []).map((f) => f.rfilename)
    .filter((f) => !/\.(md|gitattributes)$/i.test(f) && !f.includes('/'));
  if (!files.includes('model.bin')) throw new Error(`model.bin não encontrado em ${spec.repo}`);
  const dir = modelDir(model);
  fs.mkdirSync(dir, { recursive: true });
  const url = (f) => `https://huggingface.co/${spec.repo}/resolve/main/${f}`;
  for (const f of files.filter((x) => x !== 'model.bin')) await download(url(f), path.join(dir, f), 'aux', null, signal);
  await download(url('model.bin'), path.join(dir, 'model.bin'), 'model', onProgress, signal, spec.sizeMb);
}

async function doInstall({ model }, onProgress) {
  console.warn('[engine] install', model);
  abort = new AbortController();
  try {
    await installRuntime(onProgress, abort.signal);
    if (model) await installModel(model, onProgress, abort.signal);
    current = { model };
    onProgress?.({ stage: 'starting', percent: 100 });
    emitStatus();
    console.warn('[engine] install ok', model);
  } catch (e) {
    console.warn('[engine] install falhou', model, e.message);
    throw e;
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

// Argumentos do server.py. 'fast' = greedy; 'accurate' = beam search 5 (~3-5x mais lento).
const serverArgs = (s, extra = []) => [
  server(), '--model', modelDir(s.model || current.model), '--threads', String(threadsFor(s)),
  '--language', s.language || 'auto', '--beam', s.transcriptionQuality === 'accurate' ? '5' : '1',
  ...(s.initialPrompt ? ['--prompt', s.initialPrompt] : []), ...extra,
];

// O whisper pode fechar um segmento no meio de uma palavra; a continuação vem sem espaço
// inicial. Juntar com o texto cru (sem trim) evita "be m" no lugar de "bem".
// Sem raw (segmento já aparado), assume fronteira de palavra.
const joinSegments = (segs) => segs.map((s) => s.raw ?? ` ${s.text ?? ''}`).join('').replace(/\s+/g, ' ').trim();

async function start(settings) {
  // Durante a instalação os arquivos são apagados e trocados; quem instala sobe o motor no fim.
  if (installing) throw new Error('Instalação do motor em andamento');
  stop();
  current = { model: settings.model };
  if (!runtimeOk() || !modelOk(settings.model)) { emitStatus(); throw new Error('Engine ou modelo não instalado'); }
  port = await freePort();
  if (installing) throw new Error('Instalação do motor em andamento');
  const p = spawn(python(), serverArgs(settings, ['--port', String(port)]), { cwd: paths.fw, windowsHide: true, stdio: 'ignore' });
  proc = p;
  let exitCode = null;
  // Sem este handler, um spawn que falha (ENOENT) derruba o processo principal.
  p.on('error', (err) => { exitCode = err.code; if (proc === p) { proc = null; ready = false; emitStatus(); } });
  p.on('exit', (code) => { exitCode = code >>> 0; if (proc === p) { proc = null; ready = false; emitStatus(); } });
  emitStatus();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (proc !== p) {
      if (exitCode === BLOCKED_BY_POLICY) {
        const err = new Error('O Windows bloqueou o motor (Controle Inteligente de Aplicativos). Veja a solução de problemas na documentação.');
        err.code = 'BLOCKED_BY_POLICY';
        throw err;
      }
      throw new Error(`Motor encerrou${exitCode != null ? ` (código ${exitCode})` : ''}`);
    }
    if (await canConnect(port)) { ready = true; emitStatus(); return status(); }
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error('Timeout aguardando o motor');
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

async function transcribe(wav, { language } = {}) {
  if (!ready) throw new Error('Engine não está pronto');
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  const res = await fetch(`http://127.0.0.1:${port}/inference?language=${encodeURIComponent(language || '')}`, { method: 'POST', body: buf });
  if (!res.ok) throw new Error(`Motor HTTP ${res.status}`);
  const j = await res.json();
  const segments = (j.segments || []).map((s) => ({
    t0: Math.round((s.start ?? 0) * 1000), t1: Math.round((s.end ?? 0) * 1000), raw: String(s.text || ''), text: String(s.text || '').trim(),
  }));
  return { text: String(j.text ?? joinSegments(segments)).trim(), segments, language: j.language || language };
}

const toMs = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
const SEG_RE = /^\[(\d+):(\d+):(\d+)\.(\d+)\s*-->\s*(\d+):(\d+):(\d+)\.(\d+)\]\s*(.*)$/;

// Arquivo longo num processo à parte (server.py --file): segmentos e progresso no stdout,
// resultado final num JSON ao lado do WAV.
function transcribeFile(wavPath, opts = {}, onSegment, onProgress) {
  let child = null, cancelled = false;
  const promise = new Promise((resolve, reject) => {
    const model = opts.model || current.model;
    if (!runtimeOk() || !model || !modelOk(model)) return reject(new Error('Engine ou modelo não instalado'));
    const base = wavPath.replace(/\.[^.\\/]+$/, '') + '.stt';
    child = spawn(python(), serverArgs({ ...opts, model }, ['--file', wavPath, '--out', base]), { cwd: paths.fw, windowsHide: true });
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
      if (!result && code !== 0) return reject(new Error(`Motor saiu com código ${code}`));
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
  return text.replace(/([㐀-鿿豈-﫿])\s*([,.?!:;])/g, (_m, c, p) => c + map[p]);
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
  MODELS, RUNTIME_MB, init, detectHardware, install, isInstalling, BLOCKED_BY_POLICY, cancel, start, stop, status,
  transcribe, transcribeFile, postProcess, cleanTranscript, joinSegments, threadsFor,
});
module.exports = engine;
