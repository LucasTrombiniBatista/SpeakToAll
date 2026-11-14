// Pílula de gravação. Comandos vindos do main: start, stop, cancel, lock, transcribing, done, error.
const { createRecorder, openMic, encodeWav, fmtClock, SAMPLE_RATE } = window.staAudio;
const $ = (id) => document.getElementById(id);
const MIN_MS = 350;

let rec = null;
let levels = [];
let t0 = 0;
let raf = 0;
let hideTimer = 0;
// Detecção de mic mudo: cada ditado tem um id para descartar reaberturas que chegam atrasadas.
const SILENT_RMS = 1e-4;
const SILENT_CHECK_MS = 700;
let session = 0;
let silent = false;
let silentTimer = 0;
let opts = { sounds: true, micDevice: 'default' };
// Padrão em português; o main manda os rótulos no idioma da interface com cada comando.
let labels = { transcribing: 'Transcrevendo…', done: 'Inserido', error: 'Algo deu errado', locked: 'TRAVADO', micUnavailable: 'Microfone indisponível', micSilent: 'Microfone sem sinal. Está em uso por outro app?' };

// Um AudioContext só, para gravar e para os bipes: criar um por ditado atrasa o início da gravação.
// Fica suspenso entre ditados para não manter o dispositivo de áudio aberto.
let audioCtx = null;
let idleTimer = 0;
function audio() {
  clearTimeout(idleTimer);
  audioCtx = audioCtx || new AudioContext({ sampleRate: SAMPLE_RATE });
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function idleLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!rec && audioCtx) audioCtx.suspend(); }, 1000);
}

function beep(freq, dur = 0.08) {
  if (!opts.sounds) return;
  const ctx = audio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + dur);
}

function setState(state, label = '') {
  clearTimeout(hideTimer);
  $('bubble').classList.add('show');
  const rec = state === 'recording';
  $('i-rec').hidden = !rec;
  $('levels').hidden = !rec;
  $('time').hidden = !rec;
  $('i-spin').hidden = state !== 'transcribing';
  $('i-ok').hidden = state !== 'done';
  $('i-err').hidden = state !== 'error';
  $('label').hidden = rec;
  $('label').textContent = label || { transcribing: labels.transcribing, done: labels.done, error: labels.error }[state] || '';
  if (!rec) $('lock').hidden = true;
  if (state === 'done' || state === 'error') hideTimer = setTimeout(hide, state === 'done' ? 1000 : 2400);
}

function hide() {
  $('bubble').classList.remove('show');
  setTimeout(() => window.wp.hide && window.wp.hide(), 180);
}

function draw() {
  const c = $('levels');
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const n = 20, bw = 3, gap = 3, h = c.clientHeight;
  const slice = levels.slice(-n);
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < n; i++) {
    const lv = slice[i - (n - slice.length)] || 0;
    const bh = Math.max(3, Math.min(h, lv * h * 7));
    ctx.beginPath();
    ctx.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 1.5);
    ctx.fill();
  }
  $('time').textContent = fmtClock(performance.now() - t0, true);
  raf = requestAnimationFrame(draw);
}

async function openRec(processing) {
  const { stream } = await openMic(opts.micDevice, { processing });
  return createRecorder([stream], (lv) => levels.push(lv), audio());
}

const isSilent = () => !levels.some((lv) => lv > SILENT_RMS);

// Mic que abre mas só entrega zeros (comum quando o Discord já usa o dispositivo):
// reabre uma vez sem o processamento do Chromium; se continuar mudo, avisa no fim.
async function checkSilent(id, retried) {
  if (id !== session || !rec || !isSilent()) return;
  if (retried) { silent = true; return; }
  const old = rec;
  try {
    const next = await openRec(false);
    if (id !== session || rec !== old) return next.stop();
    rec = next;
    levels = [];
    old.stop();
    silentTimer = setTimeout(() => checkSilent(id, true), SILENT_CHECK_MS);
  } catch { silent = true; }
}

async function start(cmd = {}) {
  opts = { ...opts, ...cmd };
  const id = ++session;
  levels = [];
  silent = false;
  clearTimeout(silentTimer);
  setState('recording');
  beep(880);
  try {
    const r = await openRec(true);
    if (id !== session) return r.stop();
    rec = r;
  } catch {
    return setState('error', labels.micUnavailable);
  }
  t0 = performance.now();
  draw();
  silentTimer = setTimeout(() => checkSilent(id, false), SILENT_CHECK_MS);
}

// O main fica esperando um WAV depois do stop; sem gravação, manda um vazio para ele liberar.
const sendEmpty = () => window.wp.sendAudio(encodeWav(new Float32Array(0)));

async function stop() {
  session++;
  clearTimeout(silentTimer);
  if (!rec) return sendEmpty();
  cancelAnimationFrame(raf);
  const r = rec; rec = null;
  const wasSilent = silent && isSilent();
  const { wav, durationMs } = await r.stop({ trim: true });
  beep(660);
  idleLater();
  if (wasSilent) {
    setState('error', labels.micSilent);
    return setTimeout(sendEmpty, 2400);
  }
  if (durationMs >= MIN_MS) setState('transcribing');
  window.wp.sendAudio(wav);
}

async function cancel() {
  session++;
  clearTimeout(silentTimer);
  cancelAnimationFrame(raf);
  if (rec) { await rec.stop(); rec = null; }
  idleLater();
  hide();
}

function onCommand(cmd) {
  if (cmd.labels) { labels = cmd.labels; $('lock').textContent = labels.locked; }
  switch (cmd.type) {
    case 'start': return start(cmd);
    case 'stop': return stop();
    case 'cancel': return cancel();
    case 'lock': $('lock').hidden = false; return;
    case 'transcribing': return setState('transcribing');
    case 'done': return setState('done');
    case 'error': return setState('error', cmd.message);
  }
}

if (window.wp.isMock) {
  // No navegador: ?preview=recording|transcribing|done simula a pílula. Espaço grava de verdade.
  window.wp.onCommand = () => {};
  window.wp.sendAudio = (wav) => { console.log(`WAV ${wav.byteLength} bytes`); setTimeout(() => setState('done'), 900); };
  window.wp.hide = () => {};
  const preview = new URLSearchParams(location.search).get('preview') || 'recording';
  if (preview === 'recording') {
    setState('recording');
    t0 = performance.now();
    setInterval(() => levels.push(Math.random() * 0.12), 60);
    draw();
  } else setState(preview);
  addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) { cancelAnimationFrame(raf); start(); } });
  addEventListener('keyup', (e) => { if (e.code === 'Space') stop(); });
} else {
  window.wp.onCommand(onCommand);
}
