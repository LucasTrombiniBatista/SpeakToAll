// Teste de ponta a ponta: cada caminho de transcrição precisa terminar com uma nota salva.
// Usa o motor real (faster-whisper) já instalado pelo app, numa pasta temporária ligada ao
// motor e ao modelo do usuário por junctions: nenhum arquivo do app é alterado.
//
// Uso: node scripts/e2e-notas.js <arquivo.wav> [modelo=small]
//   (o WAV precisa ser PCM 16-bit mono 16 kHz, como os que o app grava em %APPDATA%\speaktoall\audio)
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const wavPath = process.argv[2];
const model = process.argv[3] || 'small';
if (!wavPath) { console.error('uso: node scripts/e2e-notas.js <arquivo.wav> [modelo]'); process.exit(2); }

// O i18n do main usa o Electron; aqui só precisamos dos textos.
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getLocale: () => 'pt-BR' } };
  return load.call(this, req, ...rest);
};

const engine = require('../src/main/engine');
const notes = require('../src/main/notes');
const jobs = require('../src/main/jobs');
const dictation = require('../src/main/dictation');

const app = path.join(process.env.APPDATA, 'speaktoall');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sta-e2e-'));
fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'models'), { recursive: true });
fs.symlinkSync(path.join(app, 'bin', 'fw'), path.join(tmp, 'bin', 'fw'), 'junction');
fs.symlinkSync(path.join(app, 'models', `fw-${model}`), path.join(tmp, 'models', `fw-${model}`), 'junction');

const settings = { model, language: 'pt', saveDictationNotes: true, saveAudio: true, injectMode: 'paste', hotkeyMode: 'hold' };
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ` — ${detail}` : ''}`); };

function waitJob(id) {
  return new Promise((resolve) => {
    const on = (j) => { if (j.id === id && (j.status === 'done' || j.status === 'error')) { jobs.off('update', on); resolve(j); } };
    jobs.on('update', on);
  });
}

(async () => {
  let exit = 0;
  try {
    engine.init({ dataDir: tmp });
    notes.init(path.join(tmp, 'notes'), path.join(tmp, 'audio'));
    const s = { ...settings };
    jobs.init({
      notes, tmpDir: path.join(tmp, 'tmp'),
      transcribeFn: (p, onSeg, onProg) => engine.transcribeFile(p, s, onSeg, onProg),
    });
    await engine.start(s);
    const wav = fs.readFileSync(wavPath);

    // 1. Ditado (segurar o atalho e falar)
    const injected = [];
    dictation.init({
      engine, notes, config: { get: () => s }, audioDir: path.join(tmp, 'audio'),
      injector: { inject: async (t) => { injected.push(t); } },
      windows: { overlayCommand() {}, hideOverlay() {}, send() {}, showMain() {} },
      hotkeys: { on() {}, reset() {} },
      plugins: { processText: async (t) => t, dispatch() {} },
    });
    dictation.state = 'transcribing';
    await dictation.onAudio(wav);
    const dict = notes.list().find((n) => n.source === 'dictation');
    check('ditado vira nota', !!dict?.text, dict && `"${dict.text.slice(0, 60)}"`);
    check('ditado digitado no app', injected.length === 1 && injected[0] === dict?.text);
    check('ditado guarda o áudio (saveAudio)', !!(dict?.audioFile && fs.existsSync(dict.audioFile)));

    // 2. Importar áudio ou vídeo (o renderer converte para WAV e chama transcribe:start)
    const impId = jobs.enqueue({ name: 'Arquivo importado', wavBuffer: wav, durationMs: 7600, source: 'import', language: 'pt' });
    const imp = await waitJob(impId);
    const impNote = notes.get(impId);
    check('importação vira nota', imp.status === 'done' && !!impNote.text, `"${impNote.text.slice(0, 60)}"`);
    check('importação tem segmentos com tempo', impNote.segments.length > 0 && impNote.segments.every((x) => x.t1 >= x.t0));

    // 3. Reunião gravada (meeting:done: guarda o áudio junto da nota)
    const meetId = jobs.enqueue({ name: 'Reunião', wavBuffer: wav, durationMs: 7600, source: 'meeting', keepAudio: true, audioDir: path.join(tmp, 'audio'), language: 'pt' });
    const meet = await waitJob(meetId);
    const meetNote = notes.get(meetId);
    check('reunião vira nota', meet.status === 'done' && !!meetNote.text, `"${meetNote.text.slice(0, 60)}"`);
    check('reunião guarda o áudio', !!(meetNote.audioFile && fs.existsSync(meetNote.audioFile)));

    check('3 notas no total', notes.list().length === 3, `${notes.list().length}`);
  } catch (e) {
    console.error('ERRO', e);
    exit = 1;
  } finally {
    engine.stop();
    setTimeout(() => {
      // Remove as junctions antes da pasta, para nunca apagar o motor ou o modelo do usuário.
      for (const j of [path.join(tmp, 'bin', 'fw'), path.join(tmp, 'models', `fw-${model}`)]) try { fs.unlinkSync(j); } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
      process.exit(exit || (results.every((r) => r.ok) ? 0 : 1));
    }, 1000);
  }
})();
