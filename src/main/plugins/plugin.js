// Classe base dos plugins. Tudo que o plugin registra é rastreado e desfeito no _unload().
const fs = require('fs');
const path = require('path');
const { permissionGuard } = require('./api');

const EVENTS = ['dictation:state', 'dictation:text', 'note:created', 'settings:changed'];
// Eventos que carregam conteúdo do usuário exigem permissão.
const EVENT_PERMISSIONS = { 'dictation:text': 'text', 'note:created': 'notes:read' };

class Plugin {
  constructor(app, manifest, host) {
    this.app = app;
    this.manifest = manifest;
    this._host = host;
    this._cleanups = [];
    this._commands = new Map();
    this._processors = [];
    this._need = permissionGuard(manifest.id, manifest.permissions);
  }

  onload() {}
  onunload() {}

  // Comando exibido na aba Plugins e no menu da bandeja.
  addCommand({ id, name, run }) {
    if (!id || typeof run !== 'function') throw new Error('addCommand: id e run são obrigatórios');
    this._commands.set(id, { id, name: name || id, run });
    this._host.changed();
    this._cleanups.push(() => { this._commands.delete(id); this._host.changed(); });
  }

  // fn(text, {source, language}) → texto (sync ou async). Roda antes de inserir/salvar.
  addTextProcessor(fn) {
    this._need('text');
    this._processors.push(fn);
    this._cleanups.push(() => { this._processors = this._processors.filter((f) => f !== fn); });
  }

  registerEvent(name, fn) {
    if (!EVENTS.includes(name)) throw new Error(`evento desconhecido: ${name}`);
    if (EVENT_PERMISSIONS[name]) this._need(EVENT_PERMISSIONS[name]);
    const safe = (payload) => {
      try { const r = fn(payload); if (r && r.catch) r.catch((e) => this._host.fail(this, e)); } catch (e) { this._host.fail(this, e); }
    };
    this._host.bus.on(name, safe);
    this._cleanups.push(() => this._host.bus.off(name, safe));
  }

  registerInterval(fn, ms) {
    const h = setInterval(() => { try { fn(); } catch (e) { this._host.fail(this, e); } }, ms);
    this._cleanups.push(() => clearInterval(h));
    return h;
  }

  // Persistência isolada: plugin-data/<id>.json (sobrevive a atualizações do plugin).
  _dataFile() { return path.join(this._host.dataDir, `${this.manifest.id}.json`); }

  async loadData() {
    try { return JSON.parse(fs.readFileSync(this._dataFile(), 'utf8')); } catch { return null; }
  }

  async saveData(data) {
    fs.mkdirSync(this._host.dataDir, { recursive: true });
    fs.writeFileSync(this._dataFile(), JSON.stringify(data, null, 2), 'utf8');
  }

  // Aviso curto na janela principal.
  notify(message) { this._host.notify(this, String(message)); }

  _unload() {
    try { this.onunload(); } catch (e) { console.error(`[plugin ${this.manifest.id}]`, e); }
    for (const fn of this._cleanups.reverse()) { try { fn(); } catch {} }
    this._cleanups = [];
  }
}

module.exports = { Plugin, EVENTS };
