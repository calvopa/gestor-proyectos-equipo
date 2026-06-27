const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

router.get('/', (req, res) => {
  const db = getDb();
  const { activo, search } = req.query;
  let sql = 'SELECT * FROM resources WHERE 1=1';
  const params = [];
  if (activo !== undefined) { sql += ' AND activo=?'; params.push(activo === '1' || activo === 'true' ? 1 : 0); }
  if (search) { sql += ' AND (nombre LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY nombre ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const resource = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'not found' });

  const assignments = db.prepare(`
    SELECT a.*, p.nombre as project_nombre, p.estado as project_estado, p.prioridad as project_prioridad
    FROM assignments a JOIN projects p ON p.id=a.project_id
    WHERE a.resource_id=?
  `).all(req.params.id);

  const hours = db.prepare(`
    SELECT
      SUM(CASE WHEN p.cuenta_horas=1 THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_contados,
      SUM(COALESCE(te.duracion_seg,0)) as seg_total
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    WHERE te.resource_id=? AND te.fin IS NOT NULL
  `).get(req.params.id);

  res.json({ ...resource, assignments, hours });
});

router.post('/', (req, res) => {
  const db = getDb();
  const { nombre, rol, email, clickup_member_id, activo } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });

  const result = db.prepare(`
    INSERT INTO resources (nombre, rol, email, clickup_member_id, activo)
    VALUES (?, ?, ?, ?, ?)
  `).run(nombre, rol || null, email || null, clickup_member_id || null, activo !== false ? 1 : 0);

  res.status(201).json(db.prepare('SELECT * FROM resources WHERE id=?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });

  const { nombre, rol, email, activo } = req.body;
  db.prepare(`
    UPDATE resources SET nombre=?, rol=?, email=?, activo=? WHERE id=?
  `).run(nombre ?? r.nombre, rol ?? r.rol, email ?? r.email, activo !== undefined ? (activo ? 1 : 0) : r.activo, req.params.id);

  res.json(db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM resources WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Vista de carga: todos los recursos con sus proyectos y horas
router.get('/report/carga', (req, res) => {
  const db = getDb();
  const resources = db.prepare('SELECT * FROM resources WHERE activo=1 ORDER BY nombre').all();

  const result = resources.map(r => {
    const assignments = db.prepare(`
      SELECT a.*, p.nombre as project_nombre, p.estado as project_estado
      FROM assignments a JOIN projects p ON p.id=a.project_id
      WHERE a.resource_id=?
    `).all(r.id);

    const hours = db.prepare(`
      SELECT
        SUM(CASE WHEN p.cuenta_horas=1 THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as seg_contados,
        SUM(COALESCE(te.duracion_seg,0)) as seg_total
      FROM time_entries te
      JOIN projects p ON p.id=te.project_id
      WHERE te.resource_id=? AND te.fin IS NOT NULL
    `).get(r.id);

    return { ...r, assignments, hours };
  });

  res.json(result);
});

module.exports = router;
