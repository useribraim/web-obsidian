CREATE TABLE IF NOT EXISTS roadmap_progress (
  problem_id TEXT PRIMARY KEY,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at TEXT NOT NULL
);
