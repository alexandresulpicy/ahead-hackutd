// Vercel serverless : proxy Nessie, la clé reste côté serveur (variable d'environnement NESSIE_API_KEY)
const BASE = 'https://api.nessieisreal.com';
export default async function handler(req, res) {
  const path = String(req.query.path || '');
  if (!/^\/(customers|accounts)[\w\/-]*$/.test(path)) return res.status(400).json({ error: 'bad path' });
  const r = await fetch(`${BASE}${path}?key=${process.env.NESSIE_API_KEY}`, {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body: req.method === 'GET' ? undefined : JSON.stringify(req.body),
  });
  res.status(r.status).send(await r.text());
}
