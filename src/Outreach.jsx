import { useEffect, useState } from 'react';

const KIND = { sent: 'Sent', invalid: 'Invalid', reply: 'Reply', optout: 'Opt-out', error: 'Error' };

export default function Outreach({ accounts }) {
  const [st, setSt] = useState(null);
  const [f, setF] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    window.wa.outreachGet().then((s) => { setSt(s); setF({ ...s.settings, tabs: s.settings.tabs.join(', '), serviceKey: '' }); });
    return window.wa.onOutreach(setSt);
  }, []);
  if (!st || !f) return null;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });
  const payload = (extra = {}) => ({
    ...f, tabs: f.tabs.split(',').map((t) => t.trim()).filter(Boolean), ...extra,
  });
  async function save(extra) {
    setMsg('');
    try { const s = await window.wa.outreachSet(payload(extra)); setSt(s); setF((x) => ({ ...x, serviceKey: '' })); setMsg('Saved'); }
    catch (e) { setMsg(e.message.replace(/^Error invoking remote method.*?Error: /, '')); }
  }
  async function showPreview() {
    setMsg(''); setPreview(null);
    try { await save(); setPreview(await window.wa.outreachPreview()); }
    catch (e) { setMsg(e.message.replace(/^Error invoking remote method.*?Error: /, '')); }
  }

  const running = st.settings.enabled;
  const next = st.nextAt > Date.now() ? new Date(st.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section className="outreach">
      <header><h2>Daily outreach</h2>
        <button className={running ? 'ghost' : ''} onClick={() => save({ enabled: !running })}>{running ? 'Pause' : 'Start'}</button></header>
      <div className="pad">
        <p className="stats"><b>{st.sentToday} of {st.cap}</b> sent today{next && <> · next around <b>{next}</b></>}{st.queue > 0 && <> · {st.queue} waiting in queue</>}</p>
        {st.note && <p className="hint">{running ? st.note : 'Paused'}</p>}
        <p className="hint">New accounts start at 3 a day, then 5, then your daily limit, to keep the number safe.</p>

        <h3>Google Sheet</h3>
        <label>Sheet link<input value={f.sheetId} onChange={set('sheetId')} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
        <label>Tabs to use (comma separated)<input value={f.tabs} onChange={set('tabs')} /></label>
        <label>Service account key (JSON)<textarea rows={3} value={f.serviceKey} onChange={set('serviceKey')}
          placeholder={st.hasKey ? 'Saved. Paste a new key to replace it.' : 'Paste the downloaded JSON key here'} /></label>
        {st.serviceEmail && <p className="hint">Share the sheet with <b>{st.serviceEmail}</b> as Editor so the app can update the Status column.</p>}

        <h3>Sending</h3>
        <label>Send from account
          <select value={f.accountId} onChange={set('accountId')}><option value="">Choose an account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <div className="grid">
          <label>Daily limit<input type="number" min="1" max="30" value={f.dailyCap} onChange={num('dailyCap')} /></label>
          <label>Start hour<input type="number" min="0" max="23" value={f.startHour} onChange={num('startHour')} /></label>
          <label>End hour<input type="number" min="1" max="24" value={f.endHour} onChange={num('endHour')} /></label>
          <label>Min gap (min)<input type="number" min="1" value={f.minGap} onChange={num('minGap')} /></label>
          <label>Max gap (min)<input type="number" min="1" value={f.maxGap} onChange={num('maxGap')} /></label>
          <label>Time zone of clinics<input value={f.timezone} onChange={set('timezone')} /></label>
        </div>

        <h3>Message</h3>
        <label>Your business name<input value={f.sender} onChange={set('sender')} placeholder="e.g. Acme Digital" /></label>
        <label>What you offer, in one sentence (written in the clinics' language)<input value={f.service} onChange={set('service')} /></label>
        <label>Message versions, separated by a line with ---<textarea rows={6} value={f.templates} onChange={set('templates')} /></label>
        <p className="hint">Variables: {'{clinic} {city} {sender} {service}'}. Keep the STOP line: anyone who replies STOP is skipped for good.</p>

        <div className="actions"><button onClick={() => save()}>Save</button><button className="ghost" onClick={showPreview}>Preview next messages</button>{msg && <span className="hint">{msg}</span>}</div>
        {preview && (preview.length === 0 ? <p className="hint">No sendable rows found. Rows need Status "Not contacted", WhatsApp works "WA WOrking" and a WhatsApp link.</p>
          : preview.map((p) => <div key={p.number} className="pv"><b>{p.clinic} (+{p.number})</b><p>{p.text}</p></div>))}

        <h3>Activity</h3>
        {st.log.length === 0 && <p className="hint">Nothing yet.</p>}
        {st.log.map((l, i) => <p key={i} className={'log ' + l.kind}><b>{KIND[l.kind]}</b> {l.text}<time>{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></p>)}
      </div>
    </section>
  );
}
