const { runSync } = require('./clickup');
const openclaw  = require('./openclaw');
const telegram  = require('./telegram');

let syncTimer   = null;
let dailyTimer  = null;
let botPolling  = false;

// ── ClickUp sync loop ─────────────────────────────────────
function start() {
  const minutes = parseInt(process.env.SYNC_INTERVAL_MIN || '30', 10);
  if (minutes > 0) {
    syncTimer = setInterval(async () => {
      console.log('[scheduler] running ClickUp sync...');
      const result = await runSync();
      console.log('[scheduler] sync result:', JSON.stringify(result));
    }, minutes * 60 * 1000);
    console.log(`[scheduler] auto-sync every ${minutes} min`);
  }

  scheduleDailyAi();
  startBotPolling();
}

function stop() {
  if (syncTimer)  { clearInterval(syncTimer);  syncTimer  = null; }
  if (dailyTimer) { clearTimeout(dailyTimer);  dailyTimer = null; }
  botPolling = false;
}

// ── Daily AI summary at 9 AM ──────────────────────────────
function msUntilNext9AM() {
  const now  = new Date();
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function scheduleDailyAi() {
  const ms = msUntilNext9AM();
  const hh = Math.round(ms / 3600000 * 10) / 10;
  console.log(`[scheduler] daily AI summaries scheduled in ${hh}h`);
  dailyTimer = setTimeout(async () => {
    await runDailyAiSummaries();
    scheduleDailyAi(); // reschedule next day
  }, ms);
}

async function runDailyAiSummaries() {
  console.log('[scheduler] generating daily AI summaries...');
  const { getDb } = require('../db');
  const db = getDb();

  const projects = db.prepare(`
    SELECT p.*, GROUP_CONCAT(DISTINCT r.nombre) as tecnicos
    FROM projects p
    LEFT JOIN assignments a ON a.project_id = p.id
    LEFT JOIN resources r ON r.id = a.resource_id
    WHERE p.estado IN ('en_curso', 'pausado')
    GROUP BY p.id
  `).all();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let ok = 0, fail = 0;
  const summaries = []; // collect for Telegram

  for (const project of projects) {
    try {
      const events = db.prepare(`
        SELECT actor, detail, event_at FROM weekly_activity
        WHERE project_id = ? AND date(event_at) >= ?
        ORDER BY event_at DESC LIMIT 30
      `).all(project.id, cutoffStr);

      const meta = [
        project.clickup_status ? `Estado: ${project.estado} / ${project.clickup_status}` : `Estado: ${project.estado}`,
        project.prioridad     ? `Prioridad: ${project.prioridad}` : '',
        project.tecnicos      ? `Equipo: ${project.tecnicos}`     : '',
        project.fecha_fin_est ? `Fecha límite: ${project.fecha_fin_est}` : '',
      ].filter(Boolean).join(' | ');

      const lines = events.length
        ? events.map(e => `- ${e.actor || '—'} (${e.event_at.slice(0, 10)}): ${e.detail}`).join('\n')
        : project.last_comment_text
          ? `- ${project.last_comment_by || '—'} (${(project.last_comment_at || '').slice(0, 10)}): ${project.last_comment_text}`
          : null;

      if (!lines) { console.log(`[scheduler] skip "${project.nombre}" — sin actividad`); continue; }

      const prompt = `Solo escribí texto plano como respuesta. No ejecutes herramientas ni acciones. No crees archivos ni tareas.

Completá este formato con la información del proyecto "${project.nombre}" (${meta}):

- Avanzó: [qué avanzó recientemente]
- Pendiente: [qué falta o está bloqueado]
- Consejo: [un riesgo o acción clave para el PM]

Actividad reciente:
${lines}`;

      const raw = await openclaw.query(prompt);
      if (!raw) { fail++; continue; }

      db.prepare('UPDATE projects SET ai_summary=? WHERE id=?').run(raw, project.id);
      const { summary, advice } = openclaw.parseStructured(raw);
      if (summary) summaries.push({ nombre: project.nombre, prioridad: project.prioridad, summary, advice });
      ok++;
      console.log(`[scheduler] AI summary ok: "${project.nombre}"`);
    } catch (e) {
      fail++;
      console.error(`[scheduler] AI summary error "${project.nombre}":`, e.message);
    }
  }

  console.log(`[scheduler] daily AI done — ok:${ok} fail:${fail}`);
  await sendTelegramDigest(summaries);
}

async function sendTelegramDigest(summaries) {
  if (!summaries.length) return;
  try {
    const PRIO = { critica: '🔴', alta: '🟠', media: '🟡', baja: '⚪' };
    const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

    const blocks = summaries.map(s => {
      const icon = PRIO[s.prioridad] || '⚪';
      const adv  = s.advice ? `\n💡 ${escapeHtml(s.advice)}` : '';
      return `${icon} <b>${escapeHtml(s.nombre)}</b>\n${escapeHtml(s.summary)}${adv}`;
    });

    // Split into chunks under 3800 chars
    const header = `📊 <b>Resumen diario GCS</b>\n${date}\n\n`;
    const chunks = [];
    let current = header;
    for (const block of blocks) {
      const candidate = current + (current === header ? '' : '\n\n') + block;
      if (candidate.length > 3800 && current !== header) {
        chunks.push(current);
        current = block;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);

    for (const chunk of chunks) {
      await telegram.sendMessage(chunk);
    }
    console.log(`[scheduler] Telegram digest sent (${chunks.length} mensaje/s, ${summaries.length} proyectos)`);
  } catch (e) {
    console.error('[scheduler] Telegram error:', e.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Telegram bot polling ──────────────────────────────────
async function startBotPolling() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  botPolling = true;
  let offset = 0;
  console.log('[bot] polling started');

  while (botPolling) {
    try {
      const updates = await telegram.getUpdates(offset);
      for (const upd of updates) {
        offset = upd.update_id + 1;
        const msg = upd.message;
        if (!msg?.text) continue;
        await handleBotMessage(msg).catch(e =>
          console.error('[bot] handler error:', e.message)
        );
      }
    } catch (e) {
      if (botPolling) {
        console.error('[bot] poll error:', e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

const PRIO_ICON = { critica: '🔴', alta: '🟠', media: '🟡', baja: '⚪' };
const ESTADO_ICON = { en_curso: '🟢', pausado: '⏸', backlog: '📋', cerrado: '✅' };

async function handleBotMessage(msg) {
  const chatId = msg.chat.id;
  const text   = msg.text.trim();
  const { getDb } = require('../db');
  const db = getDb();

  // /proyectos — lista activos
  if (text === '/proyectos' || text === '/start') {
    const rows = db.prepare(
      "SELECT nombre, estado, prioridad FROM projects WHERE estado IN ('en_curso','pausado') ORDER BY prioridad DESC, nombre"
    ).all();
    const lines = rows.map(p =>
      `${ESTADO_ICON[p.estado]||'·'} ${PRIO_ICON[p.prioridad]||'⚪'} ${escapeHtml(p.nombre)}`
    ).join('\n');
    return telegram.sendMessage(`📋 <b>Proyectos activos (${rows.length})</b>\n\n${lines}`, chatId);
  }

  // /resumen — digest completo
  if (text === '/resumen' || text === '/digest') {
    const rows = db.prepare(
      "SELECT nombre, prioridad, ai_summary FROM projects WHERE estado IN ('en_curso','pausado') AND ai_summary IS NOT NULL ORDER BY prioridad DESC"
    ).all();
    const summaries = rows.map(p => {
      const { summary, advice } = openclaw.parseStructured(p.ai_summary);
      return summary ? { nombre: p.nombre, prioridad: p.prioridad, summary, advice } : null;
    }).filter(Boolean);

    if (!summaries.length) return telegram.sendMessage('Sin resúmenes disponibles. Generá uno desde el Gestor.', chatId);

    const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const blocks = summaries.map(s => {
      const adv = s.advice ? `\n💡 ${escapeHtml(s.advice)}` : '';
      return `${PRIO_ICON[s.prioridad]||'⚪'} <b>${escapeHtml(s.nombre)}</b>\n${escapeHtml(s.summary)}${adv}`;
    });
    const header = `📊 <b>Resumen GCS</b>\n${date}\n\n`;
    const chunks = [];
    let cur = header;
    for (const block of blocks) {
      const next = cur + (cur === header ? '' : '\n\n') + block;
      if (next.length > 3800 && cur !== header) { chunks.push(cur); cur = block; }
      else cur = next;
    }
    if (cur) chunks.push(cur);
    for (const chunk of chunks) await telegram.sendMessage(chunk, chatId);
    return;
  }

  // Búsqueda por nombre de proyecto
  const q = `%${text}%`;
  const matches = db.prepare(
    "SELECT * FROM projects WHERE nombre LIKE ? ORDER BY CASE estado WHEN 'en_curso' THEN 0 WHEN 'pausado' THEN 1 ELSE 2 END LIMIT 3"
  ).all(q);

  if (!matches.length) {
    return telegram.sendMessage(
      `No encontré proyectos con "<b>${escapeHtml(text)}</b>".\n\nUsá /proyectos para ver todos los activos.`,
      chatId
    );
  }

  for (const p of matches) {
    const estadoIcon = ESTADO_ICON[p.estado] || '·';
    const prioIcon   = PRIO_ICON[p.prioridad] || '⚪';
    const vence = p.fecha_fin_est ? `\n📅 Vence: ${p.fecha_fin_est}` : '';
    const equipo = p.tecnicos ? `\n👥 ${escapeHtml(p.tecnicos)}` : '';

    let aiBlock = '';
    if (p.ai_summary) {
      const { summary, advice } = openclaw.parseStructured(p.ai_summary);
      if (summary) aiBlock = `\n\n${escapeHtml(summary)}`;
      if (advice)  aiBlock += `\n💡 ${escapeHtml(advice)}`;
    } else {
      aiBlock = '\n\n<i>Sin análisis IA. Generalo desde el Gestor.</i>';
    }

    const reply =
      `${estadoIcon} ${prioIcon} <b>${escapeHtml(p.nombre)}</b>` +
      `\n${escapeHtml(p.estado)}${p.clickup_status ? ' / ' + escapeHtml(p.clickup_status) : ''}` +
      vence + equipo + aiBlock;

    await telegram.sendMessage(reply, chatId);
  }
}

module.exports = { start, stop };
