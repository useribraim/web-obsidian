CREATE TABLE IF NOT EXISTS roadmap_solves (
  id TEXT PRIMARY KEY,
  problem_key TEXT NOT NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  solved_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS roadmap_solves_problem ON roadmap_solves (problem_key);
