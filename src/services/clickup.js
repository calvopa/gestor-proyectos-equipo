const { getDb } = require('../db');

const BASE = 'https://api.clickup.com/api/v2';

// Status mapping ClickUp → gestor
const STATUS_MAP = {
  'proyectos por comenzar': 'backlog',
  'proyectos/ideas':        'backlog',
  'proyectos/ideas ':       'backlog',
  'proyectos en curso':     'en_curso',
  'en desarrollo':          'en_curso',
  'qa - cliente':           'en_curso',
  'productivo':             'en_curso',
  'pendiente por terceros': 'pausado',
  'finalizado':             'cerrado',
};

const PRIORITY_MAP = {
  urgent: 'critica',
  high:   'alta',
  normal: 'media',
  low:    'baja',
};

function mapStatus(cuStatus) {
  const s = (cuStatus || '').toLowerCase().trim();
  return STATUS_MAP[s] || 'backlog';
}

function mapPriority(cuPriority) {
  const p = (cuPriority?.priority || 'normal').toLowerCase();
  return PRIORITY_MAP[p] || 'media';
}

function getDb_() { return getDb(); }

function getSetting(key) {
  const db = getDb_();
  const row = db.prepare('SELECT valor FROM settings WHERE clave=?').get(key);
  return row?.valor || null;
}

function getToken()  { return getSetting('clickup_token')  || process.env.CLICKUP_TOKEN  || null; }
function getTeamId() { return getSetting('clickup_team_id') || process.env.CLICKUP_TEAM_ID || null; }

// Lista(s) de ClickUp cuyos tasks se importan como proyectos
// Puede ser un solo ID o varios separados por coma
function getProjectListIds() {
  const stored = getSetting('clickup_project_list_ids');
  if (stored) return stored.split(',').map(s => s.trim()).filter(Boolean);
  // Default: lista GCS en el folder Proyectos
  return ['901324500391'];
}

async function apiFetch(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: token, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`ClickUp API ${res.status}: ${path}`);
  return res.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchLastComment(taskId, token) {
  try {
    // reverse=true → ClickUp devuelve el comentario más reciente primero
    const data = await apiFetch(`/task/${taskId}/comment?reverse=true`, token);
    const comments = data.comments || [];
    if (!comments.length) return null;
    const last = comments[0];
    return {
      text: last.comment_text || '',
      by:   last.user?.username || last.user?.email || '',
      at:   last.date ? new Date(parseInt(last.date)).toISOString().replace('T',' ').replace(/\.\d+Z$/,'') : null,
    };
  } catch {
    return null;
  }
}

async function fetchAllTasks(listId, token) {
  const tasks = [];
  let page = 0;
  while (true) {
    const data = await apiFetch(
      `/list/${listId}/task?archived=false&include_closed=true&page=${page}&subtasks=false`,
      token
    );
    const batch = data.tasks || [];
    tasks.push(...batch);
    if (!data.last_page && batch.length === 100) {
      page++;
      await sleep(200);
    } else break;
  }
  return tasks;
}

async function syncProjects(token) {
  const db = getDb_();
  const listIds = getProjectListIds();

  const upsert = db.prepare(`
    INSERT INTO projects
      (nombre, descripcion, estado, prioridad, clickup_id, clickup_status,
       last_comment_text, last_comment_by, last_comment_at, updated_at)
    VALUES
      (@nombre, @descripcion, @estado, @prioridad, @clickup_id, @clickup_status,
       @last_comment_text, @last_comment_by, @last_comment_at, datetime('now'))
    ON CONFLICT(clickup_id) DO UPDATE SET
      nombre            = excluded.nombre,
      descripcion       = excluded.descripcion,
      estado            = excluded.estado,
      prioridad         = excluded.prioridad,
      clickup_status    = excluded.clickup_status,
      last_comment_text = excluded.last_comment_text,
      last_comment_by   = excluded.last_comment_by,
      last_comment_at   = excluded.last_comment_at,
      updated_at        = datetime('now')
  `);

  let inserted = 0, updated = 0, commentsUpdated = 0;

  for (const listId of listIds) {
    console.log(`[clickup] fetching tasks from list ${listId}...`);
    const tasks = await fetchAllTasks(listId, token);
    console.log(`[clickup] ${tasks.length} tasks found`);

    for (const t of tasks) {
      const cuStatus = t.status?.status || '';
      const estado   = mapStatus(cuStatus);
      const prioridad = mapPriority(t.priority);

      // Fecha de vencimiento
      const fecha_fin_est = t.due_date
        ? new Date(parseInt(t.due_date)).toISOString().slice(0, 10)
        : null;
      const fecha_inicio = t.start_date
        ? new Date(parseInt(t.start_date)).toISOString().slice(0, 10)
        : null;

      // Descripción desde el texto de la tarea
      const descripcion = t.description || t.text_content || null;

      // Último comentario (reverse=true garantiza el más reciente primero)
      let comment = null;
      try {
        comment = await fetchLastComment(t.id, token);
        await sleep(80); // respetar rate limit
      } catch {}

      const existing = db.prepare('SELECT id, last_comment_at FROM projects WHERE clickup_id=?').get(t.id);

      const row = {
        nombre:            t.name,
        descripcion:       descripcion,
        estado:            estado,
        prioridad:         prioridad,
        clickup_id:        t.id,
        clickup_status:    cuStatus,
        last_comment_text: comment?.text || null,
        last_comment_by:   comment?.by   || null,
        last_comment_at:   comment?.at   || null,
      };

      upsert.run(row);

      // Siempre sincronizar fechas desde ClickUp (si ClickUp las tiene)
      if (fecha_inicio !== null || fecha_fin_est !== null) {
        db.prepare('UPDATE projects SET fecha_inicio=?, fecha_fin_est=? WHERE clickup_id=?')
          .run(fecha_inicio, fecha_fin_est, t.id);
      }

      if (comment?.at && comment.at !== existing?.last_comment_at) commentsUpdated++;
      if (existing) updated++; else inserted++;
    }

    // Asignar recursos: si el task tiene assignees, buscar por clickup_member_id y crear assignment
    for (const t of tasks) {
      const project = db.prepare('SELECT id FROM projects WHERE clickup_id=?').get(t.id);
      if (!project) continue;
      for (const assignee of (t.assignees || [])) {
        const resource = db.prepare('SELECT id FROM resources WHERE clickup_member_id=?').get(String(assignee.id));
        if (!resource) continue;
        db.prepare(`
          INSERT OR IGNORE INTO assignments (project_id, resource_id)
          VALUES (?, ?)
        `).run(project.id, resource.id);
      }
    }
  }

  console.log(`[clickup] comentarios actualizados: ${commentsUpdated}/${inserted + updated}`);
  return { inserted, updated, commentsUpdated, total: inserted + updated };
}

