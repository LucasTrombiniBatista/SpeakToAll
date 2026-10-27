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
  startWithWindows: false, closeToTray: true, theme: 'system', onboarded: false,
  hotkeyCode: 67,
  hotkeyModifiers: { ctrl: false, alt: false, shift: false, meta: false },
  threads: Math.max(1, os.cpus().length - 2),
  chineseVariant: 'traditional',
  enabledPlugins: [], restrictedMode: false,
  pluginCatalogUrl: 'https://raw.githubusercontent.com/speaktoall/plugins/main/plugins.json',
};

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
