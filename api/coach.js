// Vercel serverless : coach Ahead (Claude Haiku 5.5). Clé dans ANTHROPIC_API_KEY (jamais dans le front).
// Réponse structurée (output_config.format) : texte court + transactions citées + suggestions + UNE action proposée,
// que l'app affiche en bouton et que le client exécute d'un tap (son consentement).
const SYSTEM = `You are Ahead, the in-app money coach of Alexandre, a freelancer (video work and tennis coaching) whose income is irregular.
Write like a sharp, warm friend in a chat app:
- One or two short sentences, 40 words maximum. No lists, no greetings, no preamble.
- Never repeat what you already said earlier in the conversation; build on it. Match the user's tone.
- Use only the numbers in DATA. When you rely on a transaction, cite its tag in brackets in the text, like [D1] or [B2], and list the tags in "cites".
- If the user wants to act, or asks what to do about a predicted shortfall, propose exactly one action:
  "prevent" = move the precomputed shortfall amount (DATA.preventAmount) from savings to checking; only when DATA.shortfallPredicted is true.
  "move" = move a specific amount between savings and checking; never more than DATA.freeSavings from savings.
  The app turns the action into a button the user taps. Say "Tap below" instead of claiming it is done.
  Otherwise action.type is "none" with amount 0.
- "suggestions": 2 or 3 short follow-up questions the user might ask next, in the first person, 6 words maximum each, different from what was already asked.
- No investment advice: if asked, say you can't give it.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['text', 'cites', 'suggestions', 'action'],
  properties: {
    text: { type: 'string' },
    cites: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
    action: {
      type: 'object', additionalProperties: false, required: ['type', 'from', 'to', 'amount', 'label'],
      properties: {
        type: { type: 'string', enum: ['none', 'prevent', 'move'] },
        from: { type: 'string', enum: ['savings', 'checking', 'none'] },
        to: { type: 'string', enum: ['savings', 'checking', 'none'] },
        amount: { type: 'number' },
        label: { type: 'string' },
      },
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { messages, context } = req.body || {};
  // Historique court et propre : alternance user/assistant, texte seulement, longueur bornée
  const hist = (Array.isArray(messages) ? messages : []).slice(-8)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 600)
    .map(m => ({ role: m.role, content: m.content }));
  while (hist.length && hist[0].role !== 'user') hist.shift();
  if (!hist.length || hist[hist.length - 1].role !== 'user') return res.status(400).json({ error: 'bad messages' });
  const last = hist[hist.length - 1];
  last.content = `DATA:\n${JSON.stringify(context || {})}\n\nUser: ${last.content}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 600, thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM, messages: hist,
    }),
  });
  if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status, detail: (await r.text()).slice(0, 300) });
  const j = await r.json();
  if (j.stop_reason === 'refusal') return res.status(200).json({ text: "I can't help with that one. Ask me about your balance, bills or next payment.", cites: [], suggestions: [], action: { type: 'none', from: 'none', to: 'none', amount: 0, label: '' } });
  const raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try { res.status(200).json(JSON.parse(raw)); }
  catch { res.status(502).json({ error: 'bad json' }); }
}
