// Utilitários de áudio compartilhados pelo overlay e pela janela principal.
// Formato esperado pelo motor (faster-whisper): WAV PCM 16-bit mono 16 kHz.
(function () {
  const SAMPLE_RATE = 16000;

  function encodeWav(samples, sampleRate = SAMPLE_RATE) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  function concat(chunks) {
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function rms(block) {
    let s = 0;
    for (let i = 0; i < block.length; i++) s += block[i] * block[i];
    return Math.sqrt(s / block.length);
  }

  // Decodifica qualquer arquivo de áudio e reamostra para 16 kHz mono.
  async function fileToWav(file) {
    const data = await file.arrayBuffer();
    const decoded = await new AudioContext().decodeAudioData(data);
    const len = Math.ceil(decoded.duration * SAMPLE_RATE);
    const ctx = new OfflineAudioContext(1, len, SAMPLE_RATE);
    const src = ctx.createBufferSource();
    src.buffer = decoded; src.connect(ctx.destination); src.start();
    const rendered = await ctx.startRendering();
    return { wav: encodeWav(rendered.getChannelData(0)), durationMs: decoded.duration * 1000 };
  }

  // Remove os pedaços silenciosos das pontas, com folga de ~250 ms. Só silêncio → vazio.
  const SILENCE_RMS = 0.006;
  const TRIM_PAD = 2;
  function trimSilence(chunks) {
    const first = chunks.findIndex((c) => rms(c) > SILENCE_RMS);
    if (first < 0) return [];
    let last = chunks.length - 1;
    while (rms(chunks[last]) <= SILENCE_RMS) last--;
    return chunks.slice(Math.max(0, first - TRIM_PAD), last + TRIM_PAD + 1);
  }

  const withWorklet = new WeakSet();

  // Grava de uma ou mais fontes num único worklet (Web Audio soma as entradas).
  // Com `shared`, reaproveita um AudioContext que já existe e não o fecha no fim.
  async function createRecorder(streams, onLevel, shared = null) {
    const ctx = shared || new AudioContext({ sampleRate: SAMPLE_RATE });
    if (!withWorklet.has(ctx)) {
      await ctx.audioWorklet.addModule('../common/pcm-worklet.js');
      withWorklet.add(ctx);
    }
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    const chunks = [];
    let flushed = null;
    node.port.onmessage = (e) => {
      if (e.data.flushed) return flushed?.();
      chunks.push(e.data);
      onLevel && onLevel(rms(e.data));
    };
    const sources = streams.map((s) => ctx.createMediaStreamSource(s));
    sources.forEach((src) => src.connect(node));
    return {
      async stop({ trim = false } = {}) {
        await new Promise((r) => { flushed = r; node.port.postMessage('flush'); setTimeout(r, 300); });
        streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        sources.forEach((src) => src.disconnect());
        node.port.onmessage = null;
        if (shared) node.disconnect(); else await ctx.close();
        const samples = concat(trim ? trimSilence(chunks) : chunks);
        return { wav: encodeWav(samples), durationMs: (samples.length / SAMPLE_RATE) * 1000 };
      },
    };
  }

  // Abre o microfone escolhido com fallback em cascata:
  // 1) dispositivo exato com processamento; 2) exato sem processamento (o AEC do Chromium
  // falha ou fica mudo quando outro app, como o Discord, já usa o mic); 3) padrão do sistema
  // quando o id salvo não existe mais. Sem `exact`, o Chromium trocaria de mic em silêncio.
  async function openMic(deviceId = 'default', { processing = true } = {}) {
    const id = deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined;
    const fx = (on) => ({ echoCancellation: on, noiseSuppression: on, autoGainControl: on });
    const tries = [];
    if (processing) tries.push({ deviceId: id, ...fx(true) });
    tries.push({ deviceId: id, ...fx(false) });
    let lastErr;
    for (const audio of tries) {
      try { return { stream: await navigator.mediaDevices.getUserMedia({ audio }), fellBack: false }; }
      catch (err) { lastErr = err; if (err.name === 'NotAllowedError') throw err; }
    }
    if (!id) throw lastErr;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: processing ? fx(true) : fx(false) })
      .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    return { stream, fellBack: true };
  }

  // Barras de nível com movimento contínuo. Os níveis chegam a cada ~128 ms (um bloco do worklet).
  // A posição da fila (`head`, em barras) persegue a quantidade de níveis sem nunca voltar para trás,
  // e cada barra persegue a própria altura (sobe rápido, desce devagar). Antes a fila deslizava e
  // dava um tranco de volta a cada bloco, o que parecia uma tremida. O estado fica por canvas.
  const barState = new WeakMap();
  const ATTACK_MS = 60, RELEASE_MS = 160, SCROLL_MS = 150, NOISE = 0.004, FULL = 0.13;
  function drawBars(canvas, levels, color, { bw = 3, gap = 3, n = 0, minH = 3 } = {}) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const step = bw + gap;
    const slots = n || Math.floor(w / step);
    const now = performance.now();
    let st = barState.get(canvas);
    if (!st || levels.length < st.count) st = { disp: [], base: 0, count: 0, head: levels.length, last: now };
    barState.set(canvas, st);
    const dt = Math.min(64, Math.max(0, now - st.last)); st.last = now;
    st.count = levels.length;
    // Pulo grande (ex.: janela escondida) não vira uma corrida de barras.
    if (st.count - st.head > slots) st.head = st.count - 1;
    st.head += (st.count - st.head) * (1 - Math.exp(-dt / SCROLL_MS));
    const first = Math.max(0, Math.floor(st.head) - slots - 1);
    if (first > st.base) { st.disp.splice(0, first - st.base); st.base = first; }
    while (st.base + st.disp.length < st.count) st.disp.push(0);
    ctx.fillStyle = color;
    for (let j = Math.max(st.base, first); j < st.count; j++) {
      const k = j - st.base;
      const goal = Math.min(1, Math.sqrt(Math.max(0, levels[j] - NOISE) / FULL));
      const d = st.disp[k];
      st.disp[k] = d + (goal - d) * (1 - Math.exp(-dt / (goal > d ? ATTACK_MS : RELEASE_MS)));
      const x = (slots - (st.head - j)) * step;
      if (x < -bw || x > w) continue;
      const bh = Math.max(minH, st.disp[k] * h);
      ctx.beginPath();
      ctx.roundRect(x, (h - bh) / 2, bw, bh, bw / 2);
      ctx.fill();
    }
  }

  function fmtClock(ms, withMs = false) {
    const t = Math.max(0, Math.floor(ms));
    const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60;
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const base = h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return withMs ? `${base}.${pad(t % 1000, 3)}` : base;
  }

  window.staAudio = { SAMPLE_RATE, encodeWav, concat, rms, fileToWav, createRecorder, openMic, drawBars, fmtClock };
})();
