const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/sprints
router.get('/', (req, res) => {
  const db = getDb();
  const sprints = db.prepare(`
    SELECT s.*,
      COUNT(sp.id)                                              AS total_projects,
      SUM(CASE WHEN sp.estado = 'completado' THEN 1 ELSE 0 END) AS completed_projects
    FROM sprints s
    LEFT JOIN sprint_projects sp ON sp.sprint_id = s.id
    GROUP BY s.id
    ORDER BY s.fecha_inicio DESC
  `).all();
  res.json(sprints);
});

// POST /api/sprints
router.post('/', (req, res) => {
  const db = getDb();
  const { nombre, objetivo, fecha_inicio, fecha_fin } = req.body;
  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'nombre, fecha_inicio y fecha_fin son requeridos' });
  }
  const result = db.prepare(`
    INSERT INTO sprints (nombre, objetivo, fecha_inicio, fecha_fin)
    VALUES (?, ?, ?, ?)
  `).run(nombre.trim(), objetivo?.trim() || null, fecha_inicio, fecha_fin);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/sprints/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Sprint no encontrado' });

  const { nombre, objetivo, fecha_inicio, fecha_fin, estado } = req.body;
  const validEstados = ['planificado', 'activo', 'completado'];
  if (estado && !validEstados.includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  db.prepare(`
    UPDATE sprints
    SET nombre = ?, objetivo = ?, fecha_inicio = ?, fecha_fin = ?, estado = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    nombre ?? sprint.nombre,
    objetivo !== undefined ? (objetivo?.trim() || null) : sprint.objetivo,
    fecha_inicio ?? sprint.fecha_inicio,
    fecha_fin ?? sprint.fecha_fin,
    estado ?? sprint.estado,
    req.params.id
  );
  res.json({ ok: true });
});

// DELETE /api/sprints/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sprints WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/sprints/:id/board
router.get('/:id/board', (req, res) => {
  const db = getDb();
  const sprintId = req.params.id;

  const sprint = db.prepare(`
    SELECT s.*,
      COUNT(sp.id)                                              AS total_projects,
      SUM(CASE WHEN sp.estado = 'completado' THEN 1 ELSE 0 END) AS completed_projects
    FROM sprints s
    LEFT JOIN sprint_projects sp ON sp.sprint_id = s.id
    WHERE s.id = ?
    GROUP BY s.id
  `).get(sprintId);
  if (!sprint) return res.status(404).json({ error: 'Sprint no encontrado' });

  const sprintProjects = db.prepare(`
    SELECT p.*, sp.estado AS sprint_estado, sp.orden,
      GROUP_CONCAT(DISTINCT r.nombre) AS tecnicos
    FROM sprint_projects sp
    JOIN projects p ON p.id = sp.project_id
    LEFT JOIN assignments a ON a.project_id = p.id
    LEFT JOIN resources r ON r.id = a.resource_id
    WHERE sp.sprint_id = ?
    GROUP BY p.id
    ORDER BY sp.orden, p.nombre
  `).all(sprintId);

  const { clickup_status } = req.query;
  const backlogParams = [sprintId];
  let backlogWhere = `WHERE p.estado != 'cerrado' AND p.id NOT IN (SELECT project_id FROM sprint_projects WHERE sprint_id = ?)`;
  if (clickup_status) {
    backlogWhere += ` AND p.clickup_status = ?`;
    backlogParams.push(clickup_status);
  }

  const backlog = db.prepare(`
    SELECT p.*,
      GROUP_CONCAT(DISTINCT r.nombre) AS tecnicos
    FROM projects p
    LEFT JOIN assignments a ON a.project_id = p.id
    LEFT JOIN resources r ON r.id = a.resource_id
    ${backlogWhere}
    GROUP BY p.id
    ORDER BY
      CASE p.prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      p.nombre
  `).all(...backlogParams);

  res.json({
    sprint,
    backlog,
    activos:     sprintProjects.filter(p => p.sprint_estado !== 'completado'),
    completados: sprintProjects.filter(p => p.sprint_estado === 'completado'),
  });
});

// POST /api/sprints/:id/projects/:projectId
router.post('/:id/projects/:projectId', (req, res) => {
  const db = getDb();
  const { id: sprintId, projectId } = req.params;
  const { estado = 'pendiente' } = req.body;
  const validEstados = ['pendiente', 'en_curso', 'completado'];
  if (!validEstados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

  const sprint  = db.prepare('SELECT id FROM sprints WHERE id = ?').get(sprintId);
  if (!sprint) return res.status(404).json({ error: 'Sprint no encontrado' });
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  db.prepare(`
    INSERT INTO sprint_projects (sprint_id, project_id, estado) VALUES (?, ?, ?)
    ON CONFLICT(sprint_id, project_id) DO UPDATE SET estado = excluded.estado
  `).run(sprintId, projectId, estado);
  res.json({ ok: true });
});

// PATCH /api/sprints/:id/projects/:projectId
router.patch('/:id/projects/:projectId', (req, res) => {
  const db = getDb();
  const { estado } = req.body;
  const validEstados = ['pendiente', 'en_curso', 'completado'];
  if (!validEstados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  db.prepare('UPDATE sprint_projects SET estado = ? WHERE sprint_id = ? AND project_id = ?')
    .run(estado, req.params.id, req.params.projectId);
  res.json({ ok: true });
});

// DELETE /api/sprints/:id/projects/:projectId
router.delete('/:id/projects/:projectId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sprint_projects WHERE sprint_id = ? AND project_id = ?')
    .run(req.params.id, req.params.projectId);
  res.json({ ok: true });
});

module.exports = router;
