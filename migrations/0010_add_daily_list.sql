CREATE TABLE IF NOT EXISTS daily_list (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  items TEXT NOT NULL DEFAULT '[]',
  done TEXT NOT NULL DEFAULT '[]',
  done_on TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
