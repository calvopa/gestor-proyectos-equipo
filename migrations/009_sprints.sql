CREATE TABLE IF NOT EXISTS sprints (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL,
  objetivo     TEXT,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'planificado'
               CHECK(estado IN ('planificado','activo','completado')),
  created_at   DATETIME DEFAULT (datetime('now')),
  updated_at   DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprint_projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id  INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estado     TEXT NOT NULL DEFAULT 'pendiente'
             CHECK(estado IN ('pendiente','en_curso','completado')),
  orden      INTEGER DEFAULT 0,
  added_at   DATETIME DEFAULT (datetime('now')),
  UNIQUE(sprint_id, project_id)
);
