// ── Semana helpers ────────────────────────────────────────
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
        ${venceTxt}
      </div>
      ${aiTxt}
    </div>`;
}

// ── Register on DOMContentLoaded ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof routes !== 'undefined') {
    routes['semana'] = renderSemana;
  }
});
