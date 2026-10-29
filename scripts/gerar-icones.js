// Gera os PNG/ICO do ícone a partir de assets/*.svg. Rodar com: npx electron scripts/gerar-icones.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 20/40 cobrem a barra de tarefas em 125%/150%; 96 o Explorer em ícones médios.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// Até 32px usa o desenho da bandeja (traço mais grosso): o logo cheio some em 16px.
const SMALL_MAX = 32;
// Bandeja: 16px DIP; o Electron escolhe tray@1.25x.png etc. conforme a escala da tela.
const TRAY_SCALES = { '': 16, '@1.25x': 20, '@1.5x': 24, '@2x': 32, '@3x': 48 };

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
// Cada tamanho abre e fecha uma janela; sem isso o app sairia após a primeira.
app.on('window-all-closed', () => {});

// Rasteriza um SVG no tamanho pedido usando o Chromium do Electron (offscreen, fundo transparente).
async function render(svgFile, size, height = size) {
  const svg = fs.readFileSync(path.join(ROOT, 'assets', svgFile), 'utf8');
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="${src}" width="${size}" height="${height}" style="display:block"></body></html>`;
  const win = new BrowserWindow({
    width: size, height, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true,
    webPreferences: { offscreen: true },
  });
  // Offscreen não suporta capturePage: pega o último quadro do evento paint. Copia os pixels
  // na hora: a imagem do evento pode ser liberada depois do callback e virar 0x0.
  let frame = null;
  win.webContents.on('paint', (_e, _dirty, image) => {
    const sz = image.getSize();
    if (sz.width >= size && sz.height >= height) frame = nativeImage.createFromBitmap(image.toBitmap(), sz);
  });
  const tmp = path.join(os.tmpdir(), 'sta-icon-' + size + '.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript('document.images[0].decode()');
  win.webContents.invalidate();
  for (let t = 0; t < 30 && !frame; t++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300)); // deixa chegar o quadro final, já com a imagem
  win.destroy();
  if (!frame) throw new Error(`${svgFile}: nenhum quadro de ${size}x${height}`);
  // O Windows impõe um tamanho mínimo de janela: em tamanhos pequenos o quadro sai maior que o
  // pedido, com a imagem no canto. Recorta essa área em vez de redimensionar o quadro inteiro.
  const img = frame.crop({ x: 0, y: 0, width: size, height });
  const got = img.getSize();
  if (got.width !== size || got.height !== height) throw new Error(`${svgFile}: quadro ${got.width}x${got.height}, esperado ${size}x${height}`);
  return img;
}

// Tamanhos pequenos: renderiza grande e reduz. O quadro offscreen de janelas pequenas não cobre
// o recorte, e o crop devolvia imagem vazia (ICO com entradas sem pixels → ícone em branco).
const BIG = 256;
async function renderIcon(svgFile, size) {
  const img = await render(svgFile, BIG);
  return size === BIG ? img : img.resize({ width: size, height: size, quality: 'best' });
}

// Entrada DIB 32-bit (BGRA, linhas de baixo para cima + máscara AND zerada). O NSIS e partes
// do shell do Windows desenham errado entradas PNG pequenas; só a de 256 fica em PNG.
function dib(img) {
  const { width: w, height: h } = img.getSize();
  const bgra = img.toBitmap(); // BGRA no Windows
  const maskRow = Math.ceil(w / 32) * 4;
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(w, 4);
  head.writeInt32LE(h * 2, 8); // altura dobrada: XOR + AND
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  head.writeUInt32LE(w * h * 4 + maskRow * h, 20);
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) bgra.copy(px, (h - 1 - y) * w * 4, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([head, px, Buffer.alloc(maskRow * h)]);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const datas = [];
  let offset = 6 + 16 * images.length;
  for (const { size, img } of images) {
    const data = size >= 256 ? img.toPNG() : dib(img);
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    datas.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

// BMP 24-bit para a imagem lateral do instalador NSIS (sem alfa).
function bmp24(img) {
  const { width: w, height: h } = img.getSize();
  const bgra = img.toBitmap();
  const row = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * h);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = 54 + (h - 1 - y) * row + x * 3;
      out[dst] = bgra[src]; out[dst + 1] = bgra[src + 1]; out[dst + 2] = bgra[src + 2];
    }
  }
  return out;
}

app.whenReady().then(async () => {
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, img: await renderIcon(size <= SMALL_MAX ? 'tray.svg' : 'icon.svg', size) });
  const ico = buildIco(images);
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico);
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), ico); // janela/barra de tarefas (build/ não é empacotado)
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), (await render('icon.svg', 512)).toPNG());
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), (await renderIcon('icon.svg', 256)).toPNG());
  for (const name of ['tray', 'tray-rec']) {
    for (const [suffix, size] of Object.entries(TRAY_SCALES)) {
      fs.writeFileSync(path.join(ROOT, 'assets', `${name}${suffix}.png`), (await renderIcon(`${name}.svg`, size)).toPNG());
    }
  }
  fs.writeFileSync(path.join(ROOT, 'build', 'installerSidebar.bmp'), bmp24(await render('installer-sidebar.svg', 164, 314)));
  console.log('Ícones gerados em build/ e assets/');
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
