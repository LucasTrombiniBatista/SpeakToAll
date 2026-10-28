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
  threads: 0, // 0 = automático (núcleos físicos, ver engine.threadsFor)
  transcriptionQuality: 'fast',
  chineseVariant: 'traditional',
  enabledPlugins: [], restrictedMode: false,
  pluginCatalogUrl: 'https://raw.githubusercontent.com/speaktoall/plugins/main/plugins.json',
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Chaves que o renderer pode alterar, cada uma com seu validador (menor privilégio: o resto
// — pluginCatalogUrl, enabledPlugins, hotkeyCode… — só o processo main escreve).
const isStr = (max) => (v) => typeof v === 'string' && v.length <= max;
const isBool = (v) => typeof v === 'boolean';
const oneOf = (...vals) => (v) => vals.includes(v);
const isHttpUrl = (v) => isStr(500)(v) && /^https?:\/\/[^\s]+$/i.test(v);
const RENDERER_KEYS = {
  uiLanguage: isStr(10), language: isStr(10), model: isStr(60), micDevice: isStr(300),
  hotkey: isStr(40), hotkeyMode: oneOf('hold', 'toggle'), tapToLock: isBool,
  engineFlavor: oneOf('cpu', 'cuda'), transcriptionQuality: oneOf('fast', 'accurate'),
  initialPrompt: isStr(2000), injectMode: oneOf('paste', 'type'),
  sounds: isBool, saveDictationNotes: isBool, saveAudio: isBool,
  aiBaseUrl: isHttpUrl, aiModel: isStr(200), aiApiKey: isStr(500),
  // A pasta do vault só é escolhida pelo diálogo nativo (main); o renderer pode apenas limpá-la.
  obsidianVault: oneOf(''), obsidianFolder: isStr(200), obsidianCategories: isStr(2000), obsidianAutoDetect: isBool,
  startWithWindows: isBool, closeToTray: isBool, theme: oneOf('system', 'light', 'dark'),
  onboarded: isBool, restrictedMode: isBool,
};

// Filtra um patch vindo do renderer. Devolve só as chaves permitidas e válidas.
function sanitizePatch(patch) {
  const clean = {};
  const rejected = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { clean, rejected };
  for (const [k, v] of Object.entries(patch)) {
    if (Object.hasOwn(RENDERER_KEYS, k) && RENDERER_KEYS[k](v)) clean[k] = v;
    else rejected.push(k);
  }
  return { clean, rejected };
}

// Segredos nunca vão para o disco em texto puro nem para o renderer.
const SECRETS = ['aiApiKey'];

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

  // cipher: { encrypt(str) → Buffer, decrypt(Buffer) → str } (safeStorage do Electron).
  // Sem cipher (testes, Node puro), segredos ficam só em memória.
  init(userDataDir, cipher = null) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.file = path.join(userDataDir, 'settings.json');
    this.cipher = cipher;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch {}
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    const secrets = {};
    for (const k of SECRETS) {
      const enc = saved[`${k}Enc`];
      if (enc && cipher) { try { secrets[k] = cipher.decrypt(Buffer.from(enc, 'base64')); } catch {} }
      else if (typeof saved[k] === 'string') secrets[k] = saved[k]; // migração do texto puro
      delete saved[`${k}Enc`];
    }
    this.settings = { ...clone(DEFAULTS), ...saved, ...secrets };
    if (cipher && SECRETS.some((k) => typeof saved[k] === 'string' && saved[k])) this._save(); // regrava cifrado
    return this.get();
  }

  // Uso interno do processo main (inclui segredos).
  get() { return clone(this.settings); }

  // O que o renderer pode ver: segredos viram só "<chave>Set: true/false".
  getPublic() {
    const s = this.get();
    for (const k of SECRETS) { s[`${k}Set`] = !!s[k]; s[k] = ''; }
    return s;
  }

  // Patch vindo do renderer: só chaves permitidas e válidas.
  setFromRenderer(patch) {
    const { clean, rejected } = sanitizePatch(patch);
    if (rejected.length) console.warn('[config] chaves recusadas do renderer:', rejected.join(', '));
    this.set(clean);
    return this.getPublic();
  }

  _save() {
    if (!this.file) return;
    const out = { ...this.settings };
    // Sem safeStorage disponível o segredo fica em texto puro (como antes), para não perder a chave.
    if (this.cipher) {
      for (const k of SECRETS) {
        if (out[k]) out[`${k}Enc`] = this.cipher.encrypt(out[k]).toString('base64');
        delete out[k];
      }
    }
    writeAtomic(this.file, JSON.stringify(out, null, 2));
  }

  // Faz merge, salva atomicamente e emite 'changed' só com as chaves que mudaram de fato.
  set(patch = {}) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(this.settings[k]) !== JSON.stringify(v)) changed.push(k);
    }
    this.settings = { ...this.settings, ...clone(patch) };
    this._save();
    if (changed.length) this.emit('changed', this.get(), changed);
    return this.get();
  }
}

module.exports = new Config();
module.exports.Config = Config;
module.exports.DEFAULTS = DEFAULTS;
module.exports.sanitizePatch = sanitizePatch;
module.exports.RENDERER_KEYS = RENDERER_KEYS;
