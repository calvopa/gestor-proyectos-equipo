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
  'settings':       renderSettings,
  'dashboard':      renderDashboard,
  'semana':         () => renderSemana(),
  'resumen-horas':  renderResumenHoras,
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
async function renderProjects({ search = '', estado = '', prioridad = '', fase = '', tecnico = '', sort = 'updated_at', dir = 'desc', soloRiesgo = false, focusSearch = false } = {}) {
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
      <button class="btn btn-primary" id="btn-new-project">＋ Nuevo proyecto</button>
    </div>
    <div class="filters">
      <input type="text" id="f-search" placeholder="Buscar..." value="${escHtml(search)}" style="flex:2;min-width:160px">
      <select id="f-estado">
        <option value="">Todos los estados</option>
        ${['backlog','en_curso','pausado','cerrado'].map(e => `<option value="${e}" ${estado===e?'selected':''}>${e.replace('_',' ')}</option>`).join('')}
      </select>
      <select id="f-prioridad">
        <option value="">Todas las prioridades</option>
        ${['baja','media','alta','critica'].map(p => `<option value="${p}" ${prioridad===p?'selected':''}>${p}</option>`).join('')}
      </select>
      <select id="f-fase">
        <option value="">Todas las fases</option>
        ${phases.map(f => `<option value="${escHtml(f)}" ${fase===f?'selected':''}>${escHtml(f)}</option>`).join('')}
      </select>
      <select id="f-tecnico">
        <option value="">Todos los técnicos</option>
        ${resources.map(r => `<option value="${r.id}" ${tecnico===String(r.id)?'selected':''}>${escHtml(r.nombre)}</option>`).join('')}
      </select>
      <button class="btn ${soloRiesgo ? 'btn-primary' : 'btn-ghost'} btn-sm" id="f-riesgo" title="Mostrar solo en riesgo o con atención">
        ⚠ ${soloRiesgo ? 'Todos' : 'En riesgo'}
      </button>
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
                    <button class="btn btn-ghost btn-sm btn-edit-project" data-id="${p.id}">✎</button>
                    <button class="btn btn-danger btn-sm btn-del-project" data-id="${p.id}">✕</button>
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
      search:   document.getElementById('f-search')?.value   || '',
      estado:   document.getElementById('f-estado')?.value   || '',
      prioridad:document.getElementById('f-prioridad')?.value|| '',
      fase:     document.getElementById('f-fase')?.value     || '',
      tecnico:  document.getElementById('f-tecnico')?.value  || '',
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
  ['f-estado','f-prioridad','f-fase','f-tecnico'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () =>
      renderProjects({ ...getFilters(), sort, dir, soloRiesgo }));
  });
  document.getElementById('f-riesgo').addEventListener('click', () =>
    renderProjects({ ...getFilters(), sort, dir, soloRiesgo: !soloRiesgo }));

  main.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => renderProjects({
      ...getFilters(), sort: th.dataset.col, dir: th.dataset.dir, soloRiesgo
    }));
  });

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
              ${['backlog','en_curso','pausado','cerrado'].map(e => `<option value="${e}" ${(p.estado||'backlog')===e?'selected':''}>${e}</option>`).join('')}
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

