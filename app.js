// IDs du compte de test Nessie (non secrets)
const CUSTOMER = 'b25d35fb-c5e7-4311-a81b-52a754262e90';
const CH = 'ee0be6f8-275f-48fc-8843-995a05e11a59', SV = '4b98e589-8627-41a4-b2dd-acfed22513e3';
const TODAY = new Date('2026-11-07'), DAY = 864e5, HORIZON = 45, OVERDRAFT_FEE = 36;
const $ = id => document.getElementById(id);
const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const iso = d => d.toISOString().slice(0, 10);
const nice = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Couche données : Nessie via /api/nessie, repli sur données simulées (même histoire) ---
async function nessie(path, method = 'GET', body) {
  const r = await fetch('/api/nessie?path=' + encodeURIComponent(path), {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
function demoData() { // miroir du compte Nessie : 90 jours de freelance, revenu irrégulier
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cats = [['Groceries', 30, 70, .30], ['Gas', 25, 45, .12], ['Eating out', 12, 30, .22], ['Coffee', 5, 9, .20], ['Equipment', 90, 220, .03]];
  const purchases = [];
  for (let i = 89; i >= 1; i--) cats.forEach(([n, lo, hi, p]) => { if (rnd() < p) purchases.push({ purchase_date: iso(new Date(+TODAY - i * DAY)), amount: lo + Math.floor(rnd() * (hi - lo + 1)), description: n }); });
  return {
    checking: 900, savings: 2500, debt: 640, purchases,
    deposits: [['2026-08-14', 2400, 'Wedding film - Client B'], ['2026-08-28', 1600, 'Brand video - Client C'], ['2026-09-22', 300, 'Photo edit - Client D'],
      ['2026-10-09', 1500, 'Product shoot - Client E'], ['2026-10-27', 700, 'Reel editing - Client F'], ['2026-11-01', 1200, 'Client payment - video shoot']]
      .map(([transaction_date, amount, description]) => ({ transaction_date, amount, description })),
    bills: [{ nickname: 'Rent', payment_amount: 850, payment_date: '2026-11-15', recurring_date: 15 }, { nickname: 'Phone', payment_amount: 60, payment_date: '2026-11-20', recurring_date: 20 },
      { nickname: 'Software', payment_amount: 30, payment_date: '2026-12-05', recurring_date: 5 }],
  };
}
let S = demoData(), live = false;

async function load() {
  try {
    const [d, p, b, a] = await Promise.all([nessie(`/accounts/${CH}/deposits`), nessie(`/accounts/${CH}/purchases`), nessie(`/accounts/${CH}/bills`), nessie(`/customers/${CUSTOMER}/accounts`)]);
    const by = t => a.find(x => x.type === t);
    Object.assign(S, { deposits: d, purchases: p, bills: b, checking: by('Checking').balance, savings: by('Savings').balance, debt: by('Credit Card')?.balance || 0 });
    live = true;
  } catch { live = false; } // pas de proxy en local : démo simulée
  $('mode').textContent = live ? 'Nessie live' : 'Simulated data';
}

// --- Modèle de revenu irrégulier : calculé sur l'historique des dépôts ---
const quant = (arr, p) => { const a = [...arr].sort((x, y) => x - y), pos = p * (a.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos); return a[lo] + (a[hi] - a[lo]) * (pos - lo); };
function incomeModel() {
  const ds = S.deposits.map(d => ({ t: Date.parse(d.transaction_date), amt: d.amount })).sort((a, b) => a.t - b.t);
  const gaps = ds.slice(1).map((d, i) => (d.t - ds[i].t) / DAY), amts = ds.map(d => d.amt);
  return {
    since: Math.round((+TODAY - ds[ds.length - 1].t) / DAY),                       // jours depuis le dernier paiement
    g: { cautious: Math.max(...gaps), expected: quant(gaps, .5), favorable: quant(gaps, .25) },  // délai entre paiements
    a: { cautious: quant(amts, .25), expected: quant(amts, .5), favorable: quant(amts, .75) },   // montant d'un paiement
    monthIncome: amts.reduce((s, x) => s + x, 0) / 3,
  };
}
function dailySpend() { // dépense moyenne par jour sur 60 jours, d'après les achats Nessie
  const from = +TODAY - 60 * DAY;
  return S.purchases.filter(p => Date.parse(p.purchase_date) >= from).reduce((t, p) => t + p.amount, 0) / 60 || 28;
}
const billsOn = date => S.bills.filter(b => b.recurring_date ? b.recurring_date === +date.slice(8, 10) : b.payment_date === date);

// Prévision d'un scénario ; `late` = semaines de retard du client (what-if)
function forecast(scn, late = 0) {
  const M = incomeModel(), spend = dailySpend();
  const first = Math.max(scn === 'cautious' ? 2 : 1, Math.round(M.g[scn] - M.since)) + late * 7, gap = Math.max(3, Math.round(M.g[scn]));
  let bal = S.checking; const out = [], bills = [], inc = [];
  for (let i = 0; i <= HORIZON; i++) {
    const date = iso(new Date(+TODAY + i * DAY));
    if (i > 0) {
      bal -= spend;
      billsOn(date).forEach(b => { bal -= b.payment_amount; bills.push({ i, name: b.nickname, amt: b.payment_amount }); });
      if (i >= first && (i - first) % gap === 0) { bal += M.a[scn]; inc.push(i); }
    }
    out.push({ i, date, bal });
  }
  return { out, bills, inc, first };
}
function metrics(late) {
  const fe = forecast('expected', late), fc = forecast('cautious', late), ff = forecast('favorable', late), M = incomeModel();
  // Le risque se mesure jusqu'au prochain paiement, même en retard (cas prudent) : c'est ce que « Prevent it » doit couvrir
  const minOf = f => f.out.slice(0, fc.first).reduce((m, p) => p.bal < m.bal ? p : m, f.out[0]);
  const liquid = S.checking + S.savings, tax = 0.27 * M.monthIncome * 3;
  const billsDue = fc.bills.filter(b => b.i <= fc.first).reduce((s, b) => s + b.amt, 0);
  const free = Math.max(0, liquid - tax - billsDue), safe = free / Math.max(1, fc.first);
  const minE = minOf(fe), minC = minOf(fc);
  const riskE = minE.bal < 0 ? minE : null, riskC = minC.bal < 0 ? minC : null;
  const need = riskC ? Math.min(S.savings, Math.ceil(-minC.bal + 50)) : 0;
  return { fe, fc, ff, M, liquid, tax, billsDue, free, safe, daysToIncome: fc.first, minE, minC, riskE, riskC, need };
}
// Échelle verticale FIXE : calculée sur tous les scénarios et tous les retards (0 à 6 semaines),
// donc le graphique ne change pas de format quand on bouge le curseur.
function scale() {
  let lo = 0, hi = 0;
  for (let k = 0; k <= 6; k++) ['cautious', 'expected', 'favorable'].forEach(s => forecast(s, k).out.forEach(p => { lo = Math.min(lo, p.bal); hi = Math.max(hi, p.bal); }));
  return { lo: lo * 1.12, hi: hi * 1.08 };
}

// --- Transactions : une seule liste, avec les tags que le coach cite ---
function txAll() {
  const desc = (a, k) => [...a].sort((x, y) => y[k].localeCompare(x[k]));
  return [
    ...desc(S.deposits, 'transaction_date').map((d, i) => ({ tag: 'D' + (i + 1), date: d.transaction_date, label: d.description, amt: +d.amount })),
    ...desc(S.purchases, 'purchase_date').slice(0, 15).map((p, i) => ({ tag: 'P' + (i + 1), date: p.purchase_date, label: p.description, amt: -p.amount })),
    ...S.bills.map((b, i) => ({ tag: 'B' + (i + 1), date: b.payment_date, label: `${b.nickname} (monthly, day ${b.recurring_date || +b.payment_date.slice(8)})`, amt: -b.payment_amount, upcoming: true })),
  ];
}
const txTags = () => txAll().map(t => ({ tag: t.tag, text: `${t.date} ${t.amt > 0 ? '+' : '-'}${usd(Math.abs(t.amt))} ${t.label}` }));

// --- Rendu ---
function render() {
  const late = +$('late').value; $('lateVal').textContent = late;
  const m = metrics(late);
  countTo(m.safe);
  $('acctCh').textContent = usd(S.checking); $('acctSv').textContent = usd(S.savings);
  $('buckets').innerHTML = [['Taxes (27%)', m.tax], ['Bills before next pay', m.billsDue], ['Free', m.free]]
    .map(([n, v]) => `<div class="bucket">${n}<b>${usd(v)}</b></div>`).join('');
  const risk = m.riskE || m.riskC;
  $('alert').hidden = !risk && $('done').hidden;
  if (risk) $('done').hidden = true;
  $('alert').classList.toggle('is-done', !risk && !$('done').hidden);
  $('alert').classList.toggle('is-risk', !m.riskE && !!m.riskC);
  $('alertLabel').textContent = risk ? (m.riskE ? 'Overdraft predicted' : 'At risk') : 'All clear';
  $('alertText').textContent = m.riskE
    ? `Checking is projected at ${usd(m.minE.bal)} on ${nice(m.minE.date)}. Without action: about ${usd(OVERDRAFT_FEE)} in overdraft fees.`
    : m.riskC ? `If your next payment is as late as your slowest (${nice(m.fc.out[m.daysToIncome].date)}), checking hits ${usd(m.minC.bal)} on ${nice(m.minC.date)}.`
    : 'No overdraft in the next 45 days, even if your next payment is late.';
  $('alertSub').textContent = risk ? `Prevent it moves ${usd(m.need)} from savings now, enough even on the cautious timeline.` : '';
  $('alertSub').hidden = !risk;
  $('prevent').hidden = !risk; $('prevent').disabled = false;
  const spend = dailySpend(), monthSpend = spend * 30 + S.bills.reduce((s, b) => s + b.payment_amount, 0);
  $('health').innerHTML = [['Savings rate', Math.max(0, Math.round((m.M.monthIncome - monthSpend) / m.M.monthIncome * 100)) + '%'],
    ['Reserve', (m.liquid / monthSpend).toFixed(1) + ' mo'], ['Debt / income', Math.round(S.debt / m.M.monthIncome * 100) + '%']]
    .map(([n, v]) => `<div>${n}<b>${v}</b></div>`).join('');
  renderActivity();
  setChart(m);
}
function renderActivity() {
  const all = txAll(), up = all.filter(t => t.upcoming), past = all.filter(t => !t.upcoming).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  $('activity').innerHTML = [...up, ...past].map(t => `<li><span class="tag">${t.tag}</span><span class="t">${t.label}<small>${t.upcoming ? 'Upcoming' : t.date}</small></span><span class="a ${t.amt > 0 ? 'in' : ''}">${t.amt > 0 ? '+' : '-'}${usd(Math.abs(t.amt))}</span></li>`).join('');
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
  for (let k = cur.l.length - 1; k >= 0; k--) g.lineTo(x(k), y(cur.l[k])); g.closePath(); g.fillStyle = 'rgba(27,127,140,.16)'; g.fill();
  // ligne zéro
  g.strokeStyle = '#c9d4dd'; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(L, y(0)); g.lineTo(L + W, y(0)); g.stroke(); g.setLineDash([]);
  // cas prudent (pointillés ambre), puis solde attendu (trait plein), découvert en rouge
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(217,138,26,.85)'; g.lineWidth = 1.5; g.setLineDash([5, 4]); line(cur.c); g.stroke(); g.setLineDash([]);
  g.lineWidth = 2.75; g.strokeStyle = '#1b7f8c'; line(cur.e); g.stroke();
  g.strokeStyle = '#c8372d'; g.lineWidth = 3.25; g.beginPath(); let on = false;
  cur.e.forEach((v, k) => { if (v < 0) { on ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v)); on = true; } else on = false; }); g.stroke();
  // repères : factures (ambre), paiements attendus (vert), aujourd'hui (marine)
  const dot = (i, col, r = 4) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(x(i), y(cur.e[i]), r + 2, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(x(i), y(cur.e[i]), r, 0, 7); g.fill(); };
  meta.bills.forEach(b => dot(b.i, '#d98a1a')); meta.inc.forEach(i => dot(i, '#1f9d6b')); dot(0, '#0b2540');
  // axe des dates
  g.fillStyle = '#64788a'; g.font = '11px Inter, system-ui'; g.textBaseline = 'alphabetic';
  [[0, 'Today', 'left'], [15, null, 'center'], [30, null, 'center'], [45, null, 'right']].forEach(([i, lab, al]) => {
    g.textAlign = al; g.fillText(lab || nice(meta.dates[i]), al === 'left' ? L : al === 'right' ? L + W : x(i), ch - 8);
  });
  // survol : repère + bulle date / solde attendu / fourchette
  if (hover !== null) {
    const v = cur.e[hover], px = x(hover), py = y(v);
    g.strokeStyle = 'rgba(11,37,64,.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + H); g.stroke();
    dot(hover, v < 0 ? '#c8372d' : '#1b7f8c', 5);
    const label = `${nice(meta.dates[hover])}  ${usd(v)}  (${usd(cur.l[hover])} to ${usd(cur.h[hover])})`;
    g.font = '600 12px Inter, system-ui'; const tw = g.measureText(label).width + 20, bx = Math.min(Math.max(px - tw / 2, L), L + W - tw), by = Math.max(py - 40, 2);
    g.fillStyle = '#0b2540'; g.beginPath(); g.roundRect(bx, by, tw, 26, 8); g.fill();
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
$('prevent').onclick = async () => {
  const m = metrics(+$('late').value), need = m.need; if (!need) return;
  $('prevent').disabled = true; // pas de double transfert
  S.savings -= need; S.checking += need;
  $('done').hidden = false; $('done').textContent = `Overdraft avoided. ${usd(OVERDRAFT_FEE)} in fees saved.`;
  render();
  // Nessie ne déplace pas les soldes : le transfer est enregistré (best-effort)
  try { await nessie(`/accounts/${SV}/transfers`, 'POST', { status: 'pending', amount: need, transaction_date: iso(TODAY), description: `Prevent overdraft: savings ${SV} -> checking ${CH}` }); } catch {}
};
// Curseur : un seul rendu par image, pas à chaque événement
let pending = 0;
$('late').addEventListener('input', () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); }); });

