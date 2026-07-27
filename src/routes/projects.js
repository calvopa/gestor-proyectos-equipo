const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { parseHorasFromText } = require('../services/estimator');

// GET /api/projects/phases — valores distintos de clickup_status en la DB
router.get('/phases', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    "SELECT DISTINCT clickup_status FROM projects WHERE clickup_status IS NOT NULL AND clickup_status != '' ORDER BY clickup_status"
  ).all();
  res.json(rows.map(r => r.clickup_status));
});

router.get('/', (req, res) => {
  const db = getDb();
  const { estado, prioridad, search, fase, tecnico, sort = 'updated_at', dir = 'desc' } = req.query;

  const allowed_sort = ['nombre','estado','prioridad','fecha_inicio','fecha_fin_est','created_at','updated_at'];
  const col = allowed_sort.includes(sort) ? `p.${sort}` : 'p.updated_at';
  const order = dir === 'asc' ? 'ASC' : 'DESC';

  let sql = `
    SELECT p.*,
      GROUP_CONCAT(DISTINCT r.nombre) as tecnicos,
      (SELECT ai_summary FROM weekly_snapshots WHERE project_id=p.id AND ai_summary IS NOT NULL ORDER BY week_start DESC LIMIT 1) as ai_summary
    FROM projects p
    LEFT JOIN assignments a ON a.project_id = p.id
    LEFT JOIN resources r ON r.id = a.resource_id
    WHERE 1=1
  `;
  const params = [];

  if (estado)   { sql += ' AND p.estado=?';    params.push(estado); }
  if (prioridad){ sql += ' AND p.prioridad=?'; params.push(prioridad); }
  if (fase)     { sql += ' AND p.clickup_status=?'; params.push(fase); }
  if (tecnico)  { sql += ' AND EXISTS (SELECT 1 FROM assignments a2 WHERE a2.project_id=p.id AND a2.resource_id=?)'; params.push(tecnico); }
  if (search)   { sql += ' AND (p.nombre LIKE ? OR p.descripcion LIKE ? OR p.last_comment_text LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  sql += ` GROUP BY p.id ORDER BY ${col} ${order}`;
  res.json(db.prepare(sql).all(...params));
});

// GET /api/projects/resumen-horas
// Lista proyectos con horas extraídas de comentarios (weekly_activity) y horas reales registradas (time_entries).
router.get('/resumen-horas', (req, res) => {
  const db = getDb();

  const projects = db.prepare(`
    SELECT id, nombre, estado, clickup_status, prioridad, cuenta_horas
    FROM projects
    ORDER BY nombre
  `).all();

  const { from, to } = req.query;
  const commentParams = [];
  let commentSql = `SELECT project_id, actor, detail FROM weekly_activity WHERE event_type = 'comment'`;
  if (from) { commentSql += ' AND date(event_at) >= ?'; commentParams.push(from); }
  if (to)   { commentSql += ' AND date(event_at) <= ?'; commentParams.push(to); }
  const comments = db.prepare(commentSql).all(...commentParams);

  const timeParams = [];
  let timeSql = `
    SELECT
      te.project_id,
      COALESCE(r.nombre, 'Sin asignar') as recurso,
      SUM(CASE WHEN te.tipo != 'estimado' THEN COALESCE(te.duracion_seg, 0) ELSE 0 END) as seg_registrados,
      COUNT(CASE WHEN te.tipo != 'estimado' THEN 1 END) as entradas
    FROM time_entries te
    LEFT JOIN resources r ON r.id = te.resource_id
    WHERE te.fin IS NOT NULL
  `;
  if (from) { timeSql += ' AND date(te.inicio) >= ?'; timeParams.push(from); }
  if (to)   { timeSql += ' AND date(te.inicio) <= ?'; timeParams.push(to); }
  timeSql += ' GROUP BY te.project_id, te.resource_id';
  const timeRows = db.prepare(timeSql).all(...timeParams);

  // Procesar comentarios agrupando por proyecto y actor
  const commentsByProject = {};
  for (const c of comments) {
    if (!commentsByProject[c.project_id]) {
      commentsByProject[c.project_id] = { total: 0, conHoras: 0, segTotal: 0, porActor: {} };
    }
    const p = commentsByProject[c.project_id];
    p.total++;

    const seg = parseHorasFromText(c.detail);
    if (seg !== null) {
      p.conHoras++;
      p.segTotal += seg;
      if (!p.porActor[c.actor]) p.porActor[c.actor] = { seg: 0, comentarios: 0 };
      p.porActor[c.actor].seg += seg;
      p.porActor[c.actor].comentarios++;
    }
  }

  // Procesar time_entries agrupando por proyecto
  const timeByProject = {};
  for (const t of timeRows) {
    if (!timeByProject[t.project_id]) timeByProject[t.project_id] = { seg: 0, entradas: 0 };
    timeByProject[t.project_id].seg += t.seg_registrados || 0;
    timeByProject[t.project_id].entradas += t.entradas || 0;
  }

  const segToHoras = seg => Math.round((seg / 3600) * 100) / 100;

  const result = projects.map(p => {
    const cp = commentsByProject[p.id] || { total: 0, conHoras: 0, segTotal: 0, porActor: {} };
    const tp = timeByProject[p.id] || { seg: 0, entradas: 0 };

    return {
      id: p.id,
      nombre: p.nombre,
      estado: p.estado,
      clickup_status: p.clickup_status,
      prioridad: p.prioridad,
      total_comentarios: cp.total,
      comentarios_con_horas: cp.conHoras,
      horas_comentadas: segToHoras(cp.segTotal),
      horas_registradas: segToHoras(tp.seg),
      entradas_registradas: tp.entradas,
      por_actor: Object.entries(cp.porActor)
        .map(([actor, d]) => ({ actor, horas: segToHoras(d.seg), comentarios: d.comentarios }))
        .sort((a, b) => b.horas - a.horas)
    };
  });

  res.json(result);
});

// POST /api/projects/:id/ai-summary
router.post('/:id/ai-summary', async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: 'GROQ_API_KEY no configurado en el servidor' });

  try {
    const db = getDb();
    const project = db.prepare(`
      SELECT p.*, GROUP_CONCAT(DISTINCT r.nombre) as tecnicos
      FROM projects p
      LEFT JOIN assignments a ON a.project_id = p.id
      LEFT JOIN resources r ON r.id = a.resource_id
      WHERE p.id = ?
      GROUP BY p.id
    `).get(req.params.id);

    if (!project) return res.status(404).json({ error: 'not found' });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const events = db.prepare(`
      SELECT event_type, actor, detail, event_at
      FROM weekly_activity
      WHERE project_id = ? AND date(event_at) >= ?
      ORDER BY event_at DESC
      LIMIT 40
    `).all(req.params.id, cutoffStr);

    const context = [
      `Proyecto: ${project.nombre}`,
      `Estado: ${project.estado}${project.clickup_status ? ' / ' + project.clickup_status : ''}`,
      project.prioridad   ? `Prioridad: ${project.prioridad}`     : '',
      project.tecnicos    ? `Técnicos: ${project.tecnicos}`        : '',
      project.fecha_fin_est ? `Fecha límite: ${project.fecha_fin_est}` : '',
    ].filter(Boolean).join('\n');

    const lines = events.length
      ? events.map(e => `- ${e.actor || '—'} (${e.event_at.slice(0, 10)}): ${e.detail}`).join('\n')
      : project.last_comment_text
        ? `- ${project.last_comment_by || '—'} (${(project.last_comment_at || '').slice(0, 10)}): ${project.last_comment_text}`
        : '(sin actividad reciente registrada)';

    const prompt = `Sos asistente de un equipo técnico. Con la información del proyecto, generá un resumen de exactamente 3 líneas con este formato:
▸ Estado actual: [en qué punto está el proyecto]
▸ Último avance: [qué se hizo recientemente]
▸ Atención: [riesgos, bloqueos o próximos pasos críticos]
Sé conciso y técnico. No uses otros emojis ni markdown.

${context}

Actividad reciente (más reciente primero):
${lines}`;

    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) throw new Error(data.error?.message || `Groq API ${apiRes.status}`);
    const summary = data.choices?.[0]?.message?.content?.trim() || 'No se pudo generar resumen.';

    res.json({ summary });
  } catch (err) {
    console.error('[projects] AI summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const assignments = db.prepare(`
    SELECT a.*, r.nombre as resource_nombre, r.rol as resource_rol, r.email as resource_email
    FROM assignments a JOIN resources r ON r.id=a.resource_id
    WHERE a.project_id=?
  `).all(req.params.id);

  const hours = db.prepare(`
    SELECT
      SUM(CASE WHEN p.cuenta_horas=1 AND te.tipo!='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_contados,
      SUM(CASE WHEN te.tipo!='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_total,
      SUM(CASE WHEN te.tipo='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_estimado,
      COUNT(*) as entradas
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    WHERE te.project_id=? AND te.fin IS NOT NULL
  `).get(req.params.id);

  const activeTimer = db.prepare(
    "SELECT * FROM time_entries WHERE project_id=? AND tipo='timer' AND fin IS NULL ORDER BY inicio DESC LIMIT 1"
  ).get(req.params.id);

  res.json({ ...project, assignments, hours, activeTimer: activeTimer || null });
});

router.post('/', (req, res) => {
  const db = getDb();
  const { nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin_est, cuenta_horas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });

  const result = db.prepare(`
    INSERT INTO projects (nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin_est, cuenta_horas)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    nombre,
    descripcion || null,
    estado || 'backlog',
    prioridad || 'media',
    fecha_inicio || null,
    fecha_fin_est || null,
    cuenta_horas !== undefined ? (cuenta_horas ? 1 : 0) : 1
  );

  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id=?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const { nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin_est, cuenta_horas } = req.body;

  db.prepare(`
    UPDATE projects SET
      nombre=?, descripcion=?, estado=?, prioridad=?,
      fecha_inicio=?, fecha_fin_est=?, cuenta_horas=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    nombre ?? project.nombre,
    descripcion !== undefined ? descripcion : project.descripcion,
    estado ?? project.estado,
    prioridad ?? project.prioridad,
    fecha_inicio !== undefined ? fecha_inicio : project.fecha_inicio,
    fecha_fin_est !== undefined ? fecha_fin_est : project.fecha_fin_est,
    cuenta_horas !== undefined ? (cuenta_horas ? 1 : 0) : project.cuenta_horas,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

module.exports = router;
