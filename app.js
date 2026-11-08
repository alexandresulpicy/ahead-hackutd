// Ahead — interface : écrans, graphique, onboarding, notification, coach
const LOGO = '<img src="assets/logo-192.jpg" alt="" style="width:36px;height:36px;border-radius:10px;flex:none">';
const TITLES = { today: 'Today', plan: 'What-if', whole: 'Whole picture', autopilot: 'Autopilot', coach: 'Coach', activity: 'Activity' };
let view = 'today';

function show(v) {
  if (!TITLES[v]) v = 'today';
  view = v;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 'screen-' + v));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('title').textContent = TITLES[v];
  const hr = new Date().getHours();
  $('hello').textContent = (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + ', Alexandre';
  try { history.replaceState(null, '', '#' + v); } catch {}
  window.scrollTo(0, 0);
  requestAnimationFrame(drawChart);
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

// --- Rendu ---
function render() {
  const late = +$('late').value; $('lateVal').textContent = late; $('lateVal').nextSibling.textContent = late === 1 ? ' week late' : ' weeks late';
  const m = metrics(late);
  countTo(m.safe);
  $('days').textContent = m.daysAhead + (m.capped ? '+' : '');
  $('daysSub').textContent = m.capped ? 'no shortfall projected in the next 45 days' : 'until checking runs short if nothing changes';
  renderWhatIf(m, late);
  $('acctCh').textContent = usd(S.checking); $('acctSv').textContent = usd(S.savings);
  $('buckets').innerHTML = [[`Taxes (${Math.round(PREFS.taxRate * 100)}%)`, m.tax], ['Bills before next pay', m.billsDue], ['Free', m.free]]
    .map(([n, v]) => `<div class="bucket">${n}<b>${usd(v)}</b></div>`).join('');
  const risk = m.riskE; // alerte seulement si le cas attendu passe en négatif (base calme)
  $('alert').hidden = !risk && $('done').hidden;
  if (risk) $('done').hidden = true;
  $('alert').classList.toggle('is-done', !risk && !$('done').hidden);
  $('alert').classList.toggle('is-risk', !m.riskE && !!m.riskC);
  $('alertLabel').textContent = risk ? (m.riskE ? 'Overdraft predicted' : 'At risk') : 'All clear';
  $('alertText').textContent = m.riskE
    ? `Checking is projected at ${usd(m.minE.bal)} on ${nice(m.minE.date)}. Without action: about ${usd(OVERDRAFT_FEE)} in overdraft fees.`
    : m.riskC ? `If your next payment is as late as your slowest (${nice(m.fc.out[Math.min(m.daysToIncome, HORIZON)].date)}), checking hits ${usd(m.minC.bal)} on ${nice(m.minC.date)}.`
    : 'No overdraft in the next 45 days, even if your next payment is late.';
  $('alertSub').textContent = risk ? `Prevent it moves ${usd(m.need)} from savings now, enough even on the cautious timeline.` : '';
  $('alertSub').hidden = !risk;
  $('prevent').hidden = !risk; $('prevent').disabled = false;
  const spend = dailySpend(), monthSpend = spend * 30 + S.bills.reduce((s, b) => s + b.payment_amount, 0);
  $('health').innerHTML = [['Savings rate', Math.max(0, Math.round((m.M.monthIncome - monthSpend) / m.M.monthIncome * 100)) + '%'],
    ['Reserve', (m.liquid / monthSpend).toFixed(1) + ' mo'], ['Debt / income', Math.round(S.debt / m.M.monthIncome * 100) + '%']]
    .map(([n, v]) => `<div>${n}<b>${v}</b></div>`).join('');
  renderNextPay(m);
  renderActivity();
  renderWhole();
  updateBadge();
  renderAutopilot(m);
  setChart(m);
  return m;
}
function renderWhatIf(m, late) {
  $('lateChips').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.w === late));
  const low = m.minC.bal, fee = m.riskC ? OVERDRAFT_FEE : 0;
  $('whatifOut').innerHTML = [['Days Ahead', m.daysAhead + (m.capped ? '+' : '')], ['Lowest balance', `<span class="${low < 0 ? 'bad' : ''}">${usd(low)}</span>`], ['Fees at risk', usd(fee)]]
    .map(([n, v]) => `<div>${n}<b>${v}</b></div>`).join('');
  $('whatifText').textContent = late === 0 ? 'Your client pays on their usual rhythm. Drag to see how a late payment changes your runway.'
    : m.riskC ? `If they pay ${late} week${late > 1 ? 's' : ''} late, checking drops to ${usd(low)} on ${nice(m.minC.date)}. Ahead would warn you ${m.daysAhead} days before.`
    : `Even ${late} week${late > 1 ? 's' : ''} late, you stay above zero. Ahead keeps you ${m.daysAhead}${m.capped ? '+' : ''} days ahead.`;
}
function renderNextPay(m) {
  const day = f => f.out[Math.min(f.first, HORIZON)].date, span = Math.max(30, m.fc.first + 3), pct = d => Math.min(100, d / span * 100);
  $('nextPay').innerHTML = `<div class="when">${nice(day(m.fe))}</div>
    <div class="rng">Could land as early as ${nice(day(m.ff))}, or as late as ${nice(day(m.fc))}. Typically ${usd(m.M.a.expected)}.</div>
    <div class="bar"><i style="left:${pct(m.ff.first)}%;width:${Math.max(2, pct(m.fc.first) - pct(m.ff.first))}%"></i><b style="left:${pct(m.fe.first)}%"></b></div>
    <div class="ends"><span>Today</span><span>+${span} days</span></div>`;
}
// --- Comptes : liste cliquable et fiche détaillée ---
const mask = n => '•••• ' + String(n || '').slice(-4);
function accountList() {
  const num = t => (S.accts || []).find(x => x.type === t)?.account_number;
  const l = t => S.loans.find(x => x.type === t);
  return [
    { id: 'checking', name: 'Checking', sub: mask(num('Checking') || ACCT_NUM.checking), ico: '◎', bal: S.checking },
    { id: 'savings', name: 'Savings', sub: mask(num('Savings') || ACCT_NUM.savings), ico: '◈', bal: S.savings },
    ...LINKED.map(a => ({ id: a.type.toLowerCase(), name: a.name, sub: 'Linked account', ico: a.type === 'IRA' ? '☼' : '▣', bal: a.balance })),
    { id: 'card', name: 'Visa card', sub: mask(num('Credit Card') || ACCT_NUM.card), ico: '▭', bal: S.debt, debt: true },
    ...S.loans.map(x => ({ id: 'loan-' + x.type, name: x.type === 'auto' ? 'Auto loan' : x.type === 'student' ? 'Student loan' : 'Loan', sub: usd(x.monthly_payment) + ' / month', ico: x.type === 'auto' ? '⛟' : '✎', bal: x.amount, debt: true })),
  ];
}
function renderAccounts() {
  const row = x => `<button class="ac ${x.debt ? 'debt' : ''}" data-acct="${x.id}"><span class="ico">${x.ico}</span><span class="nm">${x.name}<small>${x.sub}</small></span><span class="bal">${x.debt ? '-' : ''}${usd(x.bal)}</span></button>`;
  const all = accountList();
  $('acctStrip').innerHTML = all.filter(x => ['checking', 'savings', 'card'].includes(x.id)).map(row).join('') + `<button class="link" data-view="whole" style="margin:6px auto 0">See all ${all.length} accounts</button>`;
  $('acctStrip').querySelector('[data-view]').onclick = () => show('whole');
}
function openAccount(id) {
  const x = accountList().find(a => a.id === id); if (!x) return;
  const tx = txAll(), li = (t, s, v, c = '') => `<li><span class="t">${t}<small>${s}</small></span><span class="a ${c}">${v}</span></li>`;
  let body = '', note = x.sub;
  if (id === 'checking') {
    note = 'Where your clients pay you. Updated live from Nessie.';
    body = [...tx].sort((p, q) => (q.upcoming ? 1 : 0) - (p.upcoming ? 1 : 0) || q.date.localeCompare(p.date)).slice(0, 14).map(t => li(t.label, t.upcoming ? 'Upcoming · ' + nice(t.date) : nice(t.date), (t.amt > 0 ? '+' : '-') + usd(Math.abs(t.amt)), t.amt > 0 ? 'in' : '')).join('');
  } else if (id === 'savings') {
    note = 'Your cushion. Ahead only moves it before an overdraft, never your tax jar.';
    body = li('Tax jar', 'Protected', usd(ENV.tax)) + li('Bills envelope', 'Protected', usd(ENV.bills)) + li('Free to use', 'Can cover a shortfall', usd(freeSavings()), 'in')
      + LOG.filter(e => e.k === 'move').slice(0, 5).map(e => li(e.t, e.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), '')).join('');
  } else if (id === 'card') {
    note = 'Minimum payment ' + usd(CARD_MIN.amt) + ' on the ' + CARD_MIN.day + 'nd of each month.';
    body = li('Balance', 'Owed today', usd(S.debt)) + li('Minimum payment', 'Next: ' + nice('2026-11-' + CARD_MIN.day), usd(CARD_MIN.amt)) + li('Debt vs. income', 'Of one month of income', Math.round(S.debt / incomeModel().monthIncome * 100) + '%');
  } else if (id.startsWith('loan-')) {
    const l = S.loans.find(z => z.type === id.slice(5));
    note = l.description;
    body = li('Remaining', 'Principal', usd(l.amount)) + li('Monthly payment', 'Due on the ' + LOAN_DAY[l.type] + 'th', usd(l.monthly_payment)) + li('Months left', 'At this pace', Math.ceil(l.amount / l.monthly_payment) + ' mo');
  } else {
    note = 'Linked manually: Nessie has no CD or IRA, so Ahead tracks it with you.';
    body = li('Balance', 'As entered', usd(x.bal), 'in') + li('Status', 'Not touched by Ahead', 'Locked');
  }
  $('sheetCard').innerHTML = `<div class="sh-head"><div><h3>${x.name}</h3><small>${x.sub}</small></div><button class="sh-x" data-close aria-label="Close">×</button></div>
    <p class="sh-big">${x.debt ? '-' : ''}${usd(x.bal)}</p><p class="sh-note">${note}</p><ul class="activity">${body}</ul>`;
  $('sheet').hidden = false;
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-acct]'); if (c) return openAccount(c.dataset.acct);
  if (e.target.closest('[data-close]')) $('sheet').hidden = true;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('sheet').hidden = true; });
