// Ahead for Banks — console de démo côté banque.
// Même moteur que l'app (engine.js) : Alexandre est le client « live », lu dans Nessie toutes les 3 s.
// Les autres clients sont fictifs (portefeuille de démo) et servent à montrer l'angle mort des scores classiques.
const FEE = OVERDRAFT_FEE;
const PORTFOLIO = [
  { name: 'Jordan Reyes', kind: 'Salary · bi-weekly', classic: ['Low risk', 'ok'], days: 3, why: 'Car repair, then rent before payday', action: 'Shift phone bill by 5 days', status: 'Awaiting consent', impact: FEE },
  { name: 'Priya Nair', kind: 'Salary · monthly', classic: ['Low risk', 'ok'], days: 9, why: 'Card payment lands before salary', action: 'Move $240 from savings', status: 'Awaiting consent', impact: FEE },
  { name: 'Sam Okafor', kind: 'Student · part-time', classic: ['Medium risk', 'mid'], days: 13, why: 'Tuition installment', action: '$150 advance, no fee', status: 'Offered', impact: FEE },
  { name: 'Chris Morgan', kind: 'Gig · delivery', classic: ['High risk', 'bad'], days: 38, why: 'Quarterly taxes not set aside', action: 'Start a tax jar', status: 'Suggested', impact: 0 },
  { name: 'Maria Chen', kind: 'Gig · rideshare', classic: ['High risk', 'bad'], days: 99, why: 'Irregular but well cushioned', action: 'Pre-approve a $500 buffer line', status: 'Growth offer', impact: 0 },
  { name: 'Dev Patel', kind: 'Freelance · design', classic: ['High risk', 'bad'], days: 99, saved: true, why: 'Shortfall prevented this morning', action: 'Moved $310 from savings', status: 'Approved 8:12 AM', impact: FEE },
  { name: 'Lena Brooks', kind: 'Salary · bi-weekly', classic: ['Low risk', 'ok'], days: 99, why: 'No shortfall in 45 days', action: 'None needed', status: '', impact: 0 },
];
const daysTxt = d => d >= 46 ? '45+' : String(d);
let savedAt = null, lastStatus = null, synced = null;

// --- Journal des appels Nessie (preuve visible pour le track Capital One) ---
const LOGN = [];
const short = p => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, m => m.slice(0, 4) + '…');
function nlog(method, path, ok, note) {
  LOGN.unshift({ at: new Date(), method, path: short(path), ok, note });
  LOGN.length = Math.min(LOGN.length, 14);
  $('nlog').innerHTML = LOGN.map(e => `<li><span class="m ${e.method.toLowerCase()}">${e.method}</span><span class="p">${e.path}<small>${e.note || ''}</small></span><span class="s ${e.ok ? 'ok' : 'err'}">${e.ok ? '200' : 'ERR'}</span></li>`).join('');
}
async function call(path, method = 'GET', body, note) {
  try { const r = await nessie(path, method, body); nlog(method, path, true, note); return r; }
  catch (e) { nlog(method, path, false, note || String(e.message)); throw e; }
}

// --- État d'Alexandre, calculé par le même moteur que son téléphone ---
function alex() {
  const w = S.delay.weeks, m = metrics(w);
  const status = m.riskE ? 'risk' : APPLIED > 0 ? 'saved' : 'calm';
  if (status === 'saved' && lastStatus === 'risk') savedAt = new Date();
  if (status !== lastStatus && lastStatus !== null) nlog('GET', `/accounts/${status === 'saved' ? SV + '/transfers' : CH + '/deposits'}`, true,
    status === 'risk' ? `Delayed payment detected (+${w} weeks)` : status === 'saved' ? `Customer transfer ${usd(APPLIED)} detected` : 'Back to normal');
  lastStatus = status;
  const bill = (m.fe.bills.find(b => b.i === m.daysAhead) || {}).name || 'a bill';
  return { w, m, status, bill, days: m.capped ? 99 : m.daysAhead };
}

