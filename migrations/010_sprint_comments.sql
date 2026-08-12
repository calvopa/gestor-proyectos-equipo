CREATE TABLE IF NOT EXISTS sprint_project_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id  INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  comment    TEXT,
  author     TEXT,
  updated_at DATETIME DEFAULT (datetime('now')),
  UNIQUE(sprint_id, project_id)
);