function updateBadge() {
  if (!live) return;
  const s = endpointStats(); $('mode').textContent = `Nessie live · ${s.count} endpoints`;
}
function openEndpoints() {
  const s = endpointStats(), row = x => `<li><span class="t"><code>${x.k.replace(/^(\w+) (.*)$/, '<b>$1</b> $2')}</code></span><span class="a">${x.n}×</span></li>`;
  $('sheetCard').innerHTML = `<div class="sh-head"><div><h3>Capital One Nessie</h3><small>Endpoints Ahead really calls</small></div><button class="sh-x" data-close aria-label="Close">×</button></div>
    <p class="sh-big">${s.count} endpoints</p><p class="sh-note">${s.calls} calls so far in this session: accounts, deposits, purchases, merchants, bills, loans and transfers, read live and written back.</p><ul class="activity">${s.list.map(row).join('')}</ul>`;
  $('sheet').hidden = false;
}
$('mode').onclick = () => { if (live) openEndpoints(); };
function renderWhole() {
  renderAccounts();
  const w = wholePicture(), idOf = n => ({ Checking: 'checking', Savings: 'savings', '12-month CD': 'cd', 'Roth IRA': 'ira', 'Visa card': 'card', 'Auto loan': 'loan-auto', 'Federal student loan': 'loan-student' })[n], row = (n, sub, v, cls = '') => `<li ${idOf(n) ? `class="clickable" data-acct="${idOf(n)}"` : ''}><span class="t">${n}<small>${sub}</small></span><span class="a ${cls}">${v}</span></li>`;
  $('net').textContent = usd(w.net);
  $('netSub').textContent = `${usd(w.A)} owned, ${usd(w.D)} owed, across ${w.assets.length + w.debts.length} accounts`;
  $('assets').innerHTML = w.assets.map(([n, v, src]) => row(n, src, usd(v), 'in')).join('');
  $('debts').innerHTML = w.debts.map(([n, v, src, t]) => row(n, `${t} · ${src}`, usd(v))).join('');
  $('duesSub').textContent = `${usd(w.dueTotal)} due in total: bills, loans and card.`;
  $('dues').innerHTML = w.dues.map(d => row(d.name, `${nice(d.date)} · ${d.kind}`, '-' + usd(d.amt))).join('');
}
function renderMerchants() {
  const from = +TODAY - 60 * DAY, by = {};
  S.purchases.filter(p => Date.parse(p.purchase_date) >= from).forEach(p => { const n = merchantFor(p.description); (by[n] = by[n] || { n, cat: p.description, amt: 0, v: 0 }); by[n].amt += p.amount; by[n].v++; });
  const rows = Object.values(by).sort((x, y) => y.amt - x.amt), max = rows[0] ? rows[0].amt : 1;
  $('merch').innerHTML = rows.map(r => `<div class="mrow"><div><b>${r.n}</b><small>${r.cat} · ${r.v} visit${r.v > 1 ? 's' : ''}</small></div><div class="mbar"><i style="width:${r.amt / max * 100}%"></i></div><span class="mamt">${usd(r.amt)}</span></div>`).join('');
}
function renderActivity() {
  renderMerchants();
  const all = txAll(), up = all.filter(t => t.upcoming), past = all.filter(t => !t.upcoming).sort((a, b) => b.date.localeCompare(a.date));
  $('activity').innerHTML = [...up, ...past].map(t => `<li><span class="tag">${t.tag}</span><span class="t">${t.label}<small>${t.upcoming ? 'Upcoming' : (t.cat ? t.cat + ' · ' : '') + t.date}</small></span><span class="a ${t.amt > 0 ? 'in' : ''}">${t.amt > 0 ? '+' : '-'}${usd(Math.abs(t.amt))}</span></li>`).join('');
}

