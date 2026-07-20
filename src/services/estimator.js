const { getDb } = require('../db');

// Returns seconds parsed from text, or null if nothing found.
// Handles: "2h", "2 horas", "1.5h", "1,5h", "1:30h", "30min", "45 minutos", combos "2h 30min"
function parseHorasFromText(text) {
  const t = text.toLowerCase();
  let totalSeg = 0;
  let found = false;

  const horasRe = /(\d+[,.]?\d*|\d+:\d+)\s*(?:h(?:ora[s]?|rs?)?)\b/;
  const horasMatch = t.match(horasRe);
  if (horasMatch) {
    found = true;
    const raw = horasMatch[1];
    if (raw.includes(':')) {
      const [h, m] = raw.split(':').map(Number);
      totalSeg += h * 3600 + (m || 0) * 60;
    } else {
      totalSeg += parseFloat(raw.replace(',', '.')) * 3600;
    }
  }

  // Match minutes only when not already embedded in h:mm pattern
  const minRe = /(\d+)\s*min(?:uto[s]?)?\b/;
  const minMatch = t.match(minRe);
  if (minMatch && !(horasMatch && horasMatch[1].includes(':'))) {
    found = true;
    totalSeg += parseInt(minMatch[1], 10) * 60;
  }

  return found ? Math.round(totalSeg) : null;
}

function generateEstimates(projectId = null) {
  const db = getDb();
  const minPorComentario = parseInt(
    db.prepare("SELECT valor FROM settings WHERE clave='min_por_comentario'").get()?.valor || '15',
    10
  );

  let query = `
    SELECT wa.id, wa.project_id, wa.event_at, wa.detail, wa.actor
    FROM weekly_activity wa
    WHERE wa.event_type = 'comment'
      AND NOT EXISTS (
        SELECT 1 FROM time_entries te WHERE te.source_comment_id = wa.id
      )
  `;
  const params = [];
  if (projectId) {
    query += ' AND wa.project_id = ?';
    params.push(projectId);
  }

  const comments = db.prepare(query).all(...params);

  const insert = db.prepare(`
    INSERT INTO time_entries (project_id, tipo, inicio, fin, duracion_seg, nota, source_comment_id)
    VALUES (@project_id, 'estimado', @inicio, @fin, @duracion_seg, @nota, @source_comment_id)
  `);

  let created = 0;
  db.transaction(() => {
    for (const c of comments) {
      const parsed = parseHorasFromText(c.detail);
      const duracion_seg = parsed !== null ? parsed : minPorComentario * 60;
      const source = parsed !== null ? 'texto' : `fallback ${minPorComentario}min`;
      const inicio = c.event_at;
      const finDate = new Date(inicio.replace(' ', 'T') + 'Z').getTime() + duracion_seg * 1000;
      const fin = new Date(finDate).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      const nota = `[${source}] ${c.actor}: ${c.detail.slice(0, 150)}`;

      insert.run({ project_id: c.project_id, inicio, fin, duracion_seg, nota, source_comment_id: c.id });
      created++;
    }
  })();

  return { created, skipped: comments.length - created };
}

function clearEstimates(projectId = null) {
  const db = getDb();
  if (projectId) {
    const r = db.prepare("DELETE FROM time_entries WHERE tipo='estimado' AND project_id=?").run(projectId);
    return { deleted: r.changes };
  }
  const r = db.prepare("DELETE FROM time_entries WHERE tipo='estimado'").run();
  return { deleted: r.changes };
}

module.exports = { generateEstimates, clearEstimates, parseHorasFromText };
