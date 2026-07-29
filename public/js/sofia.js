(() => {
  const fab     = document.getElementById('sofia-fab');
  const panel   = document.getElementById('sofia-panel');
  const input   = document.getElementById('sofia-input');
  const sendBtn = document.getElementById('sofia-send');
  const msgs    = document.getElementById('sofia-messages');
  const closeBtn  = document.getElementById('sofia-close');
  const clearBtn  = document.getElementById('sofia-clear');
  const statusDot = document.getElementById('sofia-status-indicator');
  const statusTxt = document.getElementById('sofia-status-text');

  let sessionId = null;
  let open = false;
  let busy = false;

  // ── Status check ────────────────────────────────────────
  function setStatus(online) {
    statusDot.className = `sofia-dot ${online ? 'sofia-dot-green' : 'sofia-dot-red'}`;
    statusTxt.textContent = online ? 'En línea' : 'Sin conexión';
  }

  async function checkStatus() {
    try {
      const r = await api.sofiaStatus();
      setStatus(r.online);
    } catch {
      setStatus(false);
    }
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
    sessionId = `agent:main:gestor:${Date.now()}`;
    msgs.innerHTML = `<div class="sofia-msg sofia-msg-bot">
      <span class="sofia-msg-text">Conversación nueva. ¿En qué te ayudo?</span>
    </div>`;
  });

  // ── Auto-resize textarea ──────────────────────────────────
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ── Add message bubble ────────────────────────────────────
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

    addMessage(text, 'user');
    const typing = addTyping();

    try {
      const res = await api.sofiaChat(text, sessionId);
      typing.remove();
      if (res.sessionKey) sessionId = res.sessionKey;
      addMessage(res.text || '(sin respuesta)', 'bot');
    } catch (e) {
      typing.remove();
      addMessage('Error al comunicarme con Sofia. Verificá la conexión.', 'bot sofia-msg-error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
})();
