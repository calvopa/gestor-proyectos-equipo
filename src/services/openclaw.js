const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://192.168.1.38:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b';

async function query(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: 512 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  return json.response?.trim() || '';
}

function parseStructured(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const avanzo    = lines.find(l => /^[\-▸•*]?\s*avanz/i.test(l));
  const pendiente = lines.find(l => /^[\-▸•*]?\s*pendiente/i.test(l));
  const consejo   = lines.find(l => /^[\-▸•*]?\s*consejo/i.test(l));
  const summary = [avanzo, pendiente].filter(Boolean).join('\n') || raw.trim();
  const advice  = consejo || '';
  return { summary, advice };
}

module.exports = { query, parseStructured };
