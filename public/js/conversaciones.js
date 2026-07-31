// ── Conversaciones de Sofia ────────────────────────────────

const convState = {
  offset: 0,
  limit:  20,
  total:  0,
};

function convFmtDate(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T') + (str.includes('T') ? '' : 'Z'));
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function convPreview(txt, max = 80) {
  if (!txt) return '<span style="color:var(--text2);font-style:italic">Sin mensajes</span>';
  const clean = txt.replace(/\[WA[^\]]*\]/g, '').trim();
  return escHtml(clean.length > max ? clean.slice(0, max) + '…' : clean);
}

// ── Vista principal ────────────────────────────────────────
async function renderConversaciones() {
  convState.offset = 0;
  await convLoadPage();
}

async function convLoadPage() {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="spinner"></div>';

  try {
    const { conversations, total } = await api.sofiaConversations({
      limit:  convState.limit,
      offset: convState.offset,
    });
    convState.total = total;
    convRenderList(main, conversations);
  } catch (e) {
    main.innerHTML = `<div class="empty-state">⚠️ ${escHtml(e.message)}</div>`;
  }
}

function convRenderList(main, conversations) {
  const { offset, limit, total } = convState;
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  main.innerHTML = `
    <div class="conv-header">
      <h1 class="conv-title">💬 Conversaciones con Sofia</h1>
      <span class="conv-total">${total} conversación${total !== 1 ? 'es' : ''}</span>
    </div>

    ${conversations.length === 0 ? `
      <div class="empty-state" style="margin-top:60px">
        Sin conversaciones registradas todavía.<br>
        <span style="color:var(--text2);font-size:13px">Los mensajes enviados a Sofia aparecerán acá.</span>
      </div>` : `
      <div class="conv-table-wrap">
        <table class="conv-table">
          <thead>
            <tr>
              <th>Sesión</th>
              <th>Primer mensaje</th>
              <th>Turnos</th>
              <th>Inicio</th>
              <th>Último</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${conversations.map(c => `
              <tr class="conv-row" data-id="${c.id}">
                <td class="conv-session"><code>${escHtml(c.session_key.slice(0, 16))}…</code></td>
                <td class="conv-preview">${convPreview(c.first_msg)}</td>
                <td class="conv-count">${Math.floor(c.message_count / 2)} turno${c.message_count / 2 !== 1 ? 's' : ''}</td>
                <td class="conv-date">${convFmtDate(c.created_at)}</td>
                <td class="conv-date">${convFmtDate(c.updated_at)}</td>
                <td class="conv-actions">
                  <button class="btn btn-ghost btn-sm conv-delete-btn" data-id="${c.id}" title="Eliminar conversación">🗑</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="conv-pagination">
        <button class="btn btn-ghost btn-sm" id="conv-prev" ${hasPrev ? '' : 'disabled'}>← Anterior</button>
        <span class="conv-page-info">${offset + 1}–${Math.min(offset + limit, total)} de ${total}</span>
        <button class="btn btn-ghost btn-sm" id="conv-next" ${hasNext ? '' : 'disabled'}>Siguiente →</button>
      </div>
    `}

    <!-- Drawer de detalle -->
    <div id="conv-drawer" class="conv-drawer" aria-hidden="true"></div>
    <div id="conv-overlay" class="conv-drawer-overlay" style="display:none"></div>
  `;

  // Paginación
  document.getElementById('conv-prev')?.addEventListener('click', () => {
    convState.offset = Math.max(0, convState.offset - convState.limit);
    convLoadPage();
  });
  document.getElementById('conv-next')?.addEventListener('click', () => {
    convState.offset += convState.limit;
    convLoadPage();
  });

  // Click en fila → abrir detalle
  main.querySelectorAll('.conv-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.conv-delete-btn')) return;
      convOpenDrawer(row.dataset.id);
    });
  });

  // Botones eliminar
  main.querySelectorAll('.conv-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('¿Eliminás esta conversación? No se puede deshacer.')) return;
      try {
        await api.sofiaDeleteConversation(btn.dataset.id);
        toast('Conversación eliminada', 'success');
        convLoadPage();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // Click overlay → cerrar drawer
  document.getElementById('conv-overlay')?.addEventListener('click', convCloseDrawer);
}

// ── Drawer de detalle ──────────────────────────────────────
async function convOpenDrawer(id) {
  const drawer  = document.getElementById('conv-drawer');
  const overlay = document.getElementById('conv-overlay');

  drawer.innerHTML = '<div class="conv-drawer-loading"><div class="spinner"></div></div>';
  drawer.classList.add('open');
  overlay.style.display = 'block';

  try {
    const data = await api.sofiaConversation(id);
    convRenderDrawer(drawer, data);
  } catch (e) {
    drawer.innerHTML = `<div class="conv-drawer-loading">⚠️ ${escHtml(e.message)}</div>`;
  }
}

function convCloseDrawer() {
  const drawer  = document.getElementById('conv-drawer');
  const overlay = document.getElementById('conv-overlay');
  if (drawer)  drawer.classList.remove('open');
  if (overlay) overlay.style.display = 'none';
}

function convRenderDrawer(drawer, data) {
  const msgs = data.messages || [];

  drawer.innerHTML = `
    <div class="conv-drawer-header">
      <div>
        <div class="conv-drawer-title">Conversación</div>
        <div class="conv-drawer-sub">${convFmtDate(data.created_at)} · ${Math.floor(msgs.length / 2)} turno${msgs.length / 2 !== 1 ? 's' : ''}</div>
      </div>
      <button class="sofia-icon-btn" id="conv-drawer-close">✕</button>
    </div>
    <div class="conv-drawer-msgs">
      ${msgs.length === 0
        ? '<div style="color:var(--text2);text-align:center;padding:40px">Sin mensajes</div>'
        : msgs.map(m => `
          <div class="sofia-msg ${m.role === 'user' ? 'sofia-msg-user' : 'sofia-msg-bot'}">
            <span class="sofia-msg-text">${escHtml(m.texto)}</span>
            <span class="conv-msg-time">${convFmtDate(m.created_at)}</span>
          </div>`).join('')
      }
    </div>
    <div class="conv-drawer-footer">
      <button class="btn btn-ghost btn-sm conv-delete-btn" data-id="${data.id}">🗑 Eliminar conversación</button>
    </div>
  `;

  document.getElementById('conv-drawer-close').addEventListener('click', convCloseDrawer);

  drawer.querySelector('.conv-delete-btn')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminás esta conversación?')) return;
    try {
      await api.sofiaDeleteConversation(data.id);
      toast('Conversación eliminada', 'success');
      convCloseDrawer();
      convLoadPage();
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // Scroll al final de los mensajes
  const msgsEl = drawer.querySelector('.conv-drawer-msgs');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ── Registro de ruta ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof routes !== 'undefined') {
    routes['conversaciones'] = renderConversaciones;
  }
});
