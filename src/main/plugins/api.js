// Objeto `app` entregue aos plugins: só o que eles podem usar. Mudanças aqui quebram plugins —
// adicione, não remova; e suba o minAppVersion dos plugins que dependerem do novo.
const SAFE_SETTINGS = ['uiLanguage', 'language', 'injectMode', 'theme', 'hotkey', 'hotkeyMode'];

function createApi({ appVersion, notes, config }) {
  return Object.freeze({
    version: appVersion,
    notes: Object.freeze({
      list: () => notes.list(),
      get: (id) => notes.get(id),
      create: (partial) => notes.create(partial),
      update: (id, patch) => notes.update(id, patch),
    }),
    getSettings() {
      const s = config.get();
      return Object.fromEntries(SAFE_SETTINGS.map((k) => [k, s[k]]));
    },
  });
}

module.exports = { createApi, SAFE_SETTINGS };
