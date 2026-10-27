// Integração com o Obsidian: um vault é só uma pasta de arquivos .md, então basta ler e gravar no disco.
const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 3;
const MAX_FILES_SCANNED = 2000;
const HEAD_BYTES = 4096;
const IGNORED = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

function isVault(dir) {
  try { return fs.statSync(path.join(dir, '.obsidian')).isDirectory(); } catch { return false; }
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|#^[\]\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Nota';
}

// Caminho relativo seguro: sem "..", sem raiz absoluta, cada parte limpa.
function safeFolder(folder) {
  return String(folder || '').replace(/\\/g, '/').split('/')
    .map((p) => p.trim()).filter((p) => p && p !== '.' && p !== '..').map(safeName).join('/');
}

function readHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf8', 0, n);
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Tags do frontmatter YAML (lista inline [a, b], lista em bloco "- a" ou string "a, b").
function frontmatterTags(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const kv = /^tags?\s*:\s*(.*)$/i.exec(lines[i]);
    if (!kv) continue;
    const v = kv[1].trim();
    if (v) out.push(...v.replace(/^\[|\]$/g, '').split(','));
    else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) out.push(lines[j].replace(/^\s*-\s+/, ''));
  }
  return out.map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean);
}

// Lista pastas (até MAX_DEPTH níveis) e tags já usadas, para a IA reaproveitar.
function scanVault(vault) {
  if (!vault || !isVault(vault)) throw new Error('A pasta escolhida não é um vault do Obsidian (falta .obsidian/)');
  const folders = [];
  const tags = new Map();
  let files = 0;
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || IGNORED.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) { folders.push(r); walk(path.join(dir, e.name), r, depth + 1); }
      } else if (e.name.endsWith('.md') && files < MAX_FILES_SCANNED) {
        files++;
        for (const t of frontmatterTags(readHead(path.join(dir, e.name)))) tags.set(t, (tags.get(t) || 0) + 1);
      }
    }
  };
  walk(vault, '', 0);
  return {
    folders: folders.sort((a, b) => a.localeCompare(b)),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
  };
}

const yamlStr = (s) => JSON.stringify(String(s));

function buildMarkdown({ title, tags = [], body = '' }, note = {}) {
  const fm = ['---'];
  // Tags do Obsidian não aceitam espaços nem "#".
  tags = [...new Set(tags.map((t) => String(t).trim().replace(/^#+/, '').replace(/\s+/g, '-')).filter(Boolean))];
  if (tags.length) { fm.push('tags:'); for (const t of tags) fm.push(`  - ${yamlStr(t)}`); }
  fm.push(`created: ${new Date(note.createdAt || Date.now()).toISOString()}`);
  fm.push('source: speaktoall');
  if (note.source) fm.push(`origin: ${note.source}`);
  if (note.durationMs) fm.push(`duration: ${Math.round(note.durationMs / 1000)}`);
  if (note.language) fm.push(`language: ${note.language}`);
  fm.push('---', '');
  let md = fm.join('\n') + `# ${title}\n\n`;
  if (note.summary) md += `> [!summary] Resumo\n${note.summary.split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
  return md + `${String(body).trim()}\n`;
}

// Grava <vault>/<folder>/<title>.md sem nunca sobrescrever (acrescenta " 2", " 3"…).
// Devolve o caminho relativo ao vault.
function writeNote(vault, { title, folder, tags, body }, note = {}) {
  if (!vault || !isVault(vault)) throw new Error('Vault do Obsidian não configurado ou inválido');
  const relDir = safeFolder(folder);
  const dir = path.join(vault, relDir);
  const rootAbs = path.resolve(vault);
  if (path.resolve(dir) !== rootAbs && !path.resolve(dir).startsWith(rootAbs + path.sep)) throw new Error('Pasta fora do vault');
  fs.mkdirSync(dir, { recursive: true });
  const base = safeName(title);
  let name = `${base}.md`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base} ${i}.md`;
  const content = buildMarkdown({ title: title || base, tags, body }, note);
  fs.writeFileSync(path.join(dir, name), content, { encoding: 'utf8', flag: 'wx' });
  return relDir ? `${relDir}/${name}` : name;
}

function openUri(vault, relPath) {
  return `obsidian://open?vault=${encodeURIComponent(path.basename(vault))}&file=${encodeURIComponent(relPath.replace(/\.md$/, ''))}`;
}

module.exports = { isVault, scanVault, writeNote, buildMarkdown, frontmatterTags, safeFolder, openUri };
