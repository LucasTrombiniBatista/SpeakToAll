const api = window.wp;
const { fmtClock, fileToWav, createRecorder } = window.staAudio;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SOURCE_LABEL = { dictation: 'DITADO', import: 'IMPORTADA', meeting: 'REUNIÃO' };
let settings = {};
let dict = {};

/* ---------- utilidades ---------- */
function t(key, vars = {}, fallback = '') {
  let s = dict[key] ?? fallback;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function applyI18n() {
  $$('[data-i18n]').forEach((el) => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
  $$('[data-i18n-placeholder]').forEach((el) => { if (dict[el.dataset.i18nPlaceholder]) el.placeholder = dict[el.dataset.i18nPlaceholder]; });
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function dayGroup(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = (today - d) / 86400000;
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

function drawBars(canvas, levels, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const bw = 4, gap = 3, n = Math.floor(w / (bw + gap));
  const slice = levels.slice(-n);
  ctx.fillStyle = color;
  slice.forEach((lv, i) => {
    const bh = Math.max(4, Math.min(h, lv * h * 6));
    ctx.beginPath();
    ctx.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 2);
    ctx.fill();
  });
}

/* ---------- navegação ---------- */
function showView(name) {
  $$('.nav button').forEach((b) => (b.dataset.view === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
  try { localStorage.setItem('sta:view', name); } catch {}
}
$$('.nav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- tema e status do motor ---------- */
function applyTheme() {
  if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = settings.theme;
}

function renderEngine(st) {
  const pill = $('#engine-status .pill');
  pill.classList.toggle('ok', !!st.ready);
  $('#engine-label').textContent = st.ready ? (st.model || '').replace(/-q5_0$/, '') : st.installed ? 'iniciando…' : 'sem motor';
  $('#set-engine-info').textContent = st.ready ? `whisper.cpp · ${st.flavor} · ${st.model}` : 'não instalado';
}
$('#engine-status').addEventListener('click', () => showView('settings'));

function renderHotkey() {
  $$('.hk, #hint-hotkey, #set-hotkey-label').forEach((el) => (el.textContent = settings.hotkey));
}

/* ---------- notas ---------- */
let notes = [];
let currentId = null;
let filter = 'all';

async function loadNotes() {
  notes = await api.listNotes();
  $('#notes-count').textContent = notes.length || '';
  renderList();
  if (currentId && !notes.some((n) => n.id === currentId)) openNote(null);
}

function renderList() {
  const q = $('#notes-search').value.trim().toLowerCase();
  const items = notes.filter((n) =>
    (filter === 'all' || n.source === filter) &&
    (!q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)));
  const ul = $('#notes-ul');
  ul.replaceChildren();
  if (!items.length) {
    ul.innerHTML = `<li class="list-empty">${q ? 'Nada encontrado.' : 'Nenhuma nota ainda.'}</li>`;
    return;
  }
  let lastGroup = '';
  for (const n of items) {
    const g = dayGroup(n.createdAt);
    if (g !== lastGroup) {
      const h = document.createElement('li');
      h.className = 'list-group eyebrow'; h.textContent = g;
      ul.append(h); lastGroup = g;
    }
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.setAttribute('aria-selected', n.id === currentId);
    b.innerHTML = `<span class="t"></span><span class="d mono">${fmtDate(n.createdAt)}</span><span class="p"></span>
      <span class="src"><span class="mono muted">${SOURCE_LABEL[n.source]} · ${fmtClock(n.durationMs)}</span></span>`;
    $('.t', b).textContent = n.title;
    $('.p', b).textContent = n.text;
    b.addEventListener('click', () => openNote(n.id));
    li.append(b); ul.append(li);
  }
}

$('#notes-search').addEventListener('input', renderList);
$$('#notes-filter button').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.source;
  $$('#notes-filter button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  renderList();
}));

async function openNote(id) {
  currentId = id;
  renderList();
  $('#ai-panel').hidden = true;
  if (!id) { $('#note').hidden = true; $('#note-empty').hidden = false; return; }
  const n = await api.getNote(id);
  $('#note-empty').hidden = true;
  $('#note').hidden = false;
  $('#note-source').textContent = SOURCE_LABEL[n.source];
  $('#note-date').textContent = new Date(n.createdAt).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
  $('#note-duration').textContent = fmtClock(n.durationMs, true);
  $('#note-title').value = n.title;
  $('#note-text').value = n.text;
  renderSummary(n.summary);
  renderObsidianSent(n.obsidianPath);
  const segs = n.segments || [];
  $('#note-tabs').hidden = !segs.length;
  $('#note-segments').replaceChildren(...segs.map((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="mono">${fmtClock(s.t0, true)}</span><span></span>`;
    li.lastChild.textContent = s.text;
    return li;
  }));
  setNoteTab('text');
}

function renderSummary(summary) {
  $('#note-summary').hidden = !summary;
  $('#note-summary-text').textContent = summary || '';
}

function setNoteTab(tab) {
  $$('#note-tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === tab));
  $('#note-text').hidden = tab !== 'text';
  $('#note-segments').hidden = tab !== 'segments';
}
$$('#note-tabs button').forEach((b) => b.addEventListener('click', () => setNoteTab(b.dataset.tab)));

let saveTimer;
function scheduleSave(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await api.updateNote(currentId, patch);
    const n = notes.find((x) => x.id === currentId);
    if (n) Object.assign(n, patch);
    renderList();
  }, 400);
}
$('#note-title').addEventListener('input', (e) => scheduleSave({ title: e.target.value }));
$('#note-text').addEventListener('input', (e) => scheduleSave({ text: e.target.value }));

$('#note-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#note-text').value);
  toast('Copiado');
});
$('#note-export-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#note-export-menu').hidden ^= 1; });
document.addEventListener('click', () => ($('#note-export-menu').hidden = true));
$$('#note-export-menu button').forEach((b) => b.addEventListener('click', async () => {
  await api.exportNote(currentId, b.dataset.fmt);
  toast(`Exportado como .${b.dataset.fmt}`);
}));
$('#note-delete').addEventListener('click', async () => {
  if (!confirm('Excluir esta nota?')) return;
  await api.deleteNote(currentId);
  currentId = null;
  await loadNotes();
  openNote(null);
});

/* ---------- IA ---------- */
let chatHistory = [];
let aiBubble = null;

$('#note-ai').addEventListener('click', () => {
  const p = $('#ai-panel');
  p.hidden = !p.hidden;
  $('#ai-model').textContent = settings.aiModel;
  if (!p.hidden) { chatHistory = []; $('#ai-messages').replaceChildren(); $('#ai-input').focus(); }
});
$('#ai-close').addEventListener('click', () => ($('#ai-panel').hidden = true));
$('#ai-summarize').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = 'Resumindo…';
  try {
    const { title, summary } = await api.summarize(currentId);
    $('#note-title').value = title;
    renderSummary(summary);
    await loadNotes();
  } catch (err) {
    toast(`IA indisponível: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Gerar resumo e título';
  }
});

function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`; el.textContent = text;
  $('#ai-messages').append(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}
$('#ai-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#ai-input').value.trim();
  if (!q || aiBubble) return;
  $('#ai-input').value = '';
  addMsg('user', q);
  chatHistory.push({ role: 'user', content: q });
  aiBubble = addMsg('ai', '…');
  aiBubble.dataset.empty = '1';
  api.chat(currentId, chatHistory);
});
api.on('ai:chunk', ({ delta, done }) => {
  if (!aiBubble) return;
  if (delta) {
    if (aiBubble.dataset.empty) { aiBubble.textContent = ''; delete aiBubble.dataset.empty; }
    aiBubble.textContent += delta;
    aiBubble.scrollIntoView({ block: 'end' });
  }
  if (done) { chatHistory.push({ role: 'assistant', content: aiBubble.textContent }); aiBubble = null; }
});

/* ---------- jobs (importar / reunião) ---------- */
const jobEls = new Map();

function renderJob(job, container) {
  let el = jobEls.get(job.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'job card';
    el.innerHTML = `<div class="job-top"><strong></strong><span class="pill"></span><span class="mono muted pct"></span></div>
      <div class="progress"><i></i></div><div class="job-segs"></div>`;
    $('strong', el).textContent = job.name;
    (container || $('#jobs')).prepend(el);
    jobEls.set(job.id, el);
  }
  const pill = $('.pill', el);
  pill.className = `pill ${job.status === 'done' ? 'ok' : job.status === 'running' ? 'cobalt' : ''}`;
  pill.innerHTML = `<span class="dot"></span>${{ queued: 'NA FILA', running: 'TRANSCREVENDO', done: 'CONCLUÍDO', error: 'ERRO' }[job.status]}`;
  $('.pct', el).textContent = `${Math.round(job.progress)}%`;
  $('.progress i', el).style.width = `${job.progress}%`;
  const segs = $('.job-segs', el);
  segs.replaceChildren(...job.segments.map((s) => {
    const d = document.createElement('div');
    d.innerHTML = `<span class="mono">${fmtClock(s.t0)}</span><span></span>`;
    d.lastChild.textContent = s.text;
    return d;
  }));
  segs.scrollTop = segs.scrollHeight;
  if (job.status === 'done' && !el.dataset.linked) {
    el.dataset.linked = '1';
    const open = document.createElement('button');
    open.className = 'btn btn-sm'; open.textContent = 'Abrir nota';
    open.addEventListener('click', () => { showView('notes'); openNote(job.id); });
    $('.job-top', el).append(open);
  }
}
api.on('jobs:update', (job) => renderJob(job));

async function importFiles(files) {
  for (const f of files) {
    try {
      const { wav, durationMs } = await fileToWav(f);
      const id = await api.transcribeFile(f.name, wav, durationMs);
      if (id && !jobEls.has(id)) renderJob({ id, name: f.name, status: 'queued', progress: 0, segments: [] });
    } catch (err) {
      toast(`Não foi possível ler ${f.name}`);
    }
  }
}
const dz = $('#dropzone');
$('#file-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); importFiles([...e.dataTransfer.files]); });

/* ---------- reunião ---------- */
const MEETING_LIMIT_MS = 4 * 3600 * 1000;
let meeting = null;

function setMeetingUi(live) {
  $('#meeting').classList.toggle('live', live);
  $('#nav-rec').hidden = !live;
  const st = $('#meeting-state');
  st.className = `pill ${live ? 'onair' : ''}`;
  st.lastChild.textContent = live ? 'ON AIR' : 'PRONTO';
  const btn = $('#meeting-btn');
  btn.className = `btn btn-lg ${live ? 'btn-onair' : 'btn-ink'}`;
  btn.textContent = live ? 'Parar e transcrever' : 'Iniciar gravação';
  $('#meeting-mic').disabled = live;
}

async function startMeeting() {
  const streams = [];
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    display.getVideoTracks().forEach((tr) => tr.stop());
    if (display.getAudioTracks().length) streams.push(new MediaStream(display.getAudioTracks()));
  } catch {}
  if ($('#meeting-mic').checked) {
    try { streams.push(await navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.micDevice } })); } catch {}
  }
  if (!streams.length) return toast('Nenhuma fonte de áudio disponível');

  const levels = [];
  const rec = await createRecorder(streams, (lv) => levels.push(lv));
  const t0 = performance.now();
  meeting = { rec, timer: null };
  setMeetingUi(true);
  const tick = () => {
    const el = performance.now() - t0;
    $('#meeting-clock').textContent = fmtClock(el).padStart(8, '00:');
    drawBars($('#meeting-wave'), levels, '#FF3B30');
    if (el >= MEETING_LIMIT_MS) return stopMeeting();
    meeting.timer = requestAnimationFrame(tick);
  };
  tick();
}

async function stopMeeting() {
  if (!meeting) return;
  cancelAnimationFrame(meeting.timer);
  const { wav, durationMs } = await meeting.rec.stop();
  meeting = null;
  setMeetingUi(false);
  const title = $('#meeting-title').value.trim() || `Reunião ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  const id = await api.meetingDone(wav, { title, durationMs });
  if (id) renderJob({ id, name: title, status: 'queued', progress: 0, segments: [] }, $('#meeting-jobs'));
  $('#meeting-clock').textContent = '00:00:00';
}
$('#meeting-btn').addEventListener('click', () => (meeting ? stopMeeting() : startMeeting()));

/* ---------- enviar ao Obsidian ---------- */
let obsTags = [];

function renderObsidianSent(relPath) {
  const b = $('#note-obsidian');
  b.classList.toggle('sent', !!relPath);
  b.title = relPath ? `Já enviada: ${relPath}` : 'Enviar ao Obsidian';
}

function renderObsTags() {
  $('#obs-tags').replaceChildren(...obsTags.map((tag) => {
    const chip = el('span', 'chip', `#${tag}`);
    const x = el('button', null, '×');
    x.type = 'button';
    x.setAttribute('aria-label', `Remover ${tag}`);
    x.onclick = () => { obsTags = obsTags.filter((t) => t !== tag); renderObsTags(); };
    chip.append(x);
    return chip;
  }));
}

function addObsTag(raw) {
  const tag = String(raw).trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();
  if (tag && !obsTags.includes(tag)) { obsTags.push(tag); renderObsTags(); }
}

const fillDatalist = (sel, values) => $(sel).replaceChildren(...values.map((v) => new Option(v)));

async function openObsidian() {
  if (!settings.obsidianVault) {
    toast('Escolha a pasta do Obsidian em Configurações');
    showView('settings');
    return;
  }
  const btn = $('#note-obsidian');
  btn.disabled = true; btn.textContent = 'Organizando…';
  try {
    const { folders, tags, presets, suggestion, aiError } = await api.obsidianSuggest(currentId);
    fillDatalist('#obs-folders', [...new Set([...presets, ...folders])]);
    fillDatalist('#obs-known-tags', tags);
    $('#obs-title').value = suggestion.title;
    $('#obs-folder').value = suggestion.folder;
    $('#obs-body').value = suggestion.body;
    obsTags = [];
    suggestion.tags.forEach(addObsTag);
    renderObsTags();
    $('#obs-status').textContent = aiError ? `IA indisponível (${aiError}). Preencha à mão.` : '';
    $('#obsidian').hidden = false;
    $('#obs-title').focus();
  } catch (err) {
    toast(errMsg(err));
  } finally {
    btn.disabled = false; btn.textContent = 'Obsidian';
  }
}

$('#note-obsidian').addEventListener('click', openObsidian);
$('#obs-cancel').addEventListener('click', () => ($('#obsidian').hidden = true));
$('#obs-tag-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  addObsTag(e.target.value);
  e.target.value = '';
});
$('#obs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  addObsTag($('#obs-tag-input').value);
  $('#obs-tag-input').value = '';
  const save = $('#obs-save');
  save.disabled = true;
  try {
    const { path } = await api.obsidianWrite(currentId, {
      title: $('#obs-title').value, folder: $('#obs-folder').value, tags: obsTags, body: $('#obs-body').value,
    });
    $('#obsidian').hidden = true;
    renderObsidianSent(path);
    toast(`Salvo em ${path}`);
  } catch (err) {
    toast(`Falha ao salvar: ${errMsg(err)}`);
  } finally {
    save.disabled = false;
  }
});

/* ---------- configurações ---------- */
function bindSettings() {
  $$('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    if (el.classList.contains('seg')) {
      $$('button', el).forEach((b) => {
        b.setAttribute('aria-pressed', settings[key] === b.dataset.value);
        b.onclick = () => saveSetting(key, b.dataset.value);
      });
    } else if (el.type === 'checkbox') {
      el.checked = !!settings[key];
      el.onchange = () => saveSetting(key, el.checked);
    } else {
      el.value = settings[key] ?? '';
      el.onchange = () => saveSetting(key, el.value);
    }
  });
  const preset = $('#set-ai-preset');
  preset.value = [...preset.options].some((o) => o.value === settings.aiBaseUrl) ? settings.aiBaseUrl : '';
  $('#set-obsidian-vault').textContent = settings.obsidianVault || 'Nenhuma pasta escolhida';
  $('#set-obsidian-clear').hidden = !settings.obsidianVault;
  renderObsidianStatus();
}

