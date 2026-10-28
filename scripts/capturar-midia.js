// Gera as capturas e GIFs do README em docs/media/. Rodar com: npx electron scripts/capturar-midia.js
// Usa os renderers com o mock (wp-mock.js): só dados falsos, nada do usuário aparece.
const { app, BrowserWindow } = require('electron');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'media');
const MAIN = path.join(ROOT, 'src', 'renderer', 'main', 'index.html');
const FPS = 12; // GIFs de navegação usam 6 fps para ficar abaixo de ~2 MB
const GIF_WIDTH = 900;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Janela offscreen: capturePage não funciona nela, então guarda o último quadro do evento paint.
async function open(file, { width = 1180, height = 760, query } = {}) {
  const win = new BrowserWindow({ width, height, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(30);
  win.frame = null;
  win.webContents.on('paint', (_e, _dirty, image) => { win.frame = image; });
  await win.loadFile(file, query ? { query } : undefined);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await wait(600);
  return win;
}

const run = (win, js) => win.webContents.executeJavaScript(js);

async function snap(win, name) {
  win.webContents.invalidate();
  await wait(250);
  fs.writeFileSync(path.join(OUT, name), win.frame.toPNG());
  console.log(name);
}

// Grava `seconds` de quadros enquanto `script` roda, e codifica em GIF reduzido para GIF_WIDTH.
async function record(win, name, seconds, script, fps = FPS) {
  const frames = [];
  let done = false;
  const grab = (async () => {
    while (!done) {
      win.webContents.invalidate();
      await wait(1000 / fps);
      if (win.frame) frames.push(win.frame);
    }
  })();
  await script();
  await wait(seconds * 1000);
  done = true;
  await grab;
  const { width, height } = frames[0].getSize();
  const w = Math.min(GIF_WIDTH, width);
  const h = Math.round((height * w) / width);
  const gif = GIFEncoder();
  for (const frame of frames) {
    const bgra = frame.resize({ width: w, height: h, quality: 'best' }).toBitmap();
    const rgba = new Uint8Array(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255; }
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: Math.round(1000 / fps) });
  }
  gif.finish();
  fs.writeFileSync(path.join(OUT, name), gif.bytes());
  console.log(name, frames.length, 'quadros');
}

// Cena do ditado: a própria página da pílula, com um editor qualquer desenhado atrás dela.
// (Num iframe a pílula sai com fundo preto na janela offscreen.)
const SCENE = `
  html, body { background: #1B1E26 !important; }
  body { font: 15px/24px 'Segoe UI', sans-serif; }
  .doc { position: fixed; left: 50%; top: 56px; transform: translateX(-50%); width: 640px; height: 330px; background: #fff; border-radius: 12px; box-shadow: 0 20px 60px #0008; padding: 36px 44px; box-sizing: border-box; color: #0E0F13; }
  .doc h3 { margin: 0 0 14px; font-size: 20px; }
  .caret { display: inline-block; width: 2px; height: 18px; background: #2346FF; vertical-align: -3px; animation: b 1s steps(1) infinite; }
  @keyframes b { 50% { opacity: 0; } }
  .bubble { position: fixed; left: 50%; bottom: 34px; translate: -50% 0; }`;

async function dictationScene() {
  const win = await open(path.join(ROOT, 'src', 'renderer', 'overlay', 'overlay.html'), { width: 900, height: 520, query: { preview: 'recording' } });
  await run(win, `(() => {
    const st = document.createElement('style'); st.textContent = ${JSON.stringify(SCENE)}; document.head.append(st);
    const doc = document.createElement('div'); doc.className = 'doc';
    doc.innerHTML = '<h3>Resumo da reunião</h3><span id="t"></span><span class="caret"></span>';
    document.body.prepend(doc);
  })()`);
  await wait(300);
  return win;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // Capturas estáticas da janela principal, nos dois temas.
  const main = await open(MAIN);
  for (const theme of ['dark', 'light']) {
    await run(main, `document.documentElement.dataset.theme = '${theme}'`);
    for (const view of ['notes', 'import', 'meeting', 'plugins', 'settings']) {
      await run(main, `document.querySelector('.nav button[data-view="${view}"]').click()`);
      await snap(main, `${view}-${theme}.png`);
    }
  }

  // GIF: navegação pelas abas no tema escuro.
  await run(main, `document.documentElement.dataset.theme = 'dark'; document.querySelector('.nav button[data-view="notes"]').click()`);
  await record(main, 'tour.gif', 0.2, async () => {
    for (const view of ['notes', 'import', 'meeting', 'plugins', 'settings', 'notes']) {
      await run(main, `document.querySelector('.nav button[data-view="${view}"]').click()`);
      await wait(900);
    }
  }, 6);

  // GIF: troca de tema.
  await record(main, 'tema.gif', 0.2, async () => {
    for (const theme of ['dark', 'light', 'dark']) {
      await run(main, `document.documentElement.dataset.theme = '${theme}'`);
      await wait(1100);
    }
  }, 6);
  main.destroy();

  // GIF principal: segura a tecla, fala, solta, o texto aparece.
  const scene = await dictationScene();
  const text = 'Combinamos testar o modelo turbo como padrão e simplificar o download do modelo no primeiro uso.';
  await record(scene, 'ditado.gif', 0.6, async () => {
    await wait(2600);
    await run(scene, `cancelAnimationFrame(raf); setState('transcribing')`);
    await wait(1200);
    await run(scene, `setState('done')`);
    await run(scene, `(async () => { const t = document.getElementById('t'); for (const w of ${JSON.stringify(text)}.split(' ')) { t.textContent += w + ' '; await new Promise((r) => setTimeout(r, 70)); } })()`);
    await wait(1600);
  });
  await snap(scene, 'ditado.png');
  scene.destroy();

  console.log('Mídia gerada em docs/media/');
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
