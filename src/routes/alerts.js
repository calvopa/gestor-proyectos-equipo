const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const DIAS_SIN_ACTIVIDAD_RED    = 7;
const DIAS_SIN_ACTIVIDAD_YELLOW = 3;
const DIAS_PAUSADO_YELLOW       = 14;
const DIAS_PROXIMO_VENCER       = 5;
const PROYECTOS_SOBRECARGA      = 3;

function diasDesde(isoOrSqlite) {
  if (!isoOrSqlite) return null;
  const d = new Date(isoOrSqlite.replace(' ', 'T') + (isoOrSqlite.includes('T') ? '' : 'Z'));
  return Math.floor((Date.now() - d) / 86400000);
}

function diasHasta(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

router.get('/', (req, res) => {
  const db = getDb();
  const alerts = [];

  const projects = db.prepare(`
    SELECT p.*,
      (SELECT MAX(te.inicio) FROM time_entries te WHERE te.project_id = p.id AND te.fin IS NOT NULL) as ultima_hora
    FROM projects p
    WHERE p.estado != 'cerrado'
  `).all();

  for (const p of projects) {
    // Referencia de actividad: último comentario o última hora registrada o updated_at
    const refActividad = p.last_comment_at || p.ultima_hora || p.updated_at;
    const dias         = diasDesde(refActividad);
    const diasVence    = diasHasta(p.fecha_fin_est);

    if (p.estado === 'en_curso') {
      // Vencido
      if (diasVence !== null && diasVence < 0) {
        alerts.push({
          nivel:      'critica',
          tipo:       'vencido',
          titulo:     'Proyecto vencido',
          mensaje:    `Fecha de entrega superada hace ${Math.abs(diasVence)} día${Math.abs(diasVence) !== 1 ? 's' : ''}`,
          proyecto_id:     p.id,
          proyecto_nombre: p.nombre,
          clickup_id:      p.clickup_id,
          clickup_status:  p.clickup_status,
          dias_vencido:    Math.abs(diasVence),
        });
      }

      // Sin actividad crítica (>7 días)
      if (dias !== null && dias >= DIAS_SIN_ACTIVIDAD_RED) {
        alerts.push({
          nivel:      'critica',
          tipo:       'sin_actividad',
          titulo:     'Sin actividad',
          mensaje:    `${dias} días sin comentarios ni horas registradas`,
          proyecto_id:     p.id,
          proyecto_nombre: p.nombre,
          clickup_id:      p.clickup_id,
          clickup_status:  p.clickup_status,
          dias_inactivo:   dias,
        });
      }

      // Próximo a vencer
      if (diasVence !== null && diasVence >= 0 && diasVence <= DIAS_PROXIMO_VENCER) {
        alerts.push({
          nivel:      'atencion',
          tipo:       'proximo_vencer',
          titulo:     'Próximo a vencer',
          mensaje:    diasVence === 0 ? 'Vence hoy' : `Vence en ${diasVence} día${diasVence !== 1 ? 's' : ''}`,
          proyecto_id:     p.id,
          proyecto_nombre: p.nombre,
          clickup_id:      p.clickup_id,
          clickup_status:  p.clickup_status,
          dias_restantes:  diasVence,
        });
      }

      // Actividad escasa (3-6 días sin actividad, solo si no cayó en crítica)
      if (dias !== null && dias >= DIAS_SIN_ACTIVIDAD_YELLOW && dias < DIAS_SIN_ACTIVIDAD_RED) {
        alerts.push({
          nivel:      'atencion',
          tipo:       'actividad_escasa',
          titulo:     'Actividad escasa',
          mensaje:    `${dias} días sin comentarios ni horas`,
          proyecto_id:     p.id,
          proyecto_nombre: p.nombre,
          clickup_id:      p.clickup_id,
          clickup_status:  p.clickup_status,
          dias_inactivo:   dias,
        });
      }
    }

    if (p.estado === 'pausado' && dias !== null && dias >= DIAS_PAUSADO_YELLOW) {
      alerts.push({
        nivel:      'atencion',
        tipo:       'pausado_largo',
        titulo:     'Pausado por mucho tiempo',
        mensaje:    `Lleva ${dias} días pausado`,
        proyecto_id:     p.id,
        proyecto_nombre: p.nombre,
        clickup_id:      p.clickup_id,
        clickup_status:  p.clickup_status,
        dias_pausado:    dias,
      });
    }

    if (p.estado === 'backlog' && p.fecha_fin_est && diasHasta(p.fecha_fin_est) !== null && diasHasta(p.fecha_fin_est) < 0) {
      alerts.push({
        nivel:      'atencion',
        tipo:       'backlog_vencido',
        titulo:     'Backlog con fecha superada',
        mensaje:    `Está en backlog pero su fecha estimada ya pasó`,
        proyecto_id:     p.id,
        proyecto_nombre: p.nombre,
        clickup_id:      p.clickup_id,
        clickup_status:  p.clickup_status,
      });
    }
  }

  // Sobrecarga de recursos
  const recursos = db.prepare(`
    SELECT r.id, r.nombre, r.rol,
      COUNT(a.id) as proyectos_activos,
      SUM(COALESCE(a.dedicacion_pct, 0)) as dedicacion_total
    FROM resources r
    JOIN assignments a ON a.resource_id = r.id
    JOIN projects p ON p.id = a.project_id AND p.estado IN ('en_curso', 'backlog')
    WHERE r.activo = 1
    GROUP BY r.id
    HAVING proyectos_activos > ?
  `).all(PROYECTOS_SOBRECARGA);

  for (const r of recursos) {
    alerts.push({
      nivel:          'atencion',
      tipo:           'sobrecarga_recurso',
      titulo:         'Recurso con sobrecarga',
      mensaje:        `${r.proyectos_activos} proyectos activos asignados${r.dedicacion_total > 0 ? ` (${r.dedicacion_total}% dedicación total)` : ''}`,
      recurso_id:     r.id,
      recurso_nombre: r.nombre,
      recurso_rol:    r.rol,
      proyectos_activos: r.proyectos_activos,
      dedicacion_total:  r.dedicacion_total,
    });
  }

  // Ordenar: críticas primero, luego por días (más urgente arriba)
  const orden = { critica: 0, atencion: 1, info: 2 };
  alerts.sort((a, b) => {
    if (orden[a.nivel] !== orden[b.nivel]) return orden[a.nivel] - orden[b.nivel];
    const da = a.dias_vencido ?? a.dias_inactivo ?? a.dias_pausado ?? a.dias_restantes ?? 0;
    const db_ = b.dias_vencido ?? b.dias_inactivo ?? b.dias_pausado ?? b.dias_restantes ?? 0;
    return db_ - da;
  });

  const criticas = alerts.filter(a => a.nivel === 'critica');
  const atencion = alerts.filter(a => a.nivel === 'atencion');

  res.json({
    total:    alerts.length,
    criticas: criticas.length,
    atencion: atencion.length,
    alerts,
  });
});

module.exports = router;
