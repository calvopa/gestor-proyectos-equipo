const { getDb } = require('../db');

const BASE = 'https://api.clickup.com/api/v2';

function getToken() {
  const db = getDb();
  const row = db.prepare("SELECT valor FROM settings WHERE clave='clickup_token'").get();
  return row?.valor || process.env.CLICKUP_TOKEN || null;
}

function getTeamId() {
  const db = getDb();
  const row = db.prepare("SELECT valor FROM settings WHERE clave='clickup_team_id'").get();
  return row?.valor || process.env.CLICKUP_TEAM_ID || null;
}

function getMappingLevel() {
  const db = getDb();
  const row = db.prepare("SELECT valor FROM settings WHERE clave='clickup_mapping_level'").get();
  return row?.valor || 'list'; // 'list' | 'folder'
}

async function apiFetch(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: token, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`ClickUp API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function syncProjects(token, teamId, mappingLevel) {
  const db = getDb();
  const spaces = await apiFetch(`/team/${teamId}/space?archived=false`, token);
  const items = [];

  for (const space of spaces.spaces || []) {
    if (mappingLevel === 'folder') {
      const foldersData = await apiFetch(`/space/${space.id}/folder?archived=false`, token);
      for (const folder of foldersData.folders || []) {
        items.push({ clickup_id: `folder_${folder.id}`, nombre: folder.name, descripcion: null });
      }
    } else {
      const listsData = await apiFetch(`/space/${space.id}/list?archived=false`, token);
      for (const list of listsData.lists || []) {
        items.push({ clickup_id: `list_${list.id}`, nombre: list.name, descripcion: list.content || null });
      }
      const foldersData = await apiFetch(`/space/${space.id}/folder?archived=false`, token);
      for (const folder of foldersData.folders || []) {
        const flData = await apiFetch(`/folder/${folder.id}/list?archived=false`, token);
        for (const list of flData.lists || []) {
          items.push({ clickup_id: `list_${list.id}`, nombre: list.name, descripcion: list.content || null });
        }
      }
    }
  }

  const upsert = db.prepare(`
    INSERT INTO projects (nombre, descripcion, clickup_id, updated_at)
    VALUES (@nombre, @descripcion, @clickup_id, datetime('now'))
    ON CONFLICT(clickup_id) DO UPDATE SET
      nombre=excluded.nombre,
      descripcion=excluded.descripcion,
      updated_at=datetime('now')
  `);

  let inserted = 0, updated = 0;
  const upsertMany = db.transaction((rows) => {
    for (const row of rows) {
      const existing = db.prepare('SELECT id FROM projects WHERE clickup_id=?').get(row.clickup_id);
      upsert.run(row);
      if (existing) updated++; else inserted++;
    }
  });
  upsertMany(items);

  return { projects: { inserted, updated, total: items.length } };
}

async function syncMembers(token, teamId) {
  const db = getDb();
  const data = await apiFetch(`/team/${teamId}`, token);
  const members = data.team?.members || [];

  const upsert = db.prepare(`
    INSERT INTO resources (nombre, email, clickup_member_id)
    VALUES (@nombre, @email, @clickup_member_id)
    ON CONFLICT(clickup_member_id) DO UPDATE SET
      nombre=excluded.nombre,
      email=excluded.email
  `);

  let inserted = 0, updated = 0;
  const upsertMany = db.transaction((rows) => {
    for (const row of rows) {
      const existing = db.prepare('SELECT id FROM resources WHERE clickup_member_id=?').get(row.clickup_member_id);
      upsert.run(row);
      if (existing) updated++; else inserted++;
    }
  });

  const rows = members.map(m => ({
    nombre: m.user.username || m.user.email,
    email: m.user.email,
    clickup_member_id: String(m.user.id)
  }));
  upsertMany(rows);

  return { resources: { inserted, updated, total: rows.length } };
}

async function runSync() {
  const token = getToken();
  const teamId = getTeamId();

  if (!token || !teamId) {
    return { ok: false, error: 'ClickUp token o team_id no configurado' };
  }

  try {
    const mappingLevel = getMappingLevel();
    const projectsResult = await syncProjects(token, teamId, mappingLevel);
    const membersResult = await syncMembers(token, teamId);
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (clave,valor) VALUES ('last_sync',?)").run(new Date().toISOString());
    return { ok: true, ...projectsResult, ...membersResult, synced_at: new Date().toISOString() };
  } catch (err) {
    console.error('[clickup sync error]', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { runSync, getToken };
