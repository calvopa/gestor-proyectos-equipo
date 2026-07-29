const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');

const OPENCLAW_SSH_HOST = process.env.OPENCLAW_SSH_HOST || 'openclaw';
const OPENCLAW_SSH_KEY  = process.env.OPENCLAW_SSH_KEY  || null;

function sshArgs(remoteCmd) {
  const args = [];
  if (OPENCLAW_SSH_KEY) args.push('-i', OPENCLAW_SSH_KEY);
  args.push('-o', 'StrictHostKeyChecking=no', OPENCLAW_SSH_HOST, remoteCmd);
  return args;
}
const MAX_HISTORY = 10; // turns to keep per session

// In-memory conversation history keyed by sessionKey
const histories = new Map();

function getHistory(key) {
  if (!histories.has(key)) histories.set(key, []);
  return histories.get(key);
}

function buildPrompt(history, message) {
  if (!history.length) return message;
  const ctx = history
    .map(t => `Usuario: ${t.user}\nSofia: ${t.bot}`)
    .join('\n');
  return `Historial de conversación:\n${ctx}\n\nUsuario: ${message}`;
}

router.post('/chat', (req, res) => {
  const { message, sessionId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message requerido' });

  const sessionKey = sessionId || 'agent:main:gestor:default';
  const history = getHistory(sessionKey);
  const fullPrompt = buildPrompt(history, message);

  const escaped = fullPrompt.replace(/'/g, "'\\''");
  const remoteCmd = `openclaw agent --agent main --session-key '${sessionKey}' --message '${escaped}' --json`;

  execFile('ssh', sshArgs(remoteCmd), { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[sofia] ssh error:', err.message);
      return res.status(500).json({ error: 'Error al conectar con Sofia' });
    }
    try {
      const json = JSON.parse(stdout.trim());
      const text = json.result?.payloads?.[0]?.text ?? '';

      // Save to history
      history.push({ user: message, bot: text });
      if (history.length > MAX_HISTORY) history.shift();

      res.json({ text, sessionKey });
    } catch (e) {
      console.error('[sofia] parse error:', e.message, stdout.slice(0, 300));
      res.status(500).json({ error: 'Error al parsear respuesta de Sofia' });
    }
  });
});

router.delete('/chat', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) histories.delete(sessionId);
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  execFile('ssh', sshArgs('openclaw health --json'),
    { timeout: 10000 },
    (err, stdout) => {
      if (err) return res.json({ online: false });
      try {
        const json = JSON.parse(stdout.trim());
        res.json({ online: json.ok === true });
      } catch {
        res.json({ online: false });
      }
    }
  );
});

module.exports = router;
