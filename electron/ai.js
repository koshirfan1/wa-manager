// Away mode + AI drafts. Drafts only: nothing is sent without the owner's approval.
const fs = require('fs');

const SENSITIVE = /\b(pay|payment|price|cost|quote|invoice|refund|contract|deadline|appointment|meeting)\b|prezzo|costo|preventivo|pagamento|appuntamento|fattura|paisa|rupay|qeemat/i;
const DEFAULTS = { apiKey: '', model: 'claude-sonnet-5-5', away: false, scheduleOn: false, awayFrom: '22:00', awayTo: '09:00', styleNotes: '', blocklist: [] };

class Assistant {
  constructor(file, manager, emit, safeStorage) {
    this.file = file; this.manager = manager; this.emit = emit; this.safe = safeStorage;
    try { this.s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { this.s = { ...DEFAULTS }; }
  }
  _enc(v) { return this.safe?.isEncryptionAvailable() ? 'enc:' + this.safe.encryptString(v).toString('base64') : 'raw:' + v; }
  _key() {
    const k = this.s.apiKey || '';
    if (k.startsWith('enc:')) { try { return this.safe.decryptString(Buffer.from(k.slice(4), 'base64')); } catch { return ''; } }
    return k.startsWith('raw:') ? k.slice(4) : '';
  }
  // Manual switch OR the daily schedule (can wrap past midnight, e.g. 22:00 to 09:00)
  isAway() {
    if (this.s.away) return true;
    if (!this.s.scheduleOn) return false;
    const m = (t) => { const [h, mi] = String(t).split(':').map(Number); return h * 60 + (mi || 0); };
    const now = new Date(), cur = now.getHours() * 60 + now.getMinutes(), a = m(this.s.awayFrom), b = m(this.s.awayTo);
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  }
  getSettings() { const { apiKey, ...rest } = this.s; return { ...rest, hasKey: !!this._key(), awayNow: this.isAway() }; }
  setSettings(p) {
    const { apiKey, ...rest } = p;
    Object.assign(this.s, rest);
    if (typeof apiKey === 'string' && apiKey.trim()) this.s.apiKey = this._enc(apiKey.trim());
    fs.writeFileSync(this.file, JSON.stringify(this.s, null, 2));
    return this.getSettings();
  }

  async onIncoming(accountId, msg) {
    if (!this.isAway() || !this._key()) return;
    const num = msg.jid.split('@')[0];
    if (this.s.blocklist.some((b) => b && num.endsWith(b.replace(/\D/g, '')))) return;
    await this.suggest(accountId, msg.jid);
  }

  async suggest(accountId, jid) {
    const out = (patch) => this.emit('draft:update', { accountId, jid, ...patch });
    const key = this._key();
    if (!key) return out({ status: 'error', reason: 'Add your Claude API key in Settings first.' });
    const all = this.manager.messages(accountId);
    const thread = all.filter((m) => m.jid === jid).slice(-15);
    const last = [...thread].reverse().find((m) => !m.fromMe);
    if (last && SENSITIVE.test(last.text)) {
      return out({ status: 'needs_you', reason: 'Mentions money, prices or an appointment. Reply yourself.' });
    }
    out({ status: 'writing' });
    const samples = all.filter((m) => m.fromMe).slice(-25).map((m) => '- ' + m.text).join('\n');
    const system = [
      'You write WhatsApp replies on behalf of the account owner while they are away.',
      'Match the owner\'s style from the examples: tone, length, language mix, emoji use.',
      'Reply in the language the contact is using. Keep it short and natural.',
      'Never agree to prices, payments, appointments or commitments. If asked, say the owner will get back personally.',
      'Output only the message text.',
      this.s.styleNotes && 'Owner\'s notes about their style: ' + this.s.styleNotes,
      samples && 'Examples of the owner\'s past messages:\n' + samples,
    ].filter(Boolean).join('\n\n');
    const transcript = thread.map((m) => (m.fromMe ? 'Owner: ' : 'Contact: ') + m.text).join('\n');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.s.model, max_tokens: 400, system,
          messages: [{ role: 'user', content: 'Conversation so far:\n' + transcript + '\n\nWrite the owner\'s next reply.' }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'API error ' + res.status);
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      out({ status: 'ready', text });
    } catch (e) { out({ status: 'error', reason: e.message }); }
  }
}

module.exports = { Assistant };