async function renderObsidianStatus() {
  const warn = $('#set-obsidian-warn');
  if (!settings.obsidianVault) { warn.hidden = true; return; }
  const { exists, isVault } = await api.obsidianStatus();
  warn.textContent = exists ? 'Esta pasta não é um vault do Obsidian. Os arquivos .md serão salvos normalmente.' : 'Esta pasta não existe mais. Escolha outra.';
  warn.hidden = exists && isVault;
}

async function saveSetting(key, value) {
  settings = await api.setSettings({ [key]: value });
  bindSettings();
  applyTheme();
  renderHotkey();
  if (key === 'uiLanguage') { dict = await api.i18n(); applyI18n(); }
  if (key === 'restrictedMode') renderPlugins();
  if (['model', 'engineFlavor', 'language', 'initialPrompt'].includes(key)) toast('Motor será reiniciado');
}

async function loadMics() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
    const sel = $('#set-mic');
    for (const d of devs) sel.add(new Option(d.label || `Microfone ${sel.length}`, d.deviceId));
    sel.value = settings.micDevice || 'default';
  } catch {}
}

$('#set-hotkey').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.add('capturing');
  $('#set-hotkey-label').textContent = '…';
  btn.lastChild.textContent = 'Pressione a tecla';
  const key = await api.captureHotkey();
  btn.classList.remove('capturing');
  btn.lastChild.textContent = 'Alterar';
  if (key) await saveSetting('hotkey', key);
  else renderHotkey();
});
$$('[data-preview]').forEach((b) => b.addEventListener('click', () => api.previewOverlay(b.dataset.preview)));
$('#set-reinstall').addEventListener('click', () => openOnboarding(1));
$('#set-onboarding').addEventListener('click', () => openOnboarding(0));

