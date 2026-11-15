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

// Motor reserva (faster-whisper no Python embutido), usado quando o Windows bloqueia o whisper-server.exe.
// O pacote é publicado pelo workflow fw-runtime.yml; subir a versão faz o app baixá-lo de novo uma vez.
const FW_RUNTIME_VERSION = 'v1';
const FW_RUNTIME_URL = `https://github.com/LucasTrombiniBatista/SpeakToAll/releases/download/fw-runtime-${FW_RUNTIME_VERSION}/sta-fw-runtime-win64.zip`;
const FW_RUNTIME_MB = 96;
// Mesmos ids da interface, no formato CTranslate2 (os .bin do whisper.cpp não servem).
const FW_MODELS = {
  tiny: { repo: 'Systran/faster-whisper-tiny', sizeMb: 75 },
  base: { repo: 'Systran/faster-whisper-base', sizeMb: 145 },
  small: { repo: 'Systran/faster-whisper-small', sizeMb: 464 },
  'medium-q5_0': { repo: 'Systran/faster-whisper-medium', sizeMb: 1530 },
  'large-v3-turbo-q5_0': { repo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo', sizeMb: 1620 },
};

// 'auto' usa o nativo até ele ser bloqueado (engineFallback = 'fw'); 'native'/'fw' forçam.
function backendFor(s = {}) {
  if (s.engineBackend === 'fw') return 'fw';
  if (s.engineBackend !== 'native' && s.engineFallback === 'fw') return 'fw';
  return 'native';
}

const engine = new EventEmitter();
let paths = null;
let proc = null, port = 0, ready = false, current = { model: null, flavor: null, backend: 'native' };
let abort = null;
let installing = null; // promise da instalação em andamento

// Código de saída do Windows quando o Controle Inteligente de Aplicativos (Smart App Control)
// ou outra política de integridade bloqueia um .exe sem assinatura (STATUS_SYSTEM_INTEGRITY_POLICY_VIOLATION).
const BLOCKED_BY_POLICY = 0xC0E90002;
// DLL ausente (STATUS_DLL_NOT_FOUND): no motor CUDA, é o nvcuda.dll do driver da NVIDIA.
const DLL_NOT_FOUND = 0xC0000135;

function init({ dataDir }) {
  paths = { bin: path.join(dataDir, 'bin', 'whisper'), fw: path.join(dataDir, 'bin', 'fw'), models: path.join(dataDir, 'models') };
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

const fwPython = () => path.join(paths.fw, 'python', 'python.exe');
const fwServer = () => path.join(paths.fw, 'server.py');
const fwModelDir = (id) => path.join(paths.models, `fw-${id}`);
function fwRuntimeOk() {
  try {
    return fs.readFileSync(path.join(paths.fw, 'VERSION'), 'utf8').trim() === FW_RUNTIME_VERSION
      && fs.existsSync(fwPython()) && fs.existsSync(fwServer());
  } catch { return false; }
}
const fwModelOk = (id) => fs.existsSync(path.join(fwModelDir(id), 'model.bin')) && fs.existsSync(path.join(fwModelDir(id), 'config.json'));

function status() {
  const backend = current.backend || 'native';
  const model = current.model;
  if (backend === 'fw') {
    return { installed: !!(fwRuntimeOk() && model && fwModelOk(model)), ready, model, flavor: 'cpu', backend };
  }
  const flavor = installedFlavor();
  const installed = !!(flavor && findExe('whisper-server.exe') && model && fs.existsSync(modelPath(model)));
  return { installed, ready, model, flavor, backend };
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

// Downloads pela rede do Chromium (net.fetch): usa os certificados do Windows, então funciona com
// antivírus/proxies que inspecionam HTTPS (o fetch do Node só confia na lista própria e falha com
// SELF_SIGNED_CERT_IN_CHAIN). Fora do Electron (testes), cai no fetch do Node.
function webFetch(url, opts) {
  let net = null;
  try { net = require('electron').net; } catch {}
  return net?.fetch ? net.fetch(url, opts) : fetch(url, opts);
}

// Download com .part, progresso a cada 150 ms e cancelamento
async function download(url, dest, stage, onProgress, signal) {
  const part = dest + '.part';
  try {
    const res = await webFetch(url, { signal, redirect: 'follow' });
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

// Uma instalação por vez: uma segunda chamada recebe a mesma promise (o onboarding podia disparar
// duas, e a segunda apagava os arquivos que a primeira estava usando).
function install(opts, onProgress) {
  if (!installing) installing = doInstall(opts, onProgress).finally(() => { installing = null; });
  return installing;
}
const isInstalling = () => !!installing;

// Runtime: zip do Release (ou STA_FW_RUNTIME_ZIP, um zip local, para testar antes de publicar).
async function installFwRuntime(onProgress, signal) {
  if (fwRuntimeOk()) return;
  await stopAndWait();
  fs.rmSync(paths.fw, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  fs.mkdirSync(paths.fw, { recursive: true });
  const zip = path.join(paths.fw, 'runtime.zip');
  if (process.env.STA_FW_RUNTIME_ZIP) {
    fs.copyFileSync(process.env.STA_FW_RUNTIME_ZIP, zip);
    onProgress?.({ stage: 'engine', percent: 100, totalMb: FW_RUNTIME_MB });
  } else {
    await download(FW_RUNTIME_URL, zip, 'engine', onProgress, signal);
  }
  await expand(zip, paths.fw);
  fs.unlinkSync(zip);
  if (!fwRuntimeOk()) throw new Error('Pacote do motor alternativo incompleto');
}

// Modelo CTranslate2: lista os arquivos do repositório e baixa os pequenos primeiro; o model.bin
// (quase todo o tamanho) por último, com progresso. A pasta só conta como pronta com o model.bin.
async function installFwModel(model, onProgress, signal) {
  if (fwModelOk(model)) return;
  const spec = FW_MODELS[model];
  if (!spec) throw new Error(`Modelo sem versão para o motor alternativo: ${model}`);
  const res = await webFetch(`https://huggingface.co/api/models/${spec.repo}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao listar ${spec.repo}`);
  const files = ((await res.json()).siblings || []).map((f) => f.rfilename)
    .filter((f) => !/\.(md|gitattributes)$/i.test(f) && !f.includes('/'));
  if (!files.includes('model.bin')) throw new Error(`model.bin não encontrado em ${spec.repo}`);
  const dir = fwModelDir(model);
  fs.mkdirSync(dir, { recursive: true });
  const url = (f) => `https://huggingface.co/${spec.repo}/resolve/main/${f}`;
  for (const f of files.filter((x) => x !== 'model.bin')) await download(url(f), path.join(dir, f), 'aux', null, signal);
  await download(url('model.bin'), path.join(dir, 'model.bin'), 'model', onProgress, signal);
}

async function doInstall({ flavor = 'cpu', model, backend = 'native' }, onProgress) {
  console.warn('[engine] install', backend, flavor, model);
  if (backend === 'fw') {
    abort = new AbortController();
    try {
      await installFwRuntime(onProgress, abort.signal);
      if (model) await installFwModel(model, onProgress, abort.signal);
      current = { model, flavor: 'cpu', backend: 'fw' };
      onProgress?.({ stage: 'starting', percent: 100 });
      emitStatus();
      console.warn('[engine] install ok', backend, model);
      return;
    } catch (e) {
      console.warn('[engine] install falhou', backend, model, e.message);
      throw e;
    } finally { abort = null; }
  }
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
    current = { model, flavor, backend: 'native' };
    onProgress?.({ stage: 'starting', percent: 100 });
    emitStatus();
    console.warn('[engine] install ok', flavor, model);
  } catch (e) {
    console.warn('[engine] install falhou', flavor, model, e.message);
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
// 'fast' = greedy; 'accurate' = beam search 5 (~3-5x mais lento na CPU).
// Argumentos do server.py (motor reserva), equivalentes aos do whisper-server/whisper-cli.
const fwArgs = (s, extra = []) => [
  fwServer(), '--model', fwModelDir(s.model || current.model), '--threads', String(threadsFor(s)),
  '--language', s.language || 'auto', '--beam', s.transcriptionQuality === 'accurate' ? '5' : '1',
  ...(s.initialPrompt ? ['--prompt', s.initialPrompt] : []), ...extra,
];
const decodeArgs = (s) => (s.transcriptionQuality === 'accurate' ? ['-bs', '5', '-bo', '5'] : ['-bs', '1', '-bo', '1']);

// O whisper pode fechar um segmento no meio de uma palavra; a continuação vem sem espaço
// inicial. Juntar com o texto cru (sem trim) evita "be m" no lugar de "bem".
// Sem raw (segmento já aparado), assume fronteira de palavra.
const joinSegments = (segs) => segs.map((s) => s.raw ?? ` ${s.text ?? ''}`).join('').replace(/\s+/g, ' ').trim();

async function start(settings) {
  // Durante a instalação os arquivos são apagados e trocados; quem instala sobe o motor no fim.
  if (installing) throw new Error('Instalação do motor em andamento');
  stop();
  const backend = backendFor(settings);
  const fw = backend === 'fw';
  current = { model: settings.model, flavor: fw ? 'cpu' : installedFlavor() || settings.engineFlavor, backend };
  const exe = fw ? (fwRuntimeOk() ? fwPython() : null) : findExe('whisper-server.exe');
  const modelOk = fw ? fwModelOk(settings.model) : fs.existsSync(modelPath(settings.model));
  if (!exe || !modelOk) { emitStatus(); throw new Error('Engine ou modelo não instalado'); }
  port = await freePort();
  if (installing) throw new Error('Instalação do motor em andamento');
  const args = fw ? fwArgs(settings, ['--port', String(port)]) : [
    '-m', modelPath(settings.model), '--host', '127.0.0.1', '--port', String(port), '-t', String(threadsFor(settings)),
    '-l', settings.language || 'auto', ...decodeArgs(settings), '-sow',
    ...(settings.initialPrompt ? ['--prompt', settings.initialPrompt] : []),
  ];
  const p = spawn(exe, args, { cwd: fw ? paths.fw : path.dirname(exe), windowsHide: true, stdio: 'ignore' });
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
      if (exitCode === DLL_NOT_FOUND && current.flavor === 'cuda') {
        const err = new Error('Driver da NVIDIA não encontrado. Instale o driver da placa ou use o motor CPU.');
        err.code = 'NO_NVIDIA_DRIVER';
        throw err;
      }
      throw new Error(`${fw ? 'Motor alternativo' : 'whisper-server'} encerrou${exitCode != null ? ` (código ${exitCode})` : ''}`);
    }
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

async function transcribe(wav, { language } = {}) {
  if (!ready) throw new Error('Engine não está pronto');
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  const fw = current.backend === 'fw';
  const res = fw
    ? await fetch(`http://127.0.0.1:${port}/inference?language=${encodeURIComponent(language || '')}`, { method: 'POST', body: buf })
    : await inferNative(buf, language);
  if (!res.ok) throw new Error(`${fw ? 'Motor alternativo' : 'whisper-server'} HTTP ${res.status}`);
  const j = await res.json();
  const segments = (j.segments || []).map((s) => ({
    t0: Math.round((s.start ?? 0) * 1000), t1: Math.round((s.end ?? 0) * 1000), raw: String(s.text || ''), text: String(s.text || '').trim(),
  }));
  return { text: String(j.text ?? joinSegments(segments)).trim(), segments, language: j.language || language };
}

function inferNative(buf, language) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  fd.append('temperature_inc', '0'); // sem fallback: re-decodificar multiplica o tempo do ditado
  if (language) fd.append('language', language);
  return fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd });
}

const toMs = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
const SEG_RE = /^\[(\d+):(\d+):(\d+)\.(\d+)\s*-->\s*(\d+):(\d+):(\d+)\.(\d+)\]\s*(.*)$/;

function transcribeFile(wavPath, opts = {}, onSegment, onProgress) {
  let child = null, cancelled = false;
  const promise = new Promise((resolve, reject) => {
    const fw = (current.model ? current.backend : backendFor(opts)) === 'fw';
    const model = opts.model || current.model;
    const exe = fw ? (fwRuntimeOk() ? fwPython() : null) : findExe('whisper-cli.exe');
    if (!exe || !model || !(fw ? fwModelOk(model) : fs.existsSync(modelPath(model)))) return reject(new Error('Engine ou modelo não instalado'));
    const base = wavPath.replace(/\.[^.\\/]+$/, '') + '.stt';
    let args;
    if (fw) args = fwArgs({ ...opts, model }, ['--file', wavPath, '--out', base]);
    else {
      args = ['-m', modelPath(model), '-f', wavPath, '-l', opts.language || 'auto', '-t', String(threadsFor(opts)),
        '-oj', '-of', base, '-pp', '-np', ...decodeArgs(opts), '-sow'];
      if (opts.initialPrompt) args.push('--prompt', opts.initialPrompt);
    }
    child = spawn(exe, args, { cwd: fw ? paths.fw : path.dirname(exe), windowsHide: true });
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
  MODELS, FW_MODELS, FW_RUNTIME_MB, backendFor, init, detectHardware, install, isInstalling, BLOCKED_BY_POLICY, cancel, start, stop, status,
  transcribe, transcribeFile, postProcess, cleanTranscript, joinSegments, threadsFor,
});
module.exports = engine;
