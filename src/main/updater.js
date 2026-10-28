// Auto-update via GitHub Releases (electron-updater). Só funciona no app instalado (app.isPackaged).
// Discreto: baixa em segundo plano, avisa dentro do app e instala em modo silencioso
// (sem o assistente do NSIS) ao reiniciar ou ao sair.
const { EventEmitter } = require('events');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { state: 'idle', version: null, percent: 0, error: null };
    this.au = null;
    this.notify = null;
    this.timer = null;
    this.manual = false;
  }

  // deps: { autoUpdater, enabled, notify(kind, info) }; kind: downloaded | latest | error
  init({ autoUpdater, enabled, notify }) {
    this.notify = notify;
    if (!enabled) { this.set({ state: 'unsupported' }); return; }
    this.au = autoUpdater;
    this.au.autoDownload = false; // o download é disparado por onAvailable, para controlar o estado
    this.au.autoInstallOnAppQuit = true;
    this.au.on('checking-for-update', () => this.set({ state: 'checking', error: null }));
    this.au.on('update-not-available', () => { this.set({ state: 'latest' }); this.notifyManual('latest'); });
    this.au.on('update-available', (info) => this.onAvailable(info));
    this.au.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    this.au.on('update-downloaded', (info) => this.onDownloaded(info));
    this.au.on('error', (err) => { this.set({ state: 'error', error: err?.message || String(err) }); this.notifyManual('error'); });
  }

  // Checagem pedida pelo usuário (bandeja/configurações) sempre dá retorno, mesmo sem update.
  notifyManual(kind) {
    if (this.manual) this.notify(kind, this.status());
    this.manual = false;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.status());
  }

  status() { return { ...this.state }; }

  // Checagem silenciosa no boot e periódica; desligável em config (autoCheckUpdates).
  schedule(on) {
    clearInterval(this.timer);
    this.timer = null;
    if (!on || !this.au) return;
    this.check(false);
    this.timer = setInterval(() => this.check(false), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  async check(manual = true) {
    if (!this.au) return this.status();
    if (['checking', 'downloading', 'downloaded'].includes(this.state.state)) {
      if (manual && this.state.state === 'downloaded') this.notify('downloaded', this.status());
      return this.status();
    }
    this.manual = manual;
    try { await this.au.checkForUpdates(); } catch {} // o erro chega pelo evento 'error'
    return this.status();
  }

  // Nova versão: baixa direto em segundo plano, sem perguntar.
  onAvailable(info) {
    this.set({ state: 'available', version: info?.version || null });
    this.manual = false;
    this.download();
  }

  async download() {
    if (!this.au || this.state.state !== 'available') return this.status();
    this.set({ state: 'downloading', percent: 0 });
    try { await this.au.downloadUpdate(); } catch {}
    return this.status();
  }

  onDownloaded(info) {
    this.set({ state: 'downloaded', percent: 100, version: info?.version || this.state.version });
    this.notify('downloaded', this.status());
  }

  // isSilent: NSIS sem janelas; isForceRunAfter: reabre o app depois de instalar.
  install() {
    if (this.au && this.state.state === 'downloaded') this.au.quitAndInstall(true, true);
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = new Updater();
module.exports.Updater = Updater;
