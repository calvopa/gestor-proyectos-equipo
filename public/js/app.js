// ── Tema ───────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('gestor_theme') || 'dark';
  const valid = ['flat', 'skeu', 'pro'];
  document.documentElement.dataset.theme = valid.includes(saved) ? saved : '';
  document.addEventListener('DOMContentLoaded', () => syncThemeBtns(saved));
})();

function syncThemeBtns(theme) {
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeBtn === theme);
  });
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-theme-btn]');
  if (!btn) return;
  const theme = btn.dataset.themeBtn;
  const valid = ['flat', 'skeu', 'pro'];
  document.documentElement.dataset.theme = valid.includes(theme) ? theme : '';
  localStorage.setItem('gestor_theme', theme);
  syncThemeBtns(theme);
});

// ── State ──────────────────────────────────────────────────
const state = {
  route: null,
  params: {},
  activeTimers: {},      // projectId → { entryId, startTime, interval }
};

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'info', ms = 3000) {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── Utils ──────────────────────────────────────────────────
function fmtSec(s) {
  if (!s) return '0h 0m';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtSecTimer(s) {
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function badgeEstado(e) {
  const labels = { backlog: 'Backlog', en_curso: 'En curso', pausado: 'Pausado', cerrado: 'Cerrado' };
  return `<span class="badge badge-${e}">${labels[e] || e}</span>`;
}

function badgePrio(p) {
  const labels = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' };
  return `<span class="badge badge-${p}">${labels[p] || p}</span>`;
}

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstChild;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Modal globals: Escape + body scroll lock ───────────────
// Observa aparición/desaparición de .modal-overlay en el DOM.
// Funciona para todos los modales sin modificar cada uno.
(function initModalGlobals() {
  const lockScroll   = () => { document.body.style.overflow = 'hidden'; };
  const unlockScroll = () => { if (!document.querySelector('.modal-overlay')) document.body.style.overflow = ''; };

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes)   { if (node.classList?.contains('modal-overlay')) lockScroll(); }
      for (const node of m.removedNodes) { if (node.classList?.contains('modal-overlay')) unlockScroll(); }
    }
  });
  observer.observe(document.body, { childList: true });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Cierra el overlay más reciente
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length) overlays[overlays.length - 1].remove();
  });
})();

// ── Salud & Actividad ──────────────────────────────────────
function diasSinActividad(p) {
  const ref = p.last_comment_at || p.updated_at || p.created_at;
  if (!ref) return null;
  return Math.floor((Date.now() - new Date(ref.replace(' ', 'T') + (ref.includes('T') ? '' : 'Z'))) / 86400000);
}

// Devuelve { level: 'red'|'yellow'|'green'|'grey', titulo, detalle }
function calcSalud(p) {
  if (p.estado === 'cerrado') return { level: 'grey',   titulo: 'Cerrado',    detalle: 'Proyecto finalizado' };
  if (p.estado === 'backlog') return { level: 'grey',   titulo: 'Backlog',    detalle: 'Sin iniciar' };

  const hoy       = Date.now();
  const dias      = diasSinActividad(p);
  const vencido   = p.fecha_fin_est && new Date(p.fecha_fin_est) < hoy;
  const proxVence = p.fecha_fin_est && !vencido && Math.floor((new Date(p.fecha_fin_est) - hoy) / 86400000) <= 5;

  if (p.estado === 'en_curso') {
    if (vencido)               return { level: 'red',    titulo: 'Vencido',        detalle: `Fecha de entrega superada` };
    if (dias !== null && dias > 7)  return { level: 'red',    titulo: 'Sin actividad',  detalle: `${dias} días sin comentarios` };
    if (proxVence)             return { level: 'yellow', titulo: 'Próximo a vencer', detalle: `Vence en ≤ 5 días` };
    return                            { level: 'green',  titulo: 'Al día',          detalle: 'Activo y con actividad reciente' };
  }

  if (p.estado === 'pausado') {
    if (dias !== null && dias > 14) return { level: 'yellow', titulo: 'Pausado largo', detalle: `${dias} días sin actividad` };
    return                           { level: 'grey',   titulo: 'Pausado',        detalle: 'En pausa' };
  }

  return { level: 'grey', titulo: '—', detalle: '' };
}

function semaforoHtml(p) {
  const s = calcSalud(p);
  return `<span class="semaforo semaforo-${s.level}" title="${escHtml(s.detalle)}"></span>`;
}

function diasHtml(p) {
  if (p.estado === 'cerrado') return '<span style="color:var(--text2)">—</span>';
  const d = diasSinActividad(p);
  if (d === null) return '<span style="color:var(--text2)">—</span>';
  let cls = '';
  if (d > 7)  cls = 'dias-red';
  else if (d > 3) cls = 'dias-yellow';
  return `<span class="dias-badge ${cls}">${d}d</span>`;
}

// ── Router ─────────────────────────────────────────────────
const routes = {
  'dashboard':      renderDashboard,
  'projects':       renderProjects,
  'kanban':         renderKanban,
  'alerts':         renderAlerts,
  'project-detail': renderProjectDetail,
  'resources':      renderResources,
  'carga':          renderCarga,
  'gantt':          renderGantt,
  'settings':       renderSettings,
  'dashboard':      renderDashboard,
  'semana':         () => renderSemana(),
  'resumen-horas':  renderResumenHoras,
  'conversaciones': () => renderConversaciones(),
  'sprints':        renderSprints,
};

