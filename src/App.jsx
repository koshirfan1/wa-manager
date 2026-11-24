import { useEffect, useMemo, useRef, useState } from 'react';
import Outreach from './Outreach.jsx';

const STATUS = {
  connected: 'Connected', qr: 'Scan QR', starting: 'Starting', reconnecting: 'Reconnecting',
  offline: 'Offline', logged_out: 'Logged out',
};

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [messages, setMessages] = useState({});   // accountId -> message[]
  const [activeAcc, setActiveAcc] = useState(null);
  const [activeJid, setActiveJid] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const [view, setView] = useState('inbox');
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState({});
  const cur = useRef({});
  const [settings, setSettings] = useState(null);
  const [drafts, setDrafts] = useState({});   // "accountId|jid" -> draft
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState({ apiKey: '', styleNotes: '', blocklist: '', scheduleOn: false, awayFrom: '22:00', awayTo: '09:00' });

  useEffect(() => {
    window.wa.listAccounts().then((list) => {
      setAccounts(list);
      if (list[0]) setActiveAcc(list[0].id);
      list.forEach((a) => window.wa.listMessages(a.id).then((m) => setMessages((s) => ({ ...s, [a.id]: m }))));
    });
    const offA = window.wa.onAccount((acc) =>
      setAccounts((s) => (s.some((x) => x.id === acc.id) ? s.map((x) => (x.id === acc.id ? acc : x)) : [...s, acc])));
    const offM = window.wa.onMessage(({ accountId, message }) => {
      setMessages((s) => ({ ...s, [accountId]: [...(s[accountId] || []), message] }));
      const c = cur.current;
      if (!message.fromMe && (accountId !== c.activeAcc || c.view !== 'inbox')) setUnread((u) => ({ ...u, [accountId]: (u[accountId] || 0) + 1 }));
    });
    window.wa.getSettings().then(setSettings);
    const tick = setInterval(() => window.wa.getSettings().then(setSettings), 60000);
    const offD = window.wa.onDraft((d) => setDrafts((s) => ({ ...s, [d.accountId + '|' + d.jid]: d })));
    return () => { offA(); offM(); offD(); clearInterval(tick); };
  }, []);

  cur.current = { activeAcc, view };
  useEffect(() => { if (view === 'inbox' && activeAcc) setUnread((u) => (u[activeAcc] ? { ...u, [activeAcc]: 0 } : u)); }, [view, activeAcc, messages]);

  const account = accounts.find((a) => a.id === activeAcc);

  // Chats of the selected account, newest first
  const chats = useMemo(() => {
    const map = new Map();
    for (const m of messages[activeAcc] || []) {
      const c = map.get(m.jid) || { jid: m.jid, name: null, last: m };
      if (!m.fromMe && m.name) c.name = m.name;
      c.last = m;
      map.set(m.jid, c);
    }
    return [...map.values()].sort((a, b) => b.last.ts - a.last.ts);
  }, [messages, activeAcc]);

  const thread = (messages[activeAcc] || []).filter((m) => m.jid === activeJid);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread.length, activeJid]);

  async function addAccount() {
    const label = window.prompt('Name for this account (e.g. Sales, Support)');
    if (label === null) return;
    const acc = await window.wa.addAccount(label.trim());
    setActiveAcc(acc.id);
  }

  async function removeAccount() {
    if (!account || !window.confirm(`Remove "${account.label}" and log it out of WhatsApp?`)) return;
    await window.wa.removeAccount(account.id);
    const rest = accounts.filter((a) => a.id !== account.id);
    setAccounts(rest); setActiveAcc(rest[0]?.id || null); setActiveJid(null);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !activeJid) return;
    setError('');
    try { await window.wa.send(activeAcc, activeJid, text); setDraft(''); }
    catch (e) { setError(e.message.replace(/^Error invoking remote method.*?Error: /, '')); }
  }

  const draftKey = activeAcc + '|' + activeJid;
  const aiDraft = drafts[draftKey];
  const setDraftText = (text) => setDrafts((s) => ({ ...s, [draftKey]: { ...aiDraft, text } }));
  const dropDraft = () => setDrafts((s) => { const n = { ...s }; delete n[draftKey]; return n; });
  async function sendDraft() {
    setError('');
    try { await window.wa.send(activeAcc, activeJid, aiDraft.text.trim()); dropDraft(); }
    catch (e) { setError(e.message.replace(/^Error invoking remote method.*?Error: /, '')); }
  }
  async function toggleAway() {
    if (!settings?.hasKey) { openSettings(); return; }
    setSettings(await window.wa.setSettings({ away: !settings.away }));
  }
  function openSettings() {
    setForm({ apiKey: '', styleNotes: settings?.styleNotes || '', blocklist: (settings?.blocklist || []).join(', '), scheduleOn: !!settings?.scheduleOn, awayFrom: settings?.awayFrom || '22:00', awayTo: settings?.awayTo || '09:00' });
    setShowSettings(true);
  }
  async function saveSettings() {
    const blocklist = form.blocklist.split(',').map((x) => x.trim()).filter(Boolean);
    setSettings(await window.wa.setSettings({ apiKey: form.apiKey, styleNotes: form.styleNotes, blocklist, scheduleOn: form.scheduleOn, awayFrom: form.awayFrom, awayTo: form.awayTo }));
    setShowSettings(false);
  }

  const phoneOf = (jid) => '+' + jid.split('@')[0];

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <aside className="side">
        <div className="brand">
          <span className="logo">W</span><b className="txt">WA Manager</b>
          <button className="icon" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}><Icon n="panel" /></button>
        </div>
        <button className="newacc" onClick={addAccount}><Icon n="plus" /><span className="txt">Add account</span></button>
        <nav>
          <button className={'item' + (view === 'inbox' ? ' on' : '')} onClick={() => setView('inbox')}><Icon n="inbox" /><span className="txt">Inbox</span></button>
          <button className={'item' + (view === 'outreach' ? ' on' : '')} onClick={() => setView('outreach')}><Icon n="send" /><span className="txt">Outreach</span></button>
        </nav>
        <p className="label txt">Accounts</p>
        <div className="list">
          {accounts.map((a) => (
            <button key={a.id} className={'item' + (a.id === activeAcc && view === 'inbox' ? ' on' : '')} title={a.label}
              onClick={() => { setActiveAcc(a.id); setActiveJid(null); setView('inbox'); }}>
              <span className={'dot ' + a.status} />
              <span className="grow txt"><b>{a.label}</b><small>{a.phone ? '+' + a.phone : STATUS[a.status]}</small></span>
              {unread[a.id] > 0 && <span className="badge">{unread[a.id]}</span>}
            </button>
          ))}
          {accounts.length === 0 && <p className="hint txt">No accounts yet.</p>}
        </div>
        <div className="foot">
          <button className="item" onClick={toggleAway} title="Away mode"><Icon n="moon" /><span className="txt grow">Away mode</span>
            <span className={'switch txt' + (settings?.awayNow ? ' on' : '')} role="switch" aria-checked={!!settings?.awayNow} /></button>
          <button className="item" onClick={openSettings}><Icon n="sliders" /><span className="txt">Settings</span></button>
        </div>
      </aside>

      {view === 'outreach' ? <Outreach accounts={accounts} /> : (<>
      <section className="chats">
        <header><h2>{account ? account.label : 'Inbox'}</h2>
          {account && <button className="link" onClick={removeAccount}>Remove</button>}</header>
        {account?.status === 'qr' && (
          <div className="qr"><img src={account.qr} alt="WhatsApp QR code" />
            <p>On your phone: WhatsApp, Linked devices, Link a device, then scan this code.</p></div>
        )}
        {account && account.status !== 'qr' && chats.length === 0 && (
          <p className="empty">{account.status === 'connected' ? 'No messages yet. New chats show up here as they arrive.' : STATUS[account.status] + '…'}</p>
        )}
        {chats.map((c) => (
          <button key={c.jid} className={'chat' + (c.jid === activeJid ? ' on' : '')} onClick={() => setActiveJid(c.jid)}>
            <b>{c.name || phoneOf(c.jid)}</b>
            <small>{c.last.fromMe ? 'You: ' : ''}{c.last.text}</small>
          </button>
        ))}
        {!account && <p className="empty">Add an account to begin.</p>}
      </section>

      <main className="thread">
        {!activeJid ? <p className="empty center">Select a chat</p> : (<>
          <header><h2>{chats.find((c) => c.jid === activeJid)?.name || phoneOf(activeJid)}</h2><small>{phoneOf(activeJid)}</small></header>
          <div className="bubbles">
            {thread.map((m) => (
              <div key={m.id} className={'bubble ' + (m.fromMe ? 'me' : 'them')}>
                {m.text}<time>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {aiDraft && (
            <div className={'draft ' + aiDraft.status}>
              <b>{{ ready: 'AI draft', writing: 'Writing a draft…', needs_you: 'Needs you', error: 'Draft failed' }[aiDraft.status]}</b>
              {aiDraft.reason && <p>{aiDraft.reason}</p>}
              {aiDraft.status === 'ready' && (<>
                <textarea rows={3} value={aiDraft.text} onChange={(e) => setDraftText(e.target.value)} />
                <div className="actions"><button onClick={sendDraft} disabled={!aiDraft.text.trim() || account?.status !== 'connected'}>Send</button>
                  <button className="ghost" onClick={dropDraft}>Discard</button></div>
              </>)}
              {aiDraft.status !== 'ready' && aiDraft.status !== 'writing' && <button className="ghost" onClick={dropDraft}>Dismiss</button>}
            </div>
          )}
          {!aiDraft && settings?.hasKey && <button className="link suggest" onClick={() => window.wa.suggest(activeAcc, activeJid)}>Suggest reply</button>}
          {error && <p className="error">{error}</p>}
          <footer>
            <textarea rows={2} value={draft} placeholder="Write a message"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button onClick={send} disabled={!draft.trim() || account?.status !== 'connected'}>Send</button>
          </footer>
        </>)}
      </main>
      </>)}
      {showSettings && (
        <div className="modal" onClick={() => setShowSettings(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>Settings</h2>
            <label>Claude API key
              <input type="password" value={form.apiKey} placeholder={settings?.hasKey ? 'Saved. Leave empty to keep it.' : 'sk-ant-…'}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></label>
            <label>How you write (optional)
              <textarea rows={3} value={form.styleNotes} placeholder="Short, friendly, Roman Urdu + English mix, few emojis"
                onChange={(e) => setForm({ ...form, styleNotes: e.target.value })} /></label>
            <label>Never draft for these numbers (comma separated)
              <input value={form.blocklist} placeholder="923001234567, 393491234567"
                onChange={(e) => setForm({ ...form, blocklist: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={form.scheduleOn} onChange={(e) => setForm({ ...form, scheduleOn: e.target.checked })} />
              Turn Away mode on automatically every day</label>
            {form.scheduleOn && <div className="times">
              <label>From<input type="time" value={form.awayFrom} onChange={(e) => setForm({ ...form, awayFrom: e.target.value })} /></label>
              <label>Until<input type="time" value={form.awayTo} onChange={(e) => setForm({ ...form, awayTo: e.target.value })} /></label>
            </div>}
            <p className="hint">Only the last 15 messages of a chat and some of your past messages are sent to Claude when a draft is made. Drafts about money, prices or appointments are skipped.</p>
            <div className="actions"><button onClick={saveSettings}>Save</button><button className="ghost" onClick={() => setShowSettings(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

const PATHS = {
  panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  inbox: <><path d="M3 13l3-8h12l3 8" /><path d="M3 13v6h18v-6h-5l-1 2h-6l-1-2z" /></>,
  send: <><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
};
function Icon({ n }) {
  return <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[n]}</svg>;
}
