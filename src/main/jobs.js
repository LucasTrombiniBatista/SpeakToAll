// Fila serial de transcrições (importação / reunião): um whisper por vez.
// Cria a nota logo no início e grava os segmentos nela a cada ~4 s.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const SAVE_EVERY_MS = 4000;

class Jobs extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.jobs = new Map();
    this.current = null;
  }

  init({ notes, transcribeFn, tmpDir }) {
    this.notes = notes;
    this.transcribeFn = transcribeFn;
    this.tmpDir = tmpDir;
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  _public(job) {
    const o = { id: job.id, name: job.name, status: job.status, progress: job.progress, segments: job.segments.slice() };
    if (job.error) o.error = job.error;
    return o;
  }

  _emit(job) { this.emit('update', this._public(job)); }

  list() { return [...this.jobs.values()].map((j) => this._public(j)); }

  enqueue({ name, wavBuffer, durationMs = 0, source = 'import', keepAudio = false, audioDir, language = null }) {
    const title = name || 'Transcrição';
    const note = this.notes.create({ title, text: '', segments: [], durationMs, language, source });
    const id = note.id;
    const keep = !!(keepAudio && audioDir);
    const dir = keep ? audioDir : this.tmpDir;
    fs.mkdirSync(dir, { recursive: true });
    const wavPath = path.join(dir, `${id}.wav`);
    fs.writeFileSync(wavPath, wavBuffer);
    const job = { id, name: title, status: 'queued', progress: 0, segments: [], wavPath, keepAudio: keep, handle: null, cancelled: false };
    this.jobs.set(id, job);
    this.queue.push(job);
    this._emit(job);
    setImmediate(() => this._next());
    return id;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'error') return false;
    job.cancelled = true;
    if (job.status === 'queued') {
      this.queue = this.queue.filter((j) => j !== job);
      this._finish(job, 'error', 'cancelled');
    } else if (job.handle) {
      try { job.handle.cancel(); } catch {}
    }
    return true;
  }

  _persist(job, final) {
    const text = job.segments.map((s) => String(s.text || '').trim()).filter(Boolean).join(' ');
    const patch = { segments: job.segments, text };
    if (final && job.keepAudio) patch.audioFile = job.wavPath;
    try { this.notes.update(job.id, patch); } catch {}
  }

  _finish(job, status, error) {
    job.status = status;
    if (status === 'done') job.progress = 100;
    if (error) job.error = error;
    if (!job.keepAudio) { try { fs.unlinkSync(job.wavPath); } catch {} }
    this._emit(job);
  }

  async _next() {
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    job.status = 'running';
    this._emit(job);
    let lastSave = Date.now();
    const onSegment = (seg) => {
      if (!seg) return;
      job.segments.push(seg);
      if (Date.now() - lastSave >= SAVE_EVERY_MS) { lastSave = Date.now(); this._persist(job, false); }
      this._emit(job);
    };
    const onProgress = (p) => {
      p = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
      if (p !== job.progress) { job.progress = p; this._emit(job); }
    };
    try {
      job.handle = this.transcribeFn(job.wavPath, onSegment, onProgress);
      const res = await job.handle.promise;
      if (job.cancelled) throw new Error('cancelled');
      if (res && Array.isArray(res.segments) && res.segments.length) job.segments = res.segments;
      this._persist(job, true);
      if (res && res.text && !job.segments.length) { try { this.notes.update(job.id, { text: res.text }); } catch {} }
      this._finish(job, 'done');
    } catch (e) {
      this._persist(job, true);
      this._finish(job, 'error', job.cancelled ? 'cancelled' : (e && e.message) || String(e));
    } finally {
      job.handle = null;
      this.current = null;
      setImmediate(() => this._next());
    }
  }
}

module.exports = new Jobs();
