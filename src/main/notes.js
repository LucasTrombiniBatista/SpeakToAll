// Notas: um <id>.json por nota, sem banco de dados. Singleton EventEmitter.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const UNTITLED = 'Nota sem título';

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function defaultTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return UNTITLED;
  if (s.length <= 60) return s;
  const cut = s.slice(0, 60).replace(/\s+\S*$/, '');
  return (cut || s.slice(0, 60)) + '…';
}

function srtTime(ms) {
  ms = Math.max(0, Math.round(ms || 0));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

function safeName(s) {
  return String(s || 'nota').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').trim().slice(0, 80) || 'nota';
}

class Notes extends EventEmitter {
  constructor() { super(); this.dir = null; this.audioDir = null; }

  init(dir, audioDir) {
    this.dir = dir;
    this.audioDir = audioDir || null;
    fs.mkdirSync(dir, { recursive: true });
  }

  _file(id) {
    if (!/^[\w-]+$/.test(String(id))) throw new Error('invalid note id');
    return path.join(this.dir, `${id}.json`);
  }

  _save(note) { writeAtomic(this._file(note.id), JSON.stringify(note, null, 2)); }

  create(partial = {}) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const note = {
      id, createdAt: Date.now(), title: '', text: '', segments: [], durationMs: 0,
      language: null, source: 'dictation', audioFile: null, summary: null,
      ...partial,
    };
    note.id = id;
    if (!note.title) note.title = defaultTitle(note.text);
    this._save(note);
    this.emit('changed', { type: 'create', id });
    return note;
  }

  get(id) {
    try { return JSON.parse(fs.readFileSync(this._file(id), 'utf8')); } catch { return null; }
  }

  // Sem segments (pode ser grande); ordenado do mais recente para o mais antigo.
  list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const { segments, ...n } = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        out.push(n);
      } catch {}
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  update(id, patch = {}) {
    const note = this.get(id);
    if (!note) return null;
    const { id: _ignored, ...rest } = patch;
    Object.assign(note, rest);
    this._save(note);
    this.emit('changed', { type: 'update', id });
    return note;
  }

  delete(id) {
    const note = this.get(id);
    try { fs.unlinkSync(this._file(id)); } catch {}
    if (note && note.audioFile && this.audioDir) {
      const rel = path.relative(path.resolve(this.audioDir), path.resolve(note.audioFile));
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) { try { fs.unlinkSync(note.audioFile); } catch {} }
    }
    this.emit('changed', { type: 'delete', id });
    return !!note;
  }

  export(id, fmt = 'txt') {
    const n = this.get(id);
    if (!n) throw new Error('note not found');
    const base = safeName(n.title);
    if (fmt === 'md') {
      let content = `# ${n.title}\n\n`;
      if (n.summary) content += `## Resumo\n\n${n.summary}\n\n`;
      content += `${n.text || ''}\n`;
      return { filename: `${base}.md`, content };
    }
    if (fmt === 'srt') {
      let segs = (n.segments || []).filter((s) => s && String(s.text || '').trim());
      if (!segs.length) segs = [{ t0: 0, t1: n.durationMs || 0, text: n.text || '' }];
      const content = segs.map((s, i) =>
        `${i + 1}\n${srtTime(s.t0)} --> ${srtTime(s.t1)}\n${String(s.text).trim()}\n`).join('\n');
      return { filename: `${base}.srt`, content };
    }
    return { filename: `${base}.txt`, content: n.text || '' };
  }
}

module.exports = new Notes();
module.exports.srtTime = srtTime;
