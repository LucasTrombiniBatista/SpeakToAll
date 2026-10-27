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
const store = require('./plugins/store');
const obsidian = require('./integrations/obsidian');

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
  ipcMain.handle('ai:models', () => ai.listModels(config.get()));

  ipcMain.handle('obsidian:pick-vault', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windows.getMain(), { properties: ['openDirectory'] });
    if (canceled || !filePaths[0]) return null;
    config.set({ obsidianVault: filePaths[0] });
    return { path: filePaths[0], isVault: obsidian.isVault(filePaths[0]) };
  });
  ipcMain.handle('obsidian:status', () => {
    const vault = config.get().obsidianVault;
    return { exists: !!vault && obsidian.isFolder(vault), isVault: !!vault && obsidian.isVault(vault) };
  });
  // Sugestão para a tela de revisão. Se a IA falhar, devolve os padrões e o erro para o usuário preencher à mão.
  ipcMain.handle('obsidian:suggest', async (_e, id) => {
    const s = config.get();
    const note = notes.get(id);
    if (!note) throw new Error('Nota não encontrada');
    const { folders, tags } = obsidian.scanVault(s.obsidianVault);
    const presets = String(s.obsidianCategories || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    const fallback = { title: note.title, folder: s.obsidianFolder || '', tags: [], body: note.text || '' };
    try {
      const suggestion = await ai.categorize(note, { folders, tags, presets, autoDetect: s.obsidianAutoDetect, defaultFolder: s.obsidianFolder }, s);
      return { folders, tags, presets, suggestion, aiError: null };
    } catch (err) {
      return { folders, tags, presets, suggestion: fallback, aiError: err.message };
    }
  });
  ipcMain.handle('obsidian:write', (_e, id, data) => {
    const vault = config.get().obsidianVault;
    const note = notes.get(id);
    if (!note) throw new Error('Nota não encontrada');
    const rel = obsidian.writeNote(vault, data, note);
    notes.update(id, { obsidianPath: rel });
    return { path: rel, uri: obsidian.isVault(vault) ? obsidian.openUri(vault, rel) : null };
  });
  ipcMain.handle('obsidian:open', (_e, rel) => {
    const vault = config.get().obsidianVault;
    if (vault && rel) shell.openExternal(obsidian.openUri(vault, rel));
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

  ipcMain.handle('plugins:list', () => plugins.list());
  ipcMain.handle('plugins:enable', (_e, id) => plugins.enable(id));
  ipcMain.handle('plugins:disable', (_e, id) => plugins.disable(id));
  ipcMain.handle('plugins:reload', () => plugins.reload());
  ipcMain.handle('plugins:run-command', (_e, pluginId, commandId) => plugins.runCommand(pluginId, commandId));
  ipcMain.handle('plugins:open-folder', () => shell.openPath(plugins.dir));

  ipcMain.handle('store:catalog', () => store.fetchCatalog());
  ipcMain.handle('store:install', (_e, id) => store.install(id));
  ipcMain.handle('store:uninstall', (_e, id) => store.uninstall(id));
  ipcMain.handle('store:updates', () => store.checkUpdates());
  ipcMain.handle('store:update', (_e, id) => store.update(id));

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

  store.init({ baseDir: d.base, plugins, config });
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
    onPluginCommand: (pluginId, id) => plugins.runCommand(pluginId, id).catch(() => {}),
  });
  tray.setPluginCommands(plugins.commands());
  plugins.on('changed', () => {
    tray.setPluginCommands(plugins.commands());
    windows.send('plugins:changed');
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
    if (keys.includes('restrictedMode')) plugins.reload();
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
