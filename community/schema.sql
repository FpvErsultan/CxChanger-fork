CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL,
  model_key TEXT,
  model_size INTEGER NOT NULL,
  model_uploaded INTEGER NOT NULL DEFAULT 0,
  image_name TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  image_size INTEGER NOT NULL DEFAULT 0,
  image_type TEXT NOT NULL DEFAULT '',
  image_expected INTEGER NOT NULL DEFAULT 0,
  image_uploaded INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'pending', 'approved', 'rejected')),
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_models_public ON models(status, votes DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_upload_cleanup ON models(status, created_at);
CREATE TABLE IF NOT EXISTS votes (
  model_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (model_id, voter_id)
);