// Compteur animé du chiffre principal
let shown = 0, raf;
function countTo(v) {
  cancelAnimationFrame(raf);
  const from = shown, t0 = performance.now();
  const step = t => {
    const k = still ? 1 : Math.min(1, (t - t0) / 260), e = 1 - Math.pow(1 - k, 3);
    shown = from + (v - from) * e; $('safe').textContent = usd(shown);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

// --- Graphique : fourchette de 3 scénarios, interpolation fluide, échelle fixe, survol ---
let meta = null, cur = null, sc = scale(), chartRaf, hover = null;
function setChart(m) {
  sc = scale();
  const E = m.fe.out.map(p => p.bal), C = m.fc.out.map(p => p.bal), F = m.ff.out.map(p => p.bal);
  meta = { dates: m.fe.out.map(p => p.date), bills: m.fe.bills, inc: m.fe.inc };
  const target = { e: E, l: E.map((_, i) => Math.min(E[i], C[i], F[i])), h: E.map((_, i) => Math.max(E[i], C[i], F[i])), c: C };
  if (!cur || still) { cur = target; return drawChart(); }
  const from = { e: cur.e.slice(), l: cur.l.slice(), h: cur.h.slice(), c: cur.c.slice() }, t0 = performance.now();
  cancelAnimationFrame(chartRaf);
  const lerp = (a, b, e) => a.map((v, i) => v + (b[i] - v) * e);
  const step = t => {
    const k = Math.min(1, (t - t0) / 240), e = 1 - Math.pow(1 - k, 3);
    cur = { e: lerp(from.e, target.e, e), l: lerp(from.l, target.l, e), h: lerp(from.h, target.h, e), c: lerp(from.c, target.c, e) };
    drawChart(); if (k < 1) chartRaf = requestAnimationFrame(step);
  };
  chartRaf = requestAnimationFrame(step);
}
function drawChart() {
  if (!cur || !meta) return;
  const c = $('chart'), dpr = window.devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
  if (!cw) return;
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const L = 8, R = 8, T = 16, B = 28, W = cw - L - R, H = ch - T - B, { lo, hi } = sc;
  const x = i => L + i / HORIZON * W, y = v => T + (hi - v) / (hi - lo || 1) * H;
  const line = arr => { g.beginPath(); arr.forEach((v, k) => k ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v))); };
  // fourchette entre le cas prudent et le cas favorable
  g.beginPath(); cur.h.forEach((v, k) => k ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v)));
  for (let k = cur.l.length - 1; k >= 0; k--) g.lineTo(x(k), y(cur.l[k])); g.closePath(); g.fillStyle = 'rgba(63,208,208,.16)'; g.fill();
  // ligne zéro
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(L, y(0)); g.lineTo(L + W, y(0)); g.stroke(); g.setLineDash([]);
  // cas prudent (pointillés ambre), puis solde attendu (trait plein), découvert en rouge
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(242,169,59,.85)'; g.lineWidth = 1.5; g.setLineDash([5, 4]); line(cur.c); g.stroke(); g.setLineDash([]);
  g.lineWidth = 2.75; g.strokeStyle = '#3fd0d0'; line(cur.e); g.stroke();
  g.strokeStyle = '#ff5c4d'; g.lineWidth = 3.25; g.beginPath(); let on = false;
  cur.e.forEach((v, k) => { if (v < 0) { on ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v)); on = true; } else on = false; }); g.stroke();
  // repères : factures (ambre), paiements attendus (vert), aujourd'hui (marine)
  const dot = (i, col, r = 4) => { g.fillStyle = '#0a1d36'; g.beginPath(); g.arc(x(i), y(cur.e[i]), r + 2, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(x(i), y(cur.e[i]), r, 0, 7); g.fill(); };
  meta.bills.forEach(b => dot(b.i, '#f2a93b')); meta.inc.forEach(i => dot(i, '#2fcf94')); dot(0, '#ffffff');
  // axe des dates
  g.fillStyle = '#8fa5ba'; g.font = '11px Inter, system-ui'; g.textBaseline = 'alphabetic';
  [[0, 'Today', 'left'], [15, null, 'center'], [30, null, 'center'], [45, null, 'right']].forEach(([i, lab, al]) => {
    g.textAlign = al; g.fillText(lab || nice(meta.dates[i]), al === 'left' ? L : al === 'right' ? L + W : x(i), ch - 8);
  });
  // survol : repère + bulle date / solde attendu / fourchette
  if (hover !== null) {
    const v = cur.e[hover], px = x(hover), py = y(v);
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + H); g.stroke();
    dot(hover, v < 0 ? '#ff5c4d' : '#3fd0d0', 5);
    const label = `${nice(meta.dates[hover])}  ${usd(v)}  (${usd(cur.l[hover])} to ${usd(cur.h[hover])})`;
    g.font = '600 12px Inter, system-ui'; const tw = g.measureText(label).width + 20, bx = Math.min(Math.max(px - tw / 2, L), L + W - tw), by = Math.max(py - 40, 2);
    g.fillStyle = '#16365f'; g.beginPath(); g.roundRect(bx, by, tw, 26, 8); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(label, bx + 10, by + 17);
  }
}
const chartEl = $('chart');
chartEl.addEventListener('pointermove', e => {
  const r = chartEl.getBoundingClientRect(), i = Math.round((e.clientX - r.left - 8) / (r.width - 16) * HORIZON);
  const n = Math.min(HORIZON, Math.max(0, i)); if (n !== hover) { hover = n; drawChart(); }
});
chartEl.addEventListener('pointerleave', () => { hover = null; drawChart(); });
new ResizeObserver(() => drawChart()).observe(chartEl);

