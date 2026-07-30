const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { getDb } = require('../db');

const OPENCLAW_SSH_HOST = process.env.OPENCLAW_SSH_HOST || 'openclaw';
const OPENCLAW_SSH_KEY  = process.env.OPENCLAW_SSH_KEY  || null;
const MAX_HISTORY = 4;
const MAX_PROMPT_CHARS = 4000;
const MAX_BOT_HISTORY_CHARS = 400;

function sshArgs(remoteCmd) {
  const args = [];
  if (OPENCLAW_SSH_KEY) args.push('-i', OPENCLAW_SSH_KEY);
  args.push('-o', 'StrictHostKeyChecking=no', OPENCLAW_SSH_HOST, remoteCmd);
  return args;
}

// In-memory conversation history keyed by sessionKey
const histories = new Map();

function getHistory(key) {
  if (!histories.has(key)) histories.set(key, []);
  return histories.get(key);
}

function buildPrompt(history, message, contexts) {
  const parts = [];

  if (contexts?.length) {
    parts.push('=== CONTEXTO ADICIONAL ===');
    contexts.forEach(c => parts.push(c.slice(0, 3000)));
    parts.push('=== FIN CONTEXTO ===\n');
  }

  if (history.length) {
    const histStr = history
      .map(t => `Usuario: ${t.user}\nSofia: ${t.bot}`)
      .join('\n');
    parts.push(`Historial de conversación:\n${histStr}\n`);
  }

  parts.push(`Usuario: ${message}`);
  const result = parts.join('\n');

  if (result.length > MAX_PROMPT_CHARS) {
    return result.slice(0, MAX_PROMPT_CHARS) + '\n[...contexto recortado por longitud...]';
  }
  return result;
}

// ── Auto-context: snapshot completo de la DB ─────────────
function buildAutoContext(db) {
  try {
    const today = new Date();

    const projects = db.prepare(`
      SELECT p.nombre, p.descripcion, p.estado, p.prioridad,
             p.fecha_fin_est, p.last_comment_text, p.last_comment_by,
             COALESCE(SUM(CASE WHEN te.tipo != 'estimado' THEN te.duracion_seg ELSE 0 END), 0) AS seg_real,
             COALESCE(SUM(CASE WHEN te.tipo = 'estimado' THEN te.duracion_seg ELSE 0 END), 0) AS seg_est,
             GROUP_CONCAT(DISTINCT r.nombre) AS equipo
      FROM projects p
      LEFT JOIN time_entries te ON te.project_id = p.id
      LEFT JOIN assignments a ON a.project_id = p.id
      LEFT JOIN resources r ON r.id = a.resource_id
      WHERE p.estado != 'cerrado'
      GROUP BY p.id
      ORDER BY
        CASE p.estado WHEN 'en_curso' THEN 0 WHEN 'pausado' THEN 1 ELSE 2 END,
        CASE p.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END
    `).all();

    const resources = db.prepare(`
      SELECT r.nombre, r.rol,
             COUNT(DISTINCT CASE WHEN p.estado != 'cerrado' THEN a.project_id END) AS proyectos_activos,
             COALESCE(SUM(CASE WHEN te.tipo != 'estimado' THEN te.duracion_seg ELSE 0 END), 0) AS seg_total
      FROM resources r
      LEFT JOIN assignments a ON a.resource_id = r.id
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN time_entries te ON te.resource_id = r.id
      WHERE r.activo = 1
      GROUP BY r.id
      ORDER BY r.nombre
    `).all();

    const lines = [
      `=== GESTOR DE PROYECTOS — ${today.toLocaleDateString('es-AR')} ===`,
    ];

    for (const p of projects) {
      const hReal = Math.round(p.seg_real / 3600 * 10) / 10;
      const hEst  = Math.round(p.seg_est  / 3600 * 10) / 10;
      const vence = p.fecha_fin_est ? new Date(p.fecha_fin_est) : null;
      const dias  = vence ? Math.round((vence - today) / 86400000) : null;
      const venceStr = !vence         ? 'sin fecha límite'
        : dias < 0                    ? `⚠️ VENCIDO hace ${Math.abs(dias)} días`
        : dias === 0                  ? '⚠️ VENCE HOY'
        : dias <= 7                   ? `⚠️ vence en ${dias} días`
        :                               `vence en ${dias} días`;

      let linea = `[${p.estado.toUpperCase()}] ${p.nombre}`;
      linea += ` | Prioridad: ${p.prioridad} | ${venceStr}`;
      linea += ` | Horas reales: ${hReal}h`;
      if (hEst > 0) linea += ` / estimadas: ${hEst}h`;
      if (p.equipo) linea += ` | Equipo: ${p.equipo}`;
      if (p.descripcion) linea += ` | Desc: ${p.descripcion.slice(0, 100)}`;
      if (p.last_comment_text) {
        linea += ` | Último comentario (${p.last_comment_by || 'N/A'}): "${p.last_comment_text.slice(0, 80)}"`;
      }
      lines.push(linea);
    }

    if (resources.length) {
      lines.push('--- Recursos ---');
      for (const r of resources) {
        const h = Math.round(r.seg_total / 3600 * 10) / 10;
        lines.push(`${r.nombre}${r.rol ? ` (${r.rol})` : ''} — ${r.proyectos_activos} proyectos activos, ${h}h registradas`);
      }
    }

    lines.push('=== FIN DATOS ===');
    return lines.join('\n');
  } catch (e) {
    console.error('[sofia/autoContext]', e.message);
    return '';
  }
}

