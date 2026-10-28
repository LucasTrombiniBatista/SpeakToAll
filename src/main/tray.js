// Ícone da bandeja: PNGs 32×32 gerados de assets/tray*.svg por scripts/gerar-icones.js.
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

function loadIcon(name) {
  return nativeImage.createFromPath(path.join(ASSETS, name));
}

let tray = null;
let icons = null;
let handlers = {};
let pluginCommands = [];

function buildMenu() {
  const { onOpen, onQuit, onToggleRecording, onPluginCommand, onCheckUpdates } = handlers;
  const items = [{ label: 'Abrir SpeakToAll', click: () => onOpen && onOpen() }];
  if (onToggleRecording) items.push({ label: 'Gravar / Parar', click: () => onToggleRecording() });
  if (pluginCommands.length && onPluginCommand) {
    items.push({
      label: 'Plugins',
      submenu: pluginCommands.map((c) => ({ label: `${c.pluginName}: ${c.name}`, click: () => onPluginCommand(c.pluginId, c.id) })),
    });
  }
  if (onCheckUpdates) items.push({ type: 'separator' }, { label: 'Verificar atualizações', click: () => onCheckUpdates() });
  items.push({ type: 'separator' }, { label: 'Sair', click: () => onQuit && onQuit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray(opts = {}) {
  if (tray) return tray;
  handlers = opts;
  icons = { idle: loadIcon('tray.png'), recording: loadIcon('tray-rec.png') };
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

module.exports = { createTray, setRecording, setPluginCommands, destroyTray };