/* ---------- atualizações do app ---------- */
let updateState = { state: 'idle' };
function renderUpdate(st) {
  updateState = st;
  const v = st.version ? ` ${st.version}` : '';
  const text = {
    unsupported: 'Atualização automática só no app instalado',
    idle: 'Ainda não verificado',
    checking: 'Verificando…',
    latest: 'Você está na versão mais recente',
    available: `Versão${v} disponível`,
    downloading: `Baixando${v}… ${st.percent || 0}%`,
    downloaded: `Versão${v} pronta para instalar`,
    error: `Erro: ${st.error || 'falha ao verificar'}`,
  }[st.state];
  const action = { available: 'Atualizar', downloaded: 'Reiniciar e instalar' }[st.state] || 'Verificar agora';
  $('#update-status').textContent = text || '';
  $('#update-action').textContent = action;
  $('#update-action').disabled = ['unsupported', 'checking', 'downloading'].includes(st.state);
}
$('#update-action').addEventListener('click', () => {
  if (updateState.state === 'available') return api.downloadUpdate();
  if (updateState.state === 'downloaded') return api.installUpdate();
  return api.checkUpdates();
});
// Avisos do updater: nada de diálogo nativo; um banner discreto no rodapé.
function showUpdateNotice(n) {
  if (n.kind === 'latest') return toast('Você está na versão mais recente');
  if (n.kind === 'error') return toast('Não foi possível verificar atualizações');
  if (n.kind !== 'downloaded') return;
  $('#update-banner-text').textContent = `Versão${n.version ? ' ' + n.version : ''} pronta. Instala em segundos, sem assistente.`;
  $('#update-banner').hidden = false;
}
$('#update-banner-restart').addEventListener('click', () => api.installUpdate());
$('#update-banner-later').addEventListener('click', () => ($('#update-banner').hidden = true));
$('#set-ai-preset').addEventListener('change', (e) => { if (e.target.value) saveSetting('aiBaseUrl', e.target.value); });
$('#set-ai-models').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const models = await api.listModels();
    fillDatalist('#ai-models', models);
    toast(models.length ? `${models.length} modelos encontrados` : 'Nenhum modelo encontrado');
    $('[data-setting="aiModel"]').focus();
  } catch (err) {
    toast(`IA indisponível: ${errMsg(err)}`);
  } finally {
    btn.disabled = false;
  }
});
$('#set-obsidian-pick').addEventListener('click', async () => {
  try {
    if (await api.pickObsidianVault()) { settings = await api.getSettings(); bindSettings(); toast('Pasta conectada'); }
  } catch (err) { toast(errMsg(err)); }
});
$('#set-obsidian-clear').addEventListener('click', () => saveSetting('obsidianVault', ''));

