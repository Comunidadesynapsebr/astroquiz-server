CREATE TABLE IF NOT EXISTS players (
  player_id VARCHAR(128) PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0 AND coins <= 999999),
  unlocked TEXT NOT NULL DEFAULT 'p0|p1',
  lives INTEGER NOT NULL DEFAULT 0 CHECK (lives >= 0 AND lives <= 99),
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
  question_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at BIGINT NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS answers (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(run_id),
  question_id INTEGER NOT NULL,
  answer_index INTEGER NOT NULL CHECK (answer_index BETWEEN -1 AND 7),
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms BETWEEN 0 AND 60000),
  correct BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(run_id, question_id)
);

CREATE TABLE IF NOT EXISTS request_receipts (
  request_id UUID PRIMARY KEY,
  player_id VARCHAR(128) NOT NULL REFERENCES players(player_id),
  route VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('processing', 'completed')),
  response_status INTEGER,
  response_json JSONB,
  created_at BIGINT NOT NULL,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_runs_player ON runs(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answers_run ON answers(run_id);
CREATE INDEX IF NOT EXISTS idx_receipts_player ON request_receipts(player_id, created_at DESC);

-- Migration helpers for an existing AstroQuiz database:
ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_coins_check;
ALTER TABLE players
  ADD CONSTRAINT players_coins_check CHECK (coins >= 0 AND coins <= 999999);

ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_lives_check;
ALTER TABLE players
  ADD CONSTRAINT players_lives_check CHECK (lives >= 0 AND lives <= 99);

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS question_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE answers
  DROP CONSTRAINT IF EXISTS answers_answer_index_check;
ALTER TABLE answers
  ADD CONSTRAINT answers_answer_index_check CHECK (answer_index BETWEEN -1 AND 7);

ALTER TABLE answers
  DROP CONSTRAINT IF EXISTS answers_elapsed_ms_check;
ALTER TABLE answers
  ADD CONSTRAINT answers_elapsed_ms_check CHECK (elapsed_ms BETWEEN 0 AND 60000);
