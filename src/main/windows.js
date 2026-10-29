// Janela principal, janela overlay e permissões de mídia.
const { BrowserWindow, screen, session, desktopCapturer, nativeTheme } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// .ico multi-tamanho: o Windows escolhe a entrada certa para barra de tarefas, Alt+Tab e título.
const ICON = path.join(ROOT, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
// Barra de título própria: o app pinta o topo e o Windows só desenha os botões, nas cores do tema.
const TITLEBAR_HEIGHT = 36;
const THEME_COLORS = { light: { bg: '#FFFFFF', ink: '#0E0F13' }, dark: { bg: '#0E0F13', ink: '#F4F5F7' } };
let mainWin = null;
let overlayWin = null;
let overlayReady = null;
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

function themeColors() {
  return THEME_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

function titleBarOverlay() {
  const c = themeColors();
  return { color: c.bg, symbolColor: c.ink, height: TITLEBAR_HEIGHT };
}

// theme: system | light | dark (config.theme). Também define o prefers-color-scheme do renderer.
function setTheme(theme) {
  nativeTheme.themeSource = theme;
}

nativeTheme.on('updated', () => {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.setBackgroundColor(themeColors().bg);
  mainWin.setTitleBarOverlay(titleBarOverlay());
});

// mode: windowed | maximized | fullscreen (config.windowMode).
function setWindowMode(mode) {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.setFullScreen(mode === 'fullscreen');
  if (mode === 'maximized') mainWin.maximize();
  else if (mode === 'windowed' && mainWin.isMaximized()) mainWin.unmaximize();
}

function createMain({ closeToTray, windowMode }) {
  mainWin = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: themeColors().bg, title: 'SpeakToAll', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(),
    icon: ICON,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'main-preload.js'),
      contextIsolation: true, nodeIntegration: false,
      // O jingle do lobby de abertura toca sem clique.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWin.removeMenu();
  mainWin.loadFile(path.join(ROOT, 'renderer', 'main', 'index.html'));
  mainWin.once('ready-to-show', () => { setWindowMode(windowMode()); mainWin.show(); });
  // Em tela cheia o Windows esconde os botões; o renderer some com a faixa do topo.
  mainWin.on('enter-full-screen', () => send('window:fullscreen', true));
  mainWin.on('leave-full-screen', () => send('window:fullscreen', false));
  // Ao reabrir do segundo plano o renderer volta para a aba principal.
  mainWin.on('show', () => send('window:shown'));
  // F11 alterna tela cheia sem mudar a preferência salva.
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); mainWin.setFullScreen(!mainWin.isFullScreen()); }
  });
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
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
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
  setupMedia, createMain, setTheme, setWindowMode, createOverlay, overlayCommand, hideOverlay, showMain, send,
  getMain: () => mainWin, ICON,
  setQuitting: () => { quitting = true; },
};