// ── POST /api/sofia/chat ──────────────────────────────────
router.post('/chat', (req, res) => {
  const { message, sessionId, contexts } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message requerido' });

  const sessionKey = sessionId || 'agent:main:gestor:default';
  const history = getHistory(sessionKey);

  const db = getDb();
  const autoCtx = buildAutoContext(db);
  const allContexts = autoCtx ? [autoCtx, ...(contexts || [])] : (contexts || []);
  const fullPrompt = buildPrompt(history, message, allContexts);

  const escaped = fullPrompt.replace(/'/g, "'\\''");
  const ephemeralKey = randomUUID();
  const remoteCmd = `openclaw agent --agent main --session-key '${ephemeralKey}' --message '${escaped}' --json`;

  execFile('ssh', sshArgs(remoteCmd), { timeout: 120000 }, (err, stdout) => {
    if (err) {
      console.error('[sofia] ssh error:', err.message);
      return res.status(500).json({ error: 'Error al conectar con Sofia' });
    }
    try {
      const json = JSON.parse(stdout.trim());
      const text = json.result?.payloads?.[0]?.text ?? '';
      history.push({ user: message, bot: text.slice(0, MAX_BOT_HISTORY_CHARS) });
      if (history.length > MAX_HISTORY) history.shift();
      res.json({ text, sessionKey });
    } catch (e) {
      console.error('[sofia] parse error:', e.message, stdout.slice(0, 300));
      res.status(500).json({ error: 'Error al parsear respuesta de Sofia' });
    }
  });
});

// ── DELETE /api/sofia/chat — limpiar historial ─────────────
router.delete('/chat', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) histories.delete(sessionId);
  res.json({ ok: true });
});

// ── GET /api/sofia/projects — contexto de proyectos ───────
router.get('/projects', (req, res) => {
  try {
    const db = getDb();
    const projects = db.prepare(`
      SELECT p.nombre, p.estado, p.prioridad,
             p.fecha_fin_est, p.last_comment_text, p.last_comment_by,
             p.last_comment_at, p.ai_summary,
             COALESCE(SUM(te.duracion_seg), 0) AS seg_total,
             COUNT(DISTINCT a.resource_id) AS recursos
      FROM projects p
      LEFT JOIN time_entries te ON te.project_id = p.id AND te.tipo != 'estimado'
      LEFT JOIN assignments a ON a.project_id = p.id
      WHERE p.estado != 'cerrado'
      GROUP BY p.id
      ORDER BY
        CASE p.estado WHEN 'en_curso' THEN 0 WHEN 'pausado' THEN 1 ELSE 2 END,
        CASE p.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END
    `).all();

    const today = new Date();

    const formatted = projects.map(p => {
      const horas = Math.round(p.seg_total / 3600 * 10) / 10;
      const vence = p.fecha_fin_est ? new Date(p.fecha_fin_est) : null;
      const diasParaVencer = vence ? Math.round((vence - today) / 86400000) : null;
      const venceStr = vence
        ? diasParaVencer < 0
          ? `VENCIDO hace ${Math.abs(diasParaVencer)} días`
          : diasParaVencer === 0
            ? 'VENCE HOY'
            : `vence en ${diasParaVencer} días`
        : 'sin fecha';

      let linea = `• [${p.estado.toUpperCase()}] ${p.nombre}`;
      linea += ` | Prioridad: ${p.prioridad}`;
      linea += ` | ${venceStr} | Horas registradas: ${horas}h | Recursos: ${p.recursos}`;
      if (p.last_comment_text) {
        const snippet = p.last_comment_text.slice(0, 60).replace(/\n/g, ' ');
        linea += ` | Último comentario (${p.last_comment_by || 'N/A'}): "${snippet}"`;
      }
      return linea;
    });

    const summary = [
      `Estado de proyectos activos al ${today.toLocaleDateString('es-AR')} (${projects.length} proyectos):`,
      ...formatted
    ].join('\n');

    res.json({ context: summary, count: projects.length });
  } catch (e) {
    console.error('[sofia/projects]', e.message);
    res.status(500).json({ error: 'Error al leer proyectos' });
  }
});

// ── POST /api/sofia/parse-file — parsear PDF/texto ────────
router.post('/parse-file', express.json({ limit: '10mb' }), async (req, res) => {
  const { filename, mimeType, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data requerido' });

  try {
    const buffer = Buffer.from(data, 'base64');

    if (mimeType === 'application/pdf' || filename?.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buffer);
      const text = result.text.slice(0, 8000); // limit context size
      return res.json({ text, pages: result.numpages });
    }

    // Plain text (txt, md, csv, json, etc.)
    const text = buffer.toString('utf-8').slice(0, 8000);
    return res.json({ text });
  } catch (e) {
    console.error('[sofia/parse-file]', e.message);
    res.status(500).json({ error: `No se pudo parsear el archivo: ${e.message}` });
  }
});

// ── GET /api/sofia/status ─────────────────────────────────
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
