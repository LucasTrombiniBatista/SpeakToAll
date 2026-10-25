// Gerenciador de plugins: descobre, valida, carrega e descarrega. Singleton EventEmitter.
// Cada plugin é uma pasta em userData/plugins/<id>/ com manifest.json + main.js (CommonJS).
// Um plugin quebrado nunca derruba o app: toda chamada a código de plugin passa por try/catch.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const { Plugin } = require('./plugin');
const { createApi } = require('./api');

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REQUIRED = ['id', 'name', 'version', 'minAppVersion', 'author', 'description'];

// Compara "1.2.3" com "1.10.0" numericamente (sem pre-release).
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Lança erro legível se o manifest não servir para esta versão do app.
function validateManifest(m, { expectedId, appVersion }) {
  if (!m || typeof m !== 'object') throw new Error('manifest.json inválido');
  for (const k of REQUIRED) if (typeof m[k] !== 'string' || !m[k].trim()) throw new Error(`manifest sem "${k}"`);
  if (!ID_RE.test(m.id)) throw new Error(`id inválido: ${m.id}`);
  if (expectedId && m.id !== expectedId) throw new Error(`id "${m.id}" não confere com "${expectedId}"`);
  if (cmpVersion(m.minAppVersion, appVersion) > 0) throw new Error(`requer SpeakToAll ${m.minAppVersion} ou mais novo`);
  if (m.permissions !== undefined && !Array.isArray(m.permissions)) throw new Error('"permissions" deve ser uma lista');
  return m;
}

class Plugins extends EventEmitter {
  constructor() {
    super();
    this.bus = new EventEmitter(); // eventos do app que os plugins assinam
    this.entries = new Map(); // id → { manifest, dir, instance, error }
    this.blocked = new Set();
  }

  init({ baseDir, appVersion, config, notes, onNotify }) {
    this.dir = path.join(baseDir, 'plugins');
    this.dataDir = path.join(baseDir, 'plugin-data');
    this.appVersion = appVersion;
    this.config = config;
    this.onNotify = onNotify;
    this.api = createApi({ appVersion, notes, config });
    fs.mkdirSync(this.dir, { recursive: true });
    this.scan();
    return this.loadEnabled();
  }

  get restricted() { return !!this.config.get().restrictedMode; }

  _enabledIds() { return this.config.get().enabledPlugins || []; }

  // Relê as pastas. Plugins carregados continuam como estão.
  scan() {
    const found = new Set();
    for (const name of fs.readdirSync(this.dir)) {
      const dir = path.join(this.dir, name);
      if (name.endsWith('.tmp') || !fs.statSync(dir).isDirectory()) continue;
      found.add(name);
      const prev = this.entries.get(name);
      let manifest = null;
      let error = null;
      try {
        manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), { expectedId: name, appVersion: this.appVersion });
      } catch (e) {
        error = e.message;
      }
      this.entries.set(name, { manifest, dir, instance: prev?.instance || null, error });
    }
    for (const id of [...this.entries.keys()]) if (!found.has(id)) { this._unload(id); this.entries.delete(id); }
    this.changed();
  }

  async loadEnabled() {
    if (this.restricted) return;
    for (const id of this._enabledIds()) await this._load(id);
  }

  async _load(id) {
    const e = this.entries.get(id);
    if (!e || e.instance || e.loading || !e.manifest) return false;
    if (this.blocked.has(id)) { e.error = 'bloqueado pelo catálogo'; this.changed(); return false; }
    let instance = null;
    e.loading = true;
    try {
      const file = require.resolve(path.join(e.dir, 'main.js'));
      delete require.cache[file];
      const exported = require(file);
      const Cls = exported.prototype instanceof Plugin ? exported : exported({ Plugin });
      if (!(Cls && Cls.prototype instanceof Plugin)) throw new Error('main.js precisa exportar uma classe que estende Plugin');
      instance = new Cls(this.api, e.manifest, this);
      await instance.onload();
      e.instance = instance;
      e.error = null;
    } catch (err) {
      console.error(`[plugin ${id}]`, err);
      if (instance) instance._unload();
      e.error = err.message;
    } finally {
      e.loading = false;
    }
    this.changed();
    return !!e.instance;
  }

  _unload(id) {
    const e = this.entries.get(id);
    if (!e?.instance) return;
    e.instance._unload();
    e.instance = null;
    this.changed();
  }

  async enable(id) {
    const ids = this._enabledIds();
    if (!ids.includes(id)) this.config.set({ enabledPlugins: [...ids, id] });
    if (!this.restricted) await this._load(id);
    return this.list();
  }

  disable(id) {
    this.config.set({ enabledPlugins: this._enabledIds().filter((x) => x !== id) });
    this._unload(id);
    return this.list();
  }

  // Descarrega tudo e carrega de novo (após instalar/atualizar ou trocar o modo restrito).
  async reload() {
    this.unloadAll();
    this.scan();
    await this.loadEnabled();
    return this.list();
  }

  unloadAll() { for (const id of this.entries.keys()) this._unload(id); }

  remove(id) {
    this.disable(id);
    this.entries.delete(id);
    this.changed();
  }

  setBlocked(ids = []) {
    this.blocked = new Set(ids);
    for (const id of this.blocked) if (this.entries.get(id)?.instance) { this._unload(id); this.entries.get(id).error = 'bloqueado pelo catálogo'; }
    this.changed();
  }

  // Erro em tempo de execução: registra e mostra, mas mantém o plugin carregado.
  fail(instance, err) {
    console.error(`[plugin ${instance.manifest.id}]`, err);
    const e = this.entries.get(instance.manifest.id);
    if (e) { e.error = err?.message || String(err); this.changed(); }
  }

  notify(instance, message) { this.onNotify?.({ pluginId: instance.manifest.id, name: instance.manifest.name, message }); }

  changed() { this.emit('changed'); }

  list() {
    const enabled = this._enabledIds();
    return [...this.entries.entries()].map(([id, e]) => ({
      id,
      manifest: e.manifest,
      enabled: enabled.includes(id),
      loaded: !!e.instance,
      error: e.error,
      commands: e.instance ? [...e.instance._commands.values()].map(({ id: cid, name }) => ({ id: cid, name })) : [],
    }));
  }

  commands() {
    const out = [];
    for (const [pluginId, e] of this.entries) {
      if (!e.instance) continue;
      for (const c of e.instance._commands.values()) out.push({ pluginId, id: c.id, name: c.name, pluginName: e.manifest.name });
    }
    return out;
  }

  async runCommand(pluginId, commandId) {
    const inst = this.entries.get(pluginId)?.instance;
    const cmd = inst?._commands.get(commandId);
    if (!cmd) throw new Error('comando não encontrado');
    try { await cmd.run(); } catch (err) { this.fail(inst, err); throw err; }
  }

  // Encadeia os processadores de texto na ordem de carregamento. Falha num plugin → texto segue intacto.
  async processText(text, ctx = {}) {
    let out = text;
    for (const e of this.entries.values()) {
      if (!e.instance) continue;
      for (const fn of e.instance._processors) {
        try {
          const r = await fn(out, { ...ctx });
          if (typeof r === 'string') out = r;
        } catch (err) {
          this.fail(e.instance, err);
        }
      }
    }
    return out;
  }

  dispatch(event, payload) { this.bus.emit(event, payload); }
}

module.exports = new Plugins();
module.exports.cmpVersion = cmpVersion;
module.exports.validateManifest = validateManifest;
