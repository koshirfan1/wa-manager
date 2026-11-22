import { useEffect, useMemo, useRef, useState } from 'react';

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

  useEffect(() => {
    window.wa.listAccounts().then((list) => {
      setAccounts(list);
      if (list[0]) setActiveAcc(list[0].id);
      list.forEach((a) => window.wa.listMessages(a.id).then((m) => setMessages((s) => ({ ...s, [a.id]: m }))));
    });
    const offA = window.wa.onAccount((acc) =>
      setAccounts((s) => (s.some((x) => x.id === acc.id) ? s.map((x) => (x.id === acc.id ? acc : x)) : [...s, acc])));
    const offM = window.wa.onMessage(({ accountId, message }) =>
      setMessages((s) => ({ ...s, [accountId]: [...(s[accountId] || []), message] })));
    return () => { offA(); offM(); };
  }, []);

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

  const phoneOf = (jid) => '+' + jid.split('@')[0];

  return (
    <div className="app">
      <aside className="accounts">
        <h1>Accounts</h1>
        {accounts.map((a) => (
          <button key={a.id} className={'acc' + (a.id === activeAcc ? ' on' : '')}
            onClick={() => { setActiveAcc(a.id); setActiveJid(null); }}>
            <span className={'dot ' + a.status} />
            <span className="acc-text"><b>{a.label}</b><small>{a.phone ? '+' + a.phone : STATUS[a.status]}</small></span>
          </button>
        ))}
        <button className="add" onClick={addAccount}>Add account</button>
      </aside>

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
          {error && <p className="error">{error}</p>}
          <footer>
            <textarea rows={2} value={draft} placeholder="Write a message"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button onClick={send} disabled={!draft.trim() || account?.status !== 'connected'}>Send</button>
          </footer>
        </>)}
      </main>
    </div>
  );
}
