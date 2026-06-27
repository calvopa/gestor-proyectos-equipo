CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT    NOT NULL,
  descripcion   TEXT,
  estado        TEXT    NOT NULL DEFAULT 'backlog'
                CHECK(estado IN ('backlog','en_curso','pausado','cerrado')),
  prioridad     TEXT    NOT NULL DEFAULT 'media'
                CHECK(prioridad IN ('baja','media','alta','critica')),
  fecha_inicio  DATE,
  fecha_fin_est DATE,
  clickup_id    TEXT    UNIQUE,
  cuenta_horas  INTEGER NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at    DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre            TEXT    NOT NULL,
  rol               TEXT,
  email             TEXT    UNIQUE,
  clickup_member_id TEXT    UNIQUE,
  activo            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id     INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  rol_en_proyecto TEXT,
  dedicacion_pct  INTEGER,
  UNIQUE(project_id, resource_id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id  INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL CHECK(tipo IN ('timer','manual')),
  inicio       DATETIME NOT NULL,
  fin          DATETIME,
  duracion_seg INTEGER,
  nota         TEXT,
  created_at   DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE INDEX IF NOT EXISTS idx_te_project  ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_te_resource ON time_entries(resource_id);
CREATE INDEX IF NOT EXISTS idx_asgn_proj   ON assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_asgn_res    ON assignments(resource_id);
