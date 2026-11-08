// Ahead — moteur : données Nessie, modèle de revenu irrégulier, prévisions
// IDs du compte de test Nessie (non secrets)
const CUSTOMER = 'b25d35fb-c5e7-4311-a81b-52a754262e90';
const CH = 'ee0be6f8-275f-48fc-8843-995a05e11a59', SV = '4b98e589-8627-41a4-b2dd-acfed22513e3';
const TODAY = new Date('2026-11-07'), DAY = 864e5, HORIZON = 45, OVERDRAFT_FEE = 36;
const $ = id => document.getElementById(id);
const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const iso = d => d.toISOString().slice(0, 10);
const nice = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Préférences de l'utilisateur (onboarding) : elles changent vraiment les calculs
const PREFS = (() => {
  const d = { kind: 'Freelance', taxRate: 0.27, cushion: 50, done: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem('ahead_prefs') || '{}') }; } catch { return d; }
})();
function savePrefs() { try { localStorage.setItem('ahead_prefs', JSON.stringify(PREFS)); } catch {} }

// --- Couche données : Nessie via /api/nessie, repli sur données simulées (même histoire) ---
async function nessie(path, method = 'GET', body) {
  const r = await fetch('/api/nessie?path=' + encodeURIComponent(path), {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status);
  const t = await r.text(); return t ? JSON.parse(t) : {};
}
// Autopilot : enveloppes protégées (comptées dans l'épargne, jamais utilisées pour couvrir un découvert) et règles
const ENV = { tax: 0, bills: 0 };
const RULES = { tax: true, bills: true, billsPct: 0.2 };
const freeSavings = () => Math.max(0, S.savings - ENV.tax - ENV.bills);
function demoData() { // miroir du compte Nessie : 90 jours de freelance, revenu irrégulier
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cats = [['Groceries', 30, 70, .30], ['Gas', 25, 45, .12], ['Eating out', 12, 30, .22], ['Coffee', 5, 9, .20], ['Equipment', 90, 220, .03]];
  const purchases = [];
  for (let i = 89; i >= 1; i--) cats.forEach(([n, lo, hi, p]) => { if (rnd() < p) purchases.push({ purchase_date: iso(new Date(+TODAY - i * DAY)), amount: lo + Math.floor(rnd() * (hi - lo + 1)), description: n }); });
  return {
    checking: 900, savings: 2500, debt: 640, purchases,
    loans: [{ type: 'auto', amount: 6400, monthly_payment: 215, description: 'Auto loan - Honda Civic, 36 months left' }, { type: 'student', amount: 14500, monthly_payment: 120, description: 'Federal student loan' }],
    deposits: [['2026-08-14', 1200, 'Brand video - Elite Frame'], ['2026-08-28', 450, 'Tennis coaching'], ['2026-09-22', 120, 'Photo edit - Elite Frame'],
      ['2026-10-09', 3800, 'Wedding film - Elite Frame'], ['2026-10-27', 1200, 'Product shoot - Elite Frame'], ['2026-11-01', 300, 'Tennis coaching']]
      .map(([transaction_date, amount, description]) => ({ transaction_date, amount, description })),
    bills: [{ nickname: 'Rent', payment_amount: 850, payment_date: '2026-11-15', recurring_date: 15 }, { nickname: 'Phone', payment_amount: 60, payment_date: '2026-11-20', recurring_date: 20 },
      { nickname: 'Software', payment_amount: 30, payment_date: '2026-12-05', recurring_date: 5 }],
  };
}
let S = demoData(), live = false;
const ACCT_NUM = { checking: '8119703152899929', savings: '4631914452509412', card: '5884899707034995' }; // repli hors-ligne (numéros Nessie de test)
// Comptes externes liés à la main (Nessie n'a ni CD ni IRA) : c'est ce que fait un vrai agrégateur
const LINKED = [{ type: 'CD', name: '12-month CD', bank: 'linked manually', balance: 3000 }, { type: 'IRA', name: 'Roth IRA', bank: 'linked manually', balance: 4200 }];
const LOAN_DAY = { auto: 25, student: 28 }, CARD_MIN = { day: 22, amt: 35 }; // jours d'échéance : Nessie ne les fournit pas

async function load() {
  try {
    const [d, p, b, a, l] = await Promise.all([nessie(`/accounts/${CH}/deposits`), nessie(`/accounts/${CH}/purchases`), nessie(`/accounts/${CH}/bills`), nessie(`/customers/${CUSTOMER}/accounts`), nessie(`/accounts/${CH}/loans`).catch(() => S.loans)]);
    const by = t => a.find(x => x.type === t);
    S.accts = a;
    Object.assign(S, { deposits: d, purchases: p, bills: b, loans: l.length ? l : S.loans, checking: by('Checking').balance, savings: by('Savings').balance, debt: by('Credit Card')?.balance || 0 });
    live = true;
  } catch { live = false; } // pas de proxy en local : démo simulée
  return live;
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
  const liquid = S.checking + S.savings, tax = PREFS.taxRate * M.monthIncome * 3;
  const billsDue = fc.bills.filter(b => b.i <= fc.first).reduce((s, b) => s + b.amt, 0);
  const free = Math.max(0, liquid - tax - billsDue), safe = free / Math.max(1, fc.first);
  const minE = minOf(fe), minC = minOf(fc);
  const riskE = minE.bal < 0 ? minE : null, riskC = minC.bal < 0 ? minC : null;
  const need = riskC ? Math.min(freeSavings(), Math.ceil(-minC.bal + PREFS.cushion)) : 0;
  const dry = fe.out.find(p => p.i > 0 && p.bal < 0), daysAhead = dry ? dry.i : HORIZON; // jours avant le premier manque, cas attendu (le retard du client le fait bouger)
  return { fe, fc, ff, M, daysAhead, capped: !dry, liquid, tax, billsDue, free, safe, daysToIncome: fc.first, minE, minC, riskE, riskC, need };
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

// --- Vue 360° : valeur nette et échéancier de toutes les obligations ---
function wholePicture() {
  const assets = [['Checking', S.checking, 'Nessie'], ['Savings', S.savings, 'Nessie'], ...LINKED.map(a => [a.name, a.balance, a.bank])];
  const debts = [['Visa card', S.debt, 'Nessie', 'Credit Card'], ...S.loans.map(l => [l.description.split(' - ')[0].replace(/ \(.*/, ''), l.amount, 'Nessie loans', l.type])];
  const A = assets.reduce((s, x) => s + x[1], 0), D = debts.reduce((s, x) => s + x[1], 0);
  const dues = [];
  for (let i = 1; i <= HORIZON; i++) {
    const date = iso(new Date(+TODAY + i * DAY)), day = +date.slice(8, 10);
    S.bills.forEach(b => { if (b.recurring_date ? b.recurring_date === day : b.payment_date === date) dues.push({ date, name: b.nickname, kind: 'Bill', amt: b.payment_amount }); });
    S.loans.forEach(l => { if (LOAN_DAY[l.type] === day) dues.push({ date, name: l.type === 'auto' ? 'Auto loan' : l.type === 'student' ? 'Student loan' : 'Loan', kind: 'Loan', amt: l.monthly_payment }); });
    if (CARD_MIN.day === day) dues.push({ date, name: 'Visa minimum', kind: 'Card', amt: CARD_MIN.amt });
  }
  return { assets, debts, A, D, net: A - D, dues, dueTotal: dues.reduce((s, d) => s + d.amt, 0) };
}
