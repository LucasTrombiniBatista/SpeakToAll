// IA opcional via endpoint compatível com OpenAI (padrão: Ollama em localhost:11434/v1).
const SUMMARY_TIMEOUT_MS = 180000;
const CHAT_CONNECT_TIMEOUT_MS = 60000;
const CHAT_IDLE_TIMEOUT_MS = 120000;
const MAX_CONTEXT_CHARS = 60000;

const baseUrl = (s) => String((s && s.aiBaseUrl) || 'http://localhost:11434/v1').replace(/\/+$/, '');

// Extrai o primeiro objeto {...} balanceado de uma resposta (tolera ```json e texto extra).
function extractJson(str) {
  const s = String(str || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

function normalizeSummary(sum) {
  if (Array.isArray(sum)) sum = sum.join('\n');
  return String(sum || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.startsWith('• ') ? l : '• ' + l.replace(/^([-*•]|\d+[.)])\s*/, ''))).join('\n');
}

async function httpError(res) {
  let body = '';
  try { body = (await res.text()).slice(0, 300); } catch {}
  return new Error(`HTTP ${res.status}${body ? ': ' + body : ''}`);
}

async function summarize(note, { aiBaseUrl, aiModel } = {}) {
  const lang = note.language || 'o mesmo idioma do texto';
  const system = 'Você é um assistente que resume transcrições. Responda APENAS com JSON estrito, sem texto extra, no formato ' +
    '{"title": "...", "summary": "..."}. "title" é um título curto (até 8 palavras). "summary" tem de 3 a 5 linhas, ' +
    'separadas por \\n, cada uma começando com "• ". Escreva o título e o resumo no idioma da nota: ' + lang + '.';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl({ aiBaseUrl })}/chat/completions`, {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiModel, stream: false, temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: String(note.text || '').slice(0, MAX_CONTEXT_CHARS) },
        ],
      }),
    });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    const obj = extractJson(msg && msg.content);
    if (!obj) throw new Error('Resposta da IA não contém JSON válido');
    return { title: String(obj.title || note.title || '').trim(), summary: normalizeSummary(obj.summary) };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo esgotado aguardando a IA');
    throw e;
  } finally { clearTimeout(timer); }
}

async function chat(note, messages, settings = {}, onChunk = () => {}, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort); }
  let timer = setTimeout(() => ctrl.abort(), CHAT_CONNECT_TIMEOUT_MS);
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), CHAT_IDLE_TIMEOUT_MS); };
  const system = 'Você é um assistente que responde perguntas sobre a nota abaixo. Responda no idioma do usuário, ' +
    'de forma objetiva, usando a nota como contexto.\n\n' +
    `Título: ${note.title || ''}\n\nTexto:\n${String(note.text || '').slice(0, MAX_CONTEXT_CHARS)}`;
  try {
    const res = await fetch(`${baseUrl(settings)}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: settings.aiModel, stream: true,
        messages: [{ role: 'system', content: system }, ...(messages || []).map((m) => ({ role: m.role, content: m.content }))],
      }),
    });
    if (!res.ok) throw await httpError(res);
    const decoder = new TextDecoder();
    let buf = '';
    let finished = false;
    for await (const chunk of res.body) {
      bump();
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { finished = true; break; }
        try {
          const j = JSON.parse(payload);
          const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (delta) onChunk({ delta });
        } catch {}
      }
      if (finished) break;
    }
  } catch (e) {
    const msg = e.name === 'AbortError' ? (signal && signal.aborted ? 'cancelado' : 'Tempo esgotado aguardando a IA') : e.message;
    onChunk({ error: msg });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  onChunk({ done: true });
}

module.exports = { summarize, chat, extractJson };