/* ---------- plugins ---------- */
// Erros do ipcMain chegam como "Error invoking remote method 'x': Error: msg".
const errMsg = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

// Texto vindo de manifests e do catálogo é de terceiros: sempre textContent, nunca innerHTML.
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function pluginCard({ name, meta, description, error }) {
  const li = el('li', 'plugin card');
  const main = el('div', 'plugin-main');
  const head = el('div', 'plugin-head');
  head.append(el('strong', '', name), el('span', 'mono muted', meta));
  main.append(head);
  if (description) main.append(el('p', 'muted', description));
  if (error) main.append(el('p', 'plugin-error', error));
  const actions = el('div', 'plugin-actions');
  li.append(main, actions);
  return { li, main, actions };
}

function setPluginTab(tab) {
  $$('#plugins-tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === tab));
  $$('[data-ptab]').forEach((p) => (p.hidden = p.dataset.ptab !== tab));
}
$$('#plugins-tabs button').forEach((b) => b.addEventListener('click', () => setPluginTab(b.dataset.tab)));

async function renderInstalled() {
  const list = await api.listPlugins();
  const ul = $('#plugins-installed');
  ul.replaceChildren();
  if (!list.length) {
    ul.append(el('li', 'list-empty', 'Nenhum plugin instalado. Use a loja ou copie uma pasta para a pasta de plugins.'));
    return;
  }
  for (const p of list) {
    const m = p.manifest || {};
    let error = p.error;
    if (!error && p.enabled && !p.loaded && settings.restrictedMode) error = 'Não carregado: modo restrito ligado.';
    const { li, main, actions } = pluginCard({
      name: m.name || p.id,
      meta: m.version ? `v${m.version} · ${m.author}` : p.id,
      description: m.description,
      error,
    });
    if (p.commands.length) {
      const cmds = el('div', 'row-tight');
      for (const c of p.commands) {
        const b = el('button', 'btn btn-sm', c.name);
        b.addEventListener('click', () => api.runPluginCommand(p.id, c.id).catch((err) => toast(errMsg(err))));
        cmds.append(b);
      }
      main.append(cmds);
    }
    const toggle = el('span', 'toggle');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = p.enabled;
    input.disabled = !p.manifest;
    input.setAttribute('aria-label', `Ativar ${m.name || p.id}`);
    input.addEventListener('change', () => (input.checked ? api.enablePlugin(p.id) : api.disablePlugin(p.id)));
    toggle.append(input, el('span'));
    const remove = el('button', 'btn btn-sm btn-ghost btn-danger', 'Desinstalar');
    remove.addEventListener('click', async () => {
      if (!confirm(`Desinstalar ${m.name || p.id}? A pasta do plugin será apagada.`)) return;
      await api.uninstallPlugin(p.id);
      renderStore();
    });
    actions.append(remove, toggle);
    ul.append(li);
  }
}

let catalog = null; // { plugins, offline }

async function loadCatalog() {
  $('#store-status').textContent = 'Carregando catálogo…';
  try {
    catalog = await api.storeCatalog();
    const sel = $('#store-category');
    const cats = [...new Set(catalog.plugins.map((p) => p.category).filter(Boolean))].sort();
    sel.replaceChildren(new Option('Todas as categorias', ''), ...cats.map((c) => new Option(c, c)));
  } catch (err) {
    catalog = { plugins: [], offline: true };
  }
  renderStore();
}

async function renderStore() {
  if (!catalog) return;
  const installed = new Set((await api.listPlugins()).map((p) => p.id));
  const q = $('#store-search').value.trim().toLowerCase();
  const cat = $('#store-category').value;
  const items = catalog.plugins.filter((p) =>
    (!cat || p.category === cat) &&
    (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)));
  $('#store-status').textContent = catalog.offline ? 'Sem conexão: mostrando o último catálogo salvo.' : '';
  const ul = $('#store-list');
  ul.replaceChildren();
  if (!items.length) {
    ul.append(el('li', 'list-empty', catalog.plugins.length ? 'Nada encontrado.' : 'Catálogo vazio ou indisponível.'));
    return;
  }
  for (const p of items) {
    const { li, main, actions } = pluginCard({ name: p.name, meta: [p.author, p.category].filter(Boolean).join(' · '), description: p.description });
    if (p.permissions.length) main.append(el('p', 'mono muted', `Permissões: ${p.permissions.join(', ')}`));
    const repo = el('button', 'btn btn-sm btn-ghost', 'Repositório ↗');
    repo.addEventListener('click', () => api.openExternal(`https://github.com/${p.repo}`));
    const install = el('button', `btn btn-sm ${installed.has(p.id) ? '' : 'btn-primary'}`, installed.has(p.id) ? 'Instalado' : 'Instalar');
    install.disabled = installed.has(p.id);
    install.addEventListener('click', () => installFromStore(p, install));
    actions.append(repo, install);
    ul.append(li);
  }
}

