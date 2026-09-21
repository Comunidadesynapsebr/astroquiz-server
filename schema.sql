CREATE TABLE IF NOT EXISTS players (
  player_id VARCHAR(128) PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  unlocked TEXT NOT NULL DEFAULT 'p0|p1',
  lives INTEGER NOT NULL DEFAULT 0 CHECK (lives >= 0),
  time_bonus_secs INTEGER NOT NULL DEFAULT 0 CHECK (time_bonus_secs >= 0 AND time_bonus_secs <= 60),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id UUID PRIMARY KEY,
  player_id VARCHAR(128) NOT NULL REFERENCES players(player_id),
  category VARCHAR(16) NOT NULL,
  stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 10),
  hard_mode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS answers (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(run_id),
  question_id INTEGER NOT NULL,
  answer_index INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  correct BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(run_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_runs_player ON runs(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answers_run ON answers(run_id);