function render() {
  const a = alex(), m = a.m;
  // Projecteur sur le client live
  const exp = metrics(0), expDate = exp.fe.out[Math.min(exp.fe.first, HORIZON)].date;
  const spot = {
    calm: { tone: 'calm', big: `${daysTxt(a.days)} days ahead`, line: 'Income is irregular, but predictable. No shortfall in the next 45 days.',
      action: 'None needed', foot: 'Ahead keeps watching. The phone and this console read the same Nessie data.' },
    risk: { tone: 'risk', big: `${a.days} days`, line: `before ${a.bill.toLowerCase()} overdraws checking (${nice(m.minE.date)}: ${usd(m.minE.bal)}). Elite Frame client paying ${a.w} weeks late: expected ${nice(expDate)}, now ${nice(S.delay.date || expDate)}.`,
      action: `Move ${usd(m.need)} from savings to checking`, foot: '<span class="wait"><i></i><i></i><i></i></span> Ahead asked Alexandre in the app. Waiting for his approval…' },
    saved: { tone: 'saved', big: `${usd(FEE)} fee avoided`, line: `Shortfall prevented ${savedAt ? 'at ' + savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'earlier today'}, weeks before it happened. Customer kept.`,
      action: `Moved ${usd(APPLIED)} from savings · approved by Alexandre`, foot: 'Transfer recorded in Nessie. No overdraft, no collections call, no churn.' },
  }[a.status];
  $('spot').className = 'card bk-spot ' + spot.tone;
  $('spot').innerHTML = `<div class="bk-who"><img src="assets/alexandre.jpg" alt=""><div><b>Alexandre</b><small>Freelance · video &amp; tennis coaching</small></div><span class="live"><i></i>LIVE · Nessie</span></div>
    <div class="bk-vs"><div><p class="label">Classic view</p><p class="chip bad">High risk · irregular deposits</p></div><div><p class="label">Ahead view</p><p class="bk-big">${spot.big}</p></div></div>
    <p class="bk-line">${spot.line}</p>
    <div class="bk-act"><span class="label">Next best action</span><b>${spot.action}</b></div>
    <p class="muted small">${spot.foot}</p>`;
  // Tableau trié par jours avant le manque
  const rows = [...PORTFOLIO, { name: 'Alexandre', live: true, kind: 'Freelance · video & tennis', classic: ['High risk', 'bad'], days: a.status === 'saved' ? 99 : a.days, saved: a.status === 'saved',
    why: a.status === 'risk' ? `Client ${a.w} weeks late` : a.status === 'saved' ? 'Shortfall prevented just now' : 'Irregular but predictable',
    action: a.status === 'risk' ? `Move ${usd(m.need)} from savings` : a.status === 'saved' ? `Moved ${usd(APPLIED)} from savings` : 'None needed',
    status: a.status === 'risk' ? 'Asked in app' : a.status === 'saved' ? 'Approved in app' : '', impact: a.status === 'calm' ? 0 : FEE }]
    .sort((x, y) => (x.saved - y.saved) || (x.days - y.days));
  $('rows').innerHTML = rows.map(r => {
    const tone = r.saved ? 'saved' : r.days <= 14 ? 'risk' : r.days <= 45 ? 'watch' : 'ok';
    const view = r.saved ? 'Saved' : r.days <= 45 ? `Shortfall in ${r.days} days` : 'On track';
    return `<tr class="${r.live ? 'is-live ' : ''}${tone}"><td><b>${r.name}</b>${r.live ? '<span class="live sm"><i></i>LIVE</span>' : ''}<small>${r.why}</small></td>
      <td>${r.kind}</td><td><span class="chip ${r.classic[1]}">${r.classic[0]}</span></td>
      <td><span class="chip v-${tone}">${view}</span></td><td>${r.action}<small>${r.status}</small></td>
      <td class="num">${r.impact ? (r.saved ? '+' : '') + usd(r.impact) + `<small>${r.saved ? 'fee avoided' : 'fee at risk'}</small>` : '—'}</td></tr>`;
  }).join('');
  // Indicateurs
  const open = rows.filter(r => !r.saved && r.days <= 45), saved = rows.filter(r => r.saved);
  const k = [['Customers monitored', rows.length, 'demo portfolio'], ['Shortfalls predicted', open.length, 'next 45 days'],
    ['Average warning', open.length ? Math.round(open.reduce((s, r) => s + r.days, 0) / open.length) + ' days' : '—', 'before the shortfall'],
    ['Fees avoided today', usd(saved.reduce((s, r) => s + r.impact, 0)), `${saved.length} customer${saved.length > 1 ? 's' : ''} kept`]];
  $('kpis').innerHTML = k.map(([n, v, s], i) => `<div class="card bk-kpi ${i === 3 ? 'win' : ''}"><p class="label">${n}</p><b>${v}</b><small>${s}</small></div>`).join('');
  $('lateBtn').disabled = a.w > 0;
  $('lateBtn').textContent = a.w > 0 ? `Event sent: client ${a.w} weeks late` : 'Elite Frame client pays 3 weeks late';
}

// --- Événement de démo : le client d'Alexandre paie 3 semaines en retard (vrai dépôt « pending » dans Nessie) ---
$('lateBtn').onclick = async () => {
  $('lateBtn').disabled = true;
  const m0 = metrics(0), exp = m0.fe.out[Math.min(m0.fe.first, HORIZON)].date, delayed = iso(new Date(Date.parse(exp) + 21 * DAY));
  try {
    await call(`/accounts/${CH}/deposits`, 'POST', { medium: 'balance', transaction_date: delayed, status: 'pending', amount: Math.round(m0.M.a.expected), description: 'Delayed payment - Elite Frame client (+3 weeks)' }, `Expected payment moved to ${nice(delayed)}`);
  } catch { $('lateBtn').disabled = false; return; }
  await tick();
};
$('bkReset').onclick = async () => {
  $('bkReset').disabled = true;
  try {
    const [d, t] = await Promise.all([call(`/accounts/${CH}/deposits`), call(`/accounts/${SV}/transfers`)]);
    for (const x of d.filter(isDelay)) await call(`/deposits/${x._id}`, 'DELETE', null, 'Remove delayed payment');
    for (const x of t.filter(isPrevent)) await call(`/transfers/${x.id || x._id}`, 'DELETE', null, 'Remove demo transfer');
  } catch {}
  savedAt = null; await tick(); $('bkReset').disabled = false;
};

// --- Relecture toutes les 3 s ---
async function tick() {
  try { await sync(); synced = new Date(); $('pulse').className = 'pulse on'; }
  catch { $('pulse').className = 'pulse off'; }
  $('syncTxt').textContent = synced ? `Phone ↔ Nessie ↔ Bank · synced ${synced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'Nessie unreachable · demo data';
  render();
}
load().then(ok => {
  nlog('GET', `/customers/${CUSTOMER}/accounts`, ok, ok ? 'Portfolio loaded' : 'Offline: simulated data');
  lastStatus = null; render(); lastStatus = alex().status;
  if (ok) { tick(); setInterval(() => { if (!document.hidden) tick(); }, 3000); }
});
