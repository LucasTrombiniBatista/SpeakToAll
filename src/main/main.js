// Bootstrap: instância única, módulos, IPC.
const { app, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const i18n = require('./i18n');
const engine = require('./engine');
const notes = require('./notes');
const jobs = require('./jobs');
const ai = require('./ai');
const hotkeys = require('./hotkeys');
const injector = require('./injector');
const tray = require('./tray');
const windows = require('./windows');
const dictation = require('./dictation');
const plugins = require('./plugins');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const RESTART_KEYS = ['model', 'language', 'initialPrompt', 'threads', 'engineFlavor'];
const HOTKEY_KEYS = ['hotkeyCode', 'hotkeyModifiers', 'hotkeyMode', 'tapToLock'];
let chatAbort = null;
let installing = false;

function dirs() {
  const base = app.getPath('userData');
  return { base, notes: path.join(base, 'notes'), audio: path.join(base, 'audio'), tmp: path.join(base, 'tmp') };
}

function configureHotkeys(s) {
  hotkeys.configure({ keycode: s.hotkeyCode, modifiers: s.hotkeyModifiers, mode: s.hotkeyMode, tapToLock: s.tapToLock });
}

async function startEngine() {
  try { await engine.start(config.get()); } catch (err) { console.warn('[engine]', err.message); }
}

function registerIpc(d) {
  ipcMain.handle('settings:get', () => config.get());
  ipcMain.handle('settings:set', (_e, patch) => config.set(patch));
  ipcMain.handle('i18n:get', () => i18n.load(config.get().uiLanguage));

  ipcMain.handle('engine:status', () => engine.status());
  ipcMain.handle('engine:hardware', () => engine.detectHardware());
  ipcMain.handle('engine:install', async (_e, { flavor, model }) => {
    installing = true;
    try {
      await engine.install({ flavor, model }, (p) => windows.send('engine:progress', p));
      config.set({ engineFlavor: flavor, model });
      await engine.start(config.get());
      return engine.status();
    } finally {
      installing = false;
    }
  });
  ipcMain.handle('engine:cancel', () => engine.cancel());

  ipcMain.handle('notes:list', () => notes.list());
  ipcMain.handle('notes:get', (_e, id) => notes.get(id));
  ipcMain.handle('notes:update', (_e, id, patch) => notes.update(id, patch));
  ipcMain.handle('notes:delete', (_e, id) => notes.delete(id));
  ipcMain.handle('notes:export', async (_e, id, fmt) => {
    const { filename, content } = notes.export(id, fmt);
    const { canceled, filePath } = await dialog.showSaveDialog(windows.getMain(), {
      defaultPath: filename, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  });

  const enqueue = (name, wav, durationMs, source, keepAudio) => jobs.enqueue({
    name, wavBuffer: Buffer.from(wav), durationMs, source, keepAudio, audioDir: d.audio, language: config.get().language,
  });
  ipcMain.handle('transcribe:start', (_e, name, wav, durationMs) => enqueue(name, wav, durationMs, 'import', config.get().saveAudio));
  ipcMain.handle('meeting:done', (_e, wav, meta) => enqueue(meta.title, wav, meta.durationMs, 'meeting', true));

  ipcMain.handle('ai:summarize', async (_e, id) => {
    const res = await ai.summarize(notes.get(id), config.get());
    notes.update(id, { title: res.title, summary: res.summary });
    return res;
  });
  ipcMain.handle('ai:chat', (_e, id, messages) => {
    chatAbort?.abort();
    chatAbort = new AbortController();
    ai.chat(notes.get(id), messages, config.get(), (c) => windows.send('ai:chunk', c), chatAbort.signal);
  });

  ipcMain.handle('hotkey:capture', async () => {
    hotkeys.setEnabled(false);
    try {
      const res = await hotkeys.captureNext();
      if (!res) return null;
      config.set({ hotkey: res.label, hotkeyCode: res.keycode, hotkeyModifiers: res.modifiers });
      return res.label;
    } finally {
      hotkeys.setEnabled(true);
    }
  });

  ipcMain.handle('overlay:preview', (_e, type) => windows.overlayCommand(type === 'recording' ? { type: 'start', ...config.get() } : { type }));
  ipcMain.handle('open-external', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });

  ipcMain.on('overlay:audio', (_e, wav) => dictation.onAudio(wav));
  ipcMain.on('overlay:hide', () => windows.hideOverlay());
}

app.on('second-instance', () => windows.showMain());
app.on('before-quit', () => {
  windows.setQuitting();
  hotkeys.stop();
  plugins.unloadAll();
  injector.stop();
  engine.stop();
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  const d = dirs();
  config.init(d.base);
  notes.init(d.notes, d.audio);
  engine.init({ dataDir: d.base });
  jobs.init({
    notes, tmpDir: d.tmp,
    processText: (text, ctx) => plugins.processText(text, ctx),
    transcribeFn: (wavPath, onSegment, onProgress) => {
      const s = config.get();
      const run = engine.transcribeFile(wavPath, s, (seg) => onSegment({ ...seg, text: engine.postProcess(seg.text, s.language, s.chineseVariant) }), onProgress);
      return { cancel: run.cancel, promise: run.promise.then((r) => ({ ...r, text: engine.postProcess(r.text, s.language, s.chineseVariant) })) };
    },
  });

  await plugins.init({
    baseDir: d.base, appVersion: app.getVersion(), config, notes,
    onNotify: (n) => windows.send('plugins:notice', n),
  });

  registerIpc(d);
  windows.setupMedia();
  windows.createMain({ closeToTray: () => config.get().closeToTray });
  windows.createOverlay();

  tray.createTray({
    onOpen: () => windows.showMain(),
    onQuit: () => app.quit(),
    onToggleRecording: () => (dictation.state === 'idle' ? dictation.start() : dictation.stop()),
  });

  engine.on('status', (st) => windows.send('engine:status', st));
  notes.on('changed', () => windows.send('notes:changed'));
  jobs.on('update', (job) => windows.send('jobs:update', job));
  dictation.on('state', (st) => tray.setRecording(st === 'recording'));

  // Eventos do app repassados aos plugins.
  dictation.on('state', (state) => plugins.dispatch('dictation:state', { state }));
  notes.on('changed', (e) => { if (e?.type === 'create') plugins.dispatch('note:created', notes.get(e.id)); });

  config.on('changed', (s, keys) => {
    windows.send('settings:changed', s);
    plugins.dispatch('settings:changed', plugins.api.getSettings());
    if (keys.some((k) => RESTART_KEYS.includes(k)) && !installing) startEngine();
    if (keys.some((k) => HOTKEY_KEYS.includes(k))) configureHotkeys(s);
    if (keys.includes('startWithWindows')) app.setLoginItemSettings({ openAtLogin: s.startWithWindows });
  });

  injector.start();
  dictation.init({ engine, injector, notes, config, windows, hotkeys, plugins, audioDir: d.audio });
  configureHotkeys(config.get());
  hotkeys.start();
  startEngine();
});
