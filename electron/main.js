const { app, BrowserWindow, ipcMain, safeStorage, Notification } = require('electron');
const path = require('path');
const { SessionManager } = require('./sessions');
const { Assistant } = require('./ai');
const { Outreach } = require('./outreach');

let win, manager, assistant, outreach;

function notify(accountId, m) {
  if (!Notification.isSupported() || (win && win.isFocused())) return;
  const acc = manager.accounts.get(accountId);
  new Notification({ title: (m.name || '+' + m.jid.split('@')[0]) + (acc ? ' (' + acc.label + ')' : ''), body: m.text.slice(0, 140) }).show();
}

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
  manager = new SessionManager(path.join(app.getPath('userData'), 'sessions'), emit, (a, m) => { if (outreach.handleReply(a, m)) return; notify(a, m); assistant.onIncoming(a, m); });
  assistant = new Assistant(path.join(app.getPath('userData'), 'settings.json'), manager, emit, safeStorage);
  outreach = new Outreach(path.join(app.getPath('userData'), 'outreach.json'), manager, emit, safeStorage);
  ipcMain.handle('outreach:get', () => outreach.status());
  ipcMain.handle('outreach:set', (_e, p) => outreach.setSettings(p));
  ipcMain.handle('outreach:preview', () => outreach.preview());
  ipcMain.handle('settings:get', () => assistant.getSettings());
  ipcMain.handle('settings:set', (_e, p) => assistant.setSettings(p));
  ipcMain.handle('draft:suggest', (_e, { id, jid }) => assistant.suggest(id, jid));

  ipcMain.handle('accounts:list', () => manager.list());
  ipcMain.handle('accounts:add', (_e, label) => manager.add(label));
  ipcMain.handle('accounts:remove', (_e, id) => manager.remove(id));
  ipcMain.handle('messages:list', (_e, id) => manager.messages(id));
  ipcMain.handle('messages:send', (_e, { id, jid, text }) => manager.sendText(id, jid, text));

  createWindow();
  manager.restoreAll();
});

app.on('before-quit', () => manager && manager.flush());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
