// Configurações persistidas em settings.json (userData). Singleton EventEmitter.
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  uiLanguage: 'pt-BR', hotkey: 'F9', hotkeyMode: 'hold', tapToLock: true,
  language: 'pt', model: 'large-v3-turbo-q5_0', engineFlavor: 'cpu', micDevice: 'default',
  initialPrompt: 'Olá, tudo bem? Vamos começar.', injectMode: 'paste',
  sounds: true, saveDictationNotes: true, saveAudio: false,
  aiBaseUrl: 'http://localhost:11434/v1', aiModel: 'llama3.1', aiApiKey: '',
  obsidianVault: '', obsidianFolder: 'SpeakToAll', obsidianCategories: '', obsidianAutoDetect: true,
  startWithWindows: true, closeToTray: true, autoCheckUpdates: true, theme: 'system', onboarded: false,
  windowMode: 'windowed', // windowed | maximized | fullscreen
  hotkeyKeys: [67], // 1 a 3 keycodes do uIOhook (F9)
  hotkeyCode: 67, // formato antigo, só lido na migração
  hotkeyModifiers: { ctrl: false, alt: false, shift: false, meta: false },
  threads: 0, // 0 = automático (núcleos físicos, ver engine.threadsFor)
  transcriptionQuality: 'fast',
  chineseVariant: 'traditional',
  enabledPlugins: [], restrictedMode: false,
  pluginCatalogUrl: 'https://raw.githubusercontent.com/LucasTrombiniBatista/SpeakToAll/main/plugins.json',
};

// A organização do catálogo antigo nunca existiu; settings.json guarda a URL, então é preciso migrar.
const OLD_CATALOG_URL = 'https://raw.githubusercontent.com/speaktoall/plugins/main/plugins.json';

const clone = (o) => JSON.parse(JSON.stringify(o));

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

class Config extends EventEmitter {
  constructor() {
    super();
    this.DEFAULTS = DEFAULTS;
    this.file = null;
    this.settings = clone(DEFAULTS);
  }

  init(userDataDir) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.file = path.join(userDataDir, 'settings.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch {}
    this.settings = { ...clone(DEFAULTS), ...saved };
    // Até a 0.1.8 o padrão era desligado e ficava gravado no settings.json; liga uma vez para quem
    // já tinha o app. Quem desligar depois disso continua desligado.
    if (!this.settings.autostartMigrated) {
      this.settings.startWithWindows = true;
      this.settings.autostartMigrated = true;
      if (Object.keys(saved).length) try { writeAtomic(this.file, JSON.stringify(this.settings, null, 2)); } catch {}
    }
    // Formato antigo (uma tecla + modificadores) → lista de teclas.
    if (!Array.isArray(saved.hotkeyKeys) && Number.isInteger(saved.hotkeyCode)) {
      const m = saved.hotkeyModifiers || {};
      const own = { 29: 'ctrl', 3613: 'ctrl', 56: 'alt', 3640: 'alt', 42: 'shift', 54: 'shift', 3675: 'meta', 3676: 'meta' }[saved.hotkeyCode];
      const keys = [['ctrl', 29], ['alt', 56], ['shift', 42], ['meta', 3675]].filter(([k]) => m[k] && own !== k).map(([, c]) => c);
      this.settings.hotkeyKeys = [...keys, saved.hotkeyCode];
    }
    if (this.settings.pluginCatalogUrl === OLD_CATALOG_URL) this.settings.pluginCatalogUrl = DEFAULTS.pluginCatalogUrl;
    return this.get();
  }

  get() { return clone(this.settings); }

  // Faz merge, salva atomicamente e emite 'changed' só com as chaves que mudaram de fato.
  set(patch = {}) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(this.settings[k]) !== JSON.stringify(v)) changed.push(k);
    }
    this.settings = { ...this.settings, ...clone(patch) };
    if (this.file) writeAtomic(this.file, JSON.stringify(this.settings, null, 2));
    if (changed.length) this.emit('changed', this.get(), changed);
    return this.get();
  }
}

module.exports = new Config();
module.exports.DEFAULTS = DEFAULTS;
