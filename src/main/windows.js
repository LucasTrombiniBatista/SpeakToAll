// Janela principal, janela overlay e permissões de mídia.
const { BrowserWindow, screen, session, desktopCapturer, webContents, shell } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let mainWin = null;
let overlayWin = null;
let overlayReady = null;
let quitting = false;

// Menor privilégio: cada janela só recebe o que usa, e só para páginas locais do app.
// Overlay: microfone (ditado). Principal: microfone + áudio do sistema (reunião).
function allowedFor(wc) {
  if (!wc || !wc.getURL().startsWith('file://')) return [];
  if (overlayWin && wc === overlayWin.webContents) return ['media', 'audioCapture'];
  if (mainWin && wc === mainWin.webContents) return ['media', 'audioCapture', 'display-capture'];
  return [];
}

function setupMedia() {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowedFor(wc).includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowedFor(wc).includes(perm));
  // Reunião: áudio do sistema via WASAPI loopback (o vídeo é descartado no renderer).
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    const wc = req.frame ? webContents.fromFrame(req.frame) : null;
    if (!allowedFor(wc).includes('display-capture')) return cb({});
    const [source] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: source, audio: 'loopback' });
  });
}

// Nenhuma janela navega para fora do app; links http(s) abrem no navegador.
function lockNavigation(win) {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createMain({ closeToTray }) {
  mainWin = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: '#FFFFFF', title: 'SpeakToAll', show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'main-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  mainWin.removeMenu();
  lockNavigation(mainWin);
  mainWin.loadFile(path.join(ROOT, 'renderer', 'main', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('close', (e) => {
    if (!quitting && closeToTray()) { e.preventDefault(); mainWin.hide(); }
  });
  return mainWin;
}

function createOverlay() {
  overlayWin = new BrowserWindow({
    // 360x110: margem para a sombra da pílula não ser cortada pelas bordas da janela.
    // backgroundColor totalmente transparente evita o retângulo preto no Windows.
    width: 360, height: 110, frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: false, show: false,
    hasShadow: false, thickFrame: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'overlay-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  lockNavigation(overlayWin);
  // Só mostra depois do primeiro carregamento: antes disso o Windows pinta a área de preto.
  overlayReady = new Promise((resolve) => overlayWin.webContents.once('did-finish-load', resolve));
  overlayWin.loadFile(path.join(ROOT, 'renderer', 'overlay', 'overlay.html'));
  return overlayWin;
}

async function showOverlay() {
  await overlayReady;
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w, h] = overlayWin.getSize();
  overlayWin.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height - h - 29));
  overlayWin.showInactive();
}

function overlayCommand(cmd) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (['start', 'transcribing', 'done', 'error'].includes(cmd.type)) showOverlay();
  overlayWin.webContents.send('overlay:command', cmd);
}

function hideOverlay() { overlayWin?.hide(); }

function showMain() {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

module.exports = {
  setupMedia, createMain, createOverlay, overlayCommand, hideOverlay, showMain, send,
  getMain: () => mainWin,
  setQuitting: () => { quitting = true; },
};
