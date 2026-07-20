// ── Semana helpers ────────────────────────────────────────
function swFmtHoras(seg) {
  if (!seg) return null;
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}
function swMondayOf(date) {
  const d = date ? new Date(date) : new Date();
  const utcMs = d.getTime() - d.getTimezoneOffset() * 60000;
  const utcDate = new Date(utcMs);
  const day = utcDate.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utcDate.setUTCDate(utcDate.getUTCDate() + diff);
  return utcDate.toISOString().slice(0, 10);
}

function swSundayOf(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function swPrevMonday(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function swNextMonday(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

function swFmtRange(mondayStr) {
  const mon = new Date(mondayStr + 'T00:00:00Z');
  const sun = new Date(mondayStr + 'T00:00:00Z');
  sun.setUTCDate(sun.getUTCDate() + 6);
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${mon.toLocaleDateString('es-AR', opts)} – ${sun.toLocaleDateString('es-AR', { ...opts, year: 'numeric' })}`;
}

function swFmtDay(dtStr) {
  if (!dtStr) return '';
  const d = new Date(dtStr.replace(' ', 'T') + (dtStr.includes('T') ? '' : 'Z'));
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function swDaysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

// ── State ─────────────────────────────────────────────────
const semanaState = {
  weekStart:       null,
  data:            null,
  groupBy:         'fase',   // 'fase' | 'tecnico'
  aiEnabled:       false,
  presentProjects: [],
  presentIdx:      0,
};

// ── Route registration (called from app.js boot) ──────────
function registerSemanaRoute() {
  if (typeof routes !== 'undefined') {
    routes['semana'] = renderSemana;
  }
}

// ── Main render ───────────────────────────────────────────
async function renderSemana() {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';

  if (!semanaState.weekStart) {
    semanaState.weekStart = swMondayOf();
  }
  await semanaLoadWeek(false);
}

async function semanaLoadWeek(refresh) {
  const main = document.getElementById('main-content');
  const from = semanaState.weekStart;
  const to   = swSundayOf(from);

  main.innerHTML = `
    <div class="sem-header">
      <h1 class="sem-title">📅 Avance Semanal</h1>
      <div class="sem-week-nav">
        <span class="sem-week-label">${swFmtRange(from)}</span>
      </div>
    </div>
    <div class="spinner" style="margin-top:60px"></div>
    <div style="text-align:center;color:var(--text2);margin-top:12px;font-size:13px">
      Consultando actividad desde ClickUp…
    </div>`;

  try {
    const data = await api.getSemana(from, to, refresh);
    semanaState.data = data;
    semanaRenderFull();
  } catch (e) {
    main.innerHTML = `
      <div class="sem-header"><h1 class="sem-title">📅 Avance Semanal</h1></div>
      <div class="empty-state" style="margin-top:40px">⚠️ ${escHtml(e.message)}</div>`;
  }
}

function semanaRenderFull() {
  const main = document.getElementById('main-content');
  const { data, groupBy, aiEnabled } = semanaState;
  const { summary, projects } = data;
  const from    = data.week_start;
  const todayMon = swMondayOf();
  const isFuture = from > todayMon;

  const withActivity    = projects.filter(p => p.has_activity);
  const withoutActivity = projects.filter(p => !p.has_activity);

  // Group withActivity
  const grouped = semanaGroup(withActivity, groupBy);

  main.innerHTML = `
    <!-- Header -->
    <div class="sem-header">
      <h1 class="sem-title">📅 Avance Semanal</h1>
      <div class="sem-week-nav">
        <button class="btn btn-ghost btn-sm" id="sem-prev">← anterior</button>
        <span class="sem-week-label">${swFmtRange(from)}</span>
        <button class="btn btn-ghost btn-sm" id="sem-next" ${isFuture ? 'disabled' : ''}>siguiente →</button>
        <button class="btn btn-ghost btn-sm" id="sem-current" ${from === todayMon ? 'disabled' : ''}>Esta semana</button>
        <button class="btn btn-ghost btn-sm" id="sem-refresh" title="Recargar desde ClickUp">↻</button>
      </div>
    </div>

    <!-- KPIs -->
    <div class="sem-kpis">
      <div class="sem-kpi">
        <span class="sem-kpi-num">${summary.with_activity}<span class="sem-kpi-of"> / ${summary.total}</span></span>
        <span class="sem-kpi-lbl">con actividad</span>
      </div>
      <div class="sem-kpi">
        <span class="sem-kpi-num">${summary.total_events}</span>
        <span class="sem-kpi-lbl">updates</span>
      </div>
      <div class="sem-kpi">
        <span class="sem-kpi-num">${summary.phase_changes}</span>
        <span class="sem-kpi-lbl">cambiaron de fase</span>
      </div>
      ${summary.entered_risk > 0 ? `
      <div class="sem-kpi sem-kpi-risk">
        <span class="sem-kpi-num">+${summary.entered_risk}</span>
        <span class="sem-kpi-lbl">→ riesgo</span>
      </div>` : ''}
      ${summary.left_risk > 0 ? `
      <div class="sem-kpi sem-kpi-safe">
        <span class="sem-kpi-num">${summary.left_risk}</span>
        <span class="sem-kpi-lbl">salieron de riesgo</span>
      </div>` : ''}
    </div>

    <!-- Controls -->
    <div class="sem-controls">
      <div class="sem-group-toggle">
        <span style="color:var(--text2);font-size:12px">Agrupar:</span>
        <button class="btn btn-sm ${groupBy === 'fase'    ? 'btn-primary' : 'btn-ghost'}" data-group="fase">Por fase</button>
        <button class="btn btn-sm ${groupBy === 'tecnico' ? 'btn-primary' : 'btn-ghost'}" data-group="tecnico">Por técnico</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <label class="sem-ai-label" title="Generar resumen IA por proyecto (requiere ANTHROPIC_API_KEY)">
          <input type="checkbox" id="sem-ai-flag" ${aiEnabled ? 'checked' : ''}>
          <span>✨ Resumen IA</span>
        </label>
        ${groupBy === 'fase' ? `<button class="btn btn-secondary btn-sm" id="sem-export-pdf">⬇ Exportar PDF</button>` : ''}
        <button class="btn btn-secondary btn-sm" id="sem-export-sheets">📊 Exportar a Sheets</button>
        <button class="btn btn-primary btn-sm" id="sem-present">▶ Presentar</button>
      </div>
    </div>

    <!-- Projects with activity -->
    <div id="sem-active-section">
      ${withActivity.length === 0
        ? `<div class="sem-section-label">Con actividad esta semana (0)</div>
           <div class="empty-state" style="margin:16px 0 32px">Sin actividad registrada para esta semana.${!data.fetched_from_clickup ? ' <span style="color:var(--text2)">ClickUp no configurado.</span>' : ''}</div>`
        : grouped.map(group => `
          <div class="sem-group-header">${escHtml(group.label)} <span class="sem-group-count">${group.items.length}</span></div>
          <div class="sem-cards">
            ${group.items.map(p => semanaCardHtml(p, aiEnabled, from)).join('')}
          </div>`).join('')
      }
    </div>

    <!-- Projects without activity -->
    ${withoutActivity.length > 0 ? `
    <details class="sem-inactive-details">
      <summary class="sem-section-label sem-section-inactive">
        Sin actividad esta semana (${withoutActivity.length})
      </summary>
      <div class="sem-cards sem-cards-sm">
        ${withoutActivity.map(p => semanaCardInactiveHtml(p)).join('')}
      </div>
    </details>` : ''}
  `;

  // Wire buttons
  document.getElementById('sem-prev').addEventListener('click', () => {
    semanaState.weekStart = swPrevMonday(semanaState.weekStart);
    semanaLoadWeek(false);
  });
  document.getElementById('sem-next').addEventListener('click', () => {
    semanaState.weekStart = swNextMonday(semanaState.weekStart);
    semanaLoadWeek(false);
  });
  document.getElementById('sem-current').addEventListener('click', () => {
    semanaState.weekStart = swMondayOf();
    semanaLoadWeek(false);
  });
  document.getElementById('sem-refresh').addEventListener('click', () => {
    semanaLoadWeek(true);
  });
  document.querySelectorAll('[data-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      semanaState.groupBy = btn.dataset.group;
      semanaRenderFull();
    });
  });
  document.getElementById('sem-ai-flag').addEventListener('change', e => {
    semanaState.aiEnabled = e.target.checked;
    semanaRenderFull();
  });
  document.getElementById('sem-export-pdf')?.addEventListener('click', semanaExportPDF);
  document.getElementById('sem-export-sheets')?.addEventListener('click', semanaExportSheets);
  document.getElementById('sem-present').addEventListener('click', semanaEnterPresentation);

  main.querySelectorAll('.sem-ai-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid;
      btn.disabled = true; btn.textContent = '⏳';
      try {
        const r = await api.getSemanaAiSummary(pid, from);
        const box = document.getElementById(`sem-ai-box-${pid}`);
        if (box) box.innerHTML = `<div class="sem-ai-result">${escHtml(r.summary)}</div>`;
        // Update cached data
        const proj = semanaState.data.projects.find(p => String(p.id) === String(pid));
        if (proj) proj.ai_summary = r.summary;
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = '✨ Resumir con IA';
      }
    });
  });
}

// ── Grouping ──────────────────────────────────────────────
function semanaGroup(projects, groupBy) {
  if (groupBy === 'tecnico') {
    const map = new Map();
    for (const p of projects) {
      const tecs = p.tecnicos ? p.tecnicos.split(',').map(t => t.trim()) : ['Sin asignar'];
      for (const tec of tecs) {
        if (!map.has(tec)) map.set(tec, []);
        map.get(tec).push(p);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([label, items]) => ({ label, items }));
  }
  // groupBy === 'fase'
  const map = new Map();
  for (const p of projects) {
    const fase = p.clickup_status || '(sin fase)';
    if (!map.has(fase)) map.set(fase, []);
    map.get(fase).push(p);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, items]) => ({ label, items }));
}

// ── Card HTML ─────────────────────────────────────────────
const SALUD_DOT  = { green: '🟢', yellow: '🟡', red: '🔴', grey: '⚫', cerrado: '⚫', backlog: '⚫' };
const MOV_ICON   = { 'mejoró': '↑', 'empeoró': '↓', 'igual': '→' };
const MOV_CLASS  = { 'mejoró': 'sem-mov-up', 'empeoró': 'sem-mov-down', 'igual': 'sem-mov-same' };
const EV_ICON    = { comment: '💬', status: '🔄', date: '📅', assignee: '👤', other: '·' };

function semanaCardHtml(p, aiEnabled, weekStart) {
  const dot  = SALUD_DOT[p.salud]  || '⚪';

  const eventLines = p.events.map(e => {
    const icon   = EV_ICON[e.event_type] || '·';
    const dayStr = swFmtDay(e.event_at);
    const actor  = e.actor ? `<span class="sem-ev-actor">${escHtml(e.actor)}</span> ` : '';
    return `<div class="sem-event">
      <span class="sem-ev-day">${dayStr}</span>
      <span class="sem-ev-icon">${icon}</span>
      <span class="sem-ev-body">${actor}<span class="sem-ev-detail">${escHtml(e.detail)}</span></span>
    </div>`;
  }).join('');

  const movTxt = p.movimiento
    ? `<span class="sem-mov ${MOV_CLASS[p.movimiento] || ''}">
         ${MOV_ICON[p.movimiento] || ''} ${p.movimiento.charAt(0).toUpperCase() + p.movimiento.slice(1)}
       </span>`
    : '';

  let diasTxt = '';
  if (p.dias_inactivo_prev !== null && p.dias_inactivo !== null) {
    diasTxt = `${p.dias_inactivo_prev}d → ${p.dias_inactivo}d sin actividad`;
  } else if (p.dias_inactivo !== null) {
    diasTxt = `${p.dias_inactivo}d sin actividad`;
  }

  let venceTxt = '';
  if (p.fecha_fin_est) {
    const dv = swDaysUntil(p.fecha_fin_est);
    const vi = dv < 0 ? '🔴' : dv <= 5 ? '⚠️' : '✅';
    venceTxt = `<span class="sem-vence">Vence: ${p.fecha_fin_est} ${vi}</span>`;
  }

  const faseChangeBadge = p.fase_changed
    ? `<span class="sem-fase-change">${escHtml(p.fase_prev || '')} → ${escHtml(p.clickup_status || '')}</span>`
    : '';

  const tecChips = p.tecnicos
    ? p.tecnicos.split(',').map(t => `<span class="tec-chip">${escHtml(t.trim())}</span>`).join('')
    : '<span class="tec-chip" style="color:var(--text2)">Sin asignar</span>';

  const aiBox = aiEnabled ? `
    <div id="sem-ai-box-${p.id}" class="sem-ai-box">
      ${p.ai_summary
        ? `<div class="sem-ai-result">${escHtml(p.ai_summary)}</div>`
        : `<button class="btn btn-ghost btn-sm sem-ai-btn" data-pid="${p.id}">✨ Resumir con IA</button>`}
    </div>` : '';

  return `
    <div class="sem-card" data-salud="${p.salud}">
      <div class="sem-card-header">
        <div class="sem-card-title">
          <span class="sem-salud-dot">${dot}</span>
          <span class="sem-nombre">${escHtml(p.nombre)}</span>
          ${faseChangeBadge}
        </div>
        ${badgePrio(p.prioridad)}
      </div>
      <div class="sem-card-meta">
        <span class="sem-fase-lbl">${escHtml(p.clickup_status || '—')}</span>
        ${tecChips}
      </div>
      <div class="sem-events-wrap">
        <div class="sem-events-header">Esta semana · ${p.event_count} ${p.event_count === 1 ? 'update' : 'updates'}</div>
        <div class="sem-events">${eventLines}</div>
      </div>
      <div class="sem-card-footer">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${movTxt}
          ${diasTxt ? `<span class="sem-dias-txt">${diasTxt}</span>` : ''}
          ${p.seg_estimado_semana ? `<span class="sem-horas-est" title="Horas estimadas desde comentarios esta semana">⏱ ~${swFmtHoras(p.seg_estimado_semana)}</span>` : ''}
        </div>
        ${venceTxt}
      </div>
      ${aiBox}
    </div>`;
}

function semanaCardInactiveHtml(p) {
  const ref  = p.last_comment_at || p.updated_at;
  const dias = ref
    ? Math.floor((Date.now() - new Date(ref.replace(' ', 'T') + (ref.includes('T') ? '' : 'Z'))) / 86400000)
    : null;
  const tecChips = p.tecnicos
    ? p.tecnicos.split(',').map(t => `<span class="tec-chip">${escHtml(t.trim())}</span>`).join('')
    : '';
  return `
    <div class="sem-card sem-card-inactive">
      <div class="sem-card-header">
        <div class="sem-card-title">
          <span class="sem-salud-dot">⚫</span>
          <span class="sem-nombre">${escHtml(p.nombre)}</span>
        </div>
        ${badgePrio(p.prioridad)}
      </div>
      <div class="sem-card-meta">
        <span class="sem-fase-lbl">${escHtml(p.clickup_status || '—')}</span>
        ${tecChips}
        ${dias !== null ? `<span class="sem-dias-txt">último mov: hace ${dias}d</span>` : ''}
      </div>
    </div>`;
}

// ── Presentation mode ──────────────────────────────────────
function semanaEnterPresentation() {
  const { data } = semanaState;
  if (!data) return;
  const active = data.projects.filter(p => p.has_activity);
  if (!active.length) { toast('Sin proyectos con actividad esta semana', 'info'); return; }

  semanaState.presentProjects = active;
  semanaState.presentIdx = 0;

  const overlay = document.createElement('div');
  overlay.id = 'sem-pres-overlay';
  overlay.className = 'sem-pres-overlay';
  document.body.appendChild(overlay);
  semanaPresentDraw(overlay, data);

  function onKey(e) {
    if (e.key === 'Escape')                                        semanaExitPresentation(overlay, onKey);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (semanaState.presentIdx < active.length - 1) {
        semanaState.presentIdx++;
        semanaPresentDraw(overlay, data);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (semanaState.presentIdx > 0) {
        semanaState.presentIdx--;
        semanaPresentDraw(overlay, data);
      }
    }
  }
  document.addEventListener('keydown', onKey);
  overlay._keyHandler = onKey;
}

function semanaExitPresentation(overlay, keyHandler) {
  document.removeEventListener('keydown', keyHandler || overlay._keyHandler);
  overlay.remove();
}

function semanaPresentDraw(overlay, data) {
  const active = semanaState.presentProjects;
  const idx    = semanaState.presentIdx;
  const p      = active[idx];
  const total  = active.length;
  const dots   = active.map((_, i) =>
    `<span class="sem-pres-dot ${i === idx ? 'active' : ''}"></span>`).join('');

  overlay.innerHTML = `
    <div class="sem-pres-bar">
      <button class="sem-pres-esc" id="sem-pres-close">ESC · Salir</button>
      <span class="sem-pres-range">${swFmtRange(data.week_start)}</span>
      <span class="sem-pres-counter">${idx + 1} / ${total} con actividad</span>
    </div>
    <div class="sem-pres-body">
      ${semanaPresentCardHtml(p, data.week_start)}
    </div>
    <div class="sem-pres-footer">
      <button class="sem-pres-arrow" id="sem-pres-prev" ${idx === 0 ? 'disabled' : ''}>←</button>
      <div class="sem-pres-dots">${dots}</div>
      <button class="sem-pres-arrow" id="sem-pres-next" ${idx === total - 1 ? 'disabled' : ''}>→</button>
    </div>
  `;

  document.getElementById('sem-pres-close').addEventListener('click', () =>
    semanaExitPresentation(overlay));
  document.getElementById('sem-pres-prev').addEventListener('click', () => {
    if (semanaState.presentIdx > 0) { semanaState.presentIdx--; semanaPresentDraw(overlay, data); }
  });
  document.getElementById('sem-pres-next').addEventListener('click', () => {
    if (semanaState.presentIdx < total - 1) { semanaState.presentIdx++; semanaPresentDraw(overlay, data); }
  });
}

function semanaPresentCardHtml(p, weekStart) {
  const dot  = SALUD_DOT[p.salud] || '⚪';
  const movTxt = p.movimiento
    ? `<span class="sem-pres-mov ${MOV_CLASS[p.movimiento] || ''}">
         ${MOV_ICON[p.movimiento] || ''} ${p.movimiento.charAt(0).toUpperCase() + p.movimiento.slice(1)} vs semana anterior
       </span>`
    : '';

  let venceTxt = '';
  if (p.fecha_fin_est) {
    const dv = swDaysUntil(p.fecha_fin_est);
    const vi = dv < 0 ? '🔴' : dv <= 5 ? '⚠️' : '✅';
    venceTxt = `<div class="sem-pres-vence">Próximo vencimiento: ${p.fecha_fin_est} ${vi}</div>`;
  }

  const eventLines = p.events.map(e => {
    const icon = EV_ICON[e.event_type] || '·';
    const dayStr = swFmtDay(e.event_at);
    const actor = e.actor ? `${escHtml(e.actor)} — ` : '';
    return `<div class="sem-pres-event">
      <span class="sem-pres-ev-day">${dayStr}</span>
      <span class="sem-pres-ev-icon">${icon}</span>
      <span class="sem-pres-ev-text">${actor}${escHtml(e.detail)}</span>
    </div>`;
  }).join('');

  const tecList = p.tecnicos
    ? p.tecnicos.split(',').map(t => t.trim()).join('  ·  ')
    : 'Sin asignar';

  const faseChangeTxt = p.fase_changed
    ? `<div class="sem-pres-fase-change">Cambio de fase: ${escHtml(p.fase_prev || '')} → ${escHtml(p.clickup_status || '')}</div>`
    : '';

  const aiTxt = p.ai_summary
    ? `<div class="sem-pres-ai">${escHtml(p.ai_summary)}</div>`
    : '';

  let diasInfo = '';
  if (p.dias_inactivo_prev !== null && p.dias_inactivo !== null) {
    diasInfo = `Días sin actividad: ${p.dias_inactivo_prev}d → ${p.dias_inactivo}d`;
  } else if (p.dias_inactivo !== null) {
    diasInfo = `Días sin actividad: ${p.dias_inactivo}d`;
  }

  return `
    <div class="sem-pres-card">
      <div class="sem-pres-top">
        <div class="sem-pres-name">${dot} ${escHtml(p.nombre)}</div>
        <div class="sem-pres-prio">${badgePrio(p.prioridad)}</div>
      </div>
      <div class="sem-pres-sub">
        <span class="sem-pres-fase">${escHtml(p.clickup_status || '—')}</span>
        <span class="sem-pres-tec">${escHtml(tecList)}</span>
      </div>
      ${faseChangeTxt}
      <div class="sem-pres-events-wrap">
        <div class="sem-pres-events-title">Esta semana · ${p.event_count} ${p.event_count === 1 ? 'update' : 'updates'}</div>
        <div class="sem-pres-events">${eventLines}</div>
      </div>
      <div class="sem-pres-bottom">
        ${movTxt}
        ${diasInfo ? `<div class="sem-pres-dias">${diasInfo}</div>` : ''}
        ${p.seg_estimado_semana ? `<div class="sem-pres-dias">⏱ ~${swFmtHoras(p.seg_estimado_semana)} estimadas</div>` : ''}
        ${venceTxt}
      </div>
      ${aiTxt}
    </div>`;
}

// ── Sheets Export ─────────────────────────────────────────
async function semanaExportSheets() {
  const { data } = semanaState;
  if (!data) return;

  const btn = document.getElementById('sem-export-sheets');
  btn.disabled = true;
  btn.textContent = '⏳ Exportando...';

  try {
    const result = await api._fetch('/api/export/sheets', {
      method: 'POST',
      body: data,
    });
    if (result.ok) {
      toast(`✅ Exportado a Sheets · Solapa "${result.tab}" · ${result.rows} filas`, 'success', 5000);
    } else {
      toast(`Error: ${result.error}`, 'error', 5000);
    }
  } catch (e) {
    toast(e.message === 'sheets_webhook_url no configurada en Ajustes'
      ? '⚙️ Configurá la Sheets webhook URL en Ajustes primero'
      : e.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '📊 Exportar a Sheets';
  }
}

// ── PDF Export ────────────────────────────────────────────
function semanaExportPDF() {
  const { data } = semanaState;
  if (!data) return;

  const from    = data.week_start;
  const range   = swFmtRange(from);
  const withActivity = data.projects.filter(p => p.has_activity);
  const grouped = semanaGroup(withActivity, 'fase');

  const PRIO_COLOR = { critica: '#c53030', alta: '#c05621', media: '#2b6cb0', baja: '#276749' };
  const PRIO_BG    = { critica: '#fff5f5', alta: '#fffaf0', media: '#ebf8ff', baja: '#f0fff4' };
  const EV_ICON_PDF = { comment: '💬', status: '🔄', date: '📅', assignee: '·', other: '·' };

  function fmtSeg(seg) {
    if (!seg) return '';
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function prioBadge(p) {
    const label = { critica: 'CRÍTICA', alta: 'ALTA', media: 'MEDIA', baja: 'BAJA' }[p] || p;
    const color = PRIO_COLOR[p] || '#2b6cb0';
    const bg    = PRIO_BG[p]    || '#ebf8ff';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.6px;color:${color};background:${bg};border:1px solid ${color}33">${label}</span>`;
  }

  function saludLabel(s) {
    return { green: '🟢 Al día', yellow: '🟡 Con atención', red: '🔴 En riesgo', grey: '⚫ Sin datos', cerrado: '⚫ Cerrado', backlog: '⚫ Backlog' }[s] || s;
  }

  // Métricas
  const { summary } = data;

  // Secciones por fase (anonimizadas: sin nombres de técnicos)
  const seccionesHTML = grouped.map(group => {
    const cards = group.items.map(p => {
      const events = p.events.map(e => {
        const icon   = EV_ICON_PDF[e.event_type] || '·';
        const dayStr = swFmtDay(e.event_at);
        // detail puede contener nombre de técnico en cambios de assignee → se omite si tipo es assignee
        const detail = e.event_type === 'assignee' ? '(cambio de asignación)' : (e.detail || '');
        return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #edf2f7;font-size:11px;line-height:1.4">
          <span style="color:#718096;white-space:nowrap;min-width:72px">${dayStr}</span>
          <span style="font-size:12px">${icon}</span>
          <span style="color:#2d3748">${detail.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
        </div>`;
      }).join('');

      let faseChangeTxt = '';
      if (p.fase_changed) {
        faseChangeTxt = `<div style="margin-bottom:6px;font-size:11px;color:#744210;background:#fefcbf;border-radius:4px;padding:3px 8px;display:inline-block">
          🔄 Cambio de fase: ${(p.fase_prev||'').replace(/</g,'&lt;')} → ${(p.clickup_status||'').replace(/</g,'&lt;')}
        </div>`;
      }

      let venceTxt = '';
      if (p.fecha_fin_est) {
        const dv = swDaysUntil(p.fecha_fin_est);
        const alerta = dv < 0 ? `<span style="color:#c53030;font-weight:700">⚠️ Vencido hace ${Math.abs(dv)}d</span>`
          : dv <= 5 ? `<span style="color:#c05621;font-weight:700">⚠️ Vence en ${dv}d</span>`
          : `<span style="color:#276749">✅ Vence: ${p.fecha_fin_est}</span>`;
        venceTxt = `<span style="font-size:11px">${alerta}</span>`;
      }

      const aiTxt = p.ai_summary
        ? `<div style="margin-top:8px;padding:8px 10px;background:#ebf8ff;border-left:3px solid #2b6cb0;border-radius:4px;font-size:11px;color:#2c5282;line-height:1.5">✨ ${p.ai_summary.replace(/</g,'&lt;')}</div>`
        : '';

      return `
        <div style="page-break-inside:avoid;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;margin-bottom:12px;background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div style="font-size:13px;font-weight:700;color:#1a365d;line-height:1.3">${p.nombre.replace(/</g,'&lt;')}</div>
            ${prioBadge(p.prioridad)}
          </div>
          <div style="font-size:11px;color:#718096;margin-bottom:8px">${(p.clickup_status||'—').replace(/</g,'&lt;')} · ${saludLabel(p.salud)}</div>
          ${faseChangeTxt}
          <div style="font-size:11px;font-weight:600;color:#4a5568;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">Esta semana · ${p.event_count} ${p.event_count === 1 ? 'update' : 'updates'}</div>
          ${events}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:6px">
            <span style="font-size:11px;color:#718096">
              ${p.dias_inactivo !== null ? `${p.dias_inactivo}d sin actividad` : ''}
              ${p.seg_estimado_semana ? ` · ⏱ ~${swFmtHoras(p.seg_estimado_semana)} est.` : ''}
            </span>
            ${venceTxt}
          </div>
          ${aiTxt}
        </div>`;
    }).join('');

    return `
      <div style="page-break-inside:avoid;margin-bottom:24px">
        <div style="border-left:4px solid #2c5282;padding-left:10px;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;color:#2c5282;text-transform:uppercase;letter-spacing:.6px">${group.label.replace(/</g,'&lt;')}</div>
          <div style="font-size:11px;color:#718096">${group.items.length} proyecto${group.items.length !== 1 ? 's' : ''} con actividad</div>
        </div>
        ${cards}
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Avance Semanal — ${range}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #2d3748; background: #fff; }
    @page { margin: 18mm 14mm; }
    @media print {
      body { font-size: 11px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <!-- Botón imprimir (solo pantalla) -->
  <div class="no-print" style="position:fixed;top:14px;right:14px;z-index:999">
    <button onclick="window.print()" style="background:#1a365d;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-size:13px;cursor:pointer;font-family:Arial,sans-serif">
      🖨 Imprimir / Guardar PDF
    </button>
  </div>

  <!-- Encabezado -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a365d;padding-bottom:12px;margin-bottom:18px">
    <div>
      <div style="font-size:18px;font-weight:800;color:#1a365d;letter-spacing:-.3px">Avance Semanal de Proyectos</div>
      <div style="font-size:12px;color:#718096;margin-top:3px">Reporte generado el ${new Date().toLocaleString('es-AR', { dateStyle:'long', timeStyle:'short' })}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:14px;font-weight:700;color:#2c5282">${range}</div>
      <div style="font-size:11px;color:#718096;margin-top:2px">Vista por fase</div>
    </div>
  </div>

  <!-- Métricas -->
  <div style="display:flex;gap:12px;margin-bottom:22px;flex-wrap:wrap">
    <div style="flex:1;min-width:120px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#1a365d">${summary.with_activity}<span style="font-size:14px;color:#718096"> / ${summary.total}</span></div>
      <div style="font-size:11px;color:#718096;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Con actividad</div>
    </div>
    <div style="flex:1;min-width:120px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#1a365d">${summary.total_events}</div>
      <div style="font-size:11px;color:#718096;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Updates</div>
    </div>
    <div style="flex:1;min-width:120px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#1a365d">${summary.phase_changes}</div>
      <div style="font-size:11px;color:#718096;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Cambios de fase</div>
    </div>
    ${summary.entered_risk > 0 ? `
    <div style="flex:1;min-width:120px;background:#fff5f5;border:1px solid #fed7d7;border-radius:6px;padding:12px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#c53030">+${summary.entered_risk}</div>
      <div style="font-size:11px;color:#c53030;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">→ En riesgo</div>
    </div>` : ''}
    ${summary.left_risk > 0 ? `
    <div style="flex:1;min-width:120px;background:#f0fff4;border:1px solid #c6f6d5;border-radius:6px;padding:12px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#276749">${summary.left_risk}</div>
      <div style="font-size:11px;color:#276749;margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Salieron de riesgo</div>
    </div>` : ''}
  </div>

  <!-- Proyectos agrupados por fase -->
  ${seccionesHTML || '<p style="color:#718096;text-align:center;padding:40px">Sin proyectos con actividad esta semana.</p>'}

  <!-- Pie -->
  <div style="margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:10px;color:#a0aec0;text-align:center">
    Reporte anonimizado · Gestor de Proyectos GCS · ${new Date().getFullYear()}
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// ── Register on DOMContentLoaded ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof routes !== 'undefined') {
    routes['semana'] = renderSemana;
  }
});
