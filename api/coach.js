// Vercel serverless : coach Claude Haiku. Clé dans la variable d'environnement ANTHROPIC_API_KEY (jamais dans le front).
const SYSTEM = `You are Steady, a financial coach for people with irregular income (freelancers, gig workers, students).
Answer in English, in at most 60 words, plain and warm. Use ONLY the numbers and transactions provided.
Cite every transaction you rely on by its tag in brackets, like [D1] or [B2]. Never invent a transaction. No investment advice.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { question, context } = req.body || {};
  if (typeof question !== 'string' || question.length > 300) return res.status(400).json({ error: 'bad question' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 250, system: SYSTEM,
      messages: [{ role: 'user', content: `Data:\n${JSON.stringify(context)}\n\nQuestion: ${question}` }],
    }),
  });
  if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status });
  const j = await r.json();
  const answer = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  res.status(200).json({ answer });
}
