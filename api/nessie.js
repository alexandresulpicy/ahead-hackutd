// Vercel serverless : proxy Nessie. La clé reste côté serveur (variable d'environnement NESSIE_API_KEY).
// Liste blanche stricte : lecture des clients/comptes, écriture seulement de dépôts et de virements,
// suppression seulement d'un dépôt (pour annuler un paiement de démo).
const BASE = 'https://api.nessieisreal.com';
const ALLOWED = {
  GET: /^\/(customers|accounts)[\w\/-]*$/,
  POST: /^\/accounts\/[\w-]+\/(deposits|transfers)$/,
  DELETE: /^\/deposits\/[\w-]+$/,
};
export default async function handler(req, res) {
  const path = String(req.query.path || '');
  const rule = ALLOWED[req.method];
  if (!rule || !rule.test(path)) return res.status(400).json({ error: 'not allowed' });
  const r = await fetch(`${BASE}${path}?key=${process.env.NESSIE_API_KEY}`, {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
  });
  res.status(r.status).send(await r.text());
}
