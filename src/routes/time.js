const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { generateEstimates, clearEstimates } = require('../services/estimator');

// GET /api/time?project_id=X  — listar entradas
router.get('/', (req, res) => {
  const db = getDb();
  const { project_id, resource_id } = req.query;
  let sql = `
    SELECT te.*, r.nombre as resource_nombre, p.nombre as project_nombre, p.cuenta_horas
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    LEFT JOIN resources r ON r.id=te.resource_id
    WHERE 1=1
  `;
  const params = [];
  if (project_id) { sql += ' AND te.project_id=?'; params.push(project_id); }
  if (resource_id) { sql += ' AND te.resource_id=?'; params.push(resource_id); }
  sql += ' ORDER BY te.inicio DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/time/start — iniciar timer
router.post('/start', (req, res) => {
  const db = getDb();
  const { project_id, resource_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id requerido' });

  // Solo un timer activo por proyecto
  const active = db.prepare(
    "SELECT * FROM time_entries WHERE project_id=? AND tipo='timer' AND fin IS NULL"
  ).get(project_id);
  if (active) return res.status(409).json({ error: 'timer ya activo', entry: active });

  const result = db.prepare(`
    INSERT INTO time_entries (project_id, resource_id, tipo, inicio)
    VALUES (?, ?, 'timer', datetime('now'))
  `).run(project_id, resource_id || null);

  res.status(201).json(db.prepare('SELECT * FROM time_entries WHERE id=?').get(result.lastInsertRowid));
});

// POST /api/time/stop — detener timer
router.post('/stop', (req, res) => {
  const db = getDb();
  const { project_id, entry_id } = req.body;

  let entry;
  if (entry_id) {
    entry = db.prepare("SELECT * FROM time_entries WHERE id=? AND tipo='timer' AND fin IS NULL").get(entry_id);
  } else if (project_id) {
    entry = db.prepare("SELECT * FROM time_entries WHERE project_id=? AND tipo='timer' AND fin IS NULL ORDER BY inicio DESC LIMIT 1").get(project_id);
  }

  if (!entry) return res.status(404).json({ error: 'no hay timer activo' });

  const now = new Date();
  const inicio = new Date(entry.inicio.replace(' ', 'T') + 'Z');
  const duracion_seg = Math.floor((now - inicio) / 1000);

  db.prepare(`
    UPDATE time_entries SET fin=datetime('now'), duracion_seg=? WHERE id=?
  `).run(duracion_seg, entry.id);

  res.json(db.prepare('SELECT * FROM time_entries WHERE id=?').get(entry.id));
});

// POST /api/time/manual — carga manual
router.post('/manual', (req, res) => {
  const db = getDb();
  const { project_id, resource_id, inicio, duracion_seg, nota } = req.body;
  if (!project_id || !inicio || !duracion_seg) {
    return res.status(400).json({ error: 'project_id, inicio y duracion_seg requeridos' });
  }

  const fin = new Date(new Date(inicio).getTime() + parseInt(duracion_seg, 10) * 1000).toISOString()
    .replace('T', ' ').replace(/\.\d+Z$/, '');

  const result = db.prepare(`
    INSERT INTO time_entries (project_id, resource_id, tipo, inicio, fin, duracion_seg, nota)
    VALUES (?, ?, 'manual', ?, ?, ?, ?)
  `).run(project_id, resource_id || null, inicio, fin, parseInt(duracion_seg, 10), nota || null);

  res.status(201).json(db.prepare('SELECT * FROM time_entries WHERE id=?').get(result.lastInsertRowid));
});

// POST /api/time/estimate — generar entradas estimadas desde comentarios de weekly_activity
router.post('/estimate', (req, res) => {
  const { project_id } = req.body;
  try {
    const result = generateEstimates(project_id || null);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/time/estimates — limpiar entradas estimadas
router.delete('/estimates', (req, res) => {
  const { project_id } = req.body;
  try {
    const result = clearEstimates(project_id || null);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/time/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM time_entries WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// GET /api/time/totals — totales globales
router.get('/totals', (req, res) => {
  const db = getDb();
  const global = db.prepare(`
    SELECT
      SUM(CASE WHEN p.cuenta_horas=1 AND te.tipo!='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_contados,
      SUM(CASE WHEN te.tipo!='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_total,
      SUM(CASE WHEN te.tipo='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_estimado
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    WHERE te.fin IS NOT NULL
  `).get();

  const byProject = db.prepare(`
    SELECT
      p.id, p.nombre, p.cuenta_horas,
      SUM(CASE WHEN p.cuenta_horas=1 AND te.tipo!='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_contados,
      SUM(CASE WHEN te.tipo!='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_total,
      SUM(CASE WHEN te.tipo='estimado' THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_estimado,
      COUNT(*) as entradas
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    WHERE te.fin IS NOT NULL
    GROUP BY p.id
    ORDER BY seg_total DESC
  `).all();

  res.json({ global, byProject });
});

module.exports = router;
