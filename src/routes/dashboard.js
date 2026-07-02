const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/dashboard — resumen ejecutivo para la vista de inicio
router.get('/', (req, res) => {
  const db = getDb();

  // Conteo de proyectos por estado
  const estadoRows = db.prepare(`
    SELECT estado, COUNT(*) as n FROM projects GROUP BY estado
  `).all();
  const porEstado = { backlog: 0, en_curso: 0, pausado: 0, cerrado: 0 };
  for (const r of estadoRows) porEstado[r.estado] = r.n;
  const totalProyectos = estadoRows.reduce((s, r) => s + r.n, 0);

  // Horas contabilizadas (cuenta_horas=1) por período
  const horas = db.prepare(`
    SELECT
      SUM(CASE WHEN p.cuenta_horas=1 THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as total,
      SUM(CASE WHEN p.cuenta_horas=1 AND te.inicio >= datetime('now','-7 days')  THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as d7,
      SUM(CASE WHEN p.cuenta_horas=1 AND te.inicio >= datetime('now','-30 days') THEN COALESCE(te.duracion_seg,0) ELSE 0 END) as d30
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    WHERE te.fin IS NOT NULL
  `).get();

  // Top proyectos por horas en los últimos 7 días
  const topWeek = db.prepare(`
    SELECT p.id, p.nombre, SUM(COALESCE(te.duracion_seg,0)) as seg
    FROM time_entries te
    JOIN projects p ON p.id=te.project_id
    WHERE te.fin IS NOT NULL AND te.inicio >= datetime('now','-7 days')
    GROUP BY p.id
    HAVING seg > 0
    ORDER BY seg DESC
    LIMIT 5
  `).all();

  // Actividad reciente: últimos comentarios de ClickUp
  const recientes = db.prepare(`
    SELECT id, nombre, estado, clickup_status, clickup_id,
           last_comment_text, last_comment_by, last_comment_at
    FROM projects
    WHERE last_comment_at IS NOT NULL
    ORDER BY last_comment_at DESC
    LIMIT 6
  `).all();

  res.json({
    proyectos: { total: totalProyectos, ...porEstado },
    horas: {
      total_seg: horas?.total || 0,
      d7_seg:    horas?.d7    || 0,
      d30_seg:   horas?.d30   || 0,
    },
    topWeek,
    recientes,
  });
});

module.exports = router;
