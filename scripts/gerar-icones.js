// Gera os PNG/ICO do ícone a partir de assets/*.svg. Rodar com: npx electron scripts/gerar-icones.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
// Cada tamanho abre e fecha uma janela; sem isso o app sairia após a primeira.
app.on('window-all-closed', () => {});

// Rasteriza um SVG no tamanho pedido usando o Chromium do Electron (offscreen, fundo transparente).
async function render(svgFile, size) {
  const svg = fs.readFileSync(path.join(ROOT, 'assets', svgFile), 'utf8');
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;
  const win = new BrowserWindow({
    width: size, height: size, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true,
    webPreferences: { offscreen: true },
  });
  // Offscreen não suporta capturePage: pega o último quadro do evento paint.
  let frame = null;
  win.webContents.on('paint', (_e, _dirty, image) => { frame = image; });
  const tmp = path.join(os.tmpdir(), 'sta-icon-' + size + '.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript('document.images[0].decode()');
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 300));
  win.destroy();
  const img = frame;
  return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

// ICO com PNGs embutidos (aceito pelo Windows Vista+ e pelo electron-builder).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await render('icon.svg', size) });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), await render('icon.svg', 512));
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), await render('icon.svg', 256));
  fs.writeFileSync(path.join(ROOT, 'assets', 'tray.png'), await render('tray.svg', 32));
  fs.writeFileSync(path.join(ROOT, 'assets', 'tray-rec.png'), await render('tray-rec.svg', 32));
  console.log('Ícones gerados em build/ e assets/');
  app.quit();
});