async function installFromStore(p, btn) {
  const perms = p.permissions.length ? p.permissions.join(', ') : 'nenhuma declarada';
  if (!confirm(`Instalar "${p.name}" de ${p.repo}?\n\nPermissões: ${perms}\n\nPlugins rodam com o mesmo acesso do aplicativo. Só instale se confiar no autor.`)) return;
  btn.disabled = true; btn.textContent = 'Instalando…';
  try {
    await api.installPlugin(p.id);
    toast(`${p.name} instalado. Ative na aba Instalados.`);
  } catch (err) {
    toast(`Falha ao instalar: ${errMsg(err)}`);
  }
  renderStore();
}

$('#store-search').addEventListener('input', renderStore);
$('#store-category').addEventListener('change', renderStore);

async function checkUpdates() {
  const btn = $('#updates-check');
  btn.disabled = true; btn.textContent = 'Procurando…';
  const ul = $('#updates-list');
  try {
    const ups = await api.checkPluginUpdates();
    $('#updates-count').textContent = ups.length || '';
    ul.replaceChildren();
    if (!ups.length) ul.append(el('li', 'list-empty', 'Tudo atualizado.'));
    for (const u of ups) {
      const { li, actions } = pluginCard({
        name: u.name, meta: `v${u.current} → v${u.latest}`,
        error: u.compatible ? null : `Requer SpeakToAll ${u.minAppVersion} ou mais novo.`,
      });
      const b = el('button', 'btn btn-sm btn-primary', 'Atualizar');
      b.disabled = !u.compatible;
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Atualizando…';
        try { await api.updatePlugin(u.id); toast(`${u.name} atualizado`); checkUpdates(); } catch (err) { toast(`Falha: ${errMsg(err)}`); b.disabled = false; b.textContent = 'Atualizar'; }
      });
      actions.append(b);
      ul.append(li);
    }
  } catch (err) {
    toast(`Não foi possível procurar: ${errMsg(err)}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Procurar atualizações';
  }
}
$('#updates-check').addEventListener('click', checkUpdates);

// Catálogo só é baixado quando a aba Loja é aberta (o app funciona offline por padrão).
$$('#plugins-tabs button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab === 'store' && !catalog) loadCatalog(); }));

function renderPlugins() { renderInstalled(); renderStore(); }

$('#plugins-folder').addEventListener('click', () => api.openPluginsFolder());
$('#plugins-reload').addEventListener('click', async () => { await api.reloadPlugins(); toast('Plugins recarregados'); });

/* ---------- onboarding ---------- */
const OB_LAST = 4;
let obStep = 0;
let obFlavor = 'cpu';
let obMic = null;

function openOnboarding(step = 0) { $('#onboarding').hidden = false; goStep(step); }

function goStep(n) {
  obStep = n;
  $$('.ob-step').forEach((s) => (s.hidden = +s.dataset.step !== n));
  $('#ob-steps').innerHTML = Array.from({ length: OB_LAST + 1 }, (_, i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('');
  $('#ob-back').style.visibility = n > 0 && n !== 2 ? 'visible' : 'hidden';
  $('#ob-next').textContent = n === 0 ? 'Começar' : n === OB_LAST ? 'Concluir' : n === 1 ? 'Baixar' : 'Continuar';
  $('#ob-next').disabled = false;
  if (n === 1) detectHw();
  if (n === 2) runInstall();
  if (n !== 3) stopMicTest();
}

async function detectHw() {
  const hw = await api.detectHardware();
  $('#ob-hw').innerHTML = '';
  for (const [k, v] of [['CPU', hw.cpu], ['Memória', `${hw.ramGb} GB`], ['GPU', hw.gpu || 'nenhuma NVIDIA']]) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    $('#ob-hw').append(dt, dd);
  }
  obFlavor = hw.recommendedFlavor;
  $$('#ob-flavor button').forEach((b) => {
    $('.rec', b)?.remove();
    if (b.dataset.value === hw.recommendedFlavor) b.insertAdjacentHTML('beforeend', '<span class="rec">RECOMENDADO</span>');
    b.setAttribute('aria-pressed', b.dataset.value === obFlavor);
  });
}
$$('#ob-flavor button').forEach((b) => b.addEventListener('click', () => {
  obFlavor = b.dataset.value;
  $$('#ob-flavor button').forEach((x) => x.setAttribute('aria-pressed', x === b));
}));

async function runInstall() {
  $('#ob-next').disabled = true;
  $('#ob-model').textContent = settings.model;
  ['engine', 'model'].forEach((s) => { $(`#ob-p-${s}`).style.width = '0'; $(`#ob-t-${s}`).textContent = '0%'; });
  const off = api.on('engine:progress', ({ stage, percent, totalMb }) => {
    if (stage === 'starting') { $('#ob-dl-status').textContent = 'Carregando modelo na memória…'; return; }
    $(`#ob-p-${stage}`).style.width = `${percent}%`;
    $(`#ob-t-${stage}`).textContent = `${percent}%`;
    $('#ob-dl-status').textContent = `${stage === 'engine' ? 'whisper.cpp' : settings.model} · ${Math.round((totalMb * percent) / 100)} / ${totalMb} MB`;
  });
  try {
    await saveSetting('engineFlavor', obFlavor);
    await api.installEngine({ flavor: obFlavor, model: settings.model });
    $('#ob-dl-status').textContent = 'Pronto.';
    $('#ob-next').disabled = false;
  } catch (err) {
    $('#ob-dl-status').textContent = `Erro: ${err.message}`;
    $('#ob-back').style.visibility = 'visible';
  } finally {
    off();
  }
}

async function startMicTest() {
  const levels = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = await createRecorder([stream], (lv) => levels.push(lv));
  const loop = () => { drawBars($('#ob-mic'), levels, getComputedStyle(document.body).getPropertyValue('--sta-cobalt')); obMic.raf = requestAnimationFrame(loop); };
  obMic = { rec, raf: 0 };
  loop();
}
function stopMicTest() {
  if (!obMic) return;
  cancelAnimationFrame(obMic.raf);
  obMic.rec.stop();
  obMic = null;
}
$('#ob-mic-btn').addEventListener('click', async () => {
  try { await startMicTest(); $('#ob-mic-btn').hidden = true; } catch { toast('Permissão de microfone negada'); }
});

$('#ob-back').addEventListener('click', () => goStep(Math.max(0, obStep - (obStep === 3 ? 2 : 1))));
$('#ob-next').addEventListener('click', async () => {
  if (obStep < OB_LAST) return goStep(obStep + 1);
  await saveSetting('onboarded', true);
  $('#onboarding').hidden = true;
});

/* ---------- inicialização ---------- */
(async function init() {
  [settings, dict] = await Promise.all([api.getSettings(), api.i18n()]);
  applyI18n();
  applyTheme();
  renderHotkey();
  bindSettings();
  loadMics();
  renderEngine(await api.engineStatus());
  api.on('engine:status', renderEngine);
  api.on('settings:changed', (s) => { settings = s; });
  api.on('plugins:changed', renderPlugins);
  api.on('plugins:notice', ({ name, message }) => toast(`${name}: ${message}`));
  renderPlugins();
  renderUpdate(await api.updateStatus());
  api.on('update:status', renderUpdate);
  api.on('update:notice', showUpdateNotice);
  api.on('notes:changed', loadNotes);
  api.on('dictation:state', ({ state }) => { if (state === 'needs-setup') openOnboarding(0); });
  await loadNotes();

  let view = 'notes';
  try { view = localStorage.getItem('sta:view') || view; } catch {}
  showView(view);
  if (notes[0]) openNote(notes[0].id);

  const st = await api.engineStatus();
  if (!settings.onboarded || !st.installed) openOnboarding(0);
})();
