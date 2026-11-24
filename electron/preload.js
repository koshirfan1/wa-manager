const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wa', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (label) => ipcRenderer.invoke('accounts:add', label),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  listMessages: (id) => ipcRenderer.invoke('messages:list', id),
  send: (id, jid, text) => ipcRenderer.invoke('messages:send', { id, jid, text }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  suggest: (id, jid) => ipcRenderer.invoke('draft:suggest', { id, jid }),
  onDraft: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('draft:update', h); return () => ipcRenderer.removeListener('draft:update', h); },
  outreachGet: () => ipcRenderer.invoke('outreach:get'),
  outreachSet: (p) => ipcRenderer.invoke('outreach:set', p),
  outreachPreview: () => ipcRenderer.invoke('outreach:preview'),
  onOutreach: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('outreach:update', h); return () => ipcRenderer.removeListener('outreach:update', h); },
  onAccount: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('account:update', h); return () => ipcRenderer.removeListener('account:update', h); },
  onMessage: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('message:new', h); return () => ipcRenderer.removeListener('message:new', h); },
});
