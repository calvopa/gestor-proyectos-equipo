CREATE TABLE IF NOT EXISTS weekly_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start  DATE    NOT NULL,
  event_type  TEXT    NOT NULL DEFAULT 'comment'
              CHECK(event_type IN ('comment','status','date','assignee','other')),
  event_at    DATETIME NOT NULL,
  actor       TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start     DATE    NOT NULL,
  salud          TEXT,
  fase           TEXT,
  prioridad      TEXT,
  tecnicos       TEXT,
  event_count    INTEGER DEFAULT 0,
  dias_inactivo  INTEGER,
  fecha_fin_est  DATE,
  ai_summary     TEXT,
  created_at     DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_wa_proj_week ON weekly_activity(project_id, week_start);
CREATE INDEX IF NOT EXISTS idx_ws_week      ON weekly_snapshots(week_start);
