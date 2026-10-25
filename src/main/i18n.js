// Traduções do processo main (tray, notificações). Lê src/common/locales/<lang>.json.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'common', 'locales');
let dict = {};
let current = 'en';

function read(lang) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8')); } catch { return null; }
}

function load(lang) {
  dict = read(lang) || read('en') || {};
  current = lang;
  return dict;
}

function t(key, vars) {
  let s = dict[key] != null ? String(dict[key]) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

module.exports = { load, t, get dict() { return dict; }, get lang() { return current; } };