async function syncMembers(token, teamId) {
  const db = getDb_();
  const data = await apiFetch(`/team/${teamId}`, token);
  const members = data.team?.members || [];

  const upsert = db.prepare(`
    INSERT INTO resources (nombre, email, clickup_member_id)
    VALUES (@nombre, @email, @clickup_member_id)
    ON CONFLICT(clickup_member_id) DO UPDATE SET
      nombre = excluded.nombre,
      email  = excluded.email
  `);

  let inserted = 0, updated = 0;
  for (const m of members) {
    const existing = db.prepare('SELECT id FROM resources WHERE clickup_member_id=?').get(String(m.user.id));
    upsert.run({
      nombre:            m.user.username || m.user.email,
      email:             m.user.email,
      clickup_member_id: String(m.user.id),
    });
    if (existing) updated++; else inserted++;
  }

  return { inserted, updated, total: members.length };
}

async function runSync() {
  const token  = getToken();
  const teamId = getTeamId();

  if (!token || !teamId) {
    return { ok: false, error: 'ClickUp token o team_id no configurado' };
  }

  try {
    console.log('[clickup] starting sync...');
    const membersResult  = await syncMembers(token, teamId);
    const projectsResult = await syncProjects(token);

    const db = getDb_();
    db.prepare("INSERT OR REPLACE INTO settings (clave,valor) VALUES ('last_sync',?)").run(new Date().toISOString());

    console.log(`[clickup] sync complete — proyectos: +${projectsResult.inserted} creados / ${projectsResult.updated} actualizados / ${projectsResult.commentsUpdated} comentarios nuevos | recursos: +${membersResult.inserted} / ${membersResult.updated}`);
    return {
      ok: true,
      projects: projectsResult,
      resources: membersResult,
      synced_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[clickup sync error]', err.message);
    return { ok: false, error: err.message };
  }
}

async function fetchWeekActivity(db, fromStr, toStr, token) {
  const fromMs = new Date(fromStr + 'T00:00:00Z').getTime();
  const toMs   = new Date(toStr   + 'T23:59:59Z').getTime();

  const projects = db.prepare(
    'SELECT id, clickup_id FROM projects WHERE clickup_id IS NOT NULL'
  ).all();

  db.prepare('DELETE FROM weekly_activity WHERE week_start=?').run(fromStr);

  const insert = db.prepare(`
    INSERT INTO weekly_activity (project_id, week_start, event_type, event_at, actor, detail)
    VALUES (@project_id, @week_start, @event_type, @event_at, @actor, @detail)
  `);

  for (const p of projects) {
    try {
      const data = await apiFetch(`/task/${p.clickup_id}/comment`, token);
      const comments = data.comments || [];
      for (const c of comments) {
        const ts = parseInt(c.date, 10);
        if (isNaN(ts) || ts < fromMs || ts > toMs) continue;
        const text = (c.comment_text || '').trim();
        if (!text) continue;
        insert.run({
          project_id: p.id,
          week_start: fromStr,
          event_type: 'comment',
          event_at:   new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
          actor:      c.user?.username || c.user?.email || 'Desconocido',
          detail:     text.length > 400 ? text.slice(0, 397) + '...' : text,
        });
      }
      await sleep(120);
    } catch (err) {
      console.error(`[semana] comments for ${p.clickup_id}:`, err.message);
    }
  }
  console.log(`[semana] fetchWeekActivity done for ${fromStr}`);
}

module.exports = { runSync, getToken, fetchWeekActivity };
