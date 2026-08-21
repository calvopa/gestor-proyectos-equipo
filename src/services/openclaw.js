const { execFile } = require('child_process');
const { randomUUID } = require('crypto');

const SSH_HOST = process.env.OPENCLAW_SSH_HOST || 'openclaw';
const SSH_KEY  = process.env.OPENCLAW_SSH_KEY  || null;

function query(prompt) {
  return new Promise((resolve, reject) => {
    const key     = randomUUID();
    const escaped = prompt.replace(/'/g, "'\\''");
    const args    = [];
    if (SSH_KEY) args.push('-i', SSH_KEY);
    args.push(
      '-o', 'StrictHostKeyChecking=accept-new',
      SSH_HOST,
      `openclaw agent --agent gestor --session-key '${key}' --message '${escaped}' --json`
    );
    execFile('ssh', args, { timeout: 90000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const json = JSON.parse(stdout.trim());
        resolve(json.result?.payloads?.[0]?.text?.trim() || '');
      } catch (e) { reject(e); }
    });
  });
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
