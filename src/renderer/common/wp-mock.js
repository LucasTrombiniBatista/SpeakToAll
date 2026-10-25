// Mock de window.wp para abrir os renderers direto no navegador, sem Electron.
// Só é instalado quando o preload não expôs a API real.
(function () {
  if (window.wp) return;

  const listeners = {};
  const emit = (ev, payload) => (listeners[ev] || []).forEach((cb) => cb(payload));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = Date.now();

  let settings = {
    uiLanguage: 'pt-BR', hotkey: 'F9', hotkeyMode: 'hold', tapToLock: true,
    language: 'pt', model: 'large-v3-turbo-q5_0', engineFlavor: 'cpu', micDevice: 'default',
    initialPrompt: 'Olá, tudo bem? Vamos começar.', injectMode: 'paste',
    sounds: true, saveDictationNotes: true, saveAudio: false,
    aiBaseUrl: 'http://localhost:11434/v1', aiModel: 'llama3.1',
    startWithWindows: false, closeToTray: true, theme: 'system', onboarded: true,
    enabledPlugins: ['maiuscula-inicial'], restrictedMode: false,
  };
  const plugins = [
    {
      id: 'maiuscula-inicial', enabled: true, loaded: true, error: null,
      manifest: { id: 'maiuscula-inicial', name: 'Maiúscula inicial', version: '1.0.0', minAppVersion: '0.1.0', author: 'SpeakToAll', description: 'Começa cada frase ditada com letra maiúscula e termina com ponto final.' },
      commands: [{ id: 'toggle-period', name: 'Ligar/desligar ponto final' }],
    },
    {
      id: 'quebrado', enabled: false, loaded: false, error: 'requer SpeakToAll 9.0.0 ou mais novo',
      manifest: null, commands: [],
    },
  ];
  const pluginList = () => plugins.map((p) => ({ ...p, loaded: p.enabled && !settings.restrictedMode && !!p.manifest }));
  let engine = { installed: true, ready: true, model: settings.model, flavor: 'cpu' };

  const notes = [
    {
      id: uid(), createdAt: now - 1000 * 60 * 12, title: 'Resposta para o cliente sobre o prazo',
      text: 'Oi, Marina. Conseguimos fechar a primeira entrega até sexta-feira, e a revisão final fica para a semana seguinte. Qualquer ajuste no escopo me avise ainda hoje.',
      segments: [], durationMs: 12480, language: 'pt', source: 'dictation', summary: null,
    },
    {
      id: uid(), createdAt: now - 1000 * 60 * 60 * 3, title: 'Daily — time de produto',
      text: 'Começamos pelo status do onboarding. A taxa de conclusão subiu para 64%. Próximo passo é simplificar a etapa de download do modelo. Ficou combinado testar o modelo turbo como padrão.',
      segments: [
        { t0: 0, t1: 6200, text: 'Começamos pelo status do onboarding.' },
        { t0: 6200, t1: 14100, text: 'A taxa de conclusão subiu para 64%.' },
        { t0: 14100, t1: 23800, text: 'Próximo passo é simplificar a etapa de download do modelo.' },
        { t0: 23800, t1: 31000, text: 'Ficou combinado testar o modelo turbo como padrão.' },
      ],
      durationMs: 31000, language: 'pt', source: 'meeting',
      summary: '• Onboarding: conclusão em 64%.\n• Simplificar download do modelo.\n• Testar large-v3-turbo como padrão.',
    },
    {
      id: uid(), createdAt: now - 1000 * 60 * 60 * 26, title: 'entrevista-podcast-ep12.mp3',
      text: 'Bem-vindos a mais um episódio. Hoje a conversa é sobre ferramentas que rodam totalmente offline e por que isso importa para privacidade.',
      segments: [
        { t0: 0, t1: 3500, text: 'Bem-vindos a mais um episódio.' },
        { t0: 3500, t1: 11800, text: 'Hoje a conversa é sobre ferramentas que rodam totalmente offline e por que isso importa para privacidade.' },
      ],
      durationMs: 11800, language: 'pt', source: 'import', summary: null,
    },
    {
      id: uid(), createdAt: now - 1000 * 60 * 60 * 50, title: 'Lembrete de compras',
      text: 'Comprar café, pilhas AA e marcar o técnico do ar-condicionado para quinta.',
      segments: [], durationMs: 5200, language: 'pt', source: 'dictation', summary: null,
    },
  ];

  window.wp = {
    isMock: true,
    async i18n() { return {}; },
    async getSettings() { return { ...settings }; },
    async setSettings(patch) {
      settings = { ...settings, ...patch };
      emit('settings:changed', settings);
      return { ...settings };
    },
    async engineStatus() { return { ...engine, model: settings.model, flavor: settings.engineFlavor }; },
    async detectHardware() {
      await wait(700);
      return { cpu: 'AMD Ryzen 7 5800X (16 threads)', ramGb: 32, gpu: 'NVIDIA GeForce RTX 3060 (12 GB)', recommendedFlavor: 'cuda', recommendedModel: 'large-v3-turbo-q5_0' };
    },
    async installEngine({ flavor, model }) {
      engine = { installed: false, ready: false };
      emit('engine:status', engine);
      const steps = [['engine', flavor === 'cuda' ? 439 : 16], ['model', 574]];
      for (const [stage, mb] of steps) {
        for (let p = 0; p <= 100; p += 4) {
          emit('engine:progress', { stage, percent: p, totalMb: mb });
          await wait(60);
        }
      }
      emit('engine:progress', { stage: 'starting', percent: 100 });
      await wait(600);
      engine = { installed: true, ready: true, model, flavor };
      emit('engine:status', engine);
      return engine;
    },
    async cancelInstall() {},
    async listNotes() { return notes.map(({ segments, ...n }) => n).sort((a, b) => b.createdAt - a.createdAt); },
    async getNote(id) { return notes.find((n) => n.id === id) || null; },
    async updateNote(id, patch) { Object.assign(notes.find((n) => n.id === id), patch); emit('notes:changed'); },
    async deleteNote(id) { notes.splice(notes.findIndex((n) => n.id === id), 1); emit('notes:changed'); },
    async exportNote(id, fmt) {
      const n = notes.find((x) => x.id === id);
      const body = fmt === 'md' ? `# ${n.title}\n\n${n.text}\n` : n.text;
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([body], { type: 'text/plain' })), download: `${n.title}.${fmt}`,
      });
      a.click();
    },
    async transcribeFile(name, wav, durationMs = 20000) {
      const job = { id: uid(), name, status: 'queued', progress: 0, segments: [] };
      emit('jobs:update', { ...job });
      const fake = ['Primeiro trecho reconhecido do áudio importado.', 'O texto aparece enquanto a transcrição avança.', 'Segmentos são salvos na nota a cada poucos segundos.', 'Transcrição concluída.'];
      (async () => {
        await wait(500);
        job.status = 'running';
        for (let i = 0; i < fake.length; i++) {
          for (let p = 0; p < 25; p += 5) { job.progress = i * 25 + p; emit('jobs:update', { ...job }); await wait(150); }
          const t0 = (durationMs / fake.length) * i;
          job.segments = [...job.segments, { t0, t1: t0 + durationMs / fake.length, text: fake[i] }];
          emit('jobs:update', { ...job });
        }
        job.status = 'done'; job.progress = 100;
        notes.push({ id: job.id, createdAt: Date.now(), title: name, text: fake.join(' '), segments: job.segments, durationMs, language: 'pt', source: 'import', summary: null });
        emit('jobs:update', { ...job });
        emit('notes:changed');
      })();
      return job.id;
    },
    async meetingDone(wav, meta) { return this.transcribeFile(meta.title, wav, meta.durationMs); },
    async summarize(id) {
      await wait(900);
      const n = notes.find((x) => x.id === id);
      n.summary = '• Ponto principal da nota resumido pela IA local.\n• Segundo ponto relevante.\n• Próximos passos sugeridos.';
      return { title: n.title, summary: n.summary };
    },
    async chat(_id, messages) {
      const reply = `Com base na nota: ${messages[messages.length - 1].content.length > 40 ? 'essa é uma boa pergunta.' : 'certo.'} O trecho mais relevante fala sobre os próximos passos combinados.`;
      for (const word of reply.split(/(?<= )/)) { emit('ai:chunk', { delta: word }); await wait(40); }
      emit('ai:chunk', { done: true });
    },
    async captureHotkey() { return new Promise((resolve) => {
      const onKey = (e) => {
        e.preventDefault();
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        window.removeEventListener('keydown', onKey, true);
        const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
        resolve([...mods, e.key.length === 1 ? e.key.toUpperCase() : e.key].join('+'));
      };
      window.addEventListener('keydown', onKey, true);
    }); },
    async previewOverlay(state) { window.open(`../overlay/overlay.html?preview=${state}`, 'overlay', 'width=360,height=110'); },
    async openExternal(url) { if (/^https?:\/\//.test(url)) window.open(url, '_blank'); },
    async listPlugins() { return pluginList(); },
    async enablePlugin(id) { plugins.find((p) => p.id === id).enabled = true; emit('plugins:changed'); return pluginList(); },
    async disablePlugin(id) { plugins.find((p) => p.id === id).enabled = false; emit('plugins:changed'); return pluginList(); },
    async reloadPlugins() { emit('plugins:changed'); return pluginList(); },
    async runPluginCommand() { emit('plugins:notice', { name: 'Maiúscula inicial', message: 'Ponto final desligado' }); },
    async openPluginsFolder() {},
    on(ev, cb) {
      (listeners[ev] ||= []).push(cb);
      return () => { listeners[ev] = listeners[ev].filter((f) => f !== cb); };
    },
  };
})();
