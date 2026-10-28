// Auto-update via GitHub Releases (electron-updater). Só funciona no app instalado (app.isPackaged).
// Nada é baixado sem o usuário aceitar: autoDownload = false.
const { EventEmitter } = require('events');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { state: 'idle', version: null, percent: 0, error: null };
    this.au = null;
    this.ask = null;
    this.timer = null;
    this.manual = false;
  }

  // deps: { autoUpdater, enabled, ask(kind, info) → Promise<boolean> }; kind: available | downloaded | latest | error
  init({ autoUpdater, enabled, ask }) {
    this.ask = ask;
    if (!enabled) { this.set({ state: 'unsupported' }); return; }
    this.au = autoUpdater;
    this.au.autoDownload = false;
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
    if (this.manual) this.ask(kind, this.status());
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
    if (['checking', 'downloading', 'downloaded'].includes(this.state.state)) return this.status();
    this.manual = manual;
    try { await this.au.checkForUpdates(); } catch {} // o erro chega pelo evento 'error'
    return this.status();
  }

  async onAvailable(info) {
    this.set({ state: 'available', version: info?.version || null });
    this.manual = false;
    if (await this.ask('available', info)) this.download();
  }

  async download() {
    if (!this.au || this.state.state !== 'available') return this.status();
    this.set({ state: 'downloading', percent: 0 });
    try { await this.au.downloadUpdate(); } catch {}
    return this.status();
  }

  async onDownloaded(info) {
    this.set({ state: 'downloaded', percent: 100, version: info?.version || this.state.version });
    if (await this.ask('downloaded', info)) this.install();
  }

  install() {
    if (this.au && this.state.state === 'downloaded') this.au.quitAndInstall();
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = new Updater();
module.exports.Updater = Updater;
