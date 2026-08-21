const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { getDb } = require('../db');
const { getToken, fetchWeekActivity } = require('../services/clickup');
const { generateEstimates } = require('../services/estimator');

const OPENCLAW_SSH_HOST = process.env.OPENCLAW_SSH_HOST || 'openclaw';
const OPENCLAW_SSH_KEY  = process.env.OPENCLAW_SSH_KEY  || null;

function sshArgs(remoteCmd) {
  const args = [];
  if (OPENCLAW_SSH_KEY) args.push('-i', OPENCLAW_SSH_KEY);
  args.push('-o', 'StrictHostKeyChecking=accept-new', OPENCLAW_SSH_HOST, remoteCmd);
  return args;
}

function openclawSummary(prompt) {
  return new Promise((resolve, reject) => {
    const key = randomUUID();
    const escaped = prompt.replace(/'/g, "'\\''");
    const remoteCmd = `openclaw agent --agent gestor --session-key '${key}' --message '${escaped}' --json`;
    execFile('ssh', sshArgs(remoteCmd), { timeout: 90000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const json = JSON.parse(stdout.trim());
        resolve(json.result?.payloads?.[0]?.text?.trim() || '');
      } catch (e) { reject(e); }
    });
  });
}

const SALUD_SCORE = { green: 3, yellow: 2, red: 1, grey: 0, cerrado: -1, backlog: -1 };

function clasificar(p) {
  if (p.estado === 'cerrado') return 'cerrado';
  if (p.estado === 'backlog')  return 'backlog';
  const ref  = p.last_comment_at || p.ultima_hora || p.updated_at;
  const dias = ref
    ? Math.floor((Date.now() - new Date(ref.replace(' ', 'T') + (ref.includes('T') ? '' : 'Z'))) / 86400000)
    : null;
  const dv   = p.fecha_fin_est
    ? Math.floor((new Date(p.fecha_fin_est) - Date.now()) / 86400000)
    : null;
  if (p.estado === 'en_curso') {
    if (dv !== null && dv < 0)              return 'red';
    if (dias !== null && dias >= 7)         return 'red';
    if (dv !== null && dv >= 0 && dv <= 5) return 'yellow';
    if (dias !== null && dias >= 3)         return 'yellow';
    return 'green';
  }
  if (p.estado === 'pausado') {
    if (dias !== null && dias >= 14) return 'yellow';
    return 'grey';
  }
  return 'grey';
}