// ── ② Kanban ──────────────────────────────────────────────
async function renderKanban() {
  const main = document.getElementById('main-content');
  const projects = await api.getProjects();

  const columns = ['backlog','en_curso','pausado','cerrado'];
  const labels = { backlog: 'Backlog', en_curso: 'En curso', pausado: 'Pausado', cerrado: 'Cerrado' };

  const byCol = Object.fromEntries(columns.map(c => [c, projects.filter(p => p.estado === c)]));

  main.innerHTML = `
    <div class="page-header">
      <h1>Kanban</h1>
      <button class="btn btn-primary" id="btn-new-project">＋ Nuevo proyecto</button>
    </div>
    <div class="kanban">
      ${columns.map(col => `
        <div class="kanban-col" data-estado="${col}">
          <div class="kanban-col-header">
            <span>${labels[col]}</span>
            <span>${byCol[col].length}</span>
          </div>
          <div class="kanban-cards" data-estado="${col}">
            ${byCol[col].map(p => {
              const salud = calcSalud(p);
              const alerta = (salud.level === 'red' || salud.level === 'yellow')
                ? `<span class="kanban-salud kanban-salud-${salud.level}">${escHtml(salud.titulo)}</span>` : '';
              return `
              <div class="kanban-card" draggable="true" data-id="${p.id}" data-estado="${p.estado}">
                <div class="kanban-card-title"><span class="semaforo semaforo-${salud.level}" style="margin-right:7px" title="${escHtml(salud.detalle)}"></span>${escHtml(p.nombre)}</div>
                <div class="kanban-card-meta">
                  ${badgePrio(p.prioridad)}
                  ${alerta}
                  ${!p.cuenta_horas ? '<span class="no-cuenta-badge">sin cómputo</span>' : ''}
                </div>
              </div>
            `; }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('btn-new-project').addEventListener('click', () => showProjectModal());

  // Drag and drop
  let dragging = null;

  main.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('dragstart', () => { dragging = card; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { dragging = null; card.classList.remove('dragging'); });
    card.addEventListener('click', () => navigate('project-detail', { id: card.dataset.id }));
  });

  main.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
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

// ── ③ Project detail ──────────────────────────────────────
async function renderProjectDetail({ id }) {
  const main = document.getElementById('main-content');
  const p = await api.getProject(id);

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
            <div class="timer-display" id="timer-display">${p.activeTimer ? '▶ activo' : '00:00:00'}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="btn btn-primary" id="btn-timer-toggle">
              ${p.activeTimer ? '⏹ Detener' : '▶ Iniciar'}
            </button>
          </div>
          <div style="flex:1"></div>
          <button class="btn btn-secondary btn-sm" id="btn-manual">+ Manual</button>
          <button class="btn btn-secondary btn-sm" id="btn-estimate" title="Generar horas estimadas desde comentarios de ClickUp">⚡ Estimar</button>
          <button class="btn btn-ghost btn-sm" id="btn-clear-estimates" title="Eliminar horas estimadas de este proyecto">✕ Estimados</button>
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
        btn.textContent = '▶ Iniciar';
        activeEntry = null;
        toast('Timer detenido', 'success');
        loadEntries(id);
        // Refresh stats
        api.getProject(id).then(fresh => {
          document.getElementById('stat-contadas').textContent = fmtSec(fresh.hours?.seg_contados);
          document.getElementById('stat-total').textContent = fmtSec(fresh.hours?.seg_total);
          if (document.getElementById('stat-estimado')) document.getElementById('stat-estimado').textContent = fmtSec(fresh.hours?.seg_estimado);
        });
      } else {
        activeEntry = await api.startTimer({ project_id: id });
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
  container.innerHTML = entries.map(e => `
    <div class="entry-item">
      <span class="entry-type ${e.tipo}">${e.tipo}</span>
      <span class="entry-time">${fmtSec(e.duracion_seg)}</span>
      <span class="entry-note">${escHtml(e.nota || '—')} <span style="font-size:11px">${e.resource_nombre ? '· ' + escHtml(e.resource_nombre) : ''}</span></span>
      <span style="color:var(--text2);font-size:12px">${new Date(e.inicio).toLocaleDateString('es-AR')}</span>
      <button class="btn btn-ghost btn-sm btn-del-entry" data-id="${e.id}">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del-entry').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar registro?')) return;
      await api.deleteEntry(b.dataset.id);
      toast('Registro eliminado', 'success');
      loadEntries(projectId);
    }));
}

function showManualModal(projectId, onSave) {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal">
        <h2>Carga manual de horas</h2>
        <div class="form-group"><label>Fecha y hora de inicio</label><input type="datetime-local" id="mn-inicio" value="${localIso}"></div>
        <div class="form-row">
          <div class="form-group"><label>Horas</label><input type="number" id="mn-h" min="0" max="24" value="1"></div>
          <div class="form-group"><label>Minutos</label><input type="number" id="mn-m" min="0" max="59" value="0"></div>
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
  overlay.querySelector('#mn-save').addEventListener('click', async () => {
    const h = parseInt(document.getElementById('mn-h').value, 10) || 0;
    const m = parseInt(document.getElementById('mn-m').value, 10) || 0;
    const duracion_seg = h * 3600 + m * 60;
    if (duracion_seg <= 0) return toast('Duración debe ser mayor a 0', 'error');
    const inicio = new Date(document.getElementById('mn-inicio').value).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const nota = document.getElementById('mn-nota').value.trim() || null;
    try {
      await api.addManual({ project_id: projectId, inicio, duracion_seg, nota });
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
            <th>Nombre</th><th>Rol</th><th>Email</th><th>Estado</th><th>ClickUp ID</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${resources.length === 0 ? `<tr><td colspan="6"><div class="empty"><div class="empty-icon">👥</div><p>Sin recursos todavía</p></div></td></tr>` :
            resources.map(r => `
              <tr data-id="${r.id}">
                <td><strong>${escHtml(r.nombre)}</strong></td>
                <td>${escHtml(r.rol||'—')}</td>
                <td>${escHtml(r.email||'—')}</td>
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

// ── ⑤ Carga por recurso ───────────────────────────────────
async function renderCarga() {
  const main = document.getElementById('main-content');
  const resources = await api.getCarga();

  main.innerHTML = `
    <div class="page-header"><h1>Carga por recurso</h1></div>
    ${resources.length === 0 ? '<div class="empty"><div class="empty-icon">📊</div><p>Sin recursos activos</p></div>' :
      resources.map(r => `
        <div class="resource-card">
          <div class="rc-header">
            <div>
              <div class="rc-name">${escHtml(r.nombre)}</div>
              <div class="rc-meta">${escHtml(r.rol||'')} ${r.email ? '· ' + escHtml(r.email) : ''}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:700">${fmtSec(r.hours?.seg_contados)}</div>
              <div style="font-size:12px;color:var(--text2)">contabilizadas</div>
              ${r.hours?.seg_total !== r.hours?.seg_contados ? `<div style="font-size:12px;color:var(--orange)">${fmtSec(r.hours?.seg_total)} total registrado</div>` : ''}
            </div>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${r.assignments.length} proyecto${r.assignments.length !== 1 ? 's' : ''}</div>
          <div class="rc-projects">
            ${r.assignments.map(a => `
              <span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:12px">
                ${badgeEstado(a.project_estado)}
                ${escHtml(a.project_nombre)}
                ${a.dedicacion_pct ? `<span style="color:var(--text2)">${a.dedicacion_pct}%</span>` : ''}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('')}
  `;
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
async function renderResumenHoras({ periodo = '7d', soloConHoras = false } = {}) {
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
      <div class="rh-card">
        <div class="rh-card-header">
          <div class="rh-card-title">
            <span class="rh-project-name">${escHtml(p.nombre)}</span>
            ${badgeEstado(p.estado)}
            ${p.clickup_status ? `<span class="rh-fase">${escHtml(p.clickup_status)}</span>` : ''}
          </div>
          <div class="rh-horas-big">
            <span class="rh-horas-num">${fmtH(p.horas_comentadas)}</span>
            <span class="rh-horas-lbl">en comentarios</span>
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

  main.innerHTML = `
    <div class="page-header no-print">
      <div>
        <h1>Horas por proyecto</h1>
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
        <div class="rh-total-lbl">Total registradas</div>
      </div>
      <div class="rh-total-card">
        <div class="rh-total-num">${conActividad}</div>
        <div class="rh-total-lbl">Proyectos con actividad</div>
      </div>
    </div>

    <div class="rh-list">
      ${filtered.length === 0
        ? `<div class="empty"><div class="empty-icon">📊</div><p>Sin datos de horas para el período seleccionado</p></div>`
        : filtered.map(projectCard).join('')}
    </div>
  `;

  main.querySelectorAll('.rh-tab').forEach(btn =>
    btn.addEventListener('click', () => renderResumenHoras({ periodo: btn.dataset.periodo, soloConHoras }))
  );
  document.getElementById('btn-rh-filtro').addEventListener('click', () =>
    renderResumenHoras({ periodo, soloConHoras: !soloConHoras })
  );
  document.getElementById('btn-rh-refresh').addEventListener('click', () =>
    renderResumenHoras({ periodo, soloConHoras })
  );
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
