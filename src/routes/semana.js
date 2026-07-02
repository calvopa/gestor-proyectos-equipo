const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getToken, fetchWeekActivity } = require('../services/clickup');

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
        } catch (err) {
          console.error('[semana] fetchWeekActivity error:', err.message);
        }
      }
    }

    const projects = db.prepare(`
      SELECT p.*,
        GROUP_CONCAT(DISTINCT r.nombre) as tecnicos,
        (SELECT MAX(te.inicio) FROM time_entries te WHERE te.project_id=p.id) as ultima_hora
      FROM projects p
      LEFT JOIN assignments a ON a.project_id=p.id
      LEFT JOIN resources r ON r.id=a.resource_id
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

      return {
        id:                 p.id,
        nombre:             p.nombre,
        estado:             p.estado,
        prioridad:          p.prioridad,
        clickup_status:     p.clickup_status,
        fecha_fin_est:      p.fecha_fin_est,
        tecnicos:           p.tecnicos,
        last_comment_at:    p.last_comment_at,
        updated_at:         p.updated_at,
        salud,
        salud_prev:         saludPrev,
        events,
        event_count:        events.length,
        has_activity:       events.length > 0,
        movimiento,
        dias_inactivo:      diasInactivo,
        dias_inactivo_prev: prevSnap?.dias_inactivo ?? null,
        fase_changed:       phaseChanged,
        fase_prev:          prevSnap?.fase ?? null,
        ai_summary:         snapRow?.ai_summary ?? null,
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

// POST /api/semana/ai-summary
router.post('/ai-summary', async (req, res) => {
  const { project_id, week_start } = req.body;
  if (!project_id || !week_start)
    return res.status(400).json({ error: 'project_id y week_start requeridos' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurado en el servidor' });

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

    const prompt = `Sos asistente de un equipo técnico. Con los comentarios de la semana del proyecto "${project.nombre}", generá un resumen de exactamente 2 líneas con este formato:
▸ Avanzó: [qué se hizo]
▸ Pendiente: [qué quedó sin resolver]
Sé conciso y técnico. No uses otros emojis.

Comentarios:
${lines}`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) throw new Error(data.error?.message || `Anthropic API ${apiRes.status}`);
    const summary = data.content?.[0]?.text?.trim() || 'No se pudo generar resumen.';

    db.prepare(
      'UPDATE weekly_snapshots SET ai_summary=? WHERE project_id=? AND week_start=?'
    ).run(summary, project_id, week_start);

    res.json({ summary });
  } catch (err) {
    console.error('[semana] AI summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
