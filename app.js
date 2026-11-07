// IDs du compte de test Nessie (non secrets)
const CH = 'ee0be6f8-275f-48fc-8843-995a05e11a59', SV = '4b98e589-8627-41a4-b2dd-acfed22513e3';
const TODAY = new Date('2026-11-07'), DAY = 864e5, HORIZON = 45;
const $ = id => document.getElementById(id);
const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

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
  const dailySpend = 28, nextIncome = { day: 12 + lateWeeks * 7, amount: 1500 };
  let bal = S.checking, out = [];
  for (let i = 0; i <= HORIZON; i++) {
    const date = iso(new Date(+TODAY + i * DAY));
    if (i > 0) bal -= dailySpend;
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

// --- Rendu ---
function render() {
  const late = +$('late').value; $('lateVal').textContent = late;
  const m = metrics(late);
  $('safe').textContent = usd(m.safe);
  $('buckets').innerHTML = [['Taxes (27%)', m.tax], ['Bills due', m.rent], ['Free', m.free]]
    .map(([n, v]) => `<div class="bucket">${n}<b>${usd(v)}</b></div>`).join('');
  $('alert').hidden = !m.first && $('done').hidden;
  $('alertText').textContent = m.first ? `Checking goes to ${usd(m.first.bal)} on ${m.first.date}. Move money from savings ${m.first.i} days early?` : 'No overdraft in the next 45 days.';
  $('prevent').hidden = !m.first;
  $('health').innerHTML = [['Savings rate', Math.round(S.savings / (S.savings + S.checking) * 100) + '%'], ['Reserve', (S.savings / 1700).toFixed(1) + ' mo'], ['Debt / income', '0%']]
    .map(([n, v]) => `<div>${n}<b>${v}</b></div>`).join('');
  drawChart(m.f.out);
}
function drawChart(pts) {
  const c = $('chart'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const lo = Math.min(0, ...pts.map(p => p.bal)), hi = Math.max(...pts.map(p => p.bal));
  const x = i => i / HORIZON * W, y = v => H - 10 - (v - lo) / (hi - lo || 1) * (H - 20);
  g.strokeStyle = '#d3dde4'; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(W, y(0)); g.stroke();
  g.lineWidth = 2.5; g.strokeStyle = '#1b7f8c'; g.beginPath();
  pts.forEach((p, k) => k ? g.lineTo(x(p.i), y(p.bal)) : g.moveTo(x(p.i), y(p.bal))); g.stroke();
  g.strokeStyle = '#c8372d'; g.beginPath(); let on = false;
  pts.forEach(p => { if (p.bal < 0) { on ? g.lineTo(x(p.i), y(p.bal)) : g.moveTo(x(p.i), y(p.bal)); on = true; } }); g.stroke();
}

// --- Action : Prevent it ---
$('prevent').onclick = async () => {
  const m = metrics(+$('late').value), need = Math.ceil(-Math.min(...m.f.out.map(p => p.bal)) + 50);
  S.savings -= need; S.checking += need; savedByPrevent = 36;
  $('done').hidden = false; $('done').textContent = `Overdraft avoided. ${usd(savedByPrevent)} in fees saved.`;
  render();
  // Nessie ne déplace pas les soldes : le transfer est enregistré en best-effort
  try { await nessie(`/accounts/${SV}/transfers`, 'POST', { status: 'pending', amount: need, transaction_date: iso(TODAY), description: `Prevent overdraft: savings ${SV} -> checking ${CH}` }); } catch {}
};
$('late').oninput = render;
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
    showAnswer((await r.json()).answer);
  } catch { showAnswer(ruleCoach(q)); }
};

load().then(render);
