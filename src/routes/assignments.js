const express = require('express');
const router = express.Router({ mergeParams: true });
const { getDb } = require('../db');

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.*, r.nombre as resource_nombre, r.rol as resource_rol, r.email as resource_email
    FROM assignments a JOIN resources r ON r.id=a.resource_id
    WHERE a.project_id=?
  `).all(req.params.projectId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { resource_id, rol_en_proyecto, dedicacion_pct } = req.body;
  if (!resource_id) return res.status(400).json({ error: 'resource_id requerido' });

  try {
    const result = db.prepare(`
      INSERT INTO assignments (project_id, resource_id, rol_en_proyecto, dedicacion_pct)
      VALUES (?, ?, ?, ?)
    `).run(req.params.projectId, resource_id, rol_en_proyecto || null, dedicacion_pct || null);

    const row = db.prepare(`
      SELECT a.*, r.nombre as resource_nombre, r.rol as resource_rol, r.email as resource_email
      FROM assignments a JOIN resources r ON r.id=a.resource_id
      WHERE a.id=?
    `).get(result.lastInsertRowid);

    res.status(201).json(row);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'ya asignado' });
    throw e;
  }
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { rol_en_proyecto, dedicacion_pct } = req.body;
  db.prepare('UPDATE assignments SET rol_en_proyecto=?, dedicacion_pct=? WHERE id=? AND project_id=?')
    .run(rol_en_proyecto || null, dedicacion_pct || null, req.params.id, req.params.projectId);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM assignments WHERE id=? AND project_id=?').run(req.params.id, req.params.projectId);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

module.exports = router;
