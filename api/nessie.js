// Vercel serverless : proxy Nessie. La clé reste côté serveur (variable d'environnement NESSIE_API_KEY).
// Liste blanche stricte : lecture des clients/comptes, écriture seulement de dépôts, de virements et de prêts,
// suppression seulement d'un dépôt (pour annuler un paiement de démo).
const HOSTS = ['https://api.nessieisreal.com', 'https://prod-api.nessieisreal.com'];
const ALLOWED = {
  GET: /^\/(customers|accounts|merchants)[\w\/-]*$/,
  POST: /^\/accounts\/[\w-]+\/(deposits|transfers|loans)$/,
  DELETE: /^\/(deposits|transfers)\/[\w-]+$/,
};
export default async function handler(req, res) {
  const path = String(req.query.path || '');
  const rule = ALLOWED[req.method];
  if (!rule || !rule.test(path)) return res.status(400).json({ error: 'not allowed' });
  const key = String(process.env.NESSIE_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  res.setHeader('x-ahead-key-len', String(key.length)); // diagnostic : longueur seulement, jamais la valeur
  let last;
  for (const host of HOSTS) { // si une adresse refuse la clé (401), on essaie l'autre
    last = await fetch(`${host}${path}?key=${encodeURIComponent(key)}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });
    if (last.status !== 401) break;
  }
  res.status(last.status).send(await last.text());
}
