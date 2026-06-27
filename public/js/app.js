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
  'projects':       renderProjects,
  'kanban':         renderKanban,
  'project-detail': renderProjectDetail,
  'resources':      renderResources,
  'carga':          renderCarga,
  'settings':       renderSettings,
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

// ── Nav / Sync status ──────────────────────────────────────
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

// ── ① Projects table ──────────────────────────────────────
async function renderProjects({ search = '', estado = '', prioridad = '', sort = 'updated_at', dir = 'desc', soloRiesgo = false } = {}) {
  const main = document.getElementById('main-content');
  let projects = await api.getProjects({ search, estado, prioridad, sort, dir });

  // Filtro de riesgo client-side
  if (soloRiesgo) {
    projects = projects.filter(p => ['red','yellow'].includes(calcSalud(p).level));
  }

  // Contadores para el header
  const enRiesgo  = projects.filter(p => calcSalud(p).level === 'red').length;
  const atencion  = projects.filter(p => calcSalud(p).level === 'yellow').length;

  const sortCols = [
    ['nombre','Nombre'],['estado','Estado'],['prioridad','Prioridad'],['fecha_fin_est','Vence']
  ];

  main.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <h1>Proyectos <span style="color:var(--text2);font-size:14px;font-weight:400">${projects.length}</span></h1>
        ${enRiesgo  ? `<span class="alerta-pill alerta-red">🔴 ${enRiesgo} en riesgo</span>` : ''}
        ${atencion  ? `<span class="alerta-pill alerta-yellow">🟡 ${atencion} con atención</span>` : ''}
      </div>
      <button class="btn btn-primary" id="btn-new-project">＋ Nuevo proyecto</button>
    </div>
    <div class="filters">
      <input type="text" id="f-search" placeholder="Buscar..." value="${escHtml(search)}" style="flex:2">
      <select id="f-estado">
        <option value="">Todos los estados</option>
        ${['backlog','en_curso','pausado','cerrado'].map(e => `<option value="${e}" ${estado===e?'selected':''}>${e.replace('_',' ')}</option>`).join('')}
      </select>
      <select id="f-prioridad">
        <option value="">Todas las prioridades</option>
        ${['baja','media','alta','critica'].map(p => `<option value="${p}" ${prioridad===p?'selected':''}>${p}</option>`).join('')}
      </select>
      <button class="btn ${soloRiesgo ? 'btn-primary' : 'btn-ghost'} btn-sm" id="f-riesgo" title="Mostrar solo proyectos en riesgo o con atención">
        ⚠ ${soloRiesgo ? 'Todos' : 'En riesgo'}
      </button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:32px" title="Salud del proyecto">●</th>
            ${sortCols.map(([col,label]) =>
              `<th data-col="${col}" data-dir="${sort===col?(dir==='asc'?'desc':'asc'):'asc'}">${label}${sort===col?(dir==='asc'?' ↑':' ↓'):''}</th>`
            ).join('')}
            <th data-sort-dias title="Ordenar por días sin actividad">Sin actividad ↕</th>
            <th>Último comentario</th>
            <th>Horas</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="projects-tbody">
          ${projects.length === 0
            ? `<tr><td colspan="10"><div class="empty"><div class="empty-icon">📋</div><p>${soloRiesgo ? 'Sin proyectos en riesgo 🎉' : 'Sin proyectos todavía'}</p></div></td></tr>`
            : projects.map(p => {
                const salud = calcSalud(p);
                const dias  = diasSinActividad(p);
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
  if (projects.length) {
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

  // Ordenar por días sin actividad (client-side)
  main.querySelector('[data-sort-dias]')?.addEventListener('click', () => {
    const tbody = document.getElementById('projects-tbody');
    const rows  = [...tbody.querySelectorAll('tr[data-id]')];
    let asc = main.querySelector('[data-sort-dias]').dataset.diasDir !== 'asc';
    main.querySelector('[data-sort-dias]').dataset.diasDir = asc ? 'asc' : 'desc';
    main.querySelector('[data-sort-dias]').textContent = `Sin actividad ${asc ? '↑' : '↓'}`;
    rows.sort((a, b) => {
      const da = parseInt(a.querySelector('[data-dias]')?.dataset.dias ?? 9999);
      const db = parseInt(b.querySelector('[data-dias]')?.dataset.dias ?? 9999);
      return asc ? da - db : db - da;
    });
    rows.forEach(r => tbody.appendChild(r));
  });

  // Filtros
  let searchTimer;
  document.getElementById('f-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderProjects({
      search: e.target.value,
      estado: document.getElementById('f-estado').value,
      prioridad: document.getElementById('f-prioridad').value,
      sort, dir, soloRiesgo
    }), 300);
  });
  document.getElementById('f-estado').addEventListener('change', e =>
    renderProjects({ search: document.getElementById('f-search').value, estado: e.target.value, prioridad: document.getElementById('f-prioridad').value, sort, dir, soloRiesgo }));
  document.getElementById('f-prioridad').addEventListener('change', e =>
    renderProjects({ search: document.getElementById('f-search').value, estado: document.getElementById('f-estado').value, prioridad: e.target.value, sort, dir, soloRiesgo }));
  document.getElementById('f-riesgo').addEventListener('click', () =>
    renderProjects({ search: document.getElementById('f-search').value, estado: document.getElementById('f-estado').value, prioridad: document.getElementById('f-prioridad').value, sort, dir, soloRiesgo: !soloRiesgo }));

  main.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => renderProjects({
      search: document.getElementById('f-search').value,
      estado: document.getElementById('f-estado').value,
      prioridad: document.getElementById('f-prioridad').value,
      sort: th.dataset.col, dir: th.dataset.dir, soloRiesgo
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
      renderProjects({ search, estado, prioridad, sort, dir });
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
            ${byCol[col].map(p => `
              <div class="kanban-card" draggable="true" data-id="${p.id}" data-estado="${p.estado}">
                <div class="kanban-card-title">${escHtml(p.nombre)}</div>
                <div class="kanban-card-meta">
                  ${badgePrio(p.prioridad)}
                  ${!p.cuenta_horas ? '<span class="no-cuenta-badge">sin cómputo</span>' : ''}
                </div>
              </div>
            `).join('')}
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
        <div class="label">Horas totales registradas</div>
        <div class="value" id="stat-total">${fmtSec(p.hours?.seg_total)}</div>
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
    });
  }));

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
  });

  navigate('projects');
  updateSyncStatus();
  setInterval(updateSyncStatus, 60000);
});
