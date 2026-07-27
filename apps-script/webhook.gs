// Gestor de Proyectos GCS — Webhook para exportar a Google Sheets
// Pegá este código en Apps Script (Extensions → Apps Script) y deployá como Web App
// (Execute as: Me, Who has access: Anyone)
//
// Tipos de payload soportados:
//   • Semana: { week_start, week_end, summary, projects: [...] }
//   • Proyectos: { type: "projects", exported_at, total, projects: [...] }

const SHEET_ID = ''; // ← Completá con el ID de tu Google Sheet

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    let result;
    if (payload.type === 'projects') {
      result = exportProjects(payload);
    } else if (payload.week_start) {
      result = exportSemana(payload);
    } else {
      throw new Error('Payload no reconocido: falta week_start o type=projects');
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Export Semana ──────────────────────────────────────────────────────────────
function exportSemana(data) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const tab = 'Sem ' + data.week_start;

  // Borrar solapa anterior si existe
  const existing = ss.getSheetByName(tab);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(tab);

  // Encabezado
  const headers = [
    'Nombre', 'Fase', 'Técnicos', 'Salud', 'Con actividad',
    'Eventos semana', 'Movimiento', 'Días inactivo', 'Vence', 'Estimado (h)', 'Resumen IA',
  ];
  sheet.appendRow(headers);
  styleHeaderRow(sheet, headers.length);

  // Filas
  const projects = data.projects || [];
  const rows = projects.map(p => [
    p.nombre || '',
    p.clickup_status || '',
    p.tecnicos || '',
    saludLabel(p.salud),
    p.has_activity ? 'Sí' : 'No',
    p.event_count || 0,
    p.movimiento || '',
    p.dias_inactivo !== null && p.dias_inactivo !== undefined ? p.dias_inactivo : '',
    p.fecha_fin_est || '',
    p.seg_estimado_semana ? Math.round((p.seg_estimado_semana / 3600) * 10) / 10 : '',
    p.ai_summary || '',
  ]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Metadata en fila final
  const { summary } = data;
  if (summary) {
    sheet.appendRow([]);
    sheet.appendRow([
      'Resumen', '',
      'Total proyectos: ' + summary.total,
      'Con actividad: ' + summary.with_activity,
      'Updates: ' + summary.total_events,
      'Cambios de fase: ' + summary.phase_changes,
      'Entraron en riesgo: ' + (summary.entered_risk || 0),
      'Salieron de riesgo: ' + (summary.left_risk || 0),
    ]);
  }

  autoResizeColumns(sheet, headers.length);

  return { ok: true, tab, rows: rows.length };
}

// ── Export Proyectos ───────────────────────────────────────────────────────────
function exportProjects(data) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const dateStr = data.exported_at
    ? data.exported_at.slice(0, 10)
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const tab = 'Proyectos ' + dateStr;

  // Borrar solapa anterior del mismo día si existe
  const existing = ss.getSheetByName(tab);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(tab);

  // Encabezado
  const headers = [
    'Nombre', 'Estado', 'Prioridad', 'Fase (ClickUp)', 'Técnicos',
    'Fecha inicio', 'Vence', 'Horas reg.', 'Horas est.',
    'Último comentario (fecha)', 'Por', 'Último comentario (texto)', 'Resumen IA',
  ];
  sheet.appendRow(headers);
  styleHeaderRow(sheet, headers.length);

  // Filas
  const projects = data.projects || [];
  const rows = projects.map(p => [
    p.nombre || '',
    estadoLabel(p.estado),
    prioLabel(p.prioridad),
    p.clickup_status || '',
    p.tecnicos || '',
    p.fecha_inicio || '',
    p.fecha_fin_est || '',
    p.seg_total ? Math.round((p.seg_total / 3600) * 10) / 10 : '',
    p.seg_estimado ? Math.round((p.seg_estimado / 3600) * 10) / 10 : '',
    p.last_comment_at ? p.last_comment_at.slice(0, 10) : '',
    p.last_comment_by || '',
    (p.last_comment_text || '').slice(0, 500),
    p.ai_summary || '',
  ]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  autoResizeColumns(sheet, headers.length);

  return { ok: true, tab, rows: rows.length };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function saludLabel(s) {
  return { green: 'Al día', yellow: 'Con atención', red: 'En riesgo', grey: 'Sin datos', cerrado: 'Cerrado', backlog: 'Backlog' }[s] || (s || '');
}

function estadoLabel(s) {
  return { backlog: 'Backlog', en_curso: 'En curso', pausado: 'Pausado', cerrado: 'Cerrado' }[s] || (s || '');
}

function prioLabel(s) {
  return { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' }[s] || (s || '');
}

function styleHeaderRow(sheet, cols) {
  const range = sheet.getRange(1, 1, 1, cols);
  range.setBackground('#1a365d');
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function autoResizeColumns(sheet, cols) {
  for (let i = 1; i <= cols; i++) {
    sheet.autoResizeColumn(i);
  }
}