// GET /api/semana?from=YYYY-MM-DD&to=YYYY-MM-DD[&refresh=1]
router.get('/', async (req, res) => {
  const { from, to, refresh } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Parámetros from y to requeridos' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return res.status(400).json({ error: 'Formato de fecha inválido (YYYY-MM-DD)' });

  try {
    const db = getDb();
    const cached = db.prepare('SELECT COUNT(*) as n FROM weekly_activity WHERE week_start=?').get(from);
    const needFetch = cached.n === 0 || refresh === '1';

    let fetchedFromClickup = false;
    if (needFetch) {
      const token = getToken();
      if (token) {
        try {
          await fetchWeekActivity(db, from, to, token);
          fetchedFromClickup = true;
          const est = generateEstimates();
          if (est.created > 0) console.log(`[semana] ${est.created} estimados generados desde nuevos comentarios`);
        } catch (err) {
          console.error('[semana] fetchWeekActivity error:', err.message);
        }
      }
    }

    const projects = db.prepare(`
      SELECT p.*,
        GROUP_CONCAT(DISTINCT r.nombre) as tecnicos,
        (SELECT MAX(te.inicio) FROM time_entries te WHERE te.project_id=p.id) as ultima_hora,
        spc.comment AS sprint_comment,
        spc.updated_at AS sprint_comment_at
      FROM projects p
      LEFT JOIN assignments a ON a.project_id=p.id
      LEFT JOIN resources r ON r.id=a.resource_id
      LEFT JOIN sprint_project_comments spc ON spc.project_id=p.id
        AND spc.sprint_id=(SELECT id FROM sprints WHERE estado='activo' ORDER BY id DESC LIMIT 1)
      GROUP BY p.id
    `).all();

    const prevDate = new Date(from + 'T00:00:00Z');
    prevDate.setUTCDate(prevDate.getUTCDate() - 7);
    const prevWeekStart = prevDate.toISOString().slice(0, 10);
    const toMs = new Date(to + 'T23:59:59Z').getTime();

    const insertSnap = db.prepare(`
      INSERT INTO weekly_snapshots
        (project_id, week_start, salud, fase, prioridad, tecnicos, event_count, dias_inactivo, fecha_fin_est)
      VALUES
        (@project_id, @week_start, @salud, @fase, @prioridad, @tecnicos, @event_count, @dias_inactivo, @fecha_fin_est)
      ON CONFLICT(project_id, week_start) DO UPDATE SET
        salud=excluded.salud, fase=excluded.fase, prioridad=excluded.prioridad,
        tecnicos=excluded.tecnicos, event_count=excluded.event_count,
        dias_inactivo=excluded.dias_inactivo, fecha_fin_est=excluded.fecha_fin_est
    `);

    const result = projects.map(p => {
      const events = db.prepare(
        'SELECT * FROM weekly_activity WHERE project_id=? AND week_start=? ORDER BY event_at ASC'
      ).all(p.id, from);

      const prevSnap = db.prepare(
        'SELECT * FROM weekly_snapshots WHERE project_id=? AND week_start=?'
      ).get(p.id, prevWeekStart);

      const salud     = clasificar(p);
      const saludPrev = prevSnap?.salud ?? null;

      // Days inactive up to end of week (or now, whichever is earlier)
      const lastEventAt = events.length
        ? events[events.length - 1].event_at
        : null;
      const refStr = lastEventAt || p.last_comment_at || p.updated_at;
      let diasInactivo = null;
      if (refStr) {
        const refMs = new Date(refStr.replace(' ', 'T') + (refStr.includes('T') ? '' : 'Z')).getTime();
        diasInactivo = Math.floor((Math.min(Date.now(), toMs) - refMs) / 86400000);
        if (diasInactivo < 0) diasInactivo = 0;
      }

      // Movement vs previous week
      let movimiento = null;
      if (saludPrev !== null) {
        const curr = SALUD_SCORE[salud]     ?? 0;
        const prev = SALUD_SCORE[saludPrev] ?? 0;
        if (curr > prev) movimiento = 'mejoró';
        else if (curr < prev) movimiento = 'empeoró';
        else {
          const dPrev = prevSnap.dias_inactivo ?? 999;
          const dCurr = diasInactivo ?? 999;
          if (dCurr < dPrev && events.length > 0) movimiento = 'mejoró';
          else if (dCurr > dPrev) movimiento = 'empeoró';
          else movimiento = 'igual';
        }
      }

      const phaseChanged = !!(prevSnap?.fase && prevSnap.fase !== p.clickup_status);

      insertSnap.run({
        project_id:    p.id,
        week_start:    from,
        salud,
        fase:          p.clickup_status,
        prioridad:     p.prioridad,
        tecnicos:      p.tecnicos,
        event_count:   events.length,
        dias_inactivo: diasInactivo,
        fecha_fin_est: p.fecha_fin_est,
      });

      const snapRow = db.prepare(
        'SELECT ai_summary FROM weekly_snapshots WHERE project_id=? AND week_start=?'
      ).get(p.id, from);

      const horasEst = db.prepare(`
        SELECT COALESCE(SUM(duracion_seg), 0) as seg_estimado_semana
        FROM time_entries
        WHERE project_id=? AND tipo='estimado' AND inicio >= ? AND inicio <= ?
      `).get(p.id, from + ' 00:00:00', to + ' 23:59:59');

      return {
        id:                   p.id,
        nombre:               p.nombre,
        estado:               p.estado,
        prioridad:            p.prioridad,
        clickup_status:       p.clickup_status,
        fecha_fin_est:        p.fecha_fin_est,
        tecnicos:             p.tecnicos,
        last_comment_at:      p.last_comment_at,
        updated_at:           p.updated_at,
        salud,
        salud_prev:           saludPrev,
        events,
        event_count:          events.length,
        has_activity:         events.length > 0,
        movimiento,
        dias_inactivo:        diasInactivo,
        dias_inactivo_prev:   prevSnap?.dias_inactivo ?? null,
        fase_changed:         phaseChanged,
        fase_prev:            prevSnap?.fase ?? null,
        ai_summary:           snapRow?.ai_summary ?? null,
        sprint_comment:       p.sprint_comment || null,
        sprint_comment_at:    p.sprint_comment_at || null,
        seg_estimado_semana:  horasEst.seg_estimado_semana,
      };
    });

    result.sort((a, b) => {
      if (a.has_activity !== b.has_activity) return b.has_activity ? 1 : -1;
      return b.event_count - a.event_count;
    });

    const withActivity = result.filter(p => p.has_activity).length;
    const totalEvents  = result.reduce((a, p) => a + p.event_count, 0);
    const phaseChanges = result.filter(p => p.fase_changed).length;
    const enteredRisk  = result.filter(p =>
      p.salud === 'red' && p.salud_prev !== null && p.salud_prev !== 'red'
    ).length;
    const leftRisk     = result.filter(p =>
      p.salud !== 'red' && p.salud_prev === 'red'
    ).length;

    res.json({
      week_start: from,
      week_end:   to,
      fetched_from_clickup: fetchedFromClickup,
      summary: { total: result.length, with_activity: withActivity, total_events: totalEvents,
                 phase_changes: phaseChanges, entered_risk: enteredRisk, left_risk: leftRisk },
      projects: result,
    });

  } catch (err) {
    console.error('[semana] GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semana/ai-summary  (usa OpenClaw/Sofia — sin dependencia Groq)
router.post('/ai-summary', async (req, res) => {
  const { project_id, week_start } = req.body;
  if (!project_id || !week_start)
    return res.status(400).json({ error: 'project_id y week_start requeridos' });

  try {
    const db = getDb();
    const project = db.prepare('SELECT nombre FROM projects WHERE id=?').get(project_id);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const events = db.prepare(
      "SELECT * FROM weekly_activity WHERE project_id=? AND week_start=? ORDER BY event_at ASC"
    ).all(project_id, week_start);

    if (!events.length) return res.json({ summary: 'Sin actividad registrada esta semana.' });

    const lines = events
      .map(e => `- ${e.actor} (${e.event_at.slice(0, 10)}): ${e.detail}`)
      .join('\n');

    const snap = db.prepare(
      'SELECT spc.comment AS sprint_comment FROM projects p LEFT JOIN sprint_project_comments spc ON spc.project_id=p.id AND spc.sprint_id=(SELECT id FROM sprints WHERE estado=\'activo\' ORDER BY id DESC LIMIT 1) WHERE p.id=?'
    ).get(project_id);
    const sprintCommentLine = snap?.sprint_comment
      ? `\nNota interna del sprint (contexto adicional):\n"${snap.sprint_comment}"\n`
      : '';

    const prompt = `Sos Project Manager de un equipo técnico. Analizá la actividad semanal del proyecto "${project.nombre}" y generá el siguiente análisis estructurado:

RESUMEN:
▸ Avanzó: [qué se completó o avanzó esta semana]
▸ Pendiente: [qué quedó sin resolver o bloqueado]

SUGERENCIAS:
▸ [riesgo detectado o acción recomendada 1]
▸ [riesgo detectado o acción recomendada 2]

Sé conciso y técnico. Máximo 2 sugerencias. No uses otros emojis ni secciones adicionales. Respondé solo el texto con ese formato exacto.
${sprintCommentLine}
Comentarios:
${lines}`;

    const raw = await openclawSummary(prompt) || 'No se pudo generar resumen.';

    // Parse structured response
    const lc = raw.toLowerCase();
    const sugIdx = lc.indexOf('sugerencias:');
    let summary, advice;
    if (sugIdx !== -1) {
      summary = raw.slice(0, sugIdx).replace(/^resumen:\s*/i, '').trim();
      advice  = raw.slice(sugIdx + 'sugerencias:'.length).trim();
    } else {
      summary = raw.replace(/^resumen:\s*/i, '').trim();
      advice  = '';
    }

    db.prepare(
      'UPDATE weekly_snapshots SET ai_summary=? WHERE project_id=? AND week_start=?'
    ).run(raw, project_id, week_start);

    res.json({ summary, advice });
  } catch (err) {
    console.error('[semana] AI summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
