// Orquestra um ditado: gravar → transcrever → injetar → salvar (idle → recording → transcribing → idle).
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const MIN_MS = 350;

class Dictation extends EventEmitter {
  init({ engine, injector, notes, config, windows, hotkeys, plugins, audioDir }) {
    Object.assign(this, { engine, injector, notes, config, windows, hotkeys, plugins, audioDir });
    this.state = 'idle';
    this.startedAt = 0;
    hotkeys.on('start', () => this.start());
    hotkeys.on('stop', () => this.stop());
    hotkeys.on('lock', () => this.state === 'recording' && windows.overlayCommand({ type: 'lock' }));
    hotkeys.on('cancel', () => this.cancel());
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
    this.windows.send('dictation:state', { state });
  }

  start() {
    if (this.state !== 'idle') return;
    const st = this.engine.status();
    if (!st.installed || !st.ready) {
      this.windows.overlayCommand({ type: 'error', message: st.installed ? 'Motor iniciando…' : 'Configure o motor primeiro' });
      if (!st.installed) { this.windows.showMain(); this.windows.send('dictation:state', { state: 'needs-setup' }); }
      this.hotkeys.reset();
      return;
    }
    const s = this.config.get();
    this.startedAt = Date.now();
    this.setState('recording');
    this.windows.overlayCommand({ type: 'start', sounds: s.sounds, micDevice: s.micDevice });
  }

  stop() {
    if (this.state !== 'recording') return;
    this.setState('transcribing');
    this.windows.overlayCommand({ type: 'stop' });
  }

  cancel() {
    if (this.state === 'idle') return;
    this.windows.overlayCommand({ type: 'cancel' });
    this.finish();
  }

  finish() {
    this.setState('idle');
    this.hotkeys.reset();
  }

  async onAudio(wav) {
    if (this.state !== 'transcribing') return;
    const buf = Buffer.from(wav);
    const durationMs = Math.max(0, (buf.length - 44) / 32);
    if (durationMs < MIN_MS) { this.windows.hideOverlay(); return this.finish(); }

    const s = this.config.get();
    try {
      this.windows.overlayCommand({ type: 'transcribing' });
      const res = await this.engine.transcribe(buf, { language: s.language });
      const lang = res.language || s.language;
      const raw = this.engine.postProcess(this.engine.cleanTranscript(res.text || ''), lang, s.chineseVariant);
      const text = raw && (await this.plugins.processText(raw, { source: 'dictation', language: lang })).trim();
      if (!text) { this.windows.hideOverlay(); return this.finish(); }
      this.plugins.dispatch('dictation:text', { text, language: lang });

      await this.injector.inject(text, s.injectMode);
      this.windows.overlayCommand({ type: 'done' });

      if (s.saveDictationNotes) {
        let audioFile = null;
        if (s.saveAudio) {
          fs.mkdirSync(this.audioDir, { recursive: true });
          audioFile = path.join(this.audioDir, `${Date.now()}.wav`);
          fs.writeFileSync(audioFile, buf);
        }
        this.notes.create({ text, segments: res.segments || [], durationMs, language: lang, source: 'dictation', audioFile });
      }
    } catch (err) {
      console.error('[dictation]', err);
      this.windows.overlayCommand({ type: 'error', message: err.message.slice(0, 60) });
    } finally {
      this.finish();
    }
  }
}

module.exports = new Dictation();