// --- Coach : Haiku via /api/coach, repli à base de règles ; toujours des transactions citées ---
function ruleCoach(q) {
  const m = metrics(+$('late').value), amt = +((q.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/) || [])[1] || '').replace(',', '');
  const tags = txTags(), cite = t => tags.filter(x => x.tag[0] === t).slice(0, 3).map(x => `[${x.tag}]`).join(' ');
  if (!amt) return `Today you can spend ${usd(m.safe)} safely: ${usd(m.free)} free over the ${m.daysToIncome} days until your next payment, after ${usd(m.tax)} for taxes on income ${cite('D')} and ${usd(m.billsDue)} of bills ${cite('B')}.`;
  return amt <= m.free
    ? `Yes: ${usd(amt)} fits in your free bucket of ${usd(m.free)}, after taxes on income ${cite('D')} and bills ${cite('B')}.`
    : `Not yet: ${usd(amt)} is more than your free bucket of ${usd(m.free)}. Taxes on income ${cite('D')} and bills ${cite('B')} come first.`;
}
function showAnswer(text) {
  const used = txTags().filter(t => text.includes(`[${t.tag}]`));
  $('answer').innerHTML = `<p></p><ul class="cites">${used.map(t => `<li><b>${t.tag}</b> ${t.text}</li>`).join('')}</ul>`;
  $('answer').firstChild.textContent = text;
}
$('askForm').onsubmit = async e => {
  e.preventDefault();
  const q = $('q').value.trim(); if (!q) return;
  $('answer').textContent = 'Thinking…';
  const m = metrics(+$('late').value), when = f => nice(f.out[f.first].date);
  const context = { today: iso(TODAY), checking: S.checking, savings: S.savings, creditCardDebt: S.debt, safeToSpendToday: Math.round(m.safe), taxBucket: Math.round(m.tax),
    billsBeforeNextPayment: Math.round(m.billsDue), freeBucket: Math.round(m.free), avgDailySpend: Math.round(dailySpend()),
    nextPayment: { cautious: when(m.fc), expected: when(m.fe), favorable: when(m.ff) }, projectedLowestBalance: { expected: Math.round(m.minE.bal), cautious: Math.round(m.minC.bal) }, transactions: txTags() };
  try {
    const r = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, context }) });
    if (!r.ok) throw new Error(r.status);
    const { answer } = await r.json();
    if (!answer) throw new Error('empty');
    showAnswer(answer);
  } catch { showAnswer(ruleCoach(q)); }
};

load().then(render);
