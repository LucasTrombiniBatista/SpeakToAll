// Janela principal, janela overlay e permissões de mídia.
const { BrowserWindow, screen, session, desktopCapturer } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let mainWin = null;
let overlayWin = null;
let quitting = false;

function setupMedia() {
  const allowed = ['media', 'audioCapture', 'display-capture'];
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.includes(perm));
  // Reunião: áudio do sistema via WASAPI loopback (o vídeo é descartado no renderer).
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [source] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: source, audio: 'loopback' });
  });
}

function createMain({ closeToTray }) {
  mainWin = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: '#FFFFFF', title: 'SpeakToAll', show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'main-preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWin.removeMenu();
  mainWin.loadFile(path.join(ROOT, 'renderer', 'main', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('close', (e) => {
    if (!quitting && closeToTray()) { e.preventDefault(); mainWin.hide(); }
  });
  return mainWin;
}

function createOverlay() {
  overlayWin = new BrowserWindow({
    width: 320, height: 72, frame: false, transparent: true, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, resizable: false, show: false, hasShadow: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'overlay-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(path.join(ROOT, 'renderer', 'overlay', 'overlay.html'));
  return overlayWin;
}

function showOverlay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w, h] = overlayWin.getSize();
  overlayWin.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height - h - 48));
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
