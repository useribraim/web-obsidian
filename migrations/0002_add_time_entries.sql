CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  stopped_at TEXT
);
CREATE INDEX IF NOT EXISTS time_entries_started_at ON time_entries (started_at);
