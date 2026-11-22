const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SessionManager } = require('./sessions');

let win, manager;

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  if (app.isPackaged || process.env.NODE_ENV === 'production') {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(() => {
  const emit = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);
  manager = new SessionManager(path.join(app.getPath('userData'), 'sessions'), emit);

  ipcMain.handle('accounts:list', () => manager.list());
  ipcMain.handle('accounts:add', (_e, label) => manager.add(label));
  ipcMain.handle('accounts:remove', (_e, id) => manager.remove(id));
  ipcMain.handle('messages:list', (_e, id) => manager.messages(id));
  ipcMain.handle('messages:send', (_e, { id, jid, text }) => manager.sendText(id, jid, text));

  createWindow();
  manager.restoreAll();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
