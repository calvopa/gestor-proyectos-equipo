(() => {
  const fab      = document.getElementById('sofia-fab');
  const panel    = document.getElementById('sofia-panel');
  const input    = document.getElementById('sofia-input');
  const sendBtn  = document.getElementById('sofia-send');
  const msgs     = document.getElementById('sofia-messages');
  const closeBtn = document.getElementById('sofia-close');
  const clearBtn = document.getElementById('sofia-clear');
  const statusDot = document.getElementById('sofia-status-indicator');
  const statusTxt = document.getElementById('sofia-status-text');
  const toolbar  = document.getElementById('sofia-toolbar');
  const fileInput = document.getElementById('sofia-file-input');
  const contextBar = document.getElementById('sofia-context-bar');

  let sessionId = `session:${Date.now()}`;
  let open = false;
  let busy = false;
  let pendingContexts = []; // [{label, content}]

  // ── Status ───────────────────────────────────────────────
  function setStatus(online) {
    statusDot.className = `sofia-dot ${online ? 'sofia-dot-green' : 'sofia-dot-red'}`;
    statusTxt.textContent = online ? 'En línea' : 'Sin conexión';
  }
  async function checkStatus() {
    try { setStatus((await api.sofiaStatus()).online); } catch { setStatus(false); }
  }
  checkStatus();
  setInterval(checkStatus, 30000);

  // ── Toggle panel ─────────────────────────────────────────
  fab.addEventListener('click', () => {
    open = !open;
    panel.classList.toggle('sofia-panel-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    if (open) input.focus();
  });
  closeBtn.addEventListener('click', () => {
    open = false;
    panel.classList.remove('sofia-panel-open');
    panel.setAttribute('aria-hidden', 'true');
  });

  // ── Clear session ─────────────────────────────────────────
  clearBtn.addEventListener('click', async () => {
    if (sessionId) await api.sofiaClear(sessionId).catch(() => {});
    sessionId = `session:${Date.now()}`;
    pendingContexts = [];
    renderContextBar();
    msgs.innerHTML = `<div class="sofia-msg sofia-msg-bot">
      <span class="sofia-msg-text">Conversación nueva. ¿En qué te ayudo?</span>
    </div>`;
  });

  // ── Context bar ───────────────────────────────────────────
  function renderContextBar() {
    contextBar.innerHTML = '';
    if (!pendingContexts.length) { contextBar.style.display = 'none'; return; }
    contextBar.style.display = 'flex';
    pendingContexts.forEach((ctx, i) => {
      const chip = document.createElement('div');
      chip.className = 'sofia-ctx-chip';
      chip.innerHTML = `<span>${ctx.label}</span><button data-i="${i}" title="Quitar">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        pendingContexts.splice(i, 1);
        renderContextBar();
      });
      contextBar.appendChild(chip);
    });
  }

  // ── 📊 Proyectos ──────────────────────────────────────────
  document.getElementById('sofia-btn-projects').addEventListener('click', async () => {
    if (pendingContexts.find(c => c.label === '📊 Proyectos')) return;
    const btn = document.getElementById('sofia-btn-projects');
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const { context } = await api.sofiaProjects();
      pendingContexts.push({ label: '📊 Proyectos', content: context });
      renderContextBar();
    } catch {
      addMessage('No se pudo cargar el contexto de proyectos.', 'bot sofia-msg-error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📊';
    }
  });

  // ── 📎 Adjuntar archivo ───────────────────────────────────
  document.getElementById('sofia-btn-attach').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';

    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      addMessage('El archivo supera el límite de 5 MB.', 'bot sofia-msg-error');
      return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    const isText = file.type.startsWith('text/') ||
      ['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml'].some(e => file.name.endsWith(e));

    addMessage(`Procesando ${file.name}...`, 'bot');

    try {
      let text;
      if (isPdf) {
        const data = await readAsBase64(file);
        const result = await api.sofiaParseFile(file.name, file.type, data);
        text = result.text;
      } else if (isText) {
        text = await readAsText(file);
        text = text.slice(0, 8000);
      } else {
        addMessage(`Formato no soportado. Usá: PDF, TXT, MD, CSV, JSON.`, 'bot sofia-msg-error');
        return;
      }

      const label = `📎 ${file.name}`;
      pendingContexts.push({ label, content: `Contenido del archivo "${file.name}":\n${text}` });
      renderContextBar();
      msgs.lastChild?.remove(); // remove "procesando" message
      addMessage(`"${file.name}" adjunto. Ahora preguntale algo sobre este documento.`, 'bot');
    } catch (e) {
      msgs.lastChild?.remove();
      addMessage(`Error al procesar "${file.name}": ${e.message}`, 'bot sofia-msg-error');
    }
  });

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  // ── Auto-resize textarea ──────────────────────────────────
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener('click', sendMessage);

  // ── WhatsApp marker parser ────────────────────────────────
  const WA_RE = /\[WA:([+\d]+):(.+?)\]$/ms;

  function parseWaMarker(text) {
    const m = text.match(WA_RE);
    if (!m) return { clean: text, wa: null };
    return {
      clean: text.replace(WA_RE, '').trimEnd(),
      wa: { to: m[1].trim(), message: m[2].trim() },
    };
  }

  function addWaConfirm(to, message) {
    const div = document.createElement('div');
    div.className = 'sofia-msg sofia-msg-bot sofia-wa-confirm';
    div.innerHTML = `
      <span class="sofia-msg-text">
        📱 <strong>WhatsApp listo para enviar</strong><br>
        <small>Para: ${to}</small><br>
        <em>${message.slice(0, 120)}${message.length > 120 ? '…' : ''}</em>
      </span>
      <button class="sofia-wa-btn sofia-wa-send">Enviar ✓</button>
      <button class="sofia-wa-btn sofia-wa-cancel">Cancelar</button>`;
    div.querySelector('.sofia-wa-send').addEventListener('click', async () => {
      div.querySelector('.sofia-wa-send').disabled = true;
      div.querySelector('.sofia-wa-cancel').disabled = true;
      try {
        await api.sofiaWhatsappSend(to, message);
        div.querySelector('.sofia-msg-text').innerHTML += '<br><strong>✅ Enviado</strong>';
      } catch (e) {
        div.querySelector('.sofia-msg-text').innerHTML += `<br><strong>❌ Error: ${e.message}</strong>`;
      }
      div.querySelector('.sofia-wa-send').remove();
      div.querySelector('.sofia-wa-cancel')?.remove();
    });
    div.querySelector('.sofia-wa-cancel').addEventListener('click', () => div.remove());
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── Message bubbles ───────────────────────────────────────
  function addMessage(text, role) {
    const div = document.createElement('div');
    div.className = `sofia-msg sofia-msg-${role}`;
    const span = document.createElement('span');
    span.className = 'sofia-msg-text';
    span.textContent = text;
    div.appendChild(span);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'sofia-msg sofia-msg-bot sofia-msg-typing';
    div.innerHTML = '<span class="sofia-msg-text"><span class="sofia-typing"><span></span><span></span><span></span></span></span>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  // ── Send ──────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || busy) return;

    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    const contexts = pendingContexts.map(c => c.content);
    pendingContexts = [];
    renderContextBar();

    addMessage(text, 'user');
    const typing = addTyping();

    try {
      const res = await api.sofiaChat(text, sessionId, contexts.length ? contexts : undefined);
      typing.remove();
      if (res.sessionKey) sessionId = res.sessionKey;
      const { clean, wa } = parseWaMarker(res.text || '');
      if (clean) addMessage(clean, 'bot');
      if (wa) addWaConfirm(wa.to, wa.message);
    } catch {
      typing.remove();
      addMessage('Error al comunicarme con Sofia. Verificá la conexión.', 'bot sofia-msg-error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
})();
