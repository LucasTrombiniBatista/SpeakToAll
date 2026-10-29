const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['settings:changed', 'engine:progress', 'engine:status', 'jobs:update', 'notes:changed', 'ai:chunk', 'dictation:state', 'plugins:changed', 'plugins:notice', 'update:status', 'update:notice', 'window:fullscreen', 'window:shown'];

contextBridge.exposeInMainWorld('wp', {
  isMock: false,
  i18n: () => ipcRenderer.invoke('i18n:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  detectHardware: () => ipcRenderer.invoke('engine:hardware'),
  installEngine: (opts) => ipcRenderer.invoke('engine:install', opts),
  cancelInstall: () => ipcRenderer.invoke('engine:cancel'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  updateNote: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  exportNote: (id, fmt) => ipcRenderer.invoke('notes:export', id, fmt),
  transcribeFile: (name, wav, durationMs) => ipcRenderer.invoke('transcribe:start', name, wav, durationMs),
  meetingDone: (wav, meta) => ipcRenderer.invoke('meeting:done', wav, meta),
  summarize: (id) => ipcRenderer.invoke('ai:summarize', id),
  chat: (id, messages) => ipcRenderer.invoke('ai:chat', id, messages),
  listModels: () => ipcRenderer.invoke('ai:models'),
  pickObsidianVault: () => ipcRenderer.invoke('obsidian:pick-vault'),
  obsidianStatus: () => ipcRenderer.invoke('obsidian:status'),
  obsidianSuggest: (id) => ipcRenderer.invoke('obsidian:suggest', id),
  obsidianWrite: (id, data) => ipcRenderer.invoke('obsidian:write', id, data),
  openInObsidian: (relPath) => ipcRenderer.invoke('obsidian:open', relPath),
  captureHotkey: () => ipcRenderer.invoke('hotkey:capture'),
  previewOverlay: (state) => ipcRenderer.invoke('overlay:preview', state),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  enablePlugin: (id) => ipcRenderer.invoke('plugins:enable', id),
  disablePlugin: (id) => ipcRenderer.invoke('plugins:disable', id),
  reloadPlugins: () => ipcRenderer.invoke('plugins:reload'),
  runPluginCommand: (pluginId, commandId) => ipcRenderer.invoke('plugins:run-command', pluginId, commandId),
  openPluginsFolder: () => ipcRenderer.invoke('plugins:open-folder'),
  storeCatalog: () => ipcRenderer.invoke('store:catalog'),
  installPlugin: (id) => ipcRenderer.invoke('store:install', id),
  uninstallPlugin: (id) => ipcRenderer.invoke('store:uninstall', id),
  checkPluginUpdates: () => ipcRenderer.invoke('store:updates'),
  updatePlugin: (id) => ipcRenderer.invoke('store:update', id),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  on: (event, cb) => {
    if (!EVENTS.includes(event)) throw new Error(`evento não permitido: ${event}`);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(event, fn);
    return () => ipcRenderer.removeListener(event, fn);
  },
});
