// Daily outreach queue fed by a Google Sheet. Small daily cap, random gaps, working hours only.
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_TEMPLATES = [
  'Buongiorno {clinic}, sono di {sender}. {service} Se può interessarvi, vi mando volentieri i dettagli. Se preferite non ricevere messaggi, rispondete STOP.',
  'Salve, scrivo allo studio {clinic} ({city}) da parte di {sender}. {service} Posso inviarvi qualche informazione? Per non ricevere più messaggi basta rispondere STOP.',
  'Buongiorno, {sender} qui. {service} Se vi va, vi scrivo i dettagli per {clinic}. Rispondete STOP per non ricevere altri messaggi.',
].join('\n---\n');

const DEF = {
  sheetId: '', tabs: ['Dental Italy'], accountId: '', dailyCap: 10, startHour: 10, endHour: 18,
  minGap: 3, maxGap: 15, timezone: 'Europe/Rome', sender: '', service: '', templates: DEFAULT_TEMPLATES,
  enabled: false, serviceKey: '',
};
const OPT_OUT = /^\s*(stop|basta|annulla|unsubscribe|cancellami|non scrivere)\b/i;

const colLetter = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const rand = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())) % 24;
const dayIn = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz });

// Reads sheet values (first row = headers) into sendable rows.
function parseRows(tab, values) {
  const head = (values[0] || []).map((h) => String(h || '').trim().toLowerCase());
  const idx = (re) => head.findIndex((h) => re.test(h));
  const c = { name: idx(/^(clinic|name|business)/), city: idx(/^city/), link: idx(/whatsapp link|^wa link/), works: idx(/whatsapp works|wa working/), status: idx(/^status$/) };
  if (c.status < 0) throw new Error(`Tab "${tab}" has no "Status" column`);
  if (c.link < 0) throw new Error(`Tab "${tab}" has no "WhatsApp link" column`);
  const rows = [];
  values.slice(1).forEach((r, i) => {
    const get = (k) => (c[k] >= 0 ? String(r[c[k]] || '').trim() : '');
    if (!/^(not contacted|pending)?$/i.test(get('status'))) return;
    if (c.works >= 0 && !/working/i.test(get('works'))) return;
    const m = get('link').match(/wa\.me\/\+?(\d{8,15})/) || get('link').match(/phone=\+?(\d{8,15})/);
    if (!m) return;
    rows.push({ tab, rowNum: i + 2, statusCol: colLetter(c.status), number: m[1], clinic: get('name'), city: get('city') });
  });
  return rows;
}

class Outreach {
  constructor(file, manager, emit, safe) {
    this.file = file; this.manager = manager; this.emit = emit; this.safe = safe;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    this.s = { ...DEF, ...(saved.settings || {}) };
    this.st = { day: '', count: 0, nextAt: 0, firstSendAt: {}, contacted: {}, optedOut: [], ...(saved.state || {}) };
    this.queue = []; this.queueAt = 0; this.log = []; this.note = ''; this.busy = false;
    setInterval(() => this.tick(), 30000);
  }

  _save() { fs.writeFileSync(this.file, JSON.stringify({ settings: this.s, state: this.st })); }
  _push(kind, text) { this.log.unshift({ t: Date.now(), kind, text }); this.log.length = Math.min(this.log.length, 40); this.emit('outreach:update', this.status()); }

  _svc() {
    const k = this.s.serviceKey || '';
    const raw = k.startsWith('enc:') ? this.safe.decryptString(Buffer.from(k.slice(4), 'base64')) : k.startsWith('raw:') ? k.slice(4) : '';
    return raw ? JSON.parse(raw) : null;
  }
  setSettings(p) {
    const { serviceKey, sheetId, ...rest } = p;
    Object.assign(this.s, rest);
    if (typeof sheetId === 'string') this.s.sheetId = (sheetId.match(/\/d\/([\w-]+)/) || [null, sheetId.trim()])[1];
    if (typeof serviceKey === 'string' && serviceKey.trim()) {
      const j = JSON.parse(serviceKey);
      if (!j.client_email || !j.private_key) throw new Error('That is not a service account key file');
      this.s.serviceKey = this.safe?.isEncryptionAvailable() ? 'enc:' + this.safe.encryptString(serviceKey.trim()).toString('base64') : 'raw:' + serviceKey.trim();
      this._tok = null;
    }
    this.queue = []; this.queueAt = 0;
    this._save();
    return this.status();
  }
  status() {
    let email = ''; try { email = this._svc()?.client_email || ''; } catch { /* bad key */ }
    const { serviceKey, ...settings } = this.s;
    return { settings, hasKey: !!email, serviceEmail: email, sentToday: this.st.day === this._today() ? this.st.count : 0,
      cap: this._cap(), nextAt: this.st.nextAt, queue: this.queue.length, note: this.note, log: this.log };
  }
  _today() { try { return dayIn(this.s.timezone); } catch { return dayIn('Europe/Rome'); } }
  _cap() {
    const first = this.st.firstSendAt[this.s.accountId];
    const days = first ? (Date.now() - first) / 864e5 : 0;
    const warm = days < 3 ? 3 : days < 7 ? 5 : this.s.dailyCap;
    return Math.min(this.s.dailyCap, warm);
  }

