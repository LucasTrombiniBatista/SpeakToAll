// Loja: catálogo (JSON num repositório) + instalador a partir da última release do GitHub de cada plugin.
// A loja não hospeda código; o catálogo só aponta para o repositório do autor.
const fs = require('fs');
const path = require('path');

const { validateManifest, cmpVersion } = require('./index');

const GH_API = 'https://api.github.com';
const HEADERS = { 'User-Agent': 'SpeakToAll', Accept: 'application/vnd.github+json' };
const FILES = ['manifest.json', 'main.js'];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const TIMEOUT_MS = 20000;

const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

// Aceita tanto [entradas] quanto {plugins: [entradas], blocked: [ids]}.
function normalize(data) {
  const raw = Array.isArray(data) ? data : (data && Array.isArray(data.plugins) ? data.plugins : []);
  const plugins = raw
    .filter((p) => p && ID_RE.test(p.id) && REPO_RE.test(p.repo) && typeof p.name === 'string')
    .map((p) => ({
      id: p.id, repo: p.repo, name: str(p.name, 80), author: str(p.author, 80),
      description: str(p.description), category: str(p.category, 40),
      permissions: Array.isArray(p.permissions) ? p.permissions.map((x) => str(x, 40)).filter(Boolean) : [],
    }));
  const blocked = Array.isArray(data?.blocked) ? data.blocked.filter((x) => typeof x === 'string') : [];
  return { plugins, blocked };
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

async function getBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

class Store {
  init({ baseDir, plugins, config }) {
    this.cacheFile = path.join(baseDir, 'plugins-catalog.json');
    this.plugins = plugins;
    this.config = config;
    this.catalog = null;
    // Kill switch sem rede na inicialização: aplica o blocked do último catálogo baixado.
    try { plugins.setBlocked(normalize(JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))).blocked); } catch {}
  }

  // Baixa o catálogo; sem rede, usa o último salvo. Aplica o kill switch (blocked).
  async fetchCatalog() {
    let data = null;
    let offline = false;
    try {
      data = await getJson(this.config.get().pluginCatalogUrl);
      fs.writeFileSync(this.cacheFile, JSON.stringify(data), 'utf8');
    } catch (err) {
      console.warn('[store]', err.message);
      offline = true;
      try { data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch {}
    }
    this.catalog = normalize(data);
    this.plugins.setBlocked(this.catalog.blocked);
    return { plugins: this.catalog.plugins, offline };
  }

  async _catalog() { return this.catalog || (await this.fetchCatalog(), this.catalog); }

  async _entry(id) {
    const entry = (await this._catalog()).plugins.find((p) => p.id === id);
    if (!entry) throw new Error(`plugin "${id}" não está no catálogo`);
    return entry;
  }

  async _release(repo) {
    const rel = await getJson(`${GH_API}/repos/${repo}/releases/latest`, HEADERS);
    const asset = (name) => (rel.assets || []).find((a) => a.name === name);
    return { rel, asset };
  }

  async _remoteManifest(repo) {
    const { asset } = await this._release(repo);
    const a = asset('manifest.json');
    if (!a) throw new Error('release sem manifest.json');
    return JSON.parse((await getBuffer(a.browser_download_url)).toString('utf8'));
  }

  // Baixa para <id>.tmp, valida e só então substitui a pasta. Não ativa o plugin.
  async install(id) {
    const entry = await this._entry(id);
    const { asset } = await this._release(entry.repo);
    const files = {};
    for (const name of FILES) {
      const a = asset(name);
      if (!a) throw new Error(`release sem o arquivo obrigatório ${name}`);
      files[name] = await getBuffer(a.browser_download_url);
    }
    const manifest = validateManifest(JSON.parse(files['manifest.json'].toString('utf8')), { expectedId: id, appVersion: this.plugins.appVersion });

    const final = path.join(this.plugins.dir, id);
    const tmp = `${final}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(tmp, name), buf);

    this.plugins._unload(id);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
    await this.plugins.reload();
    return manifest;
  }

  update(id) { return this.install(id); }

  async uninstall(id) {
    if (!ID_RE.test(id)) throw new Error('id inválido');
    this.plugins.disable(id);
    fs.rmSync(path.join(this.plugins.dir, id), { recursive: true, force: true });
    this.plugins.scan();
    return this.plugins.list();
  }

  // Plugins instalados com versão mais nova na última release.
  async checkUpdates() {
    const catalog = await this._catalog();
    const out = [];
    for (const p of this.plugins.list()) {
      const entry = p.manifest && catalog.plugins.find((c) => c.id === p.id);
      if (!entry) continue;
      try {
        const remote = await this._remoteManifest(entry.repo);
        if (cmpVersion(remote.version, p.manifest.version) <= 0) continue;
        out.push({
          id: p.id, name: p.manifest.name, current: p.manifest.version, latest: str(remote.version, 20),
          minAppVersion: str(remote.minAppVersion, 20),
          compatible: cmpVersion(remote.minAppVersion, this.plugins.appVersion) <= 0,
        });
      } catch (err) {
        console.warn(`[store] ${p.id}:`, err.message);
      }
    }
    return out;
  }
}

module.exports = new Store();
module.exports.normalize = normalize;
