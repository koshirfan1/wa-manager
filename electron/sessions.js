// Multi-account manager on top of Baileys. One auth folder per account.
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');

const MAX_MESSAGES_PER_ACCOUNT = 500;

class SessionManager {
  constructor(baseDir, emit) {
    this.baseDir = baseDir;
    this.emit = emit;
    this.metaFile = path.join(baseDir, 'accounts.json');
    this.accounts = new Map();   // id -> { id, label, status, qr, phone }
    this.sockets = new Map();    // id -> socket
    this.inbox = new Map();      // id -> message[]
    fs.mkdirSync(baseDir, { recursive: true });
    this._load();
  }

  _load() {
    try {
      JSON.parse(fs.readFileSync(this.metaFile, 'utf8')).forEach((a) =>
        this.accounts.set(a.id, { ...a, status: 'offline', qr: null }));
    } catch { /* first run */ }
  }
  _save() {
    const data = [...this.accounts.values()].map(({ id, label, phone }) => ({ id, label, phone }));
    fs.writeFileSync(this.metaFile, JSON.stringify(data, null, 2));
  }
  _update(id, patch) {
    const acc = this.accounts.get(id);
    if (!acc) return;
    Object.assign(acc, patch);
    this.emit('account:update', this._public(acc));
  }
  _public({ id, label, status, qr, phone }) { return { id, label, status, qr, phone }; }

  list() { return [...this.accounts.values()].map((a) => this._public(a)); }
  messages(id) { return this.inbox.get(id) || []; }

  restoreAll() { for (const id of this.accounts.keys()) this.start(id); }

  async add(label) {
    const id = 'acc_' + Date.now().toString(36);
    this.accounts.set(id, { id, label: label || 'Account', status: 'starting', qr: null, phone: null });
    this._save();
    this.start(id);
    return this._public(this.accounts.get(id));
  }

  async remove(id) {
    const sock = this.sockets.get(id);
    try { await sock?.logout(); } catch { /* already closed */ }
    this.sockets.delete(id);
    this.accounts.delete(id);
    this.inbox.delete(id);
    fs.rmSync(path.join(this.baseDir, id), { recursive: true, force: true });
    this._save();
    return true;
  }

  async start(id) {
    const mod = await import('@whiskeysockets/baileys');
    const B = mod.default && mod.default.default ? mod.default : mod;
    const makeWASocket = B.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = B;

    const { state, saveCreds } = await useMultiFileAuthState(path.join(this.baseDir, id));
    const { version } = await fetchLatestBaileysVersion();
    this._update(id, { status: 'starting' });

    const sock = makeWASocket({
      version, auth: state, logger: pino({ level: 'silent' }),
      printQRInTerminal: false, markOnlineOnConnect: false,
    });
    this.sockets.set(id, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) this._update(id, { status: 'qr', qr: await QRCode.toDataURL(qr, { width: 260, margin: 1 }) });
      if (connection === 'open') {
        const phone = (sock.user?.id || '').split(':')[0].split('@')[0];
        this._update(id, { status: 'connected', qr: null, phone });
        this._save();
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        this.sockets.delete(id);
        if (code === DisconnectReason.loggedOut) {
          fs.rmSync(path.join(this.baseDir, id), { recursive: true, force: true });
          this._update(id, { status: 'logged_out', qr: null });
        } else {
          this._update(id, { status: 'reconnecting' });
          setTimeout(() => this.accounts.has(id) && this.start(id), 3000);
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        const jid = m.key.remoteJid;
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue; // 1:1 chats only for now
        const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
        if (!text) continue;
        this._push(id, {
          id: m.key.id, jid, fromMe: !!m.key.fromMe, text,
          name: m.pushName || null, ts: Number(m.messageTimestamp) * 1000 || Date.now(),
        });
      }
    });
  }

  _push(accountId, msg) {
    const list = this.inbox.get(accountId) || [];
    list.push(msg);
    if (list.length > MAX_MESSAGES_PER_ACCOUNT) list.shift();
    this.inbox.set(accountId, list);
    this.emit('message:new', { accountId, message: msg });
  }

  async sendText(id, jid, text) {
    const sock = this.sockets.get(id);
    if (!sock) throw new Error('Account is not connected');
    const sent = await sock.sendMessage(jid, { text });
    this._push(id, { id: sent.key.id, jid, fromMe: true, text, name: null, ts: Date.now() });
    return true;
  }
}

module.exports = { SessionManager };