  async _token() {
    if (this._tok && this._tok.exp > Date.now() + 60000) return this._tok.v;
    const k = this._svc(); if (!k) throw new Error('Add the Google service account key');
    const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = b64({ alg: 'RS256', typ: 'JWT' });
    const claim = b64({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(k.private_key, 'base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error_description || d.error);
    this._tok = { v: d.access_token, exp: Date.now() + d.expires_in * 1000 };
    return d.access_token;
  }
  async _api(method, p, body) {
    const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + this.s.sheetId + p, { method,
      headers: { authorization: 'Bearer ' + (await this._token()), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || 'Sheets error ' + r.status);
    return d;
  }
  _mark(tab, col, rowNum, value) {
    return this._api('PUT', '/values/' + encodeURIComponent(`'${tab}'!${col}${rowNum}`) + '?valueInputOption=RAW', { values: [[value]] })
      .catch((e) => this._push('error', 'Could not update sheet: ' + e.message));
  }

  async loadQueue() {
    const out = [];
    for (const tab of this.s.tabs) {
      const d = await this._api('GET', '/values/' + encodeURIComponent(`'${tab}'!A1:Z3000`));
      out.push(...parseRows(tab, d.values || []));
    }
    const have = new Set((this.manager.messages(this.s.accountId) || []).map((m) => m.jid));
    const bl = new Set(this.st.optedOut);
    const seen = new Set();
    this.queue = out.filter((r) => !this.st.contacted[r.number] && !bl.has(r.number) && !have.has(r.number + '@s.whatsapp.net') && !seen.has(r.number) && seen.add(r.number));
    this.queueAt = Date.now();
    this.emit('outreach:update', this.status());
  }

  _render(row) {
    const list = this.s.templates.split(/\n---\n/).map((t) => t.trim()).filter(Boolean);
    const t = list[Math.floor(Math.random() * list.length)] || '';
    return t.replace(/\{(\w+)\}/g, (_m, k) => ({ clinic: row.clinic || 'team', city: row.city, sender: this.s.sender, service: this.s.service })[k] ?? '').replace(/\s+\(\)/g, '').replace(/ {2,}/g, ' ');
  }
  async preview() {
    if (!this.queue.length || Date.now() - this.queueAt > 18e5) await this.loadQueue();
    return this.queue.slice(0, 3).map((r) => ({ clinic: r.clinic, number: r.number, text: this._render(r) }));
  }

  async tick() {
    const s = this.s;
    if (!s.enabled || this.busy) return;
    this.busy = true;
    try {
      if (!s.accountId || !s.sheetId || !s.sender || !s.service) { this.note = 'Fill in the settings first'; return; }
      if (this.manager.accounts.get(s.accountId)?.status !== 'connected') { this.note = 'Account is not connected'; return; }
      const h = hourIn(s.timezone);
      if (h < s.startHour || h >= s.endHour) { this.note = `Waiting for working hours (${s.startHour}:00-${s.endHour}:00 ${s.timezone})`; return; }
      if (this.st.day !== this._today()) { this.st.day = this._today(); this.st.count = 0; }
      if (this.st.count >= this._cap()) { this.note = 'Daily limit reached. Continues tomorrow.'; return; }
      if (Date.now() < this.st.nextAt) { this.note = 'Waiting before the next message'; return; }
      if (!this.queue.length || Date.now() - this.queueAt > 18e5) await this.loadQueue();
      const row = this.queue.shift();
      if (!row) { this.note = 'No pending rows in the sheet'; return; }
      this.note = 'Sending';
      await this._sendOne(row);
    } catch (e) { this._push('error', e.message); this.note = e.message; }
    finally { this.busy = false; this.emit('outreach:update', this.status()); }
  }

  async _sendOne(row) {
    const sock = this.manager.sockets.get(this.s.accountId);
    const [r] = (await sock.onWhatsApp(row.number + '@s.whatsapp.net')) || [];
    if (!r?.exists) { await this._mark(row.tab, row.statusCol, row.rowNum, 'Invalid'); this._push('invalid', `${row.clinic}: number is not on WhatsApp`); return; }
    await sock.sendPresenceUpdate('composing', r.jid); await sleep(rand(2500, 6000));
    await this.manager.sendText(this.s.accountId, r.jid, this._render(row));
    await this._mark(row.tab, row.statusCol, row.rowNum, 'Sent');
    this.st.contacted[row.number] = { tab: row.tab, rowNum: row.rowNum, col: row.statusCol };
    this.st.firstSendAt[this.s.accountId] ||= Date.now();
    this.st.count++; this.st.nextAt = Date.now() + rand(this.s.minGap, this.s.maxGap) * 60000;
    this._save(); this._push('sent', `Sent to ${row.clinic}`);
  }

  // Called for every incoming message. Returns true when it was an opt-out (no AI draft then).
  handleReply(_accountId, msg) {
    const number = msg.jid.split('@')[0], c = this.st.contacted[number];
    if (!c) return false;
    if (OPT_OUT.test(msg.text)) {
      this.st.optedOut.push(number); this._save();
      this._mark(c.tab, c.col, c.rowNum, 'Opted out');
      this._push('optout', `${msg.name || number} asked to stop. Added to the do-not-contact list.`);
      return true;
    }
    if (!c.replied) { c.replied = true; this._save(); this._mark(c.tab, c.col, c.rowNum, 'Replied'); this._push('reply', `${msg.name || number} replied. Open the inbox.`); }
    return false;
  }
}

module.exports = { Outreach, parseRows };
