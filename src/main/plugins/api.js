// Objeto `app` entregue aos plugins: só o que eles podem usar. Mudanças aqui quebram plugins —
// adicione, não remova; e suba o minAppVersion dos plugins que dependerem do novo.
const SAFE_SETTINGS = ['uiLanguage', 'language', 'injectMode', 'theme', 'hotkey', 'hotkeyMode'];

// Permissões que um plugin pode declarar no manifest. Sem declarar, a API recusa.
const PERMISSIONS = ['text', 'notes:read', 'notes:write', 'network'];
// "notes" (formato antigo) vale leitura + escrita.
const ALIASES = { notes: ['notes:read', 'notes:write'] };

function expandPermissions(list = []) {
  return [...new Set(list.flatMap((p) => ALIASES[p] || [p]))];
}

function permissionGuard(pluginId, permissions) {
  const granted = new Set(expandPermissions(permissions));
  return (perm) => {
    if (!granted.has(perm)) throw new Error(`plugin ${pluginId} não declarou a permissão "${perm}"`);
  };
}

function createApi({ appVersion, notes, config, pluginId = '?', permissions = [] }) {
  const need = permissionGuard(pluginId, permissions);
  return Object.freeze({
    version: appVersion,
    permissions: Object.freeze(expandPermissions(permissions)),
    notes: Object.freeze({
      list: () => { need('notes:read'); return notes.list(); },
      get: (id) => { need('notes:read'); return notes.get(id); },
      create: (partial) => { need('notes:write'); return notes.create(partial); },
      update: (id, patch) => { need('notes:write'); return notes.update(id, patch); },
    }),
    getSettings() {
      const s = config.get();
      return Object.fromEntries(SAFE_SETTINGS.map((k) => [k, s[k]]));
    },
  });
}

module.exports = { createApi, SAFE_SETTINGS, PERMISSIONS, expandPermissions, permissionGuard };
