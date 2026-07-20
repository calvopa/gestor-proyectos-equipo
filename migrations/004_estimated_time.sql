-- Recreate time_entries: add 'estimado' tipo + source_comment_id
PRAGMA foreign_keys=OFF;

CREATE TABLE time_entries_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id       INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  tipo              TEXT NOT NULL CHECK(tipo IN ('timer','manual','estimado')),
  inicio            DATETIME NOT NULL,
  fin               DATETIME,
  duracion_seg      INTEGER,
  nota              TEXT,
  source_comment_id INTEGER,
  created_at        DATETIME NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO time_entries_new (id, project_id, resource_id, tipo, inicio, fin, duracion_seg, nota, created_at)
SELECT id, project_id, resource_id, tipo, inicio, fin, duracion_seg, nota, created_at FROM time_entries;

DROP TABLE time_entries;
ALTER TABLE time_entries_new RENAME TO time_entries;

CREATE INDEX IF NOT EXISTS idx_te_project  ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_te_resource ON time_entries(resource_id);

PRAGMA foreign_keys=ON;