// --- Action : Prevent it ---
async function preventNow() {
  const m = metrics(+$('late').value), need = m.need; if (!need) return 0;
  $('prevent').disabled = true; // pas de double transfert
  S.savings -= need; S.checking += need; APPLIED += need; HOLD = true; GEN++; // pas de relecture Nessie pendant l'écriture
  $('done').hidden = false; $('done').textContent = `Overdraft avoided. ${usd(OVERDRAFT_FEE)} in fees saved.`;
  logAction([{ k: 'move', t: `Moved ${usd(need)} from savings to checking`, s: `Ahead acted ${m.riskE ? Math.max(1, m.minE.i) : m.minC.i} days before the shortfall. ${usd(OVERDRAFT_FEE)} in overdraft fees avoided. Tax and bills envelopes untouched.` }]);
  render();
  // Nessie ne déplace pas les soldes : le transfer est enregistré (best-effort)
  try { await nessie(`/accounts/${SV}/transfers`, 'POST', { status: 'pending', amount: need, transaction_date: iso(TODAY), description: `Ahead prevent: savings -> checking, ${S.delay.weeks ? 'client ' + S.delay.weeks + ' weeks late' : 'shortfall'}` }); }
  catch { APPLIED -= need; } // Nessie n'a pas enregistré : on garde l'effet local sans le défaire au prochain relevé
  HOLD = false; GEN++;
  return need;
}
$('prevent').onclick = preventNow;
// --- Autopilot : règles qui s'exécutent seules quand un client paie, écrites dans Nessie ---
const LOG = []; // le plus récent d'abord
const ICONS = { in: '＋', move: '→', safe: '◎', undo: '↺' };
let payAmount = 1500, LAST_PAY = null, payVia = 'deposit';
function logAction(entries) {
  const t = new Date(); entries.slice().reverse().forEach(e => LOG.unshift({ ...e, at: t }));
  renderAutopilot();
}
function renderAutopilot(m = metrics(+$('late').value)) {
  $('ruleTaxT').textContent = `Tax jar · ${Math.round(PREFS.taxRate * 100)}% of every payment`;
  $('ruleBillsT').textContent = `Bills envelope · ${Math.round(RULES.billsPct * 100)}% of every payment`;
  $('ruleTax').checked = RULES.tax; $('ruleBills').checked = RULES.bills;
  const tx = Math.round(payAmount * PREFS.taxRate), bl = Math.round(payAmount * RULES.billsPct);
  $('ruleTaxS').textContent = `Money you will owe in taxes, set aside from each payment so you never spend it. On a ${usd(payAmount)} payment: ${usd(tx)} goes in the jar.`;
  $('ruleBillsS').textContent = `Money for rent and bills due before your next payment, set aside automatically. On a ${usd(payAmount)} payment: ${usd(bl)} goes in the envelope.`;
  const bar = (name, saved, goal, cls) => `<div class="e ${cls}"><div><span>${name}</span><b>${usd(saved)} <span>of ${usd(goal)}</span></b></div><div class="track"><i style="width:${Math.min(100, goal ? saved / goal * 100 : 0)}%"></i></div></div>`;
  $('env').innerHTML = bar('Tax jar', ENV.tax, m.tax, 't') + bar('Bills envelope', ENV.bills, m.billsDue, 'b');
  $('undoBtn').hidden = !LAST_PAY;
  $('log').innerHTML = LOG.length ? LOG.map(e => `<li><span class="ic ${e.k}">${ICONS[e.k]}</span><span class="tx">${e.t}${e.s ? `<small>${e.s}</small>` : ''}</span><span class="tm">${e.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></li>`).join('')
    : '<li class="empty">Nothing yet. Simulate a payment, or tap "Prevent it" on the Today screen, and every move Ahead makes shows up here.</li>';
}
async function clientPaid(amount) {
  const late = +$('late').value, before = metrics(late).free;
  $('payBtn').disabled = true; $('payNote').textContent = 'Writing the deposit to Nessie…';
  let id = null, wrote = true;
  try { id = (await nessie(`/accounts/${CH}/deposits`, 'POST', { medium: 'balance', transaction_date: iso(TODAY), status: 'completed', amount, description: 'Autopilot demo - client payment' })).objectCreated?._id; } catch { wrote = false; }
  let tid = null;
  if (payVia === 'p2p') { try { tid = (await nessie(`/accounts/${CH}/transfers`, 'POST', { status: 'completed', amount, transaction_date: iso(TODAY), description: `P2P received: Elite Frame client sent ${usd(amount)}` })).objectCreated?._id; } catch {} }
  S.deposits.push({ transaction_date: iso(TODAY), amount, description: 'Autopilot demo - client payment', _id: id });
  S.checking += amount;
  const moves = [];
  if (RULES.tax) moves.push({ key: 'tax', name: 'tax jar', a: Math.round(amount * PREFS.taxRate) });
  if (RULES.bills) moves.push({ key: 'bills', name: 'bills envelope', a: Math.round(amount * RULES.billsPct) });
  const entries = [{ k: 'in', t: `Client paid ${usd(amount)}${payVia === 'p2p' ? ' by P2P' : ''}`, s: wrote ? (payVia === 'p2p' ? 'P2P transfer + deposit written to Capital One Nessie [D1]' : 'Deposit written to Capital One Nessie [D1]') : 'Recorded in the app (Nessie did not accept the deposit)' }];
  for (const mv of moves) {
    S.checking -= mv.a; S.savings += mv.a; ENV[mv.key] += mv.a;
    entries.push({ k: 'move', t: `${usd(mv.a)} to your ${mv.name}`, s: `${mv.key === 'tax' ? Math.round(PREFS.taxRate * 100) : Math.round(RULES.billsPct * 100)}% of the payment, moved before you could spend it` });
    try { await nessie(`/accounts/${CH}/transfers`, 'POST', { status: 'pending', amount: mv.a, transaction_date: iso(TODAY), description: `Ahead autopilot: ${mv.name} (${CH} -> ${SV})` }); } catch {}
  }
  LAST_PAY = { amount, id, tid, moves };
  const m = render();
  entries.push({ k: 'safe', t: `Free after taxes and bills: ${usd(before)} → ${usd(m.free)}`, s: m.riskE ? 'A shortfall is still possible before your next payment.' : m.riskC ? 'No overdraft expected, but a late payment could still cause one.' : 'No overdraft projected, even if your next payment is late.' });
  logAction(entries);
  $('payBtn').disabled = true; $('payNote').textContent = 'Done. Check Today, What-if and Activity. Undo or Reset to simulate another payment.';
}
async function undoPayment() {
  if (!LAST_PAY) return; const p = LAST_PAY; LAST_PAY = null;
  const i = S.deposits.findIndex(d => d._id === p.id && p.id); if (i >= 0) S.deposits.splice(i, 1); else S.deposits.pop();
  S.checking -= p.amount; p.moves.forEach(mv => { S.checking += mv.a; S.savings -= mv.a; ENV[mv.key] -= mv.a; });
  if (p.id) { try { await nessie(`/deposits/${p.id}`, 'DELETE'); } catch {} }
  if (p.tid) { try { await nessie(`/transfers/${p.tid}`, 'DELETE'); } catch {} }
  render(); $('payBtn').disabled = false; $('payNote').textContent = 'Payment reverted.';
  logAction([{ k: 'undo', t: `Reverted the ${usd(p.amount)} payment`, s: 'Deposit removed from Nessie' }]);
}
async function resetDemo() { // supprime les paiements de démo restés dans Nessie
  $('resetBtn').disabled = true;
  const stale = S.deposits.filter(d => String(d.description).startsWith('Autopilot demo'));
  for (const d of stale) { if (d._id) { try { await nessie(`/deposits/${d._id}`, 'DELETE'); } catch {} } }
  S.deposits = S.deposits.filter(d => !String(d.description).startsWith('Autopilot demo'));
  HOLD = true; GEN++; // pas de relecture pendant le nettoyage
  try { // marqueurs de la liaison banque : paiement retardé + virements « Ahead prevent »
    const [d, t] = await Promise.all([nessie(`/accounts/${CH}/deposits`), nessie(`/accounts/${SV}/transfers`)]);
    for (const x of d.filter(isDelay)) { try { await nessie(`/deposits/${x._id}`, 'DELETE'); } catch {} }
    for (const x of t.filter(isPrevent)) { try { await nessie(`/transfers/${x.id || x._id}`, 'DELETE'); } catch {} }
  } catch {}
  Object.assign(S, { checking: demoData().checking, savings: demoData().savings }); ENV.tax = ENV.bills = 0; LAST_PAY = null; LOG.length = 0;
  APPLIED = 0; pushShown = false; $('done').hidden = true; $('late').value = 0;
  await load(); HOLD = false; GEN++; $('late').value = S.delay.weeks; render();
  $('resetBtn').disabled = false; $('payBtn').disabled = false; $('payNote').textContent = 'Demo reset to your Nessie history.';
}
$('payVia').addEventListener('click', e => { const b = e.target.closest('button[data-via]'); if (!b) return; payVia = b.dataset.via; $('payVia').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
$('payBtn').onclick = () => clientPaid(payAmount);
$('undoBtn').onclick = undoPayment;
$('resetBtn').onclick = resetDemo;
$('amts').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (!b) return; payAmount = +b.dataset.a; renderAutopilot(); $('amts').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
$('ruleTax').onchange = e => { RULES.tax = e.target.checked; };
$('ruleBills').onchange = e => { RULES.bills = e.target.checked; };

$('lateChips').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (!b) return; $('late').value = b.dataset.w; render(); });
// Curseur : un seul rendu par image, pas à chaque événement
let pending = 0;
$('late').addEventListener('input', () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); }); });

