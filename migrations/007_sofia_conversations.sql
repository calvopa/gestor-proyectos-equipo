-- Persistencia de conversaciones con Sofia
CREATE TABLE IF NOT EXISTS sofia_conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT    NOT NULL UNIQUE,
  created_at  DATETIME DEFAULT (datetime('now')),
  updated_at  DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sofia_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES sofia_conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK(role IN ('user','bot')),
  texto           TEXT    NOT NULL,
  created_at      DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sofia_msgs_conv ON sofia_messages(conversation_id, created_at);
