// Vercel serverless : proxy Nessie. La clé reste côté serveur (variable d'environnement NESSIE_API_KEY).
// Verrouillé (9/11) : seuls le client et les comptes de la démo sont lisibles ; on ne peut écrire que des
// opérations de démo (descriptions connues, montants bornés) ; on ne peut effacer QUE des opérations de démo,
// jamais l'historique de base (dépôts, achats, factures, prêts).
const HOST = 'https://api.nessieisreal.com';
const CUSTOMER = 'b25d35fb-c5e7-4311-a81b-52a754262e90';
const CH = 'ee0be6f8-275f-48fc-8843-995a05e11a59', SV = '4b98e589-8627-41a4-b2dd-acfed22513e3', CARD = '9431d5c7-5271-4e7f-b0d6-568919f4e78a';
const ACCTS = `(${CH}|${SV}|${CARD})`;
const GET_OK = [
  new RegExp(`^/customers/${CUSTOMER}/accounts$`),
  new RegExp(`^/accounts/${ACCTS}(/(deposits|purchases|bills|loans|transfers))?$`),
  /^\/merchants$/,
];
const POST_OK = new RegExp(`^/accounts/(${CH}|${SV})/(deposits|transfers)$`);
const DELETE_OK = /^\/(deposits|transfers)\/[0-9a-f-]{20,40}$/;
// Seules opérations que l'app écrit (et donc les seules qu'on peut effacer)
const DEMO = /^(Delayed payment - Elite Frame client|Autopilot demo - client payment|Ahead prevent:|Ahead autopilot:|Ahead coach:|P2P received:)/;

const key = () => String(process.env.NESSIE_API_KEY || '').trim().replace(/^["']|["']$/g, '');
const call = (method, path, body) => fetch(`${HOST}${path}?key=${encodeURIComponent(key())}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const deny = (res, why) => res.status(403).json({ error: 'not allowed', why });

export default async function handler(req, res) {
  const path = String(req.query.path || '');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (!GET_OK.some(r => r.test(path))) return deny(res, 'path');
    const r = await call('GET', path);
    return res.status(r.status).send(await r.text());
  }

  if (req.method === 'POST') {
    if (!POST_OK.test(path)) return deny(res, 'path');
    const b = req.body || {};
    const amount = Number(b.amount), desc = String(b.description || '');
    if (!DEMO.test(desc) || desc.length > 160) return deny(res, 'description');
    if (!(amount > 0 && amount <= 10000)) return deny(res, 'amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.transaction_date || ''))) return deny(res, 'date');
    const clean = { status: ['pending', 'completed'].includes(b.status) ? b.status : 'pending', amount, transaction_date: b.transaction_date, description: desc };
    if (path.endsWith('/deposits')) clean.medium = 'balance';
    const r = await call('POST', path, clean);
    return res.status(r.status).send(await r.text());
  }

  if (req.method === 'DELETE') {
    if (!DELETE_OK.test(path)) return deny(res, 'path');
    // On relit l'opération : on n'efface que si c'est une opération de démo
    const g = await call('GET', path);
    if (!g.ok) return res.status(g.status).send(await g.text());
    const obj = await g.json().catch(() => ({}));
    if (!DEMO.test(String(obj.description || ''))) return deny(res, 'protected');
    const r = await call('DELETE', path);
    return res.status(r.status).send(await r.text());
  }

  return deny(res, 'method');
}