// --- Notification type « push » : prévient avant le découvert ---
let pushShown = false, pushTimer;
function showPush(m) {
  if (pushShown || !m.riskE) return; pushShown = true;
  const el = $('push');
  const w = S.delay.weeks, bill = (m.fe.bills.find(b => b.i === m.daysAhead) || {}).name;
  el.innerHTML = `${LOGO}<div><b>Ahead · now</b><span>${w ? `Your Elite Frame client is paying ${w} ${w === 1 ? 'week' : 'weeks'} late. In ${m.daysAhead} days, ${bill ? bill.toLowerCase() : 'a bill'} overdraws your checking. Tap to prevent it.` : `Overdraft predicted ${nice(m.minE.date)} (${usd(m.minE.bal)}). Tap to prevent it.`}</span></div>`;
  el.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  const hide = () => { el.classList.remove('show'); clearTimeout(pushTimer); setTimeout(() => { el.hidden = true; }, 500); };
  el.onclick = () => { hide(); show('today'); $('alert').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  pushTimer = setTimeout(hide, 9000);
}

// --- Onboarding : 3 questions qui changent vraiment les calculs ---
const STEPS = [
  { key: 'kind', title: 'How do you get paid?', text: 'Ahead is built for income that does not arrive on a schedule.',
    opts: [['Freelance', 'Clients pay when they pay'], ['Gig work', 'Payouts vary week to week'], ['Student', 'Part-time, summer jobs, side income']] },
  { key: 'taxRate', title: 'How much of each payment should go to taxes?', text: 'Nobody withholds it for you. Ahead sets it aside before you can spend it.',
    opts: [[0.25, '25%', 'Lighter'], [0.27, '27%', 'Recommended for freelancers'], [0.30, '30%', 'Safer']] },
  { key: 'cushion', title: 'How much should always stay in checking?', text: 'Ahead moves money early so your balance never drops below this.',
    opts: [[0, '$0', 'Just avoid overdrafts'], [50, '$50', 'A small buffer'], [150, '$150', 'More breathing room']] },
];
function onboard(step = 0) {
  const o = $('onboard'), s = STEPS[step];
  let chosen = PREFS[s.key];
  const label = v => (s.opts.find(x => x[0] === v) || [])[0];
  o.innerHTML = `<div class="ob"><div class="step">Step ${step + 1} of ${STEPS.length}</div><h3>${s.title}</h3><p>${s.text}</p>
    <div class="opts">${s.opts.map(([v, a, b]) => `<button data-v="${v}" class="${v === chosen ? 'on' : ''}">${b === undefined ? v : a}${(b === undefined ? a : b) ? `<small>${b === undefined ? a : b}</small>` : ''}</button>`).join('')}</div>
    <div class="ob-foot"><button class="ob-skip">Skip</button><button class="ob-next">${step === STEPS.length - 1 ? 'Show me my money' : 'Continue'}</button></div></div>`;
  o.hidden = false;
  o.querySelectorAll('.opts button').forEach((b, i) => b.onclick = () => { chosen = s.opts[i][0]; o.querySelectorAll('.opts button').forEach(x => x.classList.toggle('on', x === b)); });
  const next = () => { PREFS[s.key] = chosen; if (step + 1 < STEPS.length) onboard(step + 1); else finish(); };
  const finish = () => { PREFS.done = true; savePrefs(); o.hidden = true; const m = render(); setTimeout(() => showPush(m), 700); };
  o.querySelector('.ob-next').onclick = next;
  o.querySelector('.ob-skip').onclick = finish;
}

// --- Coach : conversation courte avec mémoire. Haiku via /api/coach (réponse structurée), repli à base de règles.
// Chaque réponse peut proposer UNE action ; le client l'exécute d'un tap (c'est son consentement).
const HIST = []; // mémoire de la conversation (texte seulement), envoyée au serveur
const NO_ACTION = { type: 'none', from: 'none', to: 'none', amount: 0, label: '' };
// Verdict d'achat calculé ici (jamais par l'IA) : tient dans le libre après impôts/factures ET le point bas prudent reste au-dessus du coussin
function purchaseCheck(amt, m = metrics(+$('late').value)) {
  const lowAfter = Math.round(m.minC.bal - amt), free = Math.round(m.free);
  const verdict = amt > free || lowAfter < 0 ? 'no' : lowAfter < PREFS.cushion ? 'tight' : 'yes'; // découvert prévu = non
  const rent = txTags().find(t => /Rent/.test(t.text)) || txTags().find(t => t.tag[0] === 'B'); // la facture qui crée le point bas
  return { amount: amt, verdict, freeAfterTaxesAndBills: free, lowestBalanceAfterPurchase: lowAfter, lowestDate: nice(m.minC.date), cushion: PREFS.cushion, citeTag: rent ? rent.tag : null };
}
function coachContext(q = '') {
  const m = metrics(+$('late').value), when = f => nice(f.out[Math.min(f.first, HORIZON)].date);
  const am = +((q.match(/\$\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:dollars|bucks)/i) || [])[1] || (q.match(/\$\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:dollars|bucks)/i) || [])[2] || '').replace(',', '');
  return { ...(am > 0 ? { purchaseCheck: purchaseCheck(am, m) } : {}), today: iso(TODAY), checking: Math.round(S.checking), savings: Math.round(S.savings), freeSavings: Math.round(freeSavings()), creditCardDebt: S.debt,
    daysAhead: m.capped ? '45+' : m.daysAhead, shortfallPredicted: !!m.riskE, preventAmount: m.need, lowestBalance: Math.round(m.minE.bal), lowestDate: nice(m.minE.date),
    clientWeeksLate: S.delay.weeks, safeToSpendToday: Math.round(m.safe), taxBucket: Math.round(m.tax), billsBeforeNextPayment: Math.round(m.billsDue),
    nextPayment: { cautious: when(m.fc), expected: when(m.fe), favorable: when(m.ff) },
    loans: S.loans.map(l => ({ type: l.type, owed: l.amount, monthly: l.monthly_payment })), transactions: txTags() };
}
function ruleCoach(q) { // repli sans IA : court, varié selon l'état, même format que l'IA
  const m = metrics(+$('late').value), amt = +((q.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/) || [])[1] || '').replace(',', '');
  const tags = txTags(), cite = (t, n = 2) => tags.filter(x => x.tag[0] === t).slice(0, n).map(x => `[${x.tag}]`).join(' ');
  const days = m.capped ? '45+' : m.daysAhead, say = (text, action = NO_ACTION, suggestions) => ({ text, cites: (text.match(/\[([A-Z]\d+)\]/g) || []).map(s => s.slice(1, -1)), action,
    suggestions: suggestions || (m.riskE ? ['Fix it now', 'Why is this happening?', 'What if they pay later?'] : ['Can I afford a $200 lens?', 'How much for taxes?', 'When is my next payment?']) });
  if (/overdraft|negative|run out|short|fix|prevent|cover/i.test(q)) {
    const rent = (tags.find(t => /Rent/.test(t.text)) || {}).tag, bill = rent ? `[${rent}]` : cite('B', 1);
    return m.riskE ? say(`Yes: rent ${bill} lands before your late payment, so checking hits ${usd(m.minE.bal)} on ${nice(m.minE.date)}. Moving ${usd(m.need)} from savings covers it. Tap below.`,
      { type: 'prevent', from: 'savings', to: 'checking', amount: m.need, label: `Move ${usd(m.need)} to checking` }, ['Why that amount?', 'Is my tax jar safe?', 'When does the client pay?'])
      : say(`No. You're ${days} days ahead, even if a client pays a bit late ${cite('D')}.`);
  }
  if (/tax/i.test(q)) return say(`Keep ${Math.round(PREFS.taxRate * 100)}% of every payment: ${usd(m.tax)} on your last income ${cite('D')}. Autopilot already sets it aside.`, NO_ACTION, ['Is that enough?', 'Am I going to overdraft?', 'Where does my money go?']);
  if (/(move|transfer|save|put)/i.test(q) && amt) {
    const toSav = /savings|save|put/i.test(q) && !/to checking/i.test(q), a2 = Math.min(amt, toSav ? Math.max(0, S.checking - PREFS.cushion) : freeSavings());
    return a2 > 0 ? say(`Sure, ${usd(a2)} from ${toSav ? 'checking to savings' : 'savings to checking'}. Tap below.`, { type: 'move', from: toSav ? 'checking' : 'savings', to: toSav ? 'savings' : 'checking', amount: a2, label: `Move ${usd(a2)} to ${toSav ? 'savings' : 'checking'}` })
      : say(`Not possible right now: that money is protected for taxes and bills.`);
  }
  if (/when|next pay|paid/i.test(q)) return say(`Most likely ${nice(m.fe.out[Math.min(m.fe.first, HORIZON)].date)}, between ${nice(m.ff.out[Math.min(m.ff.first, HORIZON)].date)} and ${nice(m.fc.out[Math.min(m.fc.first, HORIZON)].date)}, based on your past clients ${cite('D')}.`);
  if (amt) { const c = purchaseCheck(amt, m);
    return c.verdict === 'yes' ? say(`Yes, ${usd(amt)} fits: ${usd(c.freeAfterTaxesAndBills)} free after taxes and bills ${cite('B', 1)}, and you'd stay at ${usd(c.lowestBalanceAfterPurchase)} at your lowest.`)
      : c.verdict === 'tight' ? say(`Tight: ${usd(amt)} fits your free money, but your lowest balance would drop to ${usd(c.lowestBalanceAfterPurchase)} on ${c.lowestDate} ${cite('B', 1)}. A smaller amount is safer.`)
      : c.lowestBalanceAfterPurchase < 0 ? say(`Not yet: ${usd(amt)} would push checking to ${usd(c.lowestBalanceAfterPurchase)} on ${c.lowestDate} ${cite('B', 1)}. Wait for your next payment or pick a smaller amount.`)
      : say(`Not yet: ${usd(amt)} is more than your ${usd(c.freeAfterTaxesAndBills)} free after taxes ${cite('D', 1)} and bills ${cite('B', 1)}.`); }
  return say(`You can spend ${usd(m.safe)} a day safely, and you're ${days} days ahead.`);
}
// Exécute l'action proposée (bornée côté app : jamais plus que l'épargne libre)
async function runAction(a) {
  if (a.type === 'prevent') return preventNow();
  const from = a.from, amt = Math.round(Math.min(a.amount, from === 'savings' ? freeSavings() : Math.max(0, S.checking - PREFS.cushion)));
  if (!(amt > 0) || from === a.to) return 0;
  if (from === 'savings') { S.savings -= amt; S.checking += amt; } else { S.checking -= amt; S.savings += amt; }
  logAction([{ k: 'move', t: `Moved ${usd(amt)} from ${from} to ${a.to}`, s: 'Asked in the coach, approved with one tap.' }]);
  render();
  try { await nessie(`/accounts/${from === 'savings' ? SV : CH}/transfers`, 'POST', { status: 'pending', amount: amt, transaction_date: iso(TODAY), description: `Ahead coach: ${from} -> ${a.to}` }); } catch {}
  return amt;
}
function addMsg(who, text, extra = {}) {
  const d = document.createElement('div'); d.className = 'msg ' + who;
  const p = document.createElement('p'); p.textContent = text; d.appendChild(p);
  const used = extra.cites ? txTags().filter(t => extra.cites.includes(t.tag) || text.includes(`[${t.tag}]`)) : [];
  if (used.length) { const ul = document.createElement('ul'); ul.className = 'cites'; used.forEach(t => { const li = document.createElement('li'); li.innerHTML = `<b>${t.tag}</b> `; li.append(t.text); ul.appendChild(li); }); d.appendChild(ul); }
  const a = extra.action;
  if (a && a.type !== 'none' && a.amount > 0) {
    const b = document.createElement('button'); b.className = 'act'; b.textContent = a.label || `Move ${usd(a.amount)}`;
    b.onclick = async () => {
      b.disabled = true; const done = await runAction(a);
      b.textContent = done ? `Done · ${usd(done)} moved` : 'Nothing to move now'; b.classList.add('ok');
      if (done) { const msg = a.type === 'prevent' ? `Done. Checking is covered, ${usd(OVERDRAFT_FEE)} in fees avoided. You're ${metrics(+$('late').value).capped ? '45+' : metrics(+$('late').value).daysAhead} days ahead again.` : `Done. ${usd(done)} moved to ${a.to}.`;
        addMsg('bot', msg); HIST.push({ role: 'assistant', content: msg }); }
    };
    d.appendChild(b);
  }
  $('chatlog').appendChild(d); d.scrollIntoView({ block: 'end', behavior: 'smooth' }); return d;
}
function setSuggestions(list) {
  const qs = (list || []).filter(s => typeof s === 'string' && s.length <= 60).slice(0, 3); if (!qs.length) return;
  $('chips').innerHTML = qs.map(s => `<button type="button" data-q="${s.replace(/"/g, '&quot;')}">${s.replace(/</g, '&lt;')}</button>`).join('');
}
async function ask(q) {
  addMsg('me', q); HIST.push({ role: 'user', content: q });
  const typing = addMsg('bot', ''); typing.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  let r;
  try {
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: HIST.slice(-8), context: coachContext(q) }) });
    if (!res.ok) throw new Error(res.status);
    r = await res.json(); if (!r || typeof r.text !== 'string' || !r.text) throw new Error('empty');
    const pc = coachContext(q).purchaseCheck; // achat : toujours montrer la transaction derrière le verdict
    if (pc && pc.citeTag && !(r.cites || []).length) r.cites = [pc.citeTag];
    if (r.action && r.action.type === 'prevent') { const need = metrics(+$('late').value).need; r.action = need ? { ...r.action, amount: need, label: `Move ${usd(need)} to checking` } : NO_ACTION; }
  } catch { r = ruleCoach(q); }
  typing.remove(); addMsg('bot', r.text, { cites: r.cites || [], action: r.action }); HIST.push({ role: 'assistant', content: r.text }); setSuggestions(r.suggestions);
}
$('askForm').onsubmit = e => { e.preventDefault(); const q = $('q').value.trim(); if (!q) return; $('q').value = ''; ask(q); };
$('chips').addEventListener('click', e => { const b = e.target.closest('button[data-q]'); if (b) ask(b.dataset.q); });
addMsg('bot', "Hi Alexandre. Ask me anything about your money, or tell me what to do. I show the transactions behind every answer.");

