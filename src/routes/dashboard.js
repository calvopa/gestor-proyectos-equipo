const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const DIAS_SIN_ACTIVIDAD_RED    = 7;
const DIAS_SIN_ACTIVIDAD_YELLOW = 3;
const DIAS_PAUSADO_YELLOW       = 14;
const DIAS_PROXIMO_VENCER       = 5;

function diasDesde(s) {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'));
  return Math.floor((Date.now() - d) / 86400000);
}

function diasHasta(s) {
  if (!s) return null;
  return Math.floor((new Date(s) - Date.now()) / 86400000);
}

function clasificar(p) {
  if (p.estado === 'cerrado') return 'cerrado';
  if (p.estado === 'backlog') return 'backlog';

  const ref  = p.last_comment_at || p.ultima_hora || p.updated_at;
  const dias = diasDesde(ref);
  const dv   = diasHasta(p.fecha_fin_est);

  if (p.estado === 'en_curso') {
    if (dv !== null && dv < 0)                           return 'red';
    if (dias !== null && dias >= DIAS_SIN_ACTIVIDAD_RED) return 'red';
    if (dv !== null && dv >= 0 && dv <= DIAS_PROXIMO_VENCER) return 'yellow';
    if (dias !== null && dias >= DIAS_SIN_ACTIVIDAD_YELLOW)   return 'yellow';
    return 'green';
  }
  if (p.estado === 'pausado') {
    if (dias !== null && dias >= DIAS_PAUSADO_YELLOW) return 'yellow';
    return 'grey';
  }
  return 'grey';
}

router.get('/', (req, res) => {
  const db = getDb();

  const projects = db.prepare(`
    SELECT p.*,
      GROUP_CONCAT(DISTINCT r.nombre) as tecnicos,
      (SELECT MAX(te.inicio) FROM time_entries te WHERE te.project_id=p.id AND te.fin IS NOT NULL) as ultima_hora
    FROM projects p
    LEFT JOIN assignments a ON a.project_id=p.id
    LEFT JOIN resources r ON r.id=a.resource_id
    GROUP BY p.id
  `).all();

  // KPIs
  const kpis = { total: projects.length, red: 0, yellow: 0, green: 0, cerrado: 0, backlog: 0 };
  for (const p of projects) {
    const nivel = clasificar(p);
    kpis[nivel] = (kpis[nivel] || 0) + 1;
  }

  // Por fase (clickup_status)
  const faseMap = {};
  for (const p of projects) {
    const fase = p.clickup_status || '(sin fase)';
    faseMap[fase] = (faseMap[fase] || 0) + 1;
  }
  const byFase = Object.entries(faseMap)
    .sort((a, b) => b[1] - a[1])
    .map(([fase, count]) => ({ fase, count }));

  // Por prioridad
  const byPrioridad = { critica: 0, alta: 0, media: 0, baja: 0 };
  for (const p of projects) {
    if (p.prioridad in byPrioridad) byPrioridad[p.prioridad]++;
  }

  // Carga por técnico
  const tecMap = {};
  for (const p of projects) {
    if (!p.tecnicos) continue;
    for (const tec of p.tecnicos.split(',')) {
      const name = tec.trim();
      if (name) tecMap[name] = (tecMap[name] || 0) + 1;
    }
  }
  const byTecnico = Object.entries(tecMap)
    .map(([nombre, count]) => ({ nombre, count }))
    .sort((a, b) => b.count - a.count);

  // Proyectos en riesgo (red), ordenados por días sin actividad desc
  const enRiesgo = projects
    .filter(p => clasificar(p) === 'red')
    .map(p => {
      const ref  = p.last_comment_at || p.ultima_hora || p.updated_at;
      const dias = diasDesde(ref);
      const dv   = diasHasta(p.fecha_fin_est);
      return {
        id:               p.id,
        nombre:           p.nombre,
        clickup_status:   p.clickup_status,
        prioridad:        p.prioridad,
        dias_inactivo:    dias,
        dias_vencido:     dv !== null && dv < 0 ? Math.abs(dv) : null,
        last_comment_text: p.last_comment_text ? p.last_comment_text.slice(0, 120) : null,
        last_comment_by:  p.last_comment_by,
        last_comment_at:  p.last_comment_at,
        tecnicos:         p.tecnicos,
      };
    })
    .sort((a, b) => {
      // Vencidos primero, luego por días inactivo desc
      if (a.dias_vencido !== null && b.dias_vencido === null) return -1;
      if (a.dias_vencido === null && b.dias_vencido !== null) return 1;
      return (b.dias_inactivo || 0) - (a.dias_inactivo || 0);
    });

  // Próximos vencimientos (no cerrados, vence en los próximos 30 días o vencido hace ≤7 días)
  const proximos = projects
    .filter(p => p.estado !== 'cerrado' && p.fecha_fin_est)
    .map(p => ({ ...p, dv: diasHasta(p.fecha_fin_est) }))
    .filter(p => p.dv !== null && p.dv >= -7 && p.dv <= 30)
    .sort((a, b) => a.dv - b.dv)
    .map(p => ({
      id:             p.id,
      nombre:         p.nombre,
      clickup_status: p.clickup_status,
      fecha_fin_est:  p.fecha_fin_est,
      dias_hasta:     p.dv,
      tecnicos:       p.tecnicos,
    }));

  // Horas (solo si hay registros)
  const horasTotal = db.prepare('SELECT SUM(duracion_seg) as total FROM time_entries WHERE fin IS NOT NULL').get();
  let horasPorTecnico = [];
  if ((horasTotal?.total || 0) > 0) {
    horasPorTecnico = db.prepare(`
      SELECT r.nombre, SUM(te.duracion_seg) as seg
      FROM time_entries te
      JOIN resources r ON r.id=te.resource_id
      WHERE te.fin IS NOT NULL AND te.resource_id IS NOT NULL
      GROUP BY r.id
      ORDER BY seg DESC
    `).all();
  }

  const lastSync = db.prepare("SELECT valor FROM settings WHERE clave='last_sync'").get();

  res.json({
    generated_at:     new Date().toISOString(),
    last_sync:        lastSync?.valor || null,
    kpis,
    byFase,
    byPrioridad,
    byTecnico,
    enRiesgo,
    proximos,
    tieneHoras:       (horasTotal?.total || 0) > 0,
    horasPorTecnico,
  });
});

module.exports = router;
