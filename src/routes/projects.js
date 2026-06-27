const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

router.get('/', (req, res) => {
  const db = getDb();
  const { estado, prioridad, search, sort = 'updated_at', dir = 'desc' } = req.query;

  const allowed_sort = ['nombre','estado','prioridad','fecha_inicio','fecha_fin_est','created_at','updated_at'];
  const col = allowed_sort.includes(sort) ? sort : 'updated_at';
  const order = dir === 'asc' ? 'ASC' : 'DESC';

  let sql = 'SELECT * FROM projects WHERE 1=1';
  const params = [];

  if (estado) { sql += ' AND estado=?'; params.push(estado); }
  if (prioridad) { sql += ' AND prioridad=?'; params.push(prioridad); }
  if (search) { sql += ' AND (nombre LIKE ? OR descripcion LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  sql += ` ORDER BY ${col} ${order}`;
  res.json(db.prepare(sql).all(...params));
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
      SUM(CASE WHEN p.cuenta_horas=1 THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_contados,
      SUM(COALESCE(te.duracion_seg,0)) as seg_total,
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