function navigate(route, params = {}) {
  state.route = route;
  state.params = params;
  document.querySelectorAll('nav ul li a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';
  routes[route]?.(params).catch(err => {
    main.innerHTML = `<div class="empty"><p>Error: ${escHtml(err.message)}</p></div>`;
  });
}

// ── Nav / Sync + Alert badge ───────────────────────────────
async function updateSyncStatus() {
  try {
    const s = await api.getSyncStatus();
    const dot = document.querySelector('.sync-status .dot');
    const txt = document.querySelector('.sync-status .sync-txt');
    dot.className = 'dot ' + (s.configured ? 'ok' : '');
    const last = s.last_sync ? new Date(s.last_sync).toLocaleTimeString('es-AR') : 'nunca';
    txt.textContent = s.configured ? `Sync: ${last}` : 'ClickUp: sin config';
  } catch {}
}

async function updateAlertBadge() {
  try {
    const data = await api.getAlerts();
    const badge = document.getElementById('nav-alert-badge');
    if (!badge) return;
    if (data.criticas > 0) {
      badge.textContent = data.criticas;
      badge.style.display = 'inline-flex';
      badge.style.background = 'var(--red)';
    } else if (data.atencion > 0) {
      badge.textContent = data.atencion;
      badge.style.display = 'inline-flex';
      badge.style.background = 'var(--yellow)';
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

// ── ⓪ Dashboard / Inicio ──────────────────────────────────
async function renderDashboard() {
  const main = document.getElementById('main-content');
  const [dash, projects, alerts] = await Promise.all([
    api.getDashboard(),
    api.getProjects(),
    api.getAlerts(),
  ]);

  // Salud global sobre proyectos no cerrados
  const abiertos = projects.filter(p => p.estado !== 'cerrado');
  const salud = { red: 0, yellow: 0, green: 0, grey: 0 };
  abiertos.forEach(p => { salud[calcSalud(p).level]++; });
  const saludTotal = abiertos.length || 1;
  const pct = n => Math.round((n / saludTotal) * 100);

  const pe = dash.proyectos;
  const estadoDefs = [
    ['en_curso', 'En curso', pe.en_curso],
    ['backlog',  'Backlog',  pe.backlog],
    ['pausado',  'Pausado',  pe.pausado],
    ['cerrado',  'Cerrado',  pe.cerrado],
  ];

  const criticas = alerts.alerts.filter(a => a.nivel === 'critica').slice(0, 5);
  const maxWeek  = Math.max(1, ...dash.topWeek.map(t => t.seg));

  main.innerHTML = `
    <div class="page-header">
      <h1>Inicio</h1>
      <button class="btn btn-secondary btn-sm" id="btn-dash-refresh">↻ Actualizar</button>
    </div>

    <div class="dash-stats">
      <div class="stat-card dash-stat clickable" data-goto="projects" data-estado="en_curso">
        <div class="label">Proyectos activos</div>
        <div class="value">${pe.en_curso}</div>
        <div class="dash-sub">${pe.total} en total</div>
      </div>
      <div class="stat-card dash-stat">
        <div class="label">Horas · últimos 7 días</div>
        <div class="value">${fmtSec(dash.horas.d7_seg)}</div>
        <div class="dash-sub">contabilizadas</div>
      </div>
      <div class="stat-card dash-stat">
        <div class="label">Horas · últimos 30 días</div>
        <div class="value">${fmtSec(dash.horas.d30_seg)}</div>
        <div class="dash-sub">contabilizadas</div>
      </div>
      <div class="stat-card dash-stat">
        <div class="label">Horas totales</div>
        <div class="value">${fmtSec(dash.horas.total_seg)}</div>
        <div class="dash-sub">histórico</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="dash-card-title">Salud de proyectos <span style="color:var(--text2);font-weight:400">· ${abiertos.length} abiertos</span></div>
        <div class="salud-bar">
          ${salud.red    ? `<div class="salud-seg seg-red"    style="width:${pct(salud.red)}%"    title="${salud.red} en riesgo"></div>` : ''}
          ${salud.yellow ? `<div class="salud-seg seg-yellow" style="width:${pct(salud.yellow)}%" title="${salud.yellow} con atención"></div>` : ''}
          ${salud.green  ? `<div class="salud-seg seg-green"  style="width:${pct(salud.green)}%"  title="${salud.green} al día"></div>` : ''}
          ${salud.grey   ? `<div class="salud-seg seg-grey"   style="width:${pct(salud.grey)}%"   title="${salud.grey} sin iniciar/pausa"></div>` : ''}
        </div>
        <div class="salud-legend">
          <span class="clickable" data-goto="projects" data-riesgo="1"><span class="semaforo semaforo-red"></span> ${salud.red} en riesgo</span>
          <span class="clickable" data-goto="projects" data-riesgo="1"><span class="semaforo semaforo-yellow"></span> ${salud.yellow} atención</span>
          <span><span class="semaforo semaforo-green"></span> ${salud.green} al día</span>
          <span><span class="semaforo semaforo-grey"></span> ${salud.grey} en pausa/backlog</span>
        </div>

        <div class="dash-card-title" style="margin-top:22px">Proyectos por estado</div>
        <div class="estado-chips">
          ${estadoDefs.map(([e, lbl, n]) => `
            <div class="estado-chip clickable" data-goto="projects" data-estado="${e}">
              <div class="estado-chip-n">${n}</div>
              ${badgeEstado(e)}
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="dash-card-title">
          Alertas críticas
          ${alerts.criticas ? `<span class="alerta-pill alerta-red" style="margin-left:6px">${alerts.criticas}</span>` : ''}
          <a href="#" class="dash-link" data-goto="alerts" style="float:right">ver todas ›</a>
        </div>
        ${criticas.length === 0
          ? `<div class="dash-empty">✅ Sin alertas críticas</div>`
          : criticas.map(a => `
            <div class="dash-alert clickable" data-goto="project-detail" data-id="${a.proyecto_id || ''}">
              <span class="alert-dot critica"></span>
              <div style="flex:1;min-width:0">
                <div class="dash-alert-name">${escHtml(a.proyecto_nombre || a.recurso_nombre || '')}</div>
                <div class="dash-alert-msg">${escHtml(a.mensaje)}</div>
              </div>
            </div>
          `).join('')}
      </div>
    </div>

    <div class="dash-grid" style="margin-top:16px">
      <div class="card">
        <div class="dash-card-title">Top proyectos · horas últimos 7 días</div>
        ${dash.topWeek.length === 0
          ? `<div class="dash-empty">Sin horas registradas esta semana</div>`
          : dash.topWeek.map(t => `
            <div class="topweek-row clickable" data-goto="project-detail" data-id="${t.id}">
              <div class="topweek-info">
                <span class="topweek-name">${escHtml(t.nombre)}</span>
                <span class="topweek-hrs">${fmtSec(t.seg)}</span>
              </div>
              <div class="topweek-bar"><div class="topweek-fill" style="width:${Math.round((t.seg / maxWeek) * 100)}%"></div></div>
            </div>
          `).join('')}
      </div>

      <div class="card">
        <div class="dash-card-title">Actividad reciente <span style="color:var(--text2);font-weight:400">· ClickUp</span></div>
        ${dash.recientes.length === 0
          ? `<div class="dash-empty">Sin comentarios recientes</div>`
          : dash.recientes.map(r => `
            <div class="dash-reciente clickable" data-goto="project-detail" data-id="${r.id}">
              <div class="dash-reciente-name">${escHtml(r.nombre)}</div>
              <div class="dash-reciente-text">${escHtml((r.last_comment_text || '').slice(0, 100))}${(r.last_comment_text || '').length > 100 ? '…' : ''}</div>
              <div class="dash-reciente-meta">${escHtml(r.last_comment_by || '')}${r.last_comment_at ? ' · ' + new Date(r.last_comment_at).toLocaleDateString('es-AR') : ''}</div>
            </div>
          `).join('')}
      </div>
    </div>
  `;

  document.getElementById('btn-dash-refresh').addEventListener('click', () => navigate('dashboard'));

  // Navegación desde elementos clickeables
  main.querySelectorAll('[data-goto]').forEach(elm => {
    elm.addEventListener('click', e => {
      e.preventDefault();
      const goto = elm.dataset.goto;
      if (goto === 'project-detail') {
        if (elm.dataset.id) navigate('project-detail', { id: elm.dataset.id });
      } else if (goto === 'projects') {
        const params = {};
        if (elm.dataset.estado) params.estado = elm.dataset.estado;
        if (elm.dataset.riesgo) params.soloRiesgo = true;
        navigate('projects', params);
      } else {
        navigate(goto);
      }
    });
  });
}

// ── ① Projects table ──────────────────────────────────────
const projectAiCache = new Map();

function saveProjectFilters(f) {
  try { localStorage.setItem('gestor_proj_filters', JSON.stringify(f)); } catch {}
}
function loadProjectFilters() {
  try { return JSON.parse(localStorage.getItem('gestor_proj_filters') || 'null'); } catch { return null; }
}

async function renderProjects(params = {}) {
  const fromNav = Object.keys(params).length === 0;
  const saved   = fromNav ? (loadProjectFilters() || {}) : {};
  const {
    search    = saved.search    ?? '',
    estado    = saved.estado    ?? '',
    prioridad = saved.prioridad ?? '',
    fase      = saved.fase      ?? '',
    tecnico   = saved.tecnico   ?? '',
    sort      = saved.sort      ?? 'updated_at',
    dir       = saved.dir       ?? 'desc',
    soloRiesgo = saved.soloRiesgo ?? false,
    focusSearch = false,
  } = params;

  saveProjectFilters({ search, estado, prioridad, fase, tecnico, sort, dir, soloRiesgo });

  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';

  const [projects, phases, resources] = await Promise.all([
    api.getProjects({ search, estado, prioridad, fase, tecnico, sort, dir }),
    api.getPhases(),
    api.getResources(),
  ]);

  let filtered = projects;
  if (soloRiesgo) {
    filtered = filtered.filter(p => ['red','yellow'].includes(calcSalud(p).level));
  }

  const enRiesgo = filtered.filter(p => calcSalud(p).level === 'red').length;
  const atencion = filtered.filter(p => calcSalud(p).level === 'yellow').length;

  const sortCols = [
    ['nombre','Nombre'],['estado','Estado'],['prioridad','Prioridad'],['fecha_fin_est','Vence']
  ];

  main.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <h1>Proyectos <span style="color:var(--text2);font-size:14px;font-weight:400">${filtered.length}</span></h1>
        ${enRiesgo ? `<span class="alerta-pill alerta-red">🔴 ${enRiesgo} en riesgo</span>` : ''}
        ${atencion ? `<span class="alerta-pill alerta-yellow">🟡 ${atencion} con atención</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-secondary btn-sm" id="btn-export-sheets-projects">📊 Exportar a Sheets</button>
        <button class="btn btn-primary" id="btn-new-project">＋ Nuevo proyecto</button>
      </div>
    </div>
    <div class="proj-filters">
      <div class="proj-filters-top">
        <input type="text" id="f-search" placeholder="🔍 Buscar proyecto..." value="${escHtml(search)}">
        <select id="f-prioridad">
          <option value="">Prioridad</option>
          ${['baja','media','alta','critica'].map(p => `<option value="${p}" ${prioridad===p?'selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
        </select>
        <select id="f-tecnico">
          <option value="">Técnico</option>
          ${resources.map(r => `<option value="${r.id}" ${tecnico===String(r.id)?'selected':''}>${escHtml(r.nombre)}</option>`).join('')}
        </select>
        ${phases.length ? `<select id="f-fase">
          <option value="">Fase ClickUp</option>
          ${phases.map(f => `<option value="${escHtml(f)}" ${fase===f?'selected':''}>${escHtml(f)}</option>`).join('')}
        </select>` : ''}
        <button class="btn btn-sm ${soloRiesgo?'btn-primary':'btn-ghost'}" id="f-riesgo" title="Solo proyectos en riesgo o con atención">⚠ Riesgo</button>
        ${(search||estado||prioridad||fase||tecnico||soloRiesgo) ? `<button class="btn btn-ghost btn-sm" id="f-clear" title="Limpiar filtros">✕ Limpiar</button>` : ''}
      </div>
      <div class="estado-chips">
        ${[
          { v:'',        label:'Todos',    icon:'' },
          { v:'backlog', label:'Backlog',  icon:'📋' },
          { v:'en_curso',label:'En curso', icon:'🔵' },
          { v:'pausado', label:'Pausado',  icon:'⏸' },
          { v:'cerrado', label:'Cerrado',  icon:'✓'  },
        ].map(s => `<button class="estado-chip estado-chip-${s.v||'all'} ${estado===s.v?'active':''}" data-estado="${s.v}">${s.icon?s.icon+' ':''}${s.label}</button>`).join('')}
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:32px" title="Salud">●</th>
            ${sortCols.map(([col,label]) =>
              `<th data-col="${col}" data-dir="${sort===col?(dir==='asc'?'desc':'asc'):'asc'}">${label}${sort===col?(dir==='asc'?' ↑':' ↓'):''}</th>`
            ).join('')}
            <th data-sort-dias title="Ordenar por días sin actividad">Sin actividad ↕</th>
            <th>Técnicos</th>
            <th>Último comentario</th>
            <th>Horas</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="projects-tbody">
          ${filtered.length === 0
            ? `<tr><td colspan="11"><div class="empty"><div class="empty-icon">📋</div><p>${soloRiesgo ? 'Sin proyectos en riesgo 🎉' : 'Sin proyectos todavía'}</p></div></td></tr>`
            : filtered.map(p => {
                const salud = calcSalud(p);
                const dias  = diasSinActividad(p);
                const tecs  = p.tecnicos ? p.tecnicos.split(',').map(t => t.trim()).filter(Boolean) : [];
                return `
                <tr data-id="${p.id}" class="fila-${salud.level}">
                  <td style="text-align:center">
                    ${semaforoHtml(p)}
                    <div class="semaforo-label">${escHtml(salud.titulo)}</div>
                  </td>
                  <td>
                    <a href="#" class="project-link" data-id="${p.id}" style="font-weight:600">${escHtml(p.nombre)}</a>
                    ${!p.cuenta_horas ? ' <span class="no-cuenta-badge">sin cómputo</span>' : ''}
                    ${p.clickup_status ? `<div style="font-size:11px;color:var(--text2);margin-top:2px">${escHtml(p.clickup_status)}</div>` : ''}
                  </td>
                  <td>${badgeEstado(p.estado)}</td>
                  <td>${badgePrio(p.prioridad)}</td>
                  <td style="font-size:12px">${p.fecha_fin_est || '—'}</td>
                  <td style="text-align:center" data-dias="${dias ?? 9999}">
                    ${diasHtml(p)}
                    ${salud.detalle && salud.level !== 'grey' ? `<div class="semaforo-detalle">${escHtml(salud.detalle)}</div>` : ''}
                  </td>
                  <td style="font-size:12px">
                    ${tecs.length
                      ? tecs.map(t => `<span class="tec-chip">${escHtml(t)}</span>`).join(' ')
                      : '<span style="color:var(--text2)">—</span>'}
                  </td>
                  <td class="comment-cell">
                    ${p.last_comment_text
                      ? `<div class="last-comment">
                          <div class="lc-text">${escHtml(p.last_comment_text.slice(0, 90))}${p.last_comment_text.length > 90 ? '…' : ''}</div>
                          <div class="lc-meta">${escHtml(p.last_comment_by || '')}${p.last_comment_at ? ' · ' + new Date(p.last_comment_at).toLocaleDateString('es-AR') : ''}</div>
                         </div>`
                      : '<span style="color:var(--text2);font-size:12px">—</span>'}
                  </td>
                  <td id="hours-${p.id}" style="font-size:13px">—</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-sm btn-ai-project" data-id="${p.id}" title="Resumen IA">✨</button>
                    <button class="btn btn-ghost btn-sm btn-edit-project" data-id="${p.id}">✎</button>
                    <button class="btn btn-danger btn-sm btn-del-project" data-id="${p.id}">✕</button>
                  </td>
                </tr>
                <tr class="ai-summary-row" id="ai-row-${p.id}" style="display:none">
                  <td colspan="10" style="padding:0">
                    <div id="ai-box-${p.id}" class="proj-ai-box"></div>
                  </td>
                </tr>`;
              }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Horas async
  if (filtered.length) {
    api.getTotals().then(({ byProject }) => {
      byProject.forEach(row => {
        const cell = document.getElementById(`hours-${row.id}`);
        if (!cell) return;
        const txt = fmtSec(row.seg_contados);
        const extra = row.seg_total !== row.seg_contados
          ? `<span style="color:var(--text2);font-size:11px"> (+${fmtSec(row.seg_total - row.seg_contados)})</span>` : '';
        cell.innerHTML = txt + extra;
      });
    }).catch(() => {});
  }

  // Helper para leer filtros actuales
  function getFilters() {
    return {
      search:    document.getElementById('f-search')?.value    || '',
      estado:    document.querySelector('.estado-chip.active')?.dataset.estado || '',
      prioridad: document.getElementById('f-prioridad')?.value || '',
      fase:      document.getElementById('f-fase')?.value      || '',
      tecnico:   document.getElementById('f-tecnico')?.value   || '',
    };
  }

  // Ordenar por días sin actividad (client-side)
  main.querySelector('[data-sort-dias]')?.addEventListener('click', () => {
    const tbody = document.getElementById('projects-tbody');
    const rows  = [...tbody.querySelectorAll('tr[data-id]')];
    const btn   = main.querySelector('[data-sort-dias]');
    const asc   = btn.dataset.diasDir !== 'asc';
    btn.dataset.diasDir = asc ? 'asc' : 'desc';
    btn.textContent = `Sin actividad ${asc ? '↑' : '↓'}`;
    rows.sort((a, b) => {
      const da = parseInt(a.querySelector('[data-dias]')?.dataset.dias ?? 9999);
      const db = parseInt(b.querySelector('[data-dias]')?.dataset.dias ?? 9999);
      return asc ? da - db : db - da;
    });
    rows.forEach(r => tbody.appendChild(r));
  });

  // Filtros event listeners
  let searchTimer;
  document.getElementById('f-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderProjects({ ...getFilters(), search: e.target.value, sort, dir, soloRiesgo, focusSearch: true }), 300);
  });

  // Restaurar foco tras re-render por búsqueda (el input se recrea con innerHTML)
  if (focusSearch) {
    const inp = document.getElementById('f-search');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  ['f-prioridad','f-fase','f-tecnico'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () =>
      renderProjects({ ...getFilters(), sort, dir, soloRiesgo }));
  });

  // Chips de estado
  main.querySelectorAll('.estado-chip').forEach(chip => {
    chip.addEventListener('click', () =>
      renderProjects({ ...getFilters(), estado: chip.dataset.estado, sort, dir, soloRiesgo }));
  });

  document.getElementById('f-riesgo')?.addEventListener('click', () =>
    renderProjects({ ...getFilters(), sort, dir, soloRiesgo: !soloRiesgo }));
  document.getElementById('f-clear')?.addEventListener('click', () =>
    renderProjects({ search: '', estado: '', prioridad: '', fase: '', tecnico: '', sort, dir, soloRiesgo: false }));

  main.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => renderProjects({
      ...getFilters(), sort: th.dataset.col, dir: th.dataset.dir, soloRiesgo
    }));
  });

  main.querySelectorAll('.btn-ai-project').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id  = btn.dataset.id;
      const row = document.getElementById(`ai-row-${id}`);
      const box = document.getElementById(`ai-box-${id}`);
      // Toggle off
      if (row.style.display !== 'none') { row.style.display = 'none'; return; }
      row.style.display = '';
      // Cached result
      if (projectAiCache.has(id)) {
        box.innerHTML = `<div class="proj-ai-result">${escHtml(projectAiCache.get(id))}</div>`;
        return;
      }
      box.innerHTML = '<div class="proj-ai-loading">✨ Generando resumen con IA…</div>';
      btn.disabled = true;
      try {
        const { summary } = await api.getProjectAiSummary(id);
        projectAiCache.set(id, summary);
        box.innerHTML = `<div class="proj-ai-result">${escHtml(summary)}</div>`;
      } catch (e) {
        box.innerHTML = `<div class="proj-ai-error">${escHtml(e.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.getElementById('btn-export-sheets-projects').addEventListener('click', () => projectsExportSheets(filtered));
  document.getElementById('btn-new-project').addEventListener('click', () => showProjectModal());
  main.querySelectorAll('.project-link').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); navigate('project-detail', { id: a.dataset.id }); }));
  main.querySelectorAll('.btn-edit-project').forEach(b =>
    b.addEventListener('click', () => showProjectModal(b.dataset.id)));
  main.querySelectorAll('.btn-del-project').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar proyecto?')) return;
      await api.deleteProject(b.dataset.id);
      toast('Proyecto eliminado', 'success');
      renderProjects({ search, estado, prioridad, fase, tecnico, sort, dir });
    }));
}

// ── Projects → Sheets export ──────────────────────────────
async function projectsExportSheets(projects) {
  if (!projects || !projects.length) {
    toast('Sin proyectos visibles para exportar. Revisá los filtros activos.', 'error', 5000);
    return;
  }

  const btn = document.getElementById('btn-export-sheets-projects');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Exportando...'; }

  try {
    // Enriquecer con horas reales
    let horasByProject = {};
    try {
      const { byProject } = await api.getTotals();
      byProject.forEach(r => { horasByProject[r.id] = r; });
    } catch (_) {}

    const enriched = projects.map(p => {
      const h = horasByProject[p.id];
      return { ...p, seg_total: h?.seg_total ?? 0, seg_estimado: h?.seg_estimado ?? 0 };
    });

    const result = await api._fetch('/api/export/sheets', {
      method: 'POST',
      body: {
        type: 'projects',
        exported_at: new Date().toISOString(),
        total: enriched.length,
        projects: enriched,
      },
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
    if (btn) { btn.disabled = false; btn.textContent = '📊 Exportar a Sheets'; }
  }
}

// ── Project modal ─────────────────────────────────────────
async function showProjectModal(id = null) {
  const project = id ? await api.getProject(id) : null;
  const p = project || {};

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <h2>${id ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
        <div class="form-group"><label>Nombre *</label><input type="text" id="m-nombre" value="${escHtml(p.nombre||'')}"></div>
        <div class="form-group"><label>Descripción</label><textarea id="m-desc">${escHtml(p.descripcion||'')}</textarea></div>
        <div class="form-row">
          <div class="form-group">
            <label>Estado</label>
            <select id="m-estado">
              ${loadKanbanCols().map(c => `<option value="${escHtml(c.key)}" ${(p.estado||'backlog')===c.key?'selected':''}>${escHtml(c.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Prioridad</label>
            <select id="m-prioridad">
              ${['baja','media','alta','critica'].map(e => `<option value="${e}" ${(p.prioridad||'media')===e?'selected':''}>${e}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fecha inicio</label><input type="date" id="m-inicio" value="${p.fecha_inicio||''}"></div>
          <div class="form-group"><label>Fecha fin est.</label><input type="date" id="m-fin" value="${p.fecha_fin_est||''}"></div>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="m-cuenta" ${(!id || p.cuenta_horas) ? 'checked' : ''} style="width:auto">
            Contar horas en totales
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="m-cancel">Cancelar</button>
          <button class="btn btn-primary" id="m-save">Guardar</button>
        </div>
      </div>
    </div>
  `);

  document.body.appendChild(overlay);
  document.getElementById('m-nombre').focus();

  overlay.querySelector('#m-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#m-save').addEventListener('click', async () => {
    const nombre = document.getElementById('m-nombre').value.trim();
    if (!nombre) return toast('El nombre es requerido', 'error');
    const body = {
      nombre,
      descripcion: document.getElementById('m-desc').value.trim() || null,
      estado: document.getElementById('m-estado').value,
      prioridad: document.getElementById('m-prioridad').value,
      fecha_inicio: document.getElementById('m-inicio').value || null,
      fecha_fin_est: document.getElementById('m-fin').value || null,
      cuenta_horas: document.getElementById('m-cuenta').checked,
    };
    try {
      if (id) await api.updateProject(id, body);
      else await api.createProject(body);
      toast(id ? 'Proyecto actualizado' : 'Proyecto creado', 'success');
      overlay.remove();
      navigate(state.route, state.params);
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ── Kanban column config ──────────────────────────────────
const KANBAN_DEFAULT_COLS = [
  { key: 'backlog',  label: 'Backlog',  color: '#94a3b8' },
  { key: 'en_curso', label: 'En curso', color: '#6CAAD9' },
  { key: 'pausado',  label: 'Pausado',  color: '#fbbf24' },
  { key: 'cerrado',  label: 'Cerrado',  color: '#98D293' },
];
const KANBAN_PALETTE = ['#94a3b8','#6CAAD9','#fbbf24','#98D293','#EB8398','#a78bfa','#f97316','#22d3ee'];

function loadKanbanCols() {
  try {
    const s = JSON.parse(localStorage.getItem('gestor_kanban_cols') || 'null');
    if (Array.isArray(s) && s.length) return s;
  } catch {}
  return [...KANBAN_DEFAULT_COLS];
}

function saveKanbanCols(cols) {
  localStorage.setItem('gestor_kanban_cols', JSON.stringify(cols));
}

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || ('col_' + Date.now());
}

function showKanbanColsModal(onSave) {
  let cols = loadKanbanCols();
  let selectedColor = KANBAN_PALETTE[0];

  function renderList(container) {
    container.innerHTML = cols.map((c, i) => `
      <div class="kcol-row">
        <span class="kcol-dot" style="background:${c.color}"></span>
        <span class="kcol-label">${escHtml(c.label)}</span>
        <div class="kcol-actions">
          <button class="btn btn-ghost btn-xs kcol-up"   data-i="${i}" ${i === 0             ? 'disabled' : ''}>▲</button>
          <button class="btn btn-ghost btn-xs kcol-down" data-i="${i}" ${i === cols.length-1 ? 'disabled' : ''}>▼</button>
          <button class="btn btn-ghost btn-xs kcol-del"  data-i="${i}" ${cols.length <= 1    ? 'disabled' : ''}>✕</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.kcol-up').forEach(btn =>
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i;
        if (i > 0) { [cols[i-1], cols[i]] = [cols[i], cols[i-1]]; renderList(container); }
      })
    );
    container.querySelectorAll('.kcol-down').forEach(btn =>
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i;
        if (i < cols.length-1) { [cols[i], cols[i+1]] = [cols[i+1], cols[i]]; renderList(container); }
      })
    );
    container.querySelectorAll('.kcol-del').forEach(btn =>
      btn.addEventListener('click', () => { cols.splice(+btn.dataset.i, 1); renderList(container); })
    );
  }

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal" style="max-width:420px">
        <h2>Gestionar columnas</h2>
        <div id="kcol-list"></div>
        <div class="kcol-add">
          <p class="kcol-add-label">Agregar columna</p>
          <div class="kcol-palette" id="kcol-palette">
            ${KANBAN_PALETTE.map((c, i) => `<button class="kcol-swatch${i===0?' active':''}" data-color="${c}" style="background:${c}"></button>`).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input type="text" id="kcol-name" placeholder="Nombre de columna…" style="flex:1">
            <button class="btn btn-primary btn-sm" id="kcol-agregar">＋ Agregar</button>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="btn btn-ghost btn-sm" id="kcol-reset">Restablecer</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" id="kcol-cancel">Cancelar</button>
            <button class="btn btn-primary"   id="kcol-save">Guardar</button>
          </div>
        </div>
      </div>
    </div>
  `);

  document.body.appendChild(overlay);
  const listEl = overlay.querySelector('#kcol-list');
  renderList(listEl);

  overlay.querySelectorAll('.kcol-swatch').forEach(sw =>
    sw.addEventListener('click', () => {
      overlay.querySelectorAll('.kcol-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      selectedColor = sw.dataset.color;
    })
  );

  overlay.querySelector('#kcol-agregar').addEventListener('click', () => {
    const name = overlay.querySelector('#kcol-name').value.trim();
    if (!name) { toast('Escribí un nombre de columna', 'error'); return; }
    const key = slugify(name);
    if (cols.find(c => c.key === key)) { toast('Ya existe una columna con ese nombre', 'error'); return; }
    cols.push({ key, label: name, color: selectedColor });
    overlay.querySelector('#kcol-name').value = '';
    renderList(listEl);
  });

  overlay.querySelector('#kcol-reset').addEventListener('click', () => {
    cols = [...KANBAN_DEFAULT_COLS];
    renderList(listEl);
  });

  overlay.querySelector('#kcol-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#kcol-save').addEventListener('click', () => {
    if (!cols.length) { toast('Necesitás al menos una columna', 'error'); return; }
    saveKanbanCols(cols);
    overlay.remove();
    onSave();
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── ② Kanban ──────────────────────────────────────────────
async function renderKanban() {
  const main = document.getElementById('main-content');
  const [projects, resources] = await Promise.all([
    api.getProjects(),
    api.getResources({ activo: '1' }),
  ]);

  let kanbanCols = loadKanbanCols();

  function buildBoard() {
    const board = main.querySelector('.kanban');
    if (!board) return;
    board.style.gridTemplateColumns = `repeat(${kanbanCols.length}, minmax(220px, 1fr))`;
    board.innerHTML = kanbanCols.map(col => `
      <div class="kanban-col" data-estado="${escHtml(col.key)}">
        <div class="kanban-col-header" style="color:${col.color}">
          <span>${escHtml(col.label)}</span>
          <span class="kanban-col-count" data-col="${escHtml(col.key)}">0</span>
        </div>
        <div class="kanban-cards" data-estado="${escHtml(col.key)}"></div>
      </div>
    `).join('');
    wireColumns();
    applyFilters();
  }

  main.innerHTML = `
    <div class="page-header">
      <h1>Kanban</h1>
      <button class="btn btn-primary" id="btn-new-project">＋ Nuevo proyecto</button>
    </div>
    <div class="kanban-filters">
      <input type="search" id="kf-search" placeholder="Buscar proyecto…" class="filter-search">
      <select id="kf-prioridad" class="filter-select">
        <option value="">Todas las prioridades</option>
        ${['baja','media','alta','critica'].map(p => `<option value="${p}">${p}</option>`).join('')}
      </select>
      <select id="kf-tecnico" class="filter-select">
        <option value="">Todos los técnicos</option>
        ${resources.map(r => `<option value="${r.id}">${escHtml(r.nombre)}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="kf-riesgo">⚠ En riesgo</button>
      <button class="btn btn-ghost btn-sm" id="kf-clear" style="display:none">✕ Limpiar</button>
      <button class="btn btn-ghost btn-sm" id="kf-cols" style="margin-left:auto">⚙ Columnas</button>
    </div>
    <div class="kanban" style="grid-template-columns:repeat(${kanbanCols.length},minmax(220px,1fr))"></div>
  `;

  document.getElementById('btn-new-project').addEventListener('click', () => showProjectModal());
  document.getElementById('kf-cols').addEventListener('click', () =>
    showKanbanColsModal(() => { kanbanCols = loadKanbanCols(); buildBoard(); })
  );

  let soloRiesgo = false;
  let dragging = null;

  function kanbanCardHtml(p) {
    const salud = calcSalud(p);
    const alerta = (salud.level === 'red' || salud.level === 'yellow')
      ? `<span class="kanban-salud kanban-salud-${salud.level}">${escHtml(salud.titulo)}</span>` : '';
    const tecs = p.tecnicos ? p.tecnicos.split(',').map(t => t.trim()).filter(Boolean) : [];

    let fechaHtml = '';
    if (p.fecha_fin_est) {
      const hoy   = Date.now();
      const fecha = new Date(p.fecha_fin_est);
      const dias  = Math.floor((fecha - hoy) / 86400000);
      const vencido    = dias < 0;
      const proxVence  = !vencido && dias <= 5;
      const [, mm, dd] = p.fecha_fin_est.split('-');
      const label = `${dd}/${mm}`;
      const cls   = vencido ? 'kanban-fecha-red' : proxVence ? 'kanban-fecha-yellow' : 'kanban-fecha';
      fechaHtml = `<span class="${cls}" title="Vence ${p.fecha_fin_est}">📅 ${label}</span>`;
    }

    return `
      <div class="kanban-card" draggable="true" data-id="${p.id}" data-estado="${escHtml(p.estado)}">
        <div class="kanban-card-title">
          <span class="semaforo semaforo-${salud.level}" style="margin-right:7px" title="${escHtml(salud.detalle)}"></span>
          ${escHtml(p.nombre)}
        </div>
        <div class="kanban-card-meta">
          ${badgePrio(p.prioridad)}
          ${fechaHtml}
          ${alerta}
          ${!p.cuenta_horas ? '<span class="no-cuenta-badge">sin cómputo</span>' : ''}
        </div>
        ${tecs.length ? `<div class="kanban-card-tecs">${tecs.map(t => `<span class="kanban-tec">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    `;
  }

  function applyFilters() {
    const search    = document.getElementById('kf-search')?.value.toLowerCase().trim() || '';
    const prioridad = document.getElementById('kf-prioridad')?.value || '';
    const tecnicoId = document.getElementById('kf-tecnico')?.value || '';
    const tecnicoNombre = tecnicoId ? (resources.find(r => String(r.id) === tecnicoId)?.nombre || '') : '';
    const hasFilter = search || prioridad || tecnicoId || soloRiesgo;

    document.getElementById('kf-clear').style.display = hasFilter ? '' : 'none';
    document.getElementById('kf-riesgo').classList.toggle('btn-primary', soloRiesgo);
    document.getElementById('kf-riesgo').classList.toggle('btn-ghost', !soloRiesgo);

    kanbanCols.forEach(({ key }) => {
      let visible = projects.filter(p => p.estado === key);

      if (search)        visible = visible.filter(p => p.nombre.toLowerCase().includes(search));
      if (prioridad)     visible = visible.filter(p => p.prioridad === prioridad);
      if (tecnicoNombre) visible = visible.filter(p => {
        const tecs = p.tecnicos ? p.tecnicos.split(',').map(t => t.trim()) : [];
        return tecs.some(t => t.toLowerCase() === tecnicoNombre.toLowerCase());
      });
      if (soloRiesgo)    visible = visible.filter(p => {
        const s = calcSalud(p);
        return s.level === 'red' || s.level === 'yellow';
      });

      const container = main.querySelector(`.kanban-cards[data-estado="${key}"]`);
      const countEl   = main.querySelector(`.kanban-col-count[data-col="${key}"]`);
      if (container) container.innerHTML = visible.map(kanbanCardHtml).join('');
      if (countEl)   countEl.textContent = visible.length;

      wireCards(container);
    });
  }

  function wireCards(container) {
    (container ? container.querySelectorAll('.kanban-card') : main.querySelectorAll('.kanban-card'))
      .forEach(card => {
        card.addEventListener('dragstart', () => { dragging = card; card.classList.add('dragging'); });
        card.addEventListener('dragend',   () => { dragging = null; card.classList.remove('dragging'); });
        card.addEventListener('click',     () => navigate('project-detail', { id: card.dataset.id }));
      });
  }

  function wireColumns() {
    main.querySelectorAll('.kanban-col').forEach(col => {
      col.addEventListener('dragover',  e => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragging) return;
        const newEstado = col.dataset.estado;
        const id = dragging.dataset.id;
        if (dragging.dataset.estado === newEstado) return;
        try {
          await api.updateProject(id, { estado: newEstado });
          toast('Estado actualizado', 'success');
          renderKanban();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  // Filter events
  ['kf-search','kf-prioridad','kf-tecnico'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', applyFilters)
  );
  document.getElementById('kf-riesgo').addEventListener('click', () => {
    soloRiesgo = !soloRiesgo;
    applyFilters();
  });
  document.getElementById('kf-clear').addEventListener('click', () => {
    document.getElementById('kf-search').value = '';
    document.getElementById('kf-prioridad').value = '';
    document.getElementById('kf-tecnico').value = '';
    soloRiesgo = false;
    applyFilters();
  });

  buildBoard();
}

// ── ③ Project detail ──────────────────────────────────────
async function renderProjectDetail({ id }) {
  const main = document.getElementById('main-content');
  const [p, resources] = await Promise.all([api.getProject(id), api.getResources({ activo: '1' })]);

  main.innerHTML = `
    <div class="page-header">
      <div>
        <button class="btn btn-ghost btn-sm" id="btn-back">← Volver</button>
        <h1 style="margin-top:8px">${escHtml(p.nombre)} ${!p.cuenta_horas ? '<span class="no-cuenta-badge" title="Las horas de este proyecto no suman al total contabilizado">sin cómputo de horas</span>' : ''}</h1>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-edit-project">Editar proyecto</button>
    </div>

    <div class="stat-row">
      <div class="stat-card">
        <div class="label">Horas contabilizadas</div>
        <div class="value" id="stat-contadas">${fmtSec(p.hours?.seg_contados)}</div>
      </div>
      <div class="stat-card ${!p.cuenta_horas ? 'muted' : ''}">
        <div class="label">Horas registradas</div>
        <div class="value" id="stat-total">${fmtSec(p.hours?.seg_total)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Horas estimadas <span style="font-size:10px;color:var(--text2)">(comentarios)</span></div>
        <div class="value" id="stat-estimado" style="color:var(--accent)">${fmtSec(p.hours?.seg_estimado)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Estado / Prioridad</div>
        <div class="value" style="font-size:14px;display:flex;gap:6px;margin-top:4px">${badgeEstado(p.estado)} ${badgePrio(p.prioridad)}</div>
      </div>
    </div>

    ${p.last_comment_text ? `
    <div class="card" style="margin-bottom:20px;border-left:3px solid var(--accent)">
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">
        💬 Último comentario en ClickUp
        ${p.clickup_status ? `· <span style="color:var(--text2)">${escHtml(p.clickup_status)}</span>` : ''}
      </div>
      <div style="font-size:14px;line-height:1.6">${escHtml(p.last_comment_text)}</div>
      <div style="margin-top:8px;font-size:12px;color:var(--text2)">
        ${escHtml(p.last_comment_by || '')}
        ${p.last_comment_at ? '· ' + new Date(p.last_comment_at).toLocaleString('es-AR') : ''}
      </div>
    </div>` : p.clickup_id ? `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;margin-bottom:20px;font-size:13px;color:var(--text2)">
      💬 Sin comentarios en ClickUp · Estado: ${escHtml(p.clickup_status || '—')}
    </div>` : ''}

    ${!p.cuenta_horas ? `<div style="background:#3b1f0a;border:1px solid #7c3210;border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;color:#fb923c;font-size:13px">
      ⚠ Este proyecto tiene el cómputo de horas desactivado. Las horas se registran pero <strong>no suman al total contabilizado global</strong>. Activalo en "Editar proyecto" para incluirlas.
    </div>` : ''}

    <div class="detail-grid">
      <div>
        <!-- Timer -->
        <div class="timer-section">
          <div>
            <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Timer</div>
            <div class="timer-display ${p.activeTimer ? 'running' : ''}" id="timer-display">${p.activeTimer ? fmtSecTimer(Math.max(0, Math.floor((Date.now() - new Date(p.activeTimer.inicio.replace(' ','T')+'Z')) / 1000))) : '00:00:00'}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="btn btn-primary" id="btn-timer-toggle">
              ${p.activeTimer ? '⏹ Detener' : '▶ Iniciar'}
            </button>
          </div>
          <div class="timer-resource-row">
            <select id="timer-resource" style="font-size:12px;flex:1" ${p.activeTimer ? 'disabled' : ''}>
              <option value="">Recurso (opcional)</option>
              ${resources.map(r => `<option value="${r.id}" ${p.activeTimer?.resource_id == r.id ? 'selected' : ''}>${escHtml(r.nombre)}</option>`).join('')}
            </select>
            <input type="text" id="timer-nota" placeholder="Nota (opcional)" style="font-size:12px;flex:1" ${p.activeTimer ? 'disabled' : ''}>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-left:auto">
            <button class="btn btn-secondary btn-sm" id="btn-manual">+ Manual</button>
            <button class="btn btn-secondary btn-sm" id="btn-estimate" title="Generar horas estimadas desde comentarios de ClickUp">⚡ Estimar</button>
            <button class="btn btn-ghost btn-sm" id="btn-clear-estimates" title="Eliminar horas estimadas de este proyecto">✕ Estimados</button>
          </div>
        </div>

        <!-- Entries -->
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:14px;font-weight:700">Registros de horas</h3>
        </div>
        <div class="entries-list" id="entries-list">
          <div class="spinner" style="width:20px;height:20px;margin:16px auto"></div>
        </div>
      </div>

      <!-- Sidebar: assignments -->
      <div>
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:14px;font-weight:700">Recursos asignados</h3>
            <button class="btn btn-primary btn-sm" id="btn-assign">＋ Asignar</button>
          </div>
          <div id="assignments-list">
            ${p.assignments.length === 0 ? '<p style="color:var(--text2);font-size:13px">Sin recursos asignados</p>' :
              p.assignments.map(a => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
                  <div style="flex:1">
                    <div style="font-weight:600">${escHtml(a.resource_nombre)}</div>
                    <div style="color:var(--text2);font-size:12px">${escHtml(a.rol_en_proyecto||a.resource_rol||'')}${a.dedicacion_pct ? ` · ${a.dedicacion_pct}%` : ''}</div>
                  </div>
                  <button class="btn btn-danger btn-sm btn-rm-assign" data-aid="${a.id}">✕</button>
                </div>
              `).join('')}
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div style="font-size:12px;color:var(--text2);margin-bottom:8px">INFORMACIÓN</div>
          ${p.descripcion ? `<p style="font-size:13px;color:var(--text2);margin-bottom:10px">${escHtml(p.descripcion)}</p>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
            <div><span style="color:var(--text2)">Inicio</span><br>${p.fecha_inicio || '—'}</div>
            <div><span style="color:var(--text2)">Fin est.</span><br>${p.fecha_fin_est || '—'}</div>
          </div>
          ${p.clickup_id ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12px;color:var(--text2)">
            <div>ClickUp: <a href="https://app.clickup.com/t/${escHtml(p.clickup_id)}" target="_blank" style="color:var(--accent)">ver tarea ↗</a></div>
            ${p.clickup_status ? `<div style="margin-top:4px">Estado CU: ${escHtml(p.clickup_status)}</div>` : ''}
          </div>` : ''}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-back').addEventListener('click', () => navigate('projects'));
  document.getElementById('btn-edit-project').addEventListener('click', () => showProjectModal(id));

  // Load time entries
  loadEntries(id);

  // Timer
  let activeEntry = p.activeTimer;
  let timerInterval = null;

  function startDisplay(entry) {
    const display = document.getElementById('timer-display');
    display.classList.add('running');
    timerInterval = setInterval(() => {
      const start = new Date(entry.inicio.replace(' ', 'T') + 'Z');
      const elapsed = Math.floor((Date.now() - start) / 1000);
      display.textContent = fmtSecTimer(elapsed);
    }, 1000);
    if (activeEntry) {
      const start = new Date(activeEntry.inicio.replace(' ', 'T') + 'Z');
      display.textContent = fmtSecTimer(Math.floor((Date.now() - start) / 1000));
    }
  }

  if (activeEntry) startDisplay(activeEntry);

  document.getElementById('btn-timer-toggle').addEventListener('click', async () => {
    const btn = document.getElementById('btn-timer-toggle');
    try {
      if (activeEntry) {
        await api.stopTimer({ entry_id: activeEntry.id });
        clearInterval(timerInterval);
        document.getElementById('timer-display').textContent = '00:00:00';
        document.getElementById('timer-display').classList.remove('running');
        document.getElementById('timer-resource').disabled = false;
        document.getElementById('timer-nota').disabled = false;
        btn.textContent = '▶ Iniciar';
        activeEntry = null;
        toast('Timer detenido', 'success');
        loadEntries(id);
        api.getProject(id).then(fresh => {
          document.getElementById('stat-contadas').textContent = fmtSec(fresh.hours?.seg_contados);
          document.getElementById('stat-total').textContent = fmtSec(fresh.hours?.seg_total);
          if (document.getElementById('stat-estimado')) document.getElementById('stat-estimado').textContent = fmtSec(fresh.hours?.seg_estimado);
        });
      } else {
        const resource_id = document.getElementById('timer-resource').value || null;
        const nota = document.getElementById('timer-nota').value.trim() || null;
        activeEntry = await api.startTimer({ project_id: id, resource_id, nota });
        document.getElementById('timer-resource').disabled = true;
        document.getElementById('timer-nota').disabled = true;
        btn.textContent = '⏹ Detener';
        startDisplay(activeEntry);
        toast('Timer iniciado', 'success');
      }
    } catch (e) { toast(e.message, 'error'); }
  });

  // Manual
  document.getElementById('btn-manual').addEventListener('click', () => showManualModal(id, () => {
    loadEntries(id);
    api.getProject(id).then(fresh => {
      document.getElementById('stat-contadas').textContent = fmtSec(fresh.hours?.seg_contados);
      document.getElementById('stat-total').textContent = fmtSec(fresh.hours?.seg_total);
      document.getElementById('stat-estimado').textContent = fmtSec(fresh.hours?.seg_estimado);
    });
  }));

  // Estimar desde comentarios
  document.getElementById('btn-estimate').addEventListener('click', async () => {
    const btn = document.getElementById('btn-estimate');
    btn.disabled = true;
    btn.textContent = '⏳ Estimando...';
    try {
      const r = await api.estimateTime({ project_id: id });
      toast(`Estimados generados: +${r.created} registros`, 'success');
      loadEntries(id);
      api.getProject(id).then(fresh => {
        document.getElementById('stat-contadas').textContent = fmtSec(fresh.hours?.seg_contados);
        document.getElementById('stat-total').textContent = fmtSec(fresh.hours?.seg_total);
        document.getElementById('stat-estimado').textContent = fmtSec(fresh.hours?.seg_estimado);
      });
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
    btn.textContent = '⚡ Estimar';
  });

  // Limpiar estimados del proyecto
  document.getElementById('btn-clear-estimates').addEventListener('click', async () => {
    if (!confirm('¿Eliminar todas las horas estimadas de este proyecto?')) return;
    try {
      const r = await api.clearEstimates({ project_id: id });
      toast(`${r.deleted} estimados eliminados`, 'success');
      loadEntries(id);
      api.getProject(id).then(fresh => {
        document.getElementById('stat-contadas').textContent = fmtSec(fresh.hours?.seg_contados);
        document.getElementById('stat-total').textContent = fmtSec(fresh.hours?.seg_total);
        document.getElementById('stat-estimado').textContent = fmtSec(fresh.hours?.seg_estimado);
      });
    } catch (e) { toast(e.message, 'error'); }
  });

  // Assign
  document.getElementById('btn-assign').addEventListener('click', () => showAssignModal(id, () => navigate('project-detail', { id })));

  // Remove assignments
  main.querySelectorAll('.btn-rm-assign').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Quitar recurso del proyecto?')) return;
      await api.deleteAssignment(id, b.dataset.aid);
      toast('Recurso quitado', 'success');
      navigate('project-detail', { id });
    }));
}

async function loadEntries(projectId) {
  const container = document.getElementById('entries-list');
  if (!container) return;
  const entries = await api.getTime({ project_id: projectId });
  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text2);font-size:13px;padding:8px 0">Sin registros todavía</p>';
    return;
  }

  // Group by date (local date string)
  const byDate = {};
  for (const e of entries) {
    const d = new Date(e.inicio).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
    (byDate[d] = byDate[d] || []).push(e);
  }

  container.innerHTML = Object.entries(byDate).map(([dateStr, group]) => {
    const subtotal = group.reduce((s, e) => s + (e.duracion_seg || 0), 0);
    return `
      <div class="entry-date-group">
        <div class="entry-date-header">
          <span>${dateStr}</span>
          <span class="entry-date-subtotal">${fmtSec(subtotal)}</span>
        </div>
        ${group.map(e => `
          <div class="entry-item">
            <span class="entry-type ${e.tipo}">${e.tipo}</span>
            <span class="entry-time">${fmtSec(e.duracion_seg)}</span>
            <span class="entry-note">${escHtml(e.nota || '—')}</span>
            ${e.resource_nombre ? `<span class="entry-resource">👤 ${escHtml(e.resource_nombre)}</span>` : ''}
            <button class="btn btn-ghost btn-sm btn-del-entry" data-id="${e.id}" title="Eliminar">✕</button>
          </div>
        `).join('')}
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-del-entry').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar registro?')) return;
      await api.deleteEntry(b.dataset.id);
      toast('Registro eliminado', 'success');
      loadEntries(projectId);
    }));
}

async function showManualModal(projectId, onSave) {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const resources = await api.getResources({ activo: '1' });
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <h2>Carga manual de horas</h2>
        <div class="form-group"><label>Fecha y hora de inicio</label><input type="datetime-local" id="mn-inicio" value="${localIso}"></div>
        <div class="form-group">
          <label>Duración</label>
          <div class="duration-presets">
            <button class="duration-preset" data-h="0" data-m="30">30m</button>
            <button class="duration-preset" data-h="1" data-m="0">1h</button>
            <button class="duration-preset" data-h="2" data-m="0">2h</button>
            <button class="duration-preset" data-h="4" data-m="0">4h</button>
            <button class="duration-preset" data-h="8" data-m="0">8h</button>
          </div>
          <div class="form-row">
            <div class="form-group" style="margin-bottom:0"><label>Horas</label><input type="number" id="mn-h" min="0" max="24" value="1"></div>
            <div class="form-group" style="margin-bottom:0"><label>Minutos</label><input type="number" id="mn-m" min="0" max="59" value="0"></div>
          </div>
        </div>
        <div class="form-group">
          <label>Recurso (opcional)</label>
          <select id="mn-resource">
            <option value="">Sin asignar</option>
            ${resources.map(r => `<option value="${r.id}">${escHtml(r.nombre)}${r.rol ? ' · ' + escHtml(r.rol) : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Nota (opcional)</label><input type="text" id="mn-nota" placeholder="Descripción de la tarea..."></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="mn-cancel">Cancelar</button>
          <button class="btn btn-primary" id="mn-save">Guardar</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  document.getElementById('mn-h').focus();
  overlay.querySelector('#mn-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.duration-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('mn-h').value = btn.dataset.h;
      document.getElementById('mn-m').value = btn.dataset.m;
    });
  });

  overlay.querySelector('#mn-save').addEventListener('click', async () => {
    const h = parseInt(document.getElementById('mn-h').value, 10) || 0;
    const m = parseInt(document.getElementById('mn-m').value, 10) || 0;
    const duracion_seg = h * 3600 + m * 60;
    if (duracion_seg <= 0) return toast('Duración debe ser mayor a 0', 'error');
    const inicio = new Date(document.getElementById('mn-inicio').value).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const nota = document.getElementById('mn-nota').value.trim() || null;
    const resource_id = document.getElementById('mn-resource').value || null;
    try {
      await api.addManual({ project_id: projectId, inicio, duracion_seg, nota, resource_id });
      toast('Horas registradas', 'success');
      overlay.remove();
      onSave?.();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function showAssignModal(projectId, onSave) {
  const resources = await api.getResources({ activo: '1' });
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <h2>Asignar recurso</h2>
        <div class="form-group">
          <label>Recurso *</label>
          <select id="asgn-resource">
            <option value="">Seleccionar...</option>
            ${resources.map(r => `<option value="${r.id}">${escHtml(r.nombre)}${r.rol ? ' · ' + escHtml(r.rol) : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Rol en el proyecto</label><input type="text" id="asgn-rol" placeholder="ej: Lead dev, diseñador..."></div>
        <div class="form-group"><label>% Dedicación (opcional)</label><input type="number" id="asgn-pct" min="0" max="100" placeholder="ej: 50"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="asgn-cancel">Cancelar</button>
          <button class="btn btn-primary" id="asgn-save">Asignar</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector('#asgn-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#asgn-save').addEventListener('click', async () => {
    const resource_id = document.getElementById('asgn-resource').value;
    if (!resource_id) return toast('Seleccioná un recurso', 'error');
    const rol_en_proyecto = document.getElementById('asgn-rol').value.trim() || null;
    const dedicacion_pct = parseInt(document.getElementById('asgn-pct').value, 10) || null;
    try {
      await api.createAssignment(projectId, { resource_id, rol_en_proyecto, dedicacion_pct });
      toast('Recurso asignado', 'success');
      overlay.remove();
      onSave?.();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ── ④ Resources ───────────────────────────────────────────
async function renderResources() {
  const main = document.getElementById('main-content');
  const resources = await api.getResources();

  main.innerHTML = `
    <div class="page-header">
      <h1>Recursos</h1>
      <button class="btn btn-primary" id="btn-new-res">＋ Nuevo recurso</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nombre</th><th>Rol</th><th>Email</th><th>Teléfono</th><th>Estado</th><th>ClickUp ID</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${resources.length === 0 ? `<tr><td colspan="7"><div class="empty"><div class="empty-icon">👥</div><p>Sin recursos todavía</p></div></td></tr>` :
            resources.map(r => `
              <tr data-id="${r.id}">
                <td><strong>${escHtml(r.nombre)}</strong></td>
                <td>${escHtml(r.rol||'—')}</td>
                <td>${escHtml(r.email||'—')}</td>
                <td style="font-size:12px">${escHtml(r.telefono||'—')}</td>
                <td><span class="badge ${r.activo ? 'badge-en_curso' : 'badge-cerrado'}">${r.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td style="font-size:12px;color:var(--text2)">${escHtml(r.clickup_member_id||'—')}</td>
                <td>
                  <button class="btn btn-ghost btn-sm btn-edit-res" data-id="${r.id}">Editar</button>
                  <button class="btn btn-danger btn-sm btn-del-res" data-id="${r.id}">✕</button>
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-new-res').addEventListener('click', () => showResourceModal());
  main.querySelectorAll('.btn-edit-res').forEach(b => b.addEventListener('click', () => showResourceModal(b.dataset.id)));
  main.querySelectorAll('.btn-del-res').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar recurso?')) return;
      await api.deleteResource(b.dataset.id);
      toast('Recurso eliminado', 'success');
      renderResources();
    }));
}

async function showResourceModal(id = null) {
  const r = id ? await api.getResource(id) : {};
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <h2>${id ? 'Editar recurso' : 'Nuevo recurso'}</h2>
        <div class="form-group"><label>Nombre *</label><input type="text" id="r-nombre" value="${escHtml(r.nombre||'')}"></div>
        <div class="form-group"><label>Rol</label><input type="text" id="r-rol" value="${escHtml(r.rol||'')}"></div>
        <div class="form-group"><label>Email</label><input type="email" id="r-email" value="${escHtml(r.email||'')}"></div>
        <div class="form-group"><label>Teléfono WhatsApp</label><input type="tel" id="r-telefono" placeholder="ej: 1122334455" value="${escHtml(r.telefono||'')}"></div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="r-activo" ${(!id || r.activo) ? 'checked' : ''} style="width:auto">
            Activo
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="r-cancel">Cancelar</button>
          <button class="btn btn-primary" id="r-save">Guardar</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  document.getElementById('r-nombre').focus();
  overlay.querySelector('#r-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#r-save').addEventListener('click', async () => {
    const nombre = document.getElementById('r-nombre').value.trim();
    if (!nombre) return toast('El nombre es requerido', 'error');
    const body = {
      nombre,
      rol: document.getElementById('r-rol').value.trim() || null,
      email: document.getElementById('r-email').value.trim() || null,
      telefono: document.getElementById('r-telefono').value.trim() || null,
      activo: document.getElementById('r-activo').checked,
    };
    try {
      if (id) await api.updateResource(id, body);
      else await api.createResource(body);
      toast(id ? 'Recurso actualizado' : 'Recurso creado', 'success');
      overlay.remove();
      renderResources();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ── ⑤ Gantt ───────────────────────────────────────────────
async function renderGantt() {
  const main = document.getElementById('main-content');
  const allProjects = await api.getProjects();
  const projects = allProjects.filter(p => p.fecha_fin_est);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let filterSearch = '';
  let filterEstado = '';

  function buildChart(filtered) {
    if (!filtered.length) {
      return `<div class="empty" style="margin-top:40px"><div class="empty-icon">📅</div>
        <p>Sin proyectos con fecha de vencimiento cargada</p></div>`;
    }

    const sorted = filtered.slice().sort((a, b) => {
      const aS = new Date(a.fecha_inicio || a.fecha_fin_est);
      const bS = new Date(b.fecha_inicio || b.fecha_fin_est);
      return aS - bS;
    });

    const allStarts = sorted.map(p => new Date(p.fecha_inicio || p.fecha_fin_est));
    const allEnds   = sorted.map(p => new Date(p.fecha_fin_est));

    let minDate = new Date(Math.min(...allStarts.map(d => d.getTime()), today.getTime()));
    let maxDate = new Date(Math.max(...allEnds.map(d => d.getTime())));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(0, 0, 0, 0);

    const totalDays = Math.round((maxDate - minDate) / 86400000);
    const DAY_W = Math.max(6, Math.min(32, Math.floor(1100 / totalDays)));
    const totalW  = totalDays * DAY_W;
    const todayX  = Math.round((today - minDate) / 86400000) * DAY_W;

    // Month markers
    const monthMarkers = [];
    let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (cur <= maxDate) {
      const left = Math.max(0, Math.round((cur - minDate) / 86400000) * DAY_W);
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const w = Math.round((Math.min(next, maxDate) - Math.max(cur, minDate)) / 86400000) * DAY_W;
      const label = cur.toLocaleString('es-AR', { month: 'short', year: '2-digit' });
      monthMarkers.push({ left, w, label });
      cur = next;
    }

    // Week lines
    const weekLines = [];
    const wStart = new Date(minDate);
    while (wStart.getDay() !== 1) wStart.setDate(wStart.getDate() + 1);
    while (wStart < maxDate) {
      weekLines.push(Math.round((wStart - minDate) / 86400000) * DAY_W);
      wStart.setDate(wStart.getDate() + 7);
    }

    const gridLines = weekLines.map(x =>
      `<div class="gantt-grid-line" style="left:${x}px"></div>`).join('');
    const todayLine = `<div class="gantt-today-line" style="left:${todayX}px"></div>`;
    const monthsHtml = monthMarkers.map(m =>
      `<div class="gantt-month-label" style="left:${m.left}px;width:${m.w}px">${m.label}</div>`).join('');

    const rowsHtml = sorted.map(p => {
      const salud     = calcSalud(p);
      const hasStart  = !!p.fecha_inicio;
      const startDate = new Date(p.fecha_inicio || p.fecha_fin_est);
      const endDate   = new Date(p.fecha_fin_est);
      const barLeft   = Math.round((startDate - minDate) / 86400000) * DAY_W;
      const barW      = Math.max(DAY_W * 2, Math.round((endDate - startDate) / 86400000) * DAY_W + DAY_W);
      const tecs      = p.tecnicos ? p.tecnicos.split(',').map(t => t.trim()).filter(Boolean) : [];
      const [,mm,dd]  = p.fecha_fin_est.split('-');

      return `
        <div class="gantt-row" data-id="${p.id}">
          <div class="gantt-name-col">
            <span class="semaforo semaforo-${salud.level}" style="flex-shrink:0" title="${escHtml(salud.detalle)}"></span>
            <span class="gantt-name-text" title="${escHtml(p.nombre)}">${escHtml(p.nombre)}</span>
            <span class="gantt-due-lbl">${dd}/${mm}</span>
          </div>
          <div class="gantt-chart-col" style="width:${totalW}px">
            ${gridLines}${todayLine}
            <div class="gantt-bar gantt-bar-${salud.level}${!hasStart ? ' gantt-bar-nostart' : ''}"
                 style="left:${barLeft}px;width:${barW}px"
                 title="${escHtml(p.nombre)}&#10;${p.fecha_inicio ? p.fecha_inicio + ' → ' : '→ '}${p.fecha_fin_est}${tecs.length ? '&#10;' + tecs.join(', ') : ''}">
              <span class="gantt-bar-label">${escHtml(p.nombre)}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    const headerChartHtml = `
      <div class="gantt-chart-col gantt-month-row" style="width:${totalW}px">
        ${monthsHtml}${gridLines}${todayLine}
      </div>`;

    return `
      <div class="gantt-container" id="gantt-scroll">
        <div class="gantt-row gantt-header-row">
          <div class="gantt-name-col gantt-name-header">
            Proyecto <span style="font-weight:400;margin-left:4px">(${filtered.length})</span>
          </div>
          ${headerChartHtml}
        </div>
        ${rowsHtml}
      </div>`;
  }

  function redraw() {
    let f = projects;
    if (filterSearch) f = f.filter(p => p.nombre.toLowerCase().includes(filterSearch));
    if (filterEstado) f = f.filter(p => p.estado === filterEstado);
    document.getElementById('gantt-chart').innerHTML = buildChart(f);
    wireRows();
    scrollToToday();
  }

  function wireRows() {
    main.querySelectorAll('.gantt-row[data-id]').forEach(row =>
      row.addEventListener('click', () => navigate('project-detail', { id: row.dataset.id }))
    );
    main.querySelectorAll('.gantt-bar').forEach(bar =>
      bar.addEventListener('click', e => {
        e.stopPropagation();
        navigate('project-detail', { id: bar.closest('.gantt-row').dataset.id });
      })
    );
  }

  function scrollToToday() {
    setTimeout(() => {
      const scroll = document.getElementById('gantt-scroll');
      const line = scroll?.querySelector('.gantt-today-line');
      if (scroll && line) scroll.scrollLeft = Math.max(0, parseInt(line.style.left) - 240);
    }, 30);
  }

  main.innerHTML = `
    <div class="page-header">
      <h1>Gantt <span class="page-count">${projects.length}</span></h1>
    </div>
    <div class="kanban-filters" style="margin-bottom:12px">
      <input type="search" id="gf-search" placeholder="Buscar proyecto…" class="filter-search">
      <select id="gf-estado" class="filter-select">
        <option value="">Todos los estados</option>
        <option value="backlog">Backlog</option>
        <option value="en_curso">En curso</option>
        <option value="pausado">Pausado</option>
        <option value="cerrado">Cerrado</option>
      </select>
      <span style="font-size:12px;color:var(--text2);margin-left:auto">
        Solo proyectos con fecha de vencimiento · <span class="gantt-today-dot"></span> Hoy
      </span>
    </div>
    <div id="gantt-chart"></div>
  `;

  document.getElementById('gf-search').addEventListener('input', e => {
    filterSearch = e.target.value.toLowerCase().trim();
    redraw();
  });
  document.getElementById('gf-estado').addEventListener('change', e => {
    filterEstado = e.target.value;
    redraw();
  });

  redraw();
}

// ── ⑤ Carga por recurso ───────────────────────────────────
function showResourceModal(resource, onSave) {
  const isEdit = !!resource;
  const r = resource || {};
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal" style="max-width:380px">
        <h2>${isEdit ? 'Editar recurso' : 'Nuevo recurso'}</h2>
        <div class="form-group"><label>Nombre *</label><input type="text" id="rm-nombre" value="${escHtml(r.nombre||'')}"></div>
        <div class="form-group"><label>Rol</label><input type="text" id="rm-rol" value="${escHtml(r.rol||'')}"></div>
        <div class="form-group"><label>Email</label><input type="email" id="rm-email" value="${escHtml(r.email||'')}"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="rm-cancel">Cancelar</button>
          <button class="btn btn-primary" id="rm-save">Guardar</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector('#rm-nombre').focus();
  overlay.querySelector('#rm-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#rm-save').addEventListener('click', async () => {
    const nombre = overlay.querySelector('#rm-nombre').value.trim();
    if (!nombre) { toast('El nombre es requerido', 'error'); return; }
    const body = {
      nombre,
      rol:   overlay.querySelector('#rm-rol').value.trim()   || null,
      email: overlay.querySelector('#rm-email').value.trim() || null,
    };
    try {
      if (isEdit) await api.updateResource(r.id, body);
      else        await api.createResource(body);
      overlay.remove();
      onSave();
    } catch (e) { toast(e.message, 'error'); }
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showConfirmModal(message, onConfirm) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal" style="max-width:340px">
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6">${message}</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cf-cancel">Cancelar</button>
          <button class="btn btn-danger"    id="cf-ok">Eliminar</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector('#cf-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cf-ok').addEventListener('click', () => { overlay.remove(); onConfirm(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function renderCarga() {
  const main = document.getElementById('main-content');
  const resources = await api.getCarga();

  function avatarColor(name) {
    const palette = ['#6CAAD9','#98D293','#EB8398','#a78bfa','#f97316','#22d3ee','#fbbf24','#e879f9'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return palette[h % palette.length];
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  function cargaTag(assignments) {
    const n = assignments.filter(a => a.project_estado === 'en_curso').length;
    if (n === 0) return { label: 'Sin carga',  cls: 'carga-tag-none' };
    if (n <= 2)  return { label: 'Normal',      cls: 'carga-tag-ok'   };
    if (n <= 3)  return { label: 'Ocupado',     cls: 'carga-tag-mid'  };
    return            { label: 'Sobrecarga', cls: 'carga-tag-high' };
  }

  const totalHoras = resources.reduce((s, r) => s + (r.hours?.seg_contados || 0), 0);

  main.innerHTML = `
    <div class="page-header">
      <h1>Carga por recurso <span class="page-count">${resources.length}</span></h1>
      <button class="btn btn-primary" id="btn-new-resource">＋ Recurso</button>
    </div>

    ${resources.length === 0
      ? '<div class="empty"><div class="empty-icon">👥</div><p>Sin recursos activos. Agregá el primero.</p></div>'
      : `<div class="carga-grid">
          ${resources.map(r => {
            const color   = avatarColor(r.nombre);
            const tag     = cargaTag(r.assignments);
            const activos = r.assignments.filter(a => a.project_estado === 'en_curso').length;
            const horas   = r.hours?.seg_contados || 0;
            const pctHoras = totalHoras ? Math.round((horas / totalHoras) * 100) : 0;
            const proyectos = r.assignments.slice().sort((a, b) => {
              const order = { en_curso: 0, pausado: 1, backlog: 2, cerrado: 3 };
              return (order[a.project_estado] ?? 9) - (order[b.project_estado] ?? 9);
            });
            return `
              <div class="carga-card" data-rid="${r.id}">
                <div class="carga-card-header">
                  <div class="carga-avatar" style="background:${color}">${escHtml(initials(r.nombre))}</div>
                  <div class="carga-info">
                    <div class="carga-nombre">${escHtml(r.nombre)}</div>
                    <div class="carga-rol">${escHtml(r.rol || 'Sin rol')}${r.email ? ` · ${escHtml(r.email)}` : ''}</div>
                  </div>
                  <div class="carga-card-actions">
                    <span class="carga-tag ${tag.cls}">${tag.label}</span>
                    <button class="btn btn-ghost btn-xs carga-edit" data-rid="${r.id}" title="Editar">✏</button>
                    <button class="btn btn-ghost btn-xs carga-del"  data-rid="${r.id}" title="Eliminar">🗑</button>
                  </div>
                </div>

                <div class="carga-stats">
                  <div class="carga-stat">
                    <span class="carga-stat-val">${r.assignments.length}</span>
                    <span class="carga-stat-lbl">proyectos</span>
                  </div>
                  <div class="carga-stat">
                    <span class="carga-stat-val" style="color:var(--accent)">${activos}</span>
                    <span class="carga-stat-lbl">en curso</span>
                  </div>
                  <div class="carga-stat">
                    <span class="carga-stat-val">${fmtSec(horas)}</span>
                    <span class="carga-stat-lbl">horas</span>
                  </div>
                </div>

                ${totalHoras ? `
                <div class="carga-bar-wrap" title="${pctHoras}% del total de horas del equipo">
                  <div class="carga-bar-fill" style="width:${pctHoras}%;background:${color}"></div>
                </div>` : ''}

                <div class="carga-project-list" data-rid="${r.id}">
                  ${proyectos.length === 0
                    ? `<p class="carga-empty carga-drop-hint">Soltá un proyecto aquí</p>`
                    : proyectos.map(a => `
                        <div class="carga-project-row" draggable="true"
                          data-pid="${a.project_id}" data-aid="${a.id}" data-rid="${r.id}">
                          <span class="carga-drag-handle">⠿</span>
                          <span class="semaforo semaforo-${a.project_estado === 'en_curso' ? 'green' : a.project_estado === 'pausado' ? 'yellow' : 'grey'}"></span>
                          <span class="carga-project-name">${escHtml(a.project_nombre)}</span>
                          <span class="carga-project-right">
                            ${badgeEstado(a.project_estado)}
                            ${a.dedicacion_pct ? `<span class="carga-pct">${a.dedicacion_pct}%</span>` : ''}
                          </span>
                        </div>
                      `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>`
    }
  `;

  document.getElementById('btn-new-resource')?.addEventListener('click', () =>
    showResourceModal(null, renderCarga)
  );

  // Edit / Delete resource buttons
  main.querySelectorAll('.carga-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const r = resources.find(r => String(r.id) === btn.dataset.rid);
      if (r) showResourceModal(r, renderCarga);
    });
  });

  main.querySelectorAll('.carga-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const r = resources.find(r => String(r.id) === btn.dataset.rid);
      if (!r) return;
      const msg = r.assignments.length
        ? `¿Eliminar a <strong>${escHtml(r.nombre)}</strong>? Tiene ${r.assignments.length} proyecto${r.assignments.length > 1 ? 's' : ''} asignado${r.assignments.length > 1 ? 's' : ''}. Las asignaciones también se eliminarán.`
        : `¿Eliminar a <strong>${escHtml(r.nombre)}</strong>?`;
      showConfirmModal(msg, async () => {
        try {
          await api.deleteResource(r.id);
          toast(`${r.nombre} eliminado`, 'success');
          renderCarga();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });

  // Click to navigate
  main.querySelectorAll('.carga-project-row').forEach(row =>
    row.addEventListener('click', () => navigate('project-detail', { id: row.dataset.pid }))
  );

  // Drag-and-drop: move project between resources
  let dragging = null;

  main.querySelectorAll('.carga-project-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragging = { pid: row.dataset.pid, aid: row.dataset.aid, rid: row.dataset.rid };
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragging = null;
      main.querySelectorAll('.carga-card').forEach(c => c.classList.remove('carga-drop-over'));
    });
  });

  main.querySelectorAll('.carga-card').forEach(card => {
    card.addEventListener('dragover', e => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('carga-drop-over');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('carga-drop-over');
    });
    card.addEventListener('drop', async e => {
      e.preventDefault();
      card.classList.remove('carga-drop-over');
      if (!dragging) return;
      const tgtRid = card.dataset.rid;
      if (tgtRid === dragging.rid) return;
      try {
        await api.createAssignment(dragging.pid, { resource_id: Number(tgtRid) });
        await api.deleteAssignment(dragging.pid, dragging.aid);
        toast('Proyecto reasignado', 'success');
        renderCarga();
      } catch (err) {
        toast(err.message === 'ya asignado' ? 'Ese recurso ya tiene este proyecto asignado' : err.message, 'error');
      }
    });
  });
}

// ── ⑥ Settings ────────────────────────────────────────────
async function renderSettings() {
  const main = document.getElementById('main-content');
  const [settings, syncStatus] = await Promise.all([api.getSettings(), api.getSyncStatus()]);

  main.innerHTML = `
    <div class="page-header"><h1>Configuración</h1></div>
    <div class="settings-section">
      <div class="card" style="margin-bottom:20px">
        <h2>Integración ClickUp</h2>
        <div style="margin-bottom:14px;padding:10px 14px;background:var(--bg3);border-radius:var(--radius);font-size:13px">
          Estado: <strong>${syncStatus.configured ? '✅ Configurado' : '⚠️ Sin configurar — modo standalone'}</strong>
          ${syncStatus.last_sync ? `<br>Último sync: ${new Date(syncStatus.last_sync).toLocaleString('es-AR')}` : ''}
          ${syncStatus.configured ? `<br>Auto-sync: cada ${syncStatus.interval_min} min` : ''}
        </div>
        <div class="form-group">
          <label>Token de ClickUp</label>
          <input type="password" id="s-token" placeholder="${syncStatus.configured ? '●●●●●●●● (guardado)' : 'pk_xxxxx...'}" autocomplete="off">
          <div style="font-size:12px;color:var(--text2);margin-top:4px">Dejalo vacío para no cambiar el token actual.</div>
        </div>
        <div class="form-group">
          <label>Team ID de ClickUp</label>
          <input type="text" id="s-team" value="${escHtml(settings.clickup_team_id||'')}">
        </div>
        <div class="form-group">
          <label>Nivel de mapeo</label>
          <select id="s-mapping">
            <option value="list" ${(settings.clickup_mapping_level||'list')==='list'?'selected':''}>List → Proyecto (default)</option>
            <option value="folder" ${settings.clickup_mapping_level==='folder'?'selected':''}>Folder → Proyecto</option>
          </select>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-primary" id="btn-save-settings">Guardar</button>
          <button class="btn btn-secondary" id="btn-sync-now" ${!syncStatus.configured?'disabled title="Configurá el token primero"':''}>🔄 Sync ahora</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <h2>Estimación de horas desde comentarios</h2>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Al presionar "⚡ Estimar" en un proyecto, se generan registros de horas basados en los comentarios sincronizados desde ClickUp.
          Si el comentario menciona una duración (ej. "2h", "30min", "1.5h"), se usa ese valor. Caso contrario, se aplica el fallback.
        </p>
        <div class="form-group">
          <label>Minutos por comentario (fallback)</label>
          <input type="number" id="s-min-comentario" value="${escHtml(settings.min_por_comentario||'15')}" min="1" max="480" style="width:100px">
          <div style="font-size:12px;color:var(--text2);margin-top:4px">Tiempo estimado por cada comentario que no menciona duración explícita.</div>
        </div>
        <button class="btn btn-primary" id="btn-save-estimacion">Guardar</button>
      </div>

      <div class="card">
        <h2>Exportación a Google Sheets</h2>
        <div style="margin-bottom:14px;padding:10px 14px;background:var(--bg3);border-radius:var(--radius);font-size:13px">
          Estado: <strong>${settings.sheets_webhook_url ? '✅ Configurado' : '⚠️ Sin configurar'}</strong>
        </div>
        <div class="form-group">
          <label>Sheets webhook URL</label>
          <input type="text" id="s-sheets-url" value="${escHtml(settings.sheets_webhook_url||'')}" placeholder="https://script.google.com/macros/s/xxx/exec">
          <div style="font-size:12px;color:var(--text2);margin-top:4px">URL del Apps Script desplegado como Web App en el Sheet de trazabilidad.</div>
        </div>
        <button class="btn btn-primary" id="btn-save-sheets">Guardar URL</button>
      </div>
    </div>
  `;

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const body = {
      clickup_team_id: document.getElementById('s-team').value.trim() || null,
      clickup_mapping_level: document.getElementById('s-mapping').value,
    };
    const token = document.getElementById('s-token').value.trim();
    if (token) body.clickup_token = token;
    try {
      await api.saveSettings(body);
      toast('Configuración guardada', 'success');
      renderSettings();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('btn-save-estimacion')?.addEventListener('click', async () => {
    const val = parseInt(document.getElementById('s-min-comentario').value, 10);
    if (!val || val < 1) return toast('Valor inválido', 'error');
    try {
      await api.saveSettings({ min_por_comentario: String(val) });
      toast('Configuración guardada', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('btn-save-sheets')?.addEventListener('click', async () => {
    const url = document.getElementById('s-sheets-url').value.trim();
    try {
      await api.saveSettings({ sheets_webhook_url: url || null });
      toast('URL guardada', 'success');
      renderSettings();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-now');
    btn.disabled = true;
    btn.textContent = '⏳ Sincronizando...';
    try {
      const result = await api.syncClickUp();
      if (result.ok) {
        toast(`Sync OK · Proyectos: +${result.projects?.inserted ?? 0} / upd ${result.projects?.updated ?? 0} · Recursos: +${result.resources?.inserted ?? 0}`, 'success', 5000);
      } else {
        toast(`Error sync: ${result.error}`, 'error', 5000);
      }
      updateSyncStatus();
      renderSettings();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = '🔄 Sync ahora'; }
  });
}

// ── ⑦ Alerts ──────────────────────────────────────────────
async function renderAlerts() {
  const main = document.getElementById('main-content');
  const data = await api.getAlerts();

  const TIPO_LABELS = {
    vencido:           '📅 Fecha vencida',
    sin_actividad:     '💤 Sin actividad',
    actividad_escasa:  '🔔 Actividad escasa',
    proximo_vencer:    '⏰ Próximo a vencer',
    pausado_largo:     '⏸ Pausado largo',
    backlog_vencido:   '📋 Backlog vencido',
    sobrecarga_recurso:'👤 Sobrecarga de recurso',
  };

  function alertCard(a) {
    const isProject = !!a.proyecto_id;
    const nombre    = isProject ? a.proyecto_nombre : a.recurso_nombre;
    const chipStatus = a.clickup_status
      ? `<span class="alert-chip">${escHtml(a.clickup_status)}</span>` : '';
    const chipRol = a.recurso_rol
      ? `<span class="alert-chip">${escHtml(a.recurso_rol)}</span>` : '';

    return `
      <div class="alert-card ${a.nivel}"
           data-project-id="${a.proyecto_id || ''}"
           data-resource-id="${a.recurso_id || ''}">
        <div class="alert-dot ${a.nivel}"></div>
        <div class="alert-body">
          <div class="alert-title">${TIPO_LABELS[a.tipo] || a.tipo}</div>
          <div class="alert-proyecto">${escHtml(nombre || '')}</div>
          <div class="alert-mensaje">${escHtml(a.mensaje)}</div>
          <div class="alert-meta">
            ${chipStatus}${chipRol}
            ${a.clickup_id ? `<a href="https://app.clickup.com/t/${escHtml(a.clickup_id)}" target="_blank" class="alert-chip" style="color:var(--accent)">Ver en ClickUp ↗</a>` : ''}
          </div>
        </div>
        ${isProject ? '<div style="color:var(--text2);font-size:18px;align-self:center">›</div>' : ''}
      </div>`;
  }

  const criticas = data.alerts.filter(a => a.nivel === 'critica');
  const atencion = data.alerts.filter(a => a.nivel === 'atencion');

  main.innerHTML = `
    <div class="page-header">
      <h1>Alertas</h1>
      <button class="btn btn-secondary btn-sm" id="btn-refresh-alerts">↻ Actualizar</button>
    </div>

    <div class="alert-summary">
      <div class="alert-sum-card critica">
        <div class="num">${data.criticas}</div>
        <div class="lbl">Críticas</div>
      </div>
      <div class="alert-sum-card atencion">
        <div class="num">${data.atencion}</div>
        <div class="lbl">Con atención</div>
      </div>
      <div class="alert-sum-card ok">
        <div class="num">${data.total === 0 ? '✓' : data.total}</div>
        <div class="lbl">${data.total === 0 ? 'Todo en orden' : 'Total alertas'}</div>
      </div>
    </div>

    ${data.total === 0 ? `
      <div class="empty">
        <div class="empty-icon">✅</div>
        <p>Sin alertas activas. Todos los proyectos están al día.</p>
      </div>` : ''}

    ${criticas.length ? `
      <div class="alert-section-title">
        🔴 Críticas — requieren acción inmediata (${criticas.length})
      </div>
      ${criticas.map(alertCard).join('')}` : ''}

    ${atencion.length ? `
      <div class="alert-section-title">
        🟡 Atención — revisar esta semana (${atencion.length})
      </div>
      ${atencion.map(alertCard).join('')}` : ''}
  `;

  // Navegar al proyecto al hacer click en la card
  main.querySelectorAll('.alert-card[data-project-id]').forEach(card => {
    const pid = card.dataset.projectId;
    if (!pid) return;
    card.addEventListener('click', e => {
      if (e.target.tagName === 'A') return; // no interceptar el link a ClickUp
      navigate('project-detail', { id: pid });
    });
  });

  document.getElementById('btn-refresh-alerts').addEventListener('click', () => navigate('alerts'));
}

// ── ⑧ Dashboard ejecutivo ─────────────────────────────────
async function renderDashboard() {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';
  const d = await api.getDashboard();

  function bar(items, labelKey, countKey, color) {
    if (!items || !items.length) return '<p style="color:var(--text2);font-size:12px">Sin datos</p>';
    const max = Math.max(...items.map(i => i[countKey]));
    return items.slice(0, 10).map(item => {
      const pct = max > 0 ? Math.round((item[countKey] / max) * 100) : 0;
      return `
        <div style="margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:72%">${escHtml(String(item[labelKey]))}</span>
            <span style="color:var(--text2);flex-shrink:0;margin-left:6px;font-weight:600">${item[countKey]}</span>
          </div>
          <div style="background:var(--bg3);border-radius:3px;height:7px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
          </div>
        </div>`;
    }).join('');
  }

  function prioColor(p) {
    return { critica:'var(--red)', alta:'var(--orange)', media:'var(--accent)', baja:'var(--green)' }[p] || 'var(--accent)';
  }

  const corte = new Date(d.generated_at).toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' });
  const syncTxt = d.last_sync ? new Date(d.last_sync).toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' }) : 'nunca';

  const prios = [
    { prioridad:'critica', count: d.byPrioridad.critica },
    { prioridad:'alta',    count: d.byPrioridad.alta    },
    { prioridad:'media',   count: d.byPrioridad.media   },
    { prioridad:'baja',    count: d.byPrioridad.baja    },
  ].filter(p => p.count > 0);

  main.innerHTML = `
    <div class="dash-header no-print">
      <div>
        <h1 style="font-size:20px;font-weight:800">📈 Dashboard ejecutivo</h1>
        <div style="font-size:12px;color:var(--text2);margin-top:3px">Corte: ${corte} · Última sync ClickUp: ${syncTxt}</div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window.print()">⬇ Exportar PDF</button>
    </div>
    <div class="dash-header print-only" style="display:none">
      <h1 style="font-size:18px;font-weight:800">Dashboard ejecutivo — Proyectos GCS</h1>
      <div style="font-size:11px;color:#666">Corte: ${corte} · Sync: ${syncTxt}</div>
    </div>

    <!-- KPIs -->
    <div class="dash-kpis">
      <div class="dash-kpi">
        <div class="dash-kpi-num">${d.kpis.total}</div>
        <div class="dash-kpi-lbl">Total</div>
      </div>
      <div class="dash-kpi dash-kpi-red">
        <div class="dash-kpi-num">${d.kpis.red}</div>
        <div class="dash-kpi-lbl">🔴 En riesgo</div>
      </div>
      <div class="dash-kpi dash-kpi-yellow">
        <div class="dash-kpi-num">${d.kpis.yellow}</div>
        <div class="dash-kpi-lbl">🟡 Con atención</div>
      </div>
      <div class="dash-kpi dash-kpi-green">
        <div class="dash-kpi-num">${d.kpis.green}</div>
        <div class="dash-kpi-lbl">🟢 Al día</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-num" style="color:var(--text2)">${(d.kpis.backlog||0) + (d.kpis.cerrado||0)}</div>
        <div class="dash-kpi-lbl">Backlog / Cerrado</div>
      </div>
    </div>

    <!-- Gráficos -->
    <div class="dash-charts">
      <div class="dash-chart-card">
        <div class="dash-chart-title">Por fase / estado ClickUp</div>
        ${bar(d.byFase, 'fase', 'count', 'var(--accent)')}
      </div>
      <div class="dash-chart-card">
        <div class="dash-chart-title">Por prioridad</div>
        ${(() => {
          const maxP = Math.max(...prios.map(p => p.count), 1);
          return prios.map(p => `
            <div style="margin-bottom:9px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                <span style="font-weight:500">${p.prioridad.charAt(0).toUpperCase()+p.prioridad.slice(1)}</span>
                <span style="color:var(--text2);font-weight:600">${p.count}</span>
              </div>
              <div style="background:var(--bg3);border-radius:3px;height:7px;overflow:hidden">
                <div style="width:${Math.round(p.count/maxP*100)}%;height:100%;background:${prioColor(p.prioridad)};border-radius:3px"></div>
              </div>
            </div>`).join('');
        })()}
      </div>
      <div class="dash-chart-card">
        <div class="dash-chart-title">Carga por técnico</div>
        ${bar(d.byTecnico.map(t => ({ label: t.nombre, count: t.count })), 'label', 'count', 'var(--green)')}
      </div>
    </div>

    <!-- En riesgo -->
    ${d.enRiesgo.length ? `
    <div class="dash-section">
      <div class="dash-section-title">🔴 Proyectos en riesgo (${d.enRiesgo.length})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Proyecto</th>
              <th>Fase</th>
              <th>Prioridad</th>
              <th>Inactividad</th>
              <th>Último comentario</th>
              <th>Técnico(s)</th>
            </tr>
          </thead>
          <tbody>
            ${d.enRiesgo.map(p => `
              <tr>
                <td><a href="#" class="dash-proj-link" data-id="${p.id}" style="font-weight:600;color:var(--accent)">${escHtml(p.nombre)}</a></td>
                <td style="font-size:12px;color:var(--text2)">${escHtml(p.clickup_status||'—')}</td>
                <td>${badgePrio(p.prioridad)}</td>
                <td style="text-align:center">
                  ${p.dias_vencido !== null
                    ? `<span class="dias-badge dias-red">Vencido ${p.dias_vencido}d</span>`
                    : p.dias_inactivo !== null
                      ? `<span class="dias-badge ${p.dias_inactivo>7?'dias-red':'dias-yellow'}">${p.dias_inactivo}d sin act.</span>`
                      : '—'}
                </td>
                <td class="comment-cell" style="max-width:220px">
                  ${p.last_comment_text
                    ? `<div class="lc-text" style="font-size:12px">${escHtml(p.last_comment_text)}</div>
                       <div class="lc-meta">${escHtml(p.last_comment_by||'')}${p.last_comment_at ? ' · '+new Date(p.last_comment_at).toLocaleDateString('es-AR') : ''}</div>`
                    : '<span style="color:var(--text2);font-size:12px">—</span>'}
                </td>
                <td style="font-size:12px">${p.tecnicos ? p.tecnicos.split(',').map(t=>`<span class="tec-chip">${escHtml(t.trim())}</span>`).join(' ') : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="dash-section"><div class="dash-section-title">🟢 Sin proyectos en riesgo</div></div>`}

    <!-- Próximos vencimientos -->
    ${d.proximos.length ? `
    <div class="dash-section">
      <div class="dash-section-title">📅 Próximos vencimientos</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Proyecto</th><th>Fase</th><th>Vence</th><th>Días</th><th>Técnico(s)</th></tr>
          </thead>
          <tbody>
            ${d.proximos.map(p => {
              const dv = p.dias_hasta;
              const dvTxt = dv < 0 ? `<span class="dias-badge dias-red">Vencido ${Math.abs(dv)}d</span>`
                : dv === 0 ? `<span class="dias-badge dias-red">Hoy</span>`
                : dv <= 5  ? `<span class="dias-badge dias-yellow">${dv}d</span>`
                : `<span class="dias-badge">${dv}d</span>`;
              return `
              <tr>
                <td><a href="#" class="dash-proj-link" data-id="${p.id}" style="font-weight:600;color:var(--accent)">${escHtml(p.nombre)}</a></td>
                <td style="font-size:12px;color:var(--text2)">${escHtml(p.clickup_status||'—')}</td>
                <td style="font-size:12px">${p.fecha_fin_est}</td>
                <td style="text-align:center">${dvTxt}</td>
                <td style="font-size:12px">${p.tecnicos ? p.tecnicos.split(',').map(t=>`<span class="tec-chip">${escHtml(t.trim())}</span>`).join(' ') : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Horas por técnico (solo si hay datos) -->
    ${d.tieneHoras && d.horasPorTecnico.length ? `
    <div class="dash-section">
      <div class="dash-section-title">⏱ Horas por técnico</div>
      <div class="dash-chart-card" style="max-width:420px">
        ${bar(d.horasPorTecnico.map(t => ({ label: t.nombre, count: Math.round(t.seg/3600*10)/10 })), 'label', 'count', 'var(--accent)')}
        <div style="font-size:11px;color:var(--text2);margin-top:8px">Valores en horas · Solo registros finalizados</div>
      </div>
    </div>` : ''}
  `;

  // Links a detalle de proyecto
  main.querySelectorAll('.dash-proj-link').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); navigate('project-detail', { id: a.dataset.id }); }));
}

// ── ⑨ Resumen de horas por proyecto ──────────────────────
async function renderResumenHoras({ periodo = '7d', soloConHoras = false, vista = 'proyectos' } = {}) {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';

  const now = new Date();
  let from = null, to = null;

  if (periodo === '7d') {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    from = monday.toISOString().slice(0, 10);
    to   = now.toISOString().slice(0, 10);
  } else if (periodo === '14d') {
    const d = new Date(now);
    d.setDate(now.getDate() - 13);
    from = d.toISOString().slice(0, 10);
    to   = now.toISOString().slice(0, 10);
  } else if (periodo === '30d') {
    const d = new Date(now);
    d.setDate(now.getDate() - 29);
    from = d.toISOString().slice(0, 10);
    to   = now.toISOString().slice(0, 10);
  }

  const q = {};
  if (from) q.from = from;
  if (to)   q.to   = to;

  const data = await api.getResumenHoras(q);

  const sorted = [...data].sort((a, b) =>
    (b.horas_comentadas + b.horas_registradas) - (a.horas_comentadas + a.horas_registradas)
  );
  const filtered = soloConHoras
    ? sorted.filter(p => p.horas_comentadas > 0 || p.horas_registradas > 0)
    : sorted;

  const totalComentadas  = filtered.reduce((s, p) => s + p.horas_comentadas, 0);
  const totalRegistradas = filtered.reduce((s, p) => s + p.horas_registradas, 0);
  const totalCombinado   = totalComentadas + totalRegistradas;
  const conActividad     = filtered.filter(p => p.horas_comentadas > 0 || p.horas_registradas > 0).length;

  const PERIODOS = { '7d': 'Esta semana', '14d': 'Últimas 2 semanas', '30d': 'Último mes', 'todo': 'Histórico completo' };
  const fechaLabel = from && to ? `${from} al ${to}` : 'Histórico completo';

  function fmtH(h) {
    if (!h || h === 0) return '0h';
    const hrs = Math.floor(h);
    const min = Math.round((h - hrs) * 60);
    if (hrs === 0) return `${min}m`;
    return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`;
  }

  function projectCard(p) {
    const maxActor = Math.max(1, ...p.por_actor.map(a => a.horas));
    return `
      <div class="rh-card rh-card-clickable" data-project-id="${p.id}">
        <div class="rh-card-header">
          <div class="rh-card-title">
            <span class="rh-project-name">${escHtml(p.nombre)}</span>
            ${badgeEstado(p.estado)}
            ${p.clickup_status ? `<span class="rh-fase">${escHtml(p.clickup_status)}</span>` : ''}
          </div>
          <div class="rh-horas-big">
            <span class="rh-horas-num">${fmtH(p.horas_comentadas)}</span>
            <span class="rh-horas-lbl">en comentarios</span>
            ${p.horas_registradas > 0 ? `<span class="rh-horas-lbl" style="color:var(--accent)">+ ${fmtH(p.horas_registradas)} timer</span>` : ''}
          </div>
        </div>
        ${p.por_actor.length === 0
          ? `<div class="rh-empty-actors">Sin menciones de horas en comentarios del período</div>`
          : `<div class="rh-actors">
              ${p.por_actor.map(a => {
                const pct = Math.round((a.horas / maxActor) * 100);
                return `
                  <div class="rh-actor-row">
                    <span class="rh-actor-name">${escHtml(a.actor)}</span>
                    <div class="rh-actor-bar-wrap"><div class="rh-actor-bar" style="width:${pct}%"></div></div>
                    <span class="rh-actor-hrs">${fmtH(a.horas)}</span>
                    <span class="rh-actor-comments">${a.comentarios} coment.</span>
                  </div>`;
              }).join('')}
            </div>`}
        <div class="rh-card-footer">
          ${p.horas_registradas > 0
            ? `<span class="rh-registered">⏱ ${fmtH(p.horas_registradas)} registradas (timer/manual)</span>`
            : `<span class="rh-registered rh-registered-none">Sin horas registradas</span>`}
          <span class="rh-total-comments">${p.total_comentarios} comentarios · ${p.comentarios_con_horas} con horas</span>
        </div>
      </div>`;
  }

  // Build pivot "por persona" from por_actor data
  function buildPersonaPivot() {
    const personas = {};
    for (const p of filtered) {
      for (const a of p.por_actor) {
        if (!personas[a.actor]) personas[a.actor] = { nombre: a.actor, total: 0, proyectos: [] };
        personas[a.actor].total += a.horas;
        personas[a.actor].proyectos.push({ nombre: p.nombre, id: p.id, horas: a.horas });
      }
    }
    return Object.values(personas).sort((a, b) => b.total - a.total);
  }

  function personaCard(persona) {
    const maxH = Math.max(1, ...persona.proyectos.map(p => p.horas));
    return `
      <div class="rh-persona-card">
        <div class="rh-persona-header">
          <span class="rh-persona-name">👤 ${escHtml(persona.nombre)}</span>
          <span class="rh-persona-total">${fmtH(persona.total)}</span>
        </div>
        <div class="rh-persona-projects">
          ${persona.proyectos.map(p => {
            const pct = Math.round((p.horas / maxH) * 100);
            return `
              <div class="rh-persona-proj-row">
                <span class="rh-persona-proj-name">${escHtml(p.nombre)}</span>
                <div class="rh-persona-proj-bar-wrap"><div class="rh-persona-proj-bar" style="width:${pct}%"></div></div>
                <span class="rh-persona-proj-hrs">${fmtH(p.horas)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  const personas = buildPersonaPivot();
  const listaContent = vista === 'personas'
    ? (personas.length === 0
        ? `<div class="empty"><div class="empty-icon">👥</div><p>Sin menciones de horas por persona en el período</p></div>`
        : personas.map(personaCard).join(''))
    : (filtered.length === 0
        ? `<div class="empty"><div class="empty-icon">📊</div><p>Sin datos de horas para el período seleccionado</p></div>`
        : filtered.map(projectCard).join(''));

  main.innerHTML = `
    <div class="page-header no-print">
      <div>
        <h1>Resumen de horas</h1>
        <div style="font-size:12px;color:var(--text2);margin-top:3px">${fechaLabel}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost btn-sm ${soloConHoras ? 'btn-active' : ''}" id="btn-rh-filtro">
          ${soloConHoras ? '● Solo con actividad' : '○ Solo con actividad'}
        </button>
        <button class="btn btn-secondary btn-sm" onclick="window.print()">⬇ PDF</button>
        <button class="btn btn-secondary btn-sm" id="btn-rh-refresh">↻</button>
      </div>
    </div>

    <div class="rh-periodo-tabs no-print">
      ${Object.entries(PERIODOS).map(([key, label]) => `
        <button class="rh-tab ${periodo === key ? 'active' : ''}" data-periodo="${key}">${label}</button>
      `).join('')}
    </div>

    <div class="rh-totales">
      <div class="rh-total-card">
        <div class="rh-total-num">${fmtH(totalComentadas)}</div>
        <div class="rh-total-lbl">Total en comentarios</div>
      </div>
      <div class="rh-total-card">
        <div class="rh-total-num">${fmtH(totalRegistradas)}</div>
        <div class="rh-total-lbl">Total registradas (timer)</div>
      </div>
      <div class="rh-total-card" style="border-color:var(--accent)">
        <div class="rh-total-num" style="color:var(--green)">${fmtH(totalCombinado)}</div>
        <div class="rh-total-lbl">Total combinado</div>
      </div>
      <div class="rh-total-card">
        <div class="rh-total-num" style="font-size:22px">${conActividad}</div>
        <div class="rh-total-lbl">Proyectos con actividad</div>
      </div>
    </div>

    <div class="rh-view-tabs no-print">
      <button class="rh-view-tab ${vista === 'proyectos' ? 'active' : ''}" data-vista="proyectos">Por proyecto</button>
      <button class="rh-view-tab ${vista === 'personas' ? 'active' : ''}" data-vista="personas">Por persona</button>
    </div>

    <div class="rh-list">
      ${listaContent}
    </div>
  `;

  main.querySelectorAll('.rh-tab').forEach(btn =>
    btn.addEventListener('click', () => renderResumenHoras({ periodo: btn.dataset.periodo, soloConHoras, vista }))
  );
  main.querySelectorAll('.rh-view-tab').forEach(btn =>
    btn.addEventListener('click', () => renderResumenHoras({ periodo, soloConHoras, vista: btn.dataset.vista }))
  );
  document.getElementById('btn-rh-filtro').addEventListener('click', () =>
    renderResumenHoras({ periodo, soloConHoras: !soloConHoras, vista })
  );
  document.getElementById('btn-rh-refresh').addEventListener('click', () =>
    renderResumenHoras({ periodo, soloConHoras, vista })
  );

  // Clickable project cards
  main.querySelectorAll('.rh-card-clickable').forEach(card =>
    card.addEventListener('click', () => navigate('project-detail', { id: card.dataset.projectId }))
  );
}

// ── Sprints ────────────────────────────────────────────────
async function renderSprints() {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';

  const [sprints, phases] = await Promise.all([api.getSprints(), api.getPhases()]);

  let sid = parseInt(localStorage.getItem('gestor_sprint_id') || '0');
  if (!sprints.find(s => s.id === sid)) {
    const active = sprints.find(s => s.estado === 'activo') || sprints[0];
    sid = active?.id || 0;
    if (sid) localStorage.setItem('gestor_sprint_id', sid);
  }

  let cuStatus = localStorage.getItem('gestor_sprint_cu_status') || '';

  const selectOpts = sprints.length === 0
    ? '<option value="">-- Sin sprints --</option>'
    : sprints.map(s => {
        const label = `${escHtml(s.nombre)} (${s.fecha_inicio} → ${s.fecha_fin})`;
        return `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${label}</option>`;
      }).join('');

  const phaseOpts = phases.length
    ? `<option value="">Todos los estados</option>` +
      phases.map(p => `<option value="${escHtml(p)}" ${cuStatus === p ? 'selected' : ''}>${escHtml(p)}</option>`).join('')
    : `<option value="">Sin datos ClickUp</option>`;

  main.innerHTML = `
    <div class="sprint-page">
      <div class="sprint-topbar">
        <select id="sprint-select" class="sprint-select">${selectOpts}</select>
        ${phases.length ? `
        <div class="sprint-cufilter-wrap">
          <span class="sprint-cufilter-label">Backlog:</span>
          <select id="sprint-cu-filter" class="sprint-select sprint-select-sm" title="Filtrar backlog por estado ClickUp">
            ${phaseOpts}
          </select>
        </div>` : ''}
        <button id="btn-nuevo-sprint" class="btn btn-primary btn-sm">+ Nuevo Sprint</button>
      </div>
      <div id="sprint-info-bar"></div>
      <div id="sprint-board-wrap"></div>
    </div>
  `;

  function sprintCardHtml(p, col) {
    const salud = calcSalud(p);
    const saludHtml = salud.level !== 'grey'
      ? `<span class="kanban-salud kanban-salud-${salud.level}">${escHtml(salud.titulo)}</span>` : '';
    const tecs = p.tecnicos ? p.tecnicos.split(',').filter(Boolean) : [];
    const hoy = Date.now();
    const vencido   = p.fecha_fin_est && new Date(p.fecha_fin_est) < hoy;
    const proxVence = p.fecha_fin_est && !vencido && Math.floor((new Date(p.fecha_fin_est) - hoy) / 86400000) <= 5;
    const fechaHtml = p.fecha_fin_est
      ? `<span class="${vencido ? 'kanban-fecha-red' : proxVence ? 'kanban-fecha-yellow' : 'kanban-fecha'}">${p.fecha_fin_est}</span>` : '';
    return `
      <div class="kanban-card sprint-card" draggable="true"
           data-id="${p.id}" data-col="${col}" data-estado="${escHtml(p.estado)}">
        <div class="kanban-card-title">${escHtml(p.nombre)}</div>
        <div class="kanban-card-meta">
          ${badgeEstado(p.estado)}${badgePrio(p.prioridad)}${saludHtml}${fechaHtml}
        </div>
        ${tecs.length ? `<div class="kanban-card-tecs">${tecs.map(t => `<span class="kanban-tec">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function renderSprintInfoBar(sprint) {
    const total = sprint.total_projects || 0;
    const done  = sprint.completed_projects || 0;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    const estadoMeta = {
      planificado: { label: 'Planificado', color: '#7a8494' },
      activo:      { label: 'Activo',      color: '#5090d0' },
      completado:  { label: 'Completado',  color: '#3aaa68' },
    };
    const m = estadoMeta[sprint.estado] || estadoMeta.planificado;
    const infoEl = document.getElementById('sprint-info-bar');
    infoEl.className = 'sprint-info-bar';
    infoEl.innerHTML = `
      <div class="sprint-info-left">
        <span class="sprint-estado-badge" style="background:${m.color}20;color:${m.color};border:1px solid ${m.color}50">${m.label}</span>
        ${sprint.objetivo ? `<span class="sprint-objetivo">${escHtml(sprint.objetivo)}</span>` : ''}
        <span class="sprint-fechas">${sprint.fecha_inicio} → ${sprint.fecha_fin}</span>
      </div>
      <div class="sprint-progress-wrap">
        <span class="sprint-progress-label">${done}/${total}</span>
        <div class="sprint-progress-bar"><div class="sprint-progress-fill" style="width:${pct}%"></div></div>
        <span class="sprint-progress-label">${pct}%</span>
      </div>
      <div class="sprint-info-actions">
        ${sprint.estado === 'planificado' ? `<button class="btn btn-sm btn-primary" data-sprint-action="activar">▶ Activar</button>` : ''}
        ${sprint.estado === 'activo' ? `<button class="btn btn-sm" style="background:#3aaa68;color:#fff" data-sprint-action="completar">✓ Completar</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-sprint-action="editar">✏ Editar</button>
        <button class="btn btn-sm btn-ghost" style="color:var(--red)" data-sprint-action="eliminar">🗑</button>
      </div>
    `;
    document.querySelectorAll('[data-sprint-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.sprintAction;
        if (action === 'activar') {
          await api.updateSprint(sprint.id, { estado: 'activo' });
          toast('Sprint activado', 'success');
          renderSprints();
        } else if (action === 'completar') {
          await api.updateSprint(sprint.id, { estado: 'completado' });
          toast('Sprint completado', 'success');
          renderSprints();
        } else if (action === 'editar') {
          showSprintModal(sprint, () => renderSprints());
        } else if (action === 'eliminar') {
          if (!confirm(`¿Eliminar "${sprint.nombre}"? Se desasignarán todos los proyectos.`)) return;
          await api.deleteSprint(sprint.id);
          localStorage.removeItem('gestor_sprint_id');
          toast('Sprint eliminado', 'info');
          renderSprints();
        }
      });
    });
  }

  function renderBoard(board) {
    const sprintId = board.sprint.id;
    const wrap = document.getElementById('sprint-board-wrap');

    const colHtml = (col, label, items) => {
      const emptyHint = items.length === 0
        ? `<div class="sprint-drop-hint">Arrastrá proyectos aquí</div>` : '';
      return `
        <div class="sprint-col" data-col="${col}">
          <div class="sprint-col-header sprint-col-${col}">
            <span>${label}</span>
            <span style="font-size:11px;opacity:.6">${items.length}</span>
          </div>
          <div class="sprint-cards" data-col="${col}">
            ${emptyHint}${items.map(p => sprintCardHtml(p, col)).join('')}
          </div>
        </div>`;
    };

    wrap.innerHTML = `
      <div class="sprint-board">
        ${colHtml('backlog',     '📋 BACKLOG',    board.backlog)}
        ${colHtml('activos',     '🏃 EN SPRINT',  board.activos)}
        ${colHtml('completados', '✅ COMPLETADO', board.completados)}
      </div>`;

    let dragging = null;

    wrap.querySelectorAll('.sprint-card').forEach(card => {
      card.addEventListener('dragstart', () => { dragging = card; card.classList.add('dragging'); });
      card.addEventListener('dragend',   () => { dragging = null; card.classList.remove('dragging'); });
    });

    wrap.querySelectorAll('.sprint-col').forEach(col => {
      col.addEventListener('dragover',  e => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', e => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
      });
      col.addEventListener('drop', async e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragging) return;
        const projectId = dragging.dataset.id;
        const fromCol   = dragging.dataset.col;
        const toCol     = col.dataset.col;
        if (fromCol === toCol) return;
        try {
          if (toCol === 'backlog') {
            await api.removeProjectFromSprint(sprintId, projectId);
          } else if (toCol === 'activos') {
            if (fromCol === 'backlog') {
              await api.addProjectToSprint(sprintId, projectId, { estado: 'en_curso' });
            } else {
              await api.updateSprintProject(sprintId, projectId, { estado: 'en_curso' });
            }
          } else if (toCol === 'completados') {
            if (fromCol === 'backlog') {
              await api.addProjectToSprint(sprintId, projectId, { estado: 'completado' });
            } else {
              await api.updateSprintProject(sprintId, projectId, { estado: 'completado' });
            }
          }
          await loadBoard(sprintId);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  async function loadBoard(sprintId) {
    if (!sprintId) {
      document.getElementById('sprint-info-bar').innerHTML = '';
      document.getElementById('sprint-board-wrap').innerHTML = `
        <div class="empty">
          <p style="font-size:2.5rem;margin-bottom:.5rem">🏃</p>
          <p>No hay sprints todavía.<br>Creá uno con el botón <strong>+ Nuevo Sprint</strong>.</p>
        </div>`;
      return;
    }
    const q = cuStatus ? { clickup_status: cuStatus } : {};
    const board = await api.getSprintBoard(sprintId, q);
    renderSprintInfoBar(board.sprint);
    renderBoard(board);
  }

  function showSprintModal(sprint, onSave) {
    const isEdit = !!sprint;
    const today    = new Date().toISOString().slice(0, 10);
    const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const overlay = el(`
      <div class="modal-overlay">
        <div class="modal">
          <h2>${isEdit ? 'Editar Sprint' : 'Nuevo Sprint'}</h2>
          <div class="form-group">
            <label>Nombre *</label>
            <input id="sm-nombre" type="text" value="${escHtml(sprint?.nombre || '')}" placeholder="Sprint 12">
          </div>
          <div class="form-group">
            <label>Objetivo</label>
            <input id="sm-objetivo" type="text" value="${escHtml(sprint?.objetivo || '')}" placeholder="Meta del sprint">
          </div>
          <div class="form-row">
            <div class="form-group"><label>Inicio *</label><input id="sm-inicio" type="date" value="${sprint?.fecha_inicio || today}"></div>
            <div class="form-group"><label>Fin *</label><input id="sm-fin" type="date" value="${sprint?.fecha_fin || twoWeeks}"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="sm-cancel">Cancelar</button>
            <button id="sm-save" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Crear Sprint'}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#sm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#sm-nombre').focus();
    overlay.querySelector('#sm-save').addEventListener('click', async () => {
      const nombre      = overlay.querySelector('#sm-nombre').value.trim();
      const objetivo    = overlay.querySelector('#sm-objetivo').value.trim();
      const fecha_inicio = overlay.querySelector('#sm-inicio').value;
      const fecha_fin   = overlay.querySelector('#sm-fin').value;
      if (!nombre || !fecha_inicio || !fecha_fin) { toast('Completá nombre, inicio y fin', 'warn'); return; }
      if (fecha_fin < fecha_inicio)               { toast('La fecha fin debe ser posterior al inicio', 'warn'); return; }
      try {
        let result;
        if (isEdit) {
          await api.updateSprint(sprint.id, { nombre, objetivo, fecha_inicio, fecha_fin });
        } else {
          result = await api.createSprint({ nombre, objetivo, fecha_inicio, fecha_fin });
          localStorage.setItem('gestor_sprint_id', result.id);
        }
        close();
        toast(isEdit ? 'Sprint actualizado' : 'Sprint creado', 'success');
        onSave?.();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  document.getElementById('sprint-select')?.addEventListener('change', e => {
    const newId = parseInt(e.target.value) || 0;
    localStorage.setItem('gestor_sprint_id', newId);
    sid = newId;
    loadBoard(newId);
  });

  document.getElementById('sprint-cu-filter')?.addEventListener('change', e => {
    cuStatus = e.target.value;
    localStorage.setItem('gestor_sprint_cu_status', cuStatus);
    loadBoard(sid);
  });

  document.getElementById('btn-nuevo-sprint')?.addEventListener('click', () => {
    showSprintModal(null, () => renderSprints());
  });

  await loadBoard(sid);
}

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('nav ul li a[data-route]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.route); });
  });

  document.getElementById('btn-sync-nav')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-nav');
    btn.textContent = '⏳';
    try {
      const r = await api.syncClickUp();
      toast(r.ok ? `Sync OK` : `Error: ${r.error}`, r.ok ? 'success' : 'error');
    } catch(e) { toast(e.message, 'error'); }
    btn.textContent = '↻';
    updateSyncStatus();
    updateAlertBadge();
  });

  navigate('dashboard');
  updateSyncStatus();
  updateAlertBadge();
  setInterval(updateSyncStatus, 60000);
  setInterval(updateAlertBadge, 120000); // refresca badge cada 2 min
});
