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
        <div class="sem-week-pager">
          <button class="btn btn-ghost btn-sm" id="sem-prev">←</button>
          <span class="sem-week-label">${swFmtRange(from)}</span>
          <button class="btn btn-ghost btn-sm" id="sem-next" ${isFuture ? 'disabled' : ''}>→</button>
        </div>
        <button class="btn btn-ghost btn-sm" id="sem-current" ${from === todayMon ? 'disabled' : ''}>Hoy</button>
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
      <button class="sem-pres-esc" id="sem-pres-close">✕ Salir</button>
      <span class="sem-pres-range">${swFmtRange(data.week_start)}</span>
      <div class="sem-pres-bar-right">
        <span class="sem-pres-keys">← → navegar</span>
        <span class="sem-pres-counter">${idx + 1} / ${total}</span>
      </div>
    </div>
    ${idx > 0 ? '<div class="sem-pres-zone sem-pres-zone-prev" id="sem-pres-zone-prev" title="Anterior"></div>' : ''}
    ${idx < total - 1 ? '<div class="sem-pres-zone sem-pres-zone-next" id="sem-pres-zone-next" title="Siguiente"></div>' : ''}
    <div class="sem-pres-body">
      ${semanaPresentCardHtml(p, data.week_start)}
    </div>
    <div class="sem-pres-footer">
      <button class="sem-pres-arrow" id="sem-pres-prev" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
      <div class="sem-pres-dots">${dots}</div>
      <button class="sem-pres-arrow" id="sem-pres-next" ${idx === total - 1 ? 'disabled' : ''}>Siguiente →</button>
    </div>
  `;

  document.getElementById('sem-pres-close').addEventListener('click', () =>
    semanaExitPresentation(overlay));

  // Botón IA en presentación
  const aiBtn = overlay.querySelector('.sem-pres-ai-btn');
  if (aiBtn) {
    aiBtn.addEventListener('click', async () => {
      const pid = aiBtn.dataset.pid;
      aiBtn.disabled = true;
      aiBtn.textContent = '⏳ Generando…';
      try {
        const r = await api.getSemanaAiSummary(pid, data.week_start);
        const box = document.getElementById(`pres-ai-box-${pid}`);
        if (box) {
          box.className = 'sem-pres-ai';
          box.textContent = r.summary;
        }
        const proj = semanaState.data.projects.find(p => String(p.id) === String(pid));
        if (proj) proj.ai_summary = r.summary;
      } catch (e) {
        aiBtn.disabled = false;
        aiBtn.textContent = '✨ Resumir con IA';
        toast(e.message, 'error');
      }
    });
  }

  document.getElementById('sem-pres-prev').addEventListener('click', () => {
    if (semanaState.presentIdx > 0) { semanaState.presentIdx--; semanaPresentDraw(overlay, data); }
  });
  document.getElementById('sem-pres-next').addEventListener('click', () => {
    if (semanaState.presentIdx < total - 1) { semanaState.presentIdx++; semanaPresentDraw(overlay, data); }
  });

  // Click zones
  document.getElementById('sem-pres-zone-prev')?.addEventListener('click', () => {
    if (semanaState.presentIdx > 0) { semanaState.presentIdx--; semanaPresentDraw(overlay, data); }
  });
  document.getElementById('sem-pres-zone-next')?.addEventListener('click', () => {
    if (semanaState.presentIdx < total - 1) { semanaState.presentIdx++; semanaPresentDraw(overlay, data); }
  });

  // Click dots to jump directly
  overlay.querySelectorAll('.sem-pres-dot').forEach((dot, i) => {
    dot.addEventListener('click', () => {
      semanaState.presentIdx = i;
      semanaPresentDraw(overlay, data);
    });
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
    ? `<div class="sem-pres-ai" id="pres-ai-box-${p.id}">${escHtml(p.ai_summary)}</div>`
    : `<div class="sem-pres-ai-box" id="pres-ai-box-${p.id}">
         <button class="sem-pres-ai-btn" data-pid="${p.id}">✨ Resumir con IA</button>
       </div>`;

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

  const projects = data.projects || [];
  if (!projects.length) {
    toast('Sin proyectos para exportar', 'error', 4000);
    return;
  }

  const btn = document.getElementById('sem-export-sheets');
  btn.disabled = true;
  btn.textContent = '⏳ Exportando...';

  // Strip events (not used by Apps Script) to reduce payload size
  const payload = {
    ...data,
    projects: projects.map(({ events: _e, ...p }) => p),
  };

  try {
    const result = await api._fetch('/api/export/sheets', {
      method: 'POST',
      body: payload,
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
function getPresentarTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'flat') return {
    bg: '#f0f2f5', cardBg: '#ffffff', cardBorder: '#d1d5db',
    text: '#1a1d2e', text2: '#6b7280',
    accent: '#6CAAD9', green: '#98D293', red: '#EB8398', orange: '#ea580c',
    headerBg: '#2a3d52', headerText: '#ffffff', headerBorder: '#2a3d52',
    sectionBorder: '#6CAAD9', sectionText: '#2a3d52',
    evBorder: '#e2e8f0', evMeta: '#718096', evText: '#2d3748',
    metricBg: '#ffffff', metricBorder: '#d1d5db', metricNum: '#2a3d52',
    riskBg: '#fff0f3', riskBorder: '#fbc8d4', riskNum: '#EB8398',
    okBg: '#f0fff4', okBorder: '#b8eabc', okNum: '#98D293',
    aiBg: '#e8f4fb', aiBorder: '#6CAAD9', aiText: '#2a3d52',
    warnBg: '#fefce8', warnText: '#92400e',
    footerBorder: '#d1d5db', footerText: '#9ca3af',
    printBtn: '#2a3d52',
  };
  if (t === 'skeu') return {
    bg: '#EBEDF0', cardBg: '#EBEDF0', cardBorder: '#D1D5DB',
    cardShadow: '-4px -4px 10px #FFFFFF, 4px 4px 10px #C8CDD6',
    text: '#31344b', text2: '#6f7491',
    accent: '#6CAAD9', green: '#98D293', red: '#EB8398', orange: '#e67e22',
    headerBg: '#2a3d52', headerText: '#ffffff', headerBorder: '#2a3d52',
    sectionBorder: '#6CAAD9', sectionText: '#2a3d52',
    evBorder: '#D1D5DB', evMeta: '#6f7491', evText: '#31344b',
    metricBg: '#EBEDF0', metricBorder: 'transparent',
    metricShadow: '-4px -4px 8px #FFFFFF, 4px 4px 8px #D1D5DB', metricNum: '#31344b',
    riskBg: '#EBEDF0', riskBorder: 'transparent',
    riskShadow: '-4px -4px 8px #FFFFFF, 4px 4px 8px #D1D5DB', riskNum: '#EB8398',
    okBg: '#EBEDF0', okBorder: 'transparent',
    okShadow: '-4px -4px 8px #FFFFFF, 4px 4px 8px #D1D5DB', okNum: '#98D293',
    aiBg: '#EBEDF0', aiBorder: '#6CAAD9', aiText: '#31344b',
    warnBg: '#fefce8', warnText: '#92400e',
    footerBorder: '#D1D5DB', footerText: '#9ba8b8',
    printBtn: '#6CAAD9',
  };
  // Dark (default)
  return {
    bg: '#1a1d27', cardBg: '#242736', cardBorder: '#2e3148',
    text: '#e2e4ef', text2: '#8b8fa8',
    accent: '#6CAAD9', green: '#98D293', red: '#EB8398', orange: '#f97316',
    headerBg: '#0f1117', headerText: '#6CAAD9', headerBorder: '#6CAAD9',
    sectionBorder: '#6CAAD9', sectionText: '#6CAAD9',
    evBorder: '#2e3148', evMeta: '#8b8fa8', evText: '#e2e4ef',
    metricBg: '#242736', metricBorder: '#2e3148', metricNum: '#e2e4ef',
    riskBg: '#2d1b22', riskBorder: '#4a2030', riskNum: '#EB8398',
    okBg: '#1b2d20', okBorder: '#204a28', okNum: '#98D293',
    aiBg: '#1a2535', aiBorder: '#6CAAD9', aiText: '#b8d4f0',
    warnBg: '#2d2800', warnText: '#d4a820',
    footerBorder: '#2e3148', footerText: '#6b7280',
    printBtn: '#6CAAD9',
  };
}

function semanaExportPDF() {
  const { data } = semanaState;
  if (!data) return;

  const c      = getPresentarTheme();
  const from   = data.week_start;
  const range  = swFmtRange(from);
  const withActivity = data.projects.filter(p => p.has_activity);
  const grouped = semanaGroup(withActivity, 'fase');

  const EV_ICON_PDF = { comment: '💬', status: '🔄', date: '📅', assignee: '·', other: '·' };

  function fmtSeg(seg) {
    if (!seg) return '';
    const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function prioBadge(p) {
    const label = { critica: 'CRÍTICA', alta: 'ALTA', media: 'MEDIA', baja: 'BAJA' }[p] || p;
    const colors = {
      critica: { color: c.red,    bg: c.riskBg  },
      alta:    { color: c.orange, bg: c.metricBg },
      media:   { color: c.accent, bg: c.metricBg },
      baja:    { color: c.green,  bg: c.okBg     },
    };
    const { color, bg } = colors[p] || { color: c.accent, bg: c.metricBg };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.6px;color:${color};background:${bg};border:1px solid ${color}44">${label}</span>`;
  }

  function saludLabel(s) {
    return { green: '🟢 Al día', yellow: '🟡 Con atención', red: '🔴 En riesgo', grey: '⚫ Sin datos', cerrado: '⚫ Cerrado', backlog: '⚫ Backlog' }[s] || s;
  }

  const { summary } = data;

  const seccionesHTML = grouped.map(group => {
    const cards = group.items.map(p => {
      const events = p.events.map(e => {
        const icon   = EV_ICON_PDF[e.event_type] || '·';
        const dayStr = swFmtDay(e.event_at);
        const detail = e.event_type === 'assignee' ? '(cambio de asignación)' : (e.detail || '');
        return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid ${c.evBorder};font-size:11px;line-height:1.4">
          <span style="color:${c.evMeta};white-space:nowrap;min-width:72px">${dayStr}</span>
          <span style="font-size:12px">${icon}</span>
          <span style="color:${c.evText}">${detail.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
        </div>`;
      }).join('');

      const faseChangeTxt = p.fase_changed
        ? `<div style="margin-bottom:6px;font-size:11px;color:${c.warnText};background:${c.warnBg};border-radius:4px;padding:3px 8px;display:inline-block">
            🔄 Cambio de fase: ${(p.fase_prev||'').replace(/</g,'&lt;')} → ${(p.clickup_status||'').replace(/</g,'&lt;')}
          </div>` : '';

      let venceTxt = '';
      if (p.fecha_fin_est) {
        const dv = swDaysUntil(p.fecha_fin_est);
        const alerta = dv < 0
          ? `<span style="color:${c.red};font-weight:700">⚠️ Vencido hace ${Math.abs(dv)}d</span>`
          : dv <= 5 ? `<span style="color:${c.orange};font-weight:700">⚠️ Vence en ${dv}d</span>`
          : `<span style="color:${c.green}">✅ Vence: ${p.fecha_fin_est}</span>`;
        venceTxt = `<span style="font-size:11px">${alerta}</span>`;
      }

      const aiTxt = p.ai_summary
        ? `<div style="margin-top:8px;padding:8px 10px;background:${c.aiBg};border-left:3px solid ${c.aiBorder};border-radius:4px;font-size:11px;color:${c.aiText};line-height:1.5">✨ ${p.ai_summary.replace(/</g,'&lt;')}</div>`
        : '';

      const cardShadow = c.cardShadow ? `box-shadow:${c.cardShadow};` : '';
      return `
        <div style="page-break-inside:avoid;border:1px solid ${c.cardBorder};border-radius:8px;padding:14px 16px;margin-bottom:12px;background:${c.cardBg};${cardShadow}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div style="font-size:13px;font-weight:700;color:${c.text};line-height:1.3">${p.nombre.replace(/</g,'&lt;')}</div>
            ${prioBadge(p.prioridad)}
          </div>
          <div style="font-size:11px;color:${c.text2};margin-bottom:8px">${(p.clickup_status||'—').replace(/</g,'&lt;')} · ${saludLabel(p.salud)}</div>
          ${faseChangeTxt}
          <div style="font-size:11px;font-weight:600;color:${c.text2};margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">Esta semana · ${p.event_count} ${p.event_count === 1 ? 'update' : 'updates'}</div>
          ${events}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:6px">
            <span style="font-size:11px;color:${c.text2}">
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
        <div style="border-left:4px solid ${c.sectionBorder};padding-left:10px;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;color:${c.sectionText};text-transform:uppercase;letter-spacing:.6px">${group.label.replace(/</g,'&lt;')}</div>
          <div style="font-size:11px;color:${c.text2}">${group.items.length} proyecto${group.items.length !== 1 ? 's' : ''} con actividad</div>
        </div>
        ${cards}
      </div>`;
  }).join('');

  function metricCard(content, opts = {}) {
    const shadow = opts.shadow ? `box-shadow:${opts.shadow};` : '';
    return `<div style="flex:1;min-width:120px;background:${opts.bg||c.metricBg};border:1px solid ${opts.border||c.metricBorder};border-radius:8px;padding:12px 16px;text-align:center;${shadow}">${content}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Avance Semanal — ${range}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Arial', Helvetica, sans-serif; font-size: 13px; color: ${c.text}; background: ${c.bg}; padding: 24px; }
    @page { margin: 18mm 14mm; }
    @media print { body { font-size: 11px; padding: 0; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="position:fixed;top:14px;right:14px;z-index:999">
    <button onclick="window.print()" style="background:${c.printBtn};color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;cursor:pointer;font-weight:600">
      🖨 Imprimir / Guardar PDF
    </button>
  </div>

  <!-- Encabezado -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;background:${c.headerBg};color:${c.headerText};border-radius:10px;padding:16px 20px;margin-bottom:20px">
    <div>
      <div style="font-size:18px;font-weight:800;letter-spacing:-.3px">Avance Semanal de Proyectos</div>
      <div style="font-size:12px;opacity:.7;margin-top:3px">Reporte generado el ${new Date().toLocaleString('es-AR', { dateStyle:'long', timeStyle:'short' })}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:14px;font-weight:700">${range}</div>
      <div style="font-size:11px;opacity:.7;margin-top:2px">Vista por fase</div>
    </div>
  </div>

  <!-- Métricas -->
  <div style="display:flex;gap:12px;margin-bottom:22px;flex-wrap:wrap">
    ${metricCard(`
      <div style="font-size:22px;font-weight:800;color:${c.accent}">${summary.with_activity}<span style="font-size:14px;color:${c.text2}"> / ${summary.total}</span></div>
      <div style="font-size:11px;color:${c.text2};margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Con actividad</div>
    `)}
    ${metricCard(`
      <div style="font-size:22px;font-weight:800;color:${c.metricNum}">${summary.total_events}</div>
      <div style="font-size:11px;color:${c.text2};margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Updates</div>
    `)}
    ${metricCard(`
      <div style="font-size:22px;font-weight:800;color:${c.metricNum}">${summary.phase_changes}</div>
      <div style="font-size:11px;color:${c.text2};margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Cambios de fase</div>
    `)}
    ${summary.entered_risk > 0 ? metricCard(`
      <div style="font-size:22px;font-weight:800;color:${c.riskNum}">+${summary.entered_risk}</div>
      <div style="font-size:11px;color:${c.riskNum};margin-top:2px;text-transform:uppercase;letter-spacing:.4px">→ En riesgo</div>
    `, { bg: c.riskBg, border: c.riskBorder, shadow: c.riskShadow }) : ''}
    ${summary.left_risk > 0 ? metricCard(`
      <div style="font-size:22px;font-weight:800;color:${c.okNum}">${summary.left_risk}</div>
      <div style="font-size:11px;color:${c.okNum};margin-top:2px;text-transform:uppercase;letter-spacing:.4px">Salieron de riesgo</div>
    `, { bg: c.okBg, border: c.okBorder, shadow: c.okShadow }) : ''}
  </div>

  <!-- Proyectos -->
  ${seccionesHTML || `<p style="color:${c.text2};text-align:center;padding:40px">Sin proyectos con actividad esta semana.</p>`}

  <!-- Pie -->
  <div style="margin-top:24px;padding-top:10px;border-top:1px solid ${c.footerBorder};font-size:10px;color:${c.footerText};text-align:center">
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
