const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wa', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (label) => ipcRenderer.invoke('accounts:add', label),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  listMessages: (id) => ipcRenderer.invoke('messages:list', id),
  send: (id, jid, text) => ipcRenderer.invoke('messages:send', { id, jid, text }),
  onAccount: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('account:update', h); return () => ipcRenderer.removeListener('account:update', h); },
  onMessage: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('message:new', h); return () => ipcRenderer.removeListener('message:new', h); },
});