// --- Écran d'ouverture : retiré après l'animation, ou au tap ; ?skip le supprime (tests) ---
(() => {
  const sp = $('splash'), done = () => sp.remove();
  if (new URLSearchParams(location.search).has('skip')) return done();
  if (new URLSearchParams(location.search).has('hold')) return; // test : garder l'écran d'ouverture
  sp.addEventListener('click', done); setTimeout(done, 3950);
})();
// --- Démarrage ---
// --- Liaison live : relit Nessie toutes les 3 s ; réagit au retard écrit par la banque ---
async function poll() {
  if (!live || document.hidden || HOLD) return;
  updateBadge();
  const w0 = S.delay.weeks, a0 = APPLIED;
  try { await sync(); } catch { return; }
  if (HOLD) return;
  const w = S.delay.weeks; if (w === w0 && APPLIED === a0) return;
  $('late').value = w;
  if (w !== w0) { pushShown = false; if (!w) $('done').hidden = true; }
  if (!APPLIED && a0) $('done').hidden = true;
  const m = render();
  if (w > w0 && m.riskE) { show('today'); setTimeout(() => showPush(m), 250); }
}
setInterval(poll, 3000);
load().then(live => {
  $('late').value = S.delay.weeks;
  $('mode').textContent = live ? 'Nessie live' : 'Simulated data'; updateBadge();
  const m = render();
  show((location.hash || '#today').slice(1));
  const skip = new URLSearchParams(location.search).has('skip');
  if (!PREFS.done && !skip) onboard(); else setTimeout(() => showPush(m), 900);
});
