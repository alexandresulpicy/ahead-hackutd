// IDs du compte de test Nessie (non secrets)
const CH = 'ee0be6f8-275f-48fc-8843-995a05e11a59', SV = '4b98e589-8627-41a4-b2dd-acfed22513e3';
const TODAY = new Date('2026-11-07'), DAY = 864e5, HORIZON = 45, DAILY_SPEND = 28;
const $ = id => document.getElementById(id);
const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Couche données : Nessie via /api/nessie, repli sur données simulées ---
async function nessie(path, method = 'GET', body) {
  const r = await fetch('/api/nessie?path=' + encodeURIComponent(path), {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
const DEMO = { // état simulé (miroir du compte Nessie)
  checking: 1700, savings: 2500,
  deposits: [{ transaction_date: '2026-10-05', amount: 300, description: 'Client A' }, { transaction_date: '2026-11-01', amount: 1200, description: 'Client payment - video shoot' }],
  purchases: [{ purchase_date: '2026-11-03', amount: 45, description: 'Groceries' }],
  bills: [{ nickname: 'Rent', payment_amount: 850, payment_date: '2026-11-15' }, { nickname: 'Phone', payment_amount: 60, payment_date: '2026-11-20' }],
};
let S = JSON.parse(JSON.stringify(DEMO)), live = false, savedByPrevent = 0;

async function load() {
  try {
    const [d, p, b] = await Promise.all([nessie(`/accounts/${CH}/deposits`), nessie(`/accounts/${CH}/purchases`), nessie(`/accounts/${CH}/bills`)]);
    Object.assign(S, { deposits: d, purchases: p, bills: b }); live = true;
  } catch { live = false; } // pas de proxy en local : démo simulée
  $('mode').textContent = live ? 'Nessie live' : 'Simulated data';
}

// --- Calculs ---
const iso = d => d.toISOString().slice(0, 10);
function forecast(lateWeeks) {
  const nextIncome = { day: 12 + lateWeeks * 7, amount: 1500 };
  let bal = S.checking, out = [];
  for (let i = 0; i <= HORIZON; i++) {
    const date = iso(new Date(+TODAY + i * DAY));
    if (i > 0) bal -= DAILY_SPEND;
    S.bills.forEach(b => { if (b.payment_date === date) bal -= b.payment_amount; });
    if (i === nextIncome.day) bal += nextIncome.amount;
    out.push({ i, date, bal });
  }
  return { out, nextIncome };
}
function metrics(lateWeeks) {
  const f = forecast(lateWeeks), income30 = S.deposits.reduce((s, d) => s + d.amount, 0);
  const tax = income30 * 0.27, rent = S.bills.reduce((s, b) => s + b.payment_amount, 0);
  const free = Math.max(0, S.checking - tax - rent), safe = free / Math.max(1, f.nextIncome.day);
  const first = f.out.find(p => p.bal < 0);
  return { f, tax, rent, free, safe, first, income30 };
}
// Échelle verticale FIXE : calculée sur tous les scénarios de retard (0 à 6 semaines),
// donc le graphique ne change pas de format quand on bouge le curseur.
function scale() {
  let lo = 0, hi = 0;
  for (let k = 0; k <= 6; k++) forecast(k).out.forEach(p => { lo = Math.min(lo, p.bal); hi = Math.max(hi, p.bal); });
  return { lo: lo * 1.12, hi: hi * 1.08 };
}

// --- Rendu ---
function render() {
  const late = +$('late').value; $('lateVal').textContent = late;
  const m = metrics(late);
  countTo(m.safe);
  $('acctCh').textContent = usd(S.checking); $('acctSv').textContent = usd(S.savings);
  $('buckets').innerHTML = [['Taxes (27%)', m.tax], ['Bills due', m.rent], ['Free', m.free]]
    .map(([n, v]) => `<div class="bucket">${n}<b>${usd(v)}</b></div>`).join('');
  $('alert').hidden = !m.first && $('done').hidden;
  $('alert').classList.toggle('is-done', !m.first && !$('done').hidden);
  $('alertText').textContent = m.first ? `Checking goes to ${usd(m.first.bal)} on ${m.first.date}. Move money from savings ${m.first.i} days early?` : 'No overdraft in the next 45 days.';
  $('prevent').hidden = !m.first;
  const essentials = m.rent + DAILY_SPEND * 30;
  $('health').innerHTML = [['Savings rate', Math.round(S.savings / (S.savings + S.checking) * 100) + '%'], ['Reserve', (S.savings / essentials).toFixed(1) + ' mo'], ['Debt / income', '0%']]
    .map(([n, v]) => `<div>${n}<b>${v}</b></div>`).join('');
  renderActivity();
  setChart(m.f.out);
}
function txList() {
  return [
    ...S.deposits.map((d, i) => ({ tag: 'D' + (i + 1), date: d.transaction_date, label: d.description, amt: +d.amount })),
    ...S.purchases.map((p, i) => ({ tag: 'P' + (i + 1), date: p.purchase_date, label: p.description, amt: -p.amount })),
    ...S.bills.map((b, i) => ({ tag: 'B' + (i + 1), date: b.payment_date, label: b.nickname + ' (upcoming)', amt: -b.payment_amount })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}
function renderActivity() {
  $('activity').innerHTML = txList().map(t => `<li><span class="tag">${t.tag}</span><span class="t">${t.label}<small>${t.date}</small></span><span class="a ${t.amt > 0 ? 'in' : ''}">${t.amt > 0 ? '+' : '-'}${usd(Math.abs(t.amt))}</span></li>`).join('');
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

// --- Graphique : interpolation entre deux états, échelle fixe, survol ---
let pts = [], cur = null, sc = scale(), chartRaf, hover = null;
function setChart(next) {
  pts = next; sc = scale();
  const target = next.map(p => p.bal);
  if (!cur || still) { cur = target; return drawChart(); }
  const from = cur.slice(), t0 = performance.now();
  cancelAnimationFrame(chartRaf);
  const step = t => {
    const k = Math.min(1, (t - t0) / 240), e = 1 - Math.pow(1 - k, 3);
    cur = from.map((v, i) => v + (target[i] - v) * e); drawChart();
    if (k < 1) chartRaf = requestAnimationFrame(step);
  };
  chartRaf = requestAnimationFrame(step);
}
function drawChart() {
  if (!cur) return;
  const c = $('chart'), dpr = window.devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
  if (!cw) return;
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const L = 8, R = 8, T = 16, B = 28, W = cw - L - R, H = ch - T - B, { lo, hi } = sc;
  const x = i => L + i / HORIZON * W, y = v => T + (hi - v) / (hi - lo || 1) * H;
  const path = () => { g.beginPath(); cur.forEach((v, k) => k ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v))); };
  // zone sous la ligne (dégradé)
  const grad = g.createLinearGradient(0, T, 0, T + H); grad.addColorStop(0, 'rgba(27,127,140,.28)'); grad.addColorStop(1, 'rgba(27,127,140,0)');
  path(); g.lineTo(x(HORIZON), y(0)); g.lineTo(x(0), y(0)); g.closePath(); g.fillStyle = grad; g.fill();
  // ligne zéro
  g.strokeStyle = '#c9d4dd'; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(L, y(0)); g.lineTo(L + W, y(0)); g.stroke(); g.setLineDash([]);
  // ligne du solde, puis découvert en rouge
  g.lineJoin = 'round'; g.lineWidth = 2.75; g.strokeStyle = '#1b7f8c'; path(); g.stroke();
  g.strokeStyle = '#c8372d'; g.lineWidth = 3.25; g.beginPath(); let on = false;
  cur.forEach((v, k) => { if (v < 0) { on ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v)); on = true; } else on = false; }); g.stroke();
  // repères : factures (ambre), revenu (vert), aujourd'hui (marine)
  const dot = (i, col, r = 4) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(x(i), y(cur[i]), r + 2, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(x(i), y(cur[i]), r, 0, 7); g.fill(); };
  S.bills.forEach(b => { const p = pts.find(q => q.date === b.payment_date); if (p) dot(p.i, '#d98a1a'); });
  const jump = pts.find((p, k) => k && p.bal - pts[k - 1].bal > 500); if (jump) dot(jump.i, '#1f9d6b');
  dot(0, '#0b2540');
  // axe des dates
  g.fillStyle = '#64788a'; g.font = '11px Inter, system-ui'; g.textBaseline = 'alphabetic';
  [[0, 'Today', 'left'], [15, null, 'center'], [30, null, 'center'], [45, null, 'right']].forEach(([i, lab, al]) => {
    const t = lab || new Date(+TODAY + i * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    g.textAlign = al; g.fillText(t, al === 'left' ? L : al === 'right' ? L + W : x(i), ch - 8);
  });
  // survol : repère + bulle date / solde
  if (hover !== null) {
    const v = cur[hover], px = x(hover), py = y(v), neg = v < 0;
    g.strokeStyle = 'rgba(11,37,64,.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + H); g.stroke();
    dot(hover, neg ? '#c8372d' : '#1b7f8c', 5);
    const label = new Date(+TODAY + hover * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + '  ' + usd(v);
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
  const m = metrics(+$('late').value), need = Math.ceil(-Math.min(...m.f.out.map(p => p.bal)) + 50);
  S.savings -= need; S.checking += need; savedByPrevent = 36;
  $('done').hidden = false; $('done').textContent = `Overdraft avoided. ${usd(savedByPrevent)} in fees saved.`;
  render();
  // Nessie ne déplace pas les soldes : le transfer est enregistré en best-effort
  try { await nessie(`/accounts/${SV}/transfers`, 'POST', { status: 'pending', amount: need, transaction_date: iso(TODAY), description: `Prevent overdraft: savings ${SV} -> checking ${CH}` }); } catch {}
};
// Curseur : un seul rendu par image, pas à chaque événement
let pending = 0;
$('late').addEventListener('input', () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); }); });

// --- Coach : Haiku via /api/coach, repli à base de règles ; toujours des transactions citées ---
function txTags() {
  const D = S.deposits.map((d, i) => ({ tag: 'D' + (i + 1), text: `${d.transaction_date} +${usd(d.amount)} ${d.description}` }));
  const P = S.purchases.map((p, i) => ({ tag: 'P' + (i + 1), text: `${p.purchase_date} -${usd(p.amount)} ${p.description}` }));
  const B = S.bills.map((b, i) => ({ tag: 'B' + (i + 1), text: `${b.payment_date} -${usd(b.payment_amount)} ${b.nickname}` }));
  return [...D, ...P, ...B];
}
function ruleCoach(q) {
  const m = metrics(+$('late').value), amt = +((q.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/) || [])[1] || '').replace(',', '');
  const tags = txTags(), cite = t => tags.filter(x => x.tag[0] === t).map(x => `[${x.tag}]`).join(' ');
  if (!amt) return `Today you can spend ${usd(m.safe)} safely. That is after ${usd(m.tax)} set aside for taxes (27% of income ${cite('D')}) and ${usd(m.rent)} of bills ${cite('B')}.`;
  return amt <= m.free
    ? `Yes: ${usd(amt)} fits in your free bucket of ${usd(m.free)}, after taxes on income ${cite('D')} and bills ${cite('B')}.`
    : `Not yet: ${usd(amt)} is more than your free bucket of ${usd(m.free)}. Taxes on income ${cite('D')} and bills ${cite('B')} come first.`;
}
function showAnswer(text) {
  const tags = txTags(), used = tags.filter(t => text.includes(`[${t.tag}]`));
  $('answer').innerHTML = `<p></p><ul class="cites">${used.map(t => `<li><b>${t.tag}</b> ${t.text}</li>`).join('')}</ul>`;
  $('answer').firstChild.textContent = text;
}
$('askForm').onsubmit = async e => {
  e.preventDefault();
  const q = $('q').value.trim(); if (!q) return;
  $('answer').textContent = 'Thinking…';
  const m = metrics(+$('late').value);
  const context = { today: iso(TODAY), checking: S.checking, savings: S.savings, safeToSpendToday: Math.round(m.safe), taxBucket: Math.round(m.tax), billsDue: Math.round(m.rent), freeBucket: Math.round(m.free), transactions: txTags() };
  try {
    const r = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, context }) });
    if (!r.ok) throw new Error(r.status);
    const { answer } = await r.json();
    if (!answer) throw new Error('empty');
    showAnswer(answer);
  } catch { showAnswer(ruleCoach(q)); }
};

load().then(render);
