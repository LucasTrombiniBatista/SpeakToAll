// Ícone da bandeja. nativeImage não carrega SVG → o logo é rasterizado em código (32×32 BGRA).
const { Tray, Menu, nativeImage } = require('electron');

const SIZE = 32;
const VIEW = 56;
// Barras do logo no viewbox 56: x, largura, altura (centralizadas verticalmente)
const BARS = [
  { x: 2, w: 8, h: 16 },
  { x: 15, w: 8, h: 32 },
  { x: 28, w: 8, h: 20 },
  { x: 43, w: 6, h: 48 },
];
const WHITE = [255, 255, 255];
const COBALT = [0x23, 0x46, 0xFF];
const RED = [0xFF, 0x3B, 0x30];

// Cobertura (0..1) de um pixel por um retângulo arredondado, com supersampling 4×4.
function coverage(px, py, rx, ry, rw, rh, r) {
  const N = 4;
  let hits = 0;
  for (let sy = 0; sy < N; sy++) {
    for (let sx = 0; sx < N; sx++) {
      const x = px + (sx + 0.5) / N;
      const y = py + (sy + 0.5) / N;
      if (x < rx || x > rx + rw || y < ry || y > ry + rh) continue;
      const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
      const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / (N * N);
}

function renderLogo(recording) {
  const buf = Buffer.alloc(SIZE * SIZE * 4); // BGRA, transparente
  const s = SIZE / VIEW;
  BARS.forEach((bar, idx) => {
    const color = recording ? RED : (idx === BARS.length - 1 ? COBALT : WHITE);
    const rx = bar.x * s, rw = bar.w * s, rh = bar.h * s;
    const ry = ((VIEW - bar.h) / 2) * s;
    const r = rw / 2;
    for (let py = Math.floor(ry); py < Math.ceil(ry + rh); py++) {
      for (let px = Math.floor(rx); px < Math.ceil(rx + rw); px++) {
        if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
        const a = coverage(px, py, rx, ry, rw, rh, r);
        if (a <= 0) continue;
        const o = (py * SIZE + px) * 4;
        const prevA = buf[o + 3] / 255;
        const outA = a + prevA * (1 - a);
        // "over" com alpha não-premultiplicado
        for (let c = 0; c < 3; c++) {
          const src = color[2 - c]; // BGRA
          buf[o + c] = Math.round((src * a + buf[o + c] * prevA * (1 - a)) / (outA || 1));
        }
        buf[o + 3] = Math.round(outA * 255);
      }
    }
  });
  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE });
}

let tray = null;
let icons = null;
let handlers = {};
let pluginCommands = [];

function buildMenu() {
  const { onOpen, onQuit, onToggleRecording, onPluginCommand } = handlers;
  const items = [{ label: 'Abrir SpeakToAll', click: () => onOpen && onOpen() }];
  if (onToggleRecording) items.push({ label: 'Gravar / Parar', click: () => onToggleRecording() });
  if (pluginCommands.length && onPluginCommand) {
    items.push({
      label: 'Plugins',
      submenu: pluginCommands.map((c) => ({ label: `${c.pluginName}: ${c.name}`, click: () => onPluginCommand(c.pluginId, c.id) })),
    });
  }
  items.push({ type: 'separator' }, { label: 'Sair', click: () => onQuit && onQuit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray(opts = {}) {
  if (tray) return tray;
  handlers = opts;
  icons = { idle: renderLogo(false), recording: renderLogo(true) };
  tray = new Tray(icons.idle);
  tray.setToolTip('SpeakToAll');
  buildMenu();
  tray.on('click', () => handlers.onOpen && handlers.onOpen());
  return tray;
}

// cmds: [{pluginId, id, name, pluginName}]
function setPluginCommands(cmds) {
  pluginCommands = cmds || [];
  if (tray && !tray.isDestroyed()) buildMenu();
}

function setRecording(on) {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(on ? icons.recording : icons.idle);
  tray.setToolTip(on ? 'SpeakToAll — gravando' : 'SpeakToAll');
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

module.exports = { createTray, setRecording, setPluginCommands, destroyTray, renderLogo };
