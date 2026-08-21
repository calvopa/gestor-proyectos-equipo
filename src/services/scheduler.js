const { runSync } = require('./clickup');
const openclaw = require('./openclaw');

let syncTimer   = null;
let dailyTimer  = null;

// ── ClickUp sync loop ─────────────────────────────────────
function start() {
  const minutes = parseInt(process.env.SYNC_INTERVAL_MIN || '30', 10);
  if (minutes > 0) {
    syncTimer = setInterval(async () => {
      console.log('[scheduler] running ClickUp sync...');
      const result = await runSync();
      console.log('[scheduler] sync result:', JSON.stringify(result));
    }, minutes * 60 * 1000);
    console.log(`[scheduler] auto-sync every ${minutes} min`);
  }

  scheduleDailyAi();
}

function stop() {
  if (syncTimer)  { clearInterval(syncTimer);  syncTimer  = null; }
  if (dailyTimer) { clearTimeout(dailyTimer);  dailyTimer = null; }
}

// ── Daily AI summary at 9 AM ──────────────────────────────
function msUntilNext9AM() {
  const now  = new Date();
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function scheduleDailyAi() {
  const ms = msUntilNext9AM();
  const hh = Math.round(ms / 3600000 * 10) / 10;
  console.log(`[scheduler] daily AI summaries scheduled in ${hh}h`);
  dailyTimer = setTimeout(async () => {
    await runDailyAiSummaries();
    scheduleDailyAi(); // reschedule next day
  }, ms);
}

async function runDailyAiSummaries() {
  console.log('[scheduler] generating daily AI summaries...');
  const { getDb } = require('../db');
  const db = getDb();

  const projects = db.prepare(`
    SELECT p.*, GROUP_CONCAT(DISTINCT r.nombre) as tecnicos
    FROM projects p
    LEFT JOIN assignments a ON a.project_id = p.id
    LEFT JOIN resources r ON r.id = a.resource_id
    WHERE p.estado IN ('en_curso', 'pausado')
    GROUP BY p.id
  `).all();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let ok = 0, fail = 0;

  for (const project of projects) {
    try {
      const events = db.prepare(`
        SELECT actor, detail, event_at FROM weekly_activity
        WHERE project_id = ? AND date(event_at) >= ?
        ORDER BY event_at DESC LIMIT 30
      `).all(project.id, cutoffStr);

      const meta = [
        project.clickup_status ? `Estado: ${project.estado} / ${project.clickup_status}` : `Estado: ${project.estado}`,
        project.prioridad     ? `Prioridad: ${project.prioridad}` : '',
        project.tecnicos      ? `Equipo: ${project.tecnicos}`     : '',
        project.fecha_fin_est ? `Fecha límite: ${project.fecha_fin_est}` : '',
      ].filter(Boolean).join(' | ');

      const lines = events.length
        ? events.map(e => `- ${e.actor || '—'} (${e.event_at.slice(0, 10)}): ${e.detail}`).join('\n')
        : project.last_comment_text
          ? `- ${project.last_comment_by || '—'} (${(project.last_comment_at || '').slice(0, 10)}): ${project.last_comment_text}`
          : null;

      if (!lines) { console.log(`[scheduler] skip "${project.nombre}" — sin actividad`); continue; }

      const prompt = `Solo escribí texto plano como respuesta. No ejecutes herramientas ni acciones. No crees archivos ni tareas.

Completá este formato con la información del proyecto "${project.nombre}" (${meta}):

- Avanzó: [qué avanzó recientemente]
- Pendiente: [qué falta o está bloqueado]
- Consejo: [un riesgo o acción clave para el PM]

Actividad reciente:
${lines}`;

      const raw = await openclaw.query(prompt);
      if (!raw) { fail++; continue; }

      db.prepare('UPDATE projects SET ai_summary=? WHERE id=?').run(raw, project.id);
      ok++;
      console.log(`[scheduler] AI summary ok: "${project.nombre}"`);
    } catch (e) {
      fail++;
      console.error(`[scheduler] AI summary error "${project.nombre}":`, e.message);
    }
  }

  console.log(`[scheduler] daily AI done — ok:${ok} fail:${fail}`);
}

module.exports = { start, stop };
