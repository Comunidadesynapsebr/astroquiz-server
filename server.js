import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASTROQUIZ_CONTRACT,
  CATALOG,
  CATEGORY_IDS,
  FREE_CATEGORIES,
  answerMaxTimeMs,
  comboMultiplier,
  isInteger,
  isPlainObject,
  validateRound,
} from './security/asteios-artenos.mjs';

const { Pool } = pg;
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb', strict: true }));

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/questions.json'), 'utf8'),
);
const QUESTION_MAP = new Map(QUESTIONS.map((q) => [Number(q.id), q]));
const CATEGORY_SET = new Set(CATEGORY_IDS);

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 90;
const ROUND_TTL_MS = 15 * 60 * 1000;
const RECEIPT_STALE_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

function json(res, data, status = 200) {
  return res.status(status).json(data);
}

function secureHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

function playerId(req) {
  const id = String(req.get('x-player-id') || '').trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(id) ? id : null;
}

function requestId(req) {
  const id = String(req.get('x-request-id') || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
    ? id
    : null;
}

function requirePlayer(req, res) {
  const id = playerId(req);
  if (!id) {
    json(res, { error: 'invalid_player' }, 400);
    return null;
  }
  return id;
}

function requireRequestId(req, res) {
  const id = requestId(req);
  if (!id) {
    json(res, { error: 'invalid_request_id' }, 400);
    return null;
  }
  return id;
}

function clientRateKey(req) {
  return playerId(req) || req.ip || 'unknown';
}

function consumeRateLimit(req) {
  const now = Date.now();
  const key = clientRateKey(req);
  const bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }

  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS * 2) {
      rateBuckets.delete(key);
    }
  }
}, RATE_WINDOW_MS * 2).unref();

app.use((req, res, next) => {
  secureHeaders(res);

  if (!consumeRateLimit(req)) {
    res.setHeader('Retry-After', '60');
    return json(res, { error: 'rate_limited' }, 429);
  }

  const configuredOrigin = String(process.env.ALLOWED_ORIGIN || '').trim();
  if (configuredOrigin && req.get('origin') === configuredOrigin) {
    res.setHeader('Access-Control-Allow-Origin', configuredOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Player-Id,X-Request-Id,X-AstroQuiz-Version');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function publicState(row) {
  return {
    player_id: row.player_id,
    coins: Number(row.coins),
    lives: Number(row.lives),
    time_bonus_secs: Number(row.time_bonus_secs),
    best_score: Number(row.best_score),
    unlocked: String(row.unlocked || 'p0|p1'),
  };
}

function releaseContractHeaders(req, res) {
  const requestedVersion = String(req.get('x-astroquiz-version') || '').trim();
  if (requestedVersion !== ASTROQUIZ_CONTRACT.version) {
    return json(res, {
      error: 'unsupported_app_version',
      expected: ASTROQUIZ_CONTRACT.version,
    }, 426);
  }
  return null;
}

async function ensurePlayer(client, id) {
  const now = Date.now();
  await client.query(
    `INSERT INTO players(player_id,created_at,updated_at)
     VALUES($1,$2,$2)
     ON CONFLICT(player_id) DO NOTHING`,
    [id, now],
  );
  const result = await client.query(
    'SELECT * FROM players WHERE player_id=$1',
    [id],
  );
  return result.rows[0];
}

async function getReceipt(client, requestIdValue, playerIdValue, route) {
  const result = await client.query(
    `SELECT request_id, player_id, route, status, response_status, response_json
     FROM request_receipts
     WHERE request_id=$1
     FOR UPDATE`,
    [requestIdValue],
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  if (row.player_id !== playerIdValue || row.route !== route) {
    const error = new Error('idempotency_conflict');
    error.code = 'idempotency_conflict';
    throw error;
  }

  return row;
}

async function beginReceipt(client, requestIdValue, playerIdValue, route) {
  const existing = await getReceipt(client, requestIdValue, playerIdValue, route);
  if (existing) {
    const stale = existing.status === 'processing' &&
      existing.response_json == null &&
      Date.now() - Number(existing.created_at || 0) > RECEIPT_STALE_MS;

    if (stale) {
      await client.query(
        `UPDATE request_receipts
         SET status='processing',response_status=NULL,response_json=NULL,
             created_at=$2,completed_at=NULL
         WHERE request_id=$1`,
        [requestIdValue, Date.now()],
      );
      const refreshed = await getReceipt(client, requestIdValue, playerIdValue, route);
      return { receipt: refreshed, fresh: true };
    }

    return { receipt: existing, fresh: false };
  }

  await client.query(
    `INSERT INTO request_receipts(request_id,player_id,route,status,created_at)
     VALUES($1,$2,$3,'processing',$4)
     ON CONFLICT(request_id) DO NOTHING`,
    [requestIdValue, playerIdValue, route, Date.now()],
  );

  const receipt = await getReceipt(client, requestIdValue, playerIdValue, route);
  return { receipt, fresh: Boolean(receipt?.status === 'processing' &&
    receipt?.response_json == null) };
}

async function finishReceipt(client, requestIdValue, status, body) {
  await client.query(
    `UPDATE request_receipts
       SET status='completed', response_status=$2, response_json=$3::jsonb,
           completed_at=$4
     WHERE request_id=$1`,
    [requestIdValue, status, JSON.stringify(body), Date.now()],
  );
}

function cachedReceiptResponse(res, receipt) {
  if (!receipt || receipt.status !== 'completed' || receipt.response_json == null) {
    return false;
  }
  return json(res, receipt.response_json, Number(receipt.response_status || 200));
}

function serverContract() {
  return {
    version: ASTROQUIZ_CONTRACT.version,
    build: ASTROQUIZ_CONTRACT.build,
    questionsPerRound: ASTROQUIZ_CONTRACT.questionsPerRound,
    rewardPerCorrect: ASTROQUIZ_CONTRACT.rewardPerCorrect,
    maxCoins: ASTROQUIZ_CONTRACT.maxCoins,
  };
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return json(res, { status: 'ok', contract: serverContract() });
  } catch {
    return json(res, { status: 'degraded' }, 503);
  }
});

app.get('/v1/config', (_req, res) => {
  return json(res, {
    contract: serverContract(),
    categories: CATEGORY_IDS,
    freeCategories: FREE_CATEGORIES,
  });
});

app.get('/v1/state', async (req, res) => {
  const versionError = releaseContractHeaders(req, res);
  if (versionError) return versionError;

  const id = requirePlayer(req, res);
  if (!id) return;

  const client = await pool.connect();
  try {
    return json(res, publicState(await ensurePlayer(client, id)));
  } catch (error) {
    console.error(error);
    return json(res, { error: 'server_error' }, 500);
  } finally {
    client.release();
  }
});

app.post('/v1/round/start', async (req, res) => {
  const versionError = releaseContractHeaders(req, res);
  if (versionError) return versionError;

  const id = requirePlayer(req, res);
  if (!id) return;
  const rid = requireRequestId(req, res);
  if (!rid) return;

  const body = req.body;
  if (!isPlainObject(body)) return json(res, { error: 'invalid_round' }, 400);

  const category = body.category;
  const stage = body.stage;
  const hardMode = body.hardMode;

  if (!isSafeCategory(category)) return json(res, { error: 'invalid_category' }, 400);
  if (!isInteger(stage) || stage < 1 || stage > ASTROQUIZ_CONTRACT.maxStage) {
    return json(res, { error: 'invalid_stage' }, 400);
  }
  if (typeof hardMode !== 'boolean') {
    return json(res, { error: 'invalid_hard_mode' }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { receipt, fresh } = await beginReceipt(client, rid, id, '/v1/round/start');
    if (!fresh) {
      if (receipt?.status === 'completed' && receipt.response_json != null) {
        await client.query('COMMIT');
        return json(res, receipt.response_json, Number(receipt.response_status || 200));
      }
      await client.query('ROLLBACK');
      return json(res, { error: 'request_in_progress' }, 409);
    }

    const playerResult = await client.query(
      'SELECT * FROM players WHERE player_id=$1 FOR UPDATE',
      [id],
    );
    const player = playerResult.rows[0] || await ensurePlayer(client, id);

    const unlocked = String(player.unlocked || 'p0|p1').split('|').filter(Boolean);
    if (!unlocked.includes(category)) {
      const response = { error: 'category_locked' };
      await finishReceipt(client, rid, 403, response);
      await client.query('COMMIT');
      return json(res, response, 403);
    }

    const poolForCategory = QUESTIONS.filter((q) => String(q.assetId) === category);
    if (poolForCategory.length < ASTROQUIZ_CONTRACT.questionsPerRound) {
      await client.query('ROLLBACK');
      return json(res, { error: 'question_pool_too_small' }, 503);
    }

    const questions = [...poolForCategory]
      .sort(() => crypto.randomInt(-1_000_000, 1_000_001))
      .slice(0, ASTROQUIZ_CONTRACT.questionsPerRound);

    const runId = crypto.randomUUID();
    const response = {
      runId,
      category,
      stage,
      hardMode,
      questionIds: questions.map((q) => Number(q.id)),
      serverTime: Date.now(),
    };

    await client.query(
      `INSERT INTO runs(
         run_id,player_id,category,stage,hard_mode,question_ids,created_at,closed
       ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,FALSE)`,
      [runId, id, category, stage, hardMode, JSON.stringify(response.questionIds), Date.now()],
    );

    await finishReceipt(client, rid, 200, response);
    await client.query('COMMIT');
    return json(res, response);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === 'idempotency_conflict') {
      return json(res, { error: 'idempotency_conflict' }, 409);
    }
    console.error(error);
    return json(res, { error: 'server_error' }, 500);
  } finally {
    client.release();
  }
});

function isSafeCategory(category) {
  return typeof category === 'string' &&
    category.length <= 16 &&
    CATEGORY_SET.has(category);
}

app.post('/v1/round', async (req, res) => {
  const versionError = releaseContractHeaders(req, res);
  if (versionError) return versionError;

  const id = requirePlayer(req, res);
  if (!id) return;
  const rid = requireRequestId(req, res);
  if (!rid) return;

  if (!isPlainObject(req.body) || typeof req.body.runId !== 'string' || !req.body.runId.trim()) {
    return json(res, { error: 'round_start_required' }, 428);
  }

  const runId = req.body.runId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    return json(res, { error: 'invalid_run_id' }, 400);
  }

  const validation = validateRound(req.body, QUESTION_MAP);
  if (!validation.ok) return json(res, { error: validation.error }, 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { receipt, fresh } = await beginReceipt(client, rid, id, '/v1/round');
    if (!fresh) {
      if (receipt?.status === 'completed' && receipt.response_json != null) {
        await client.query('COMMIT');
        return json(res, receipt.response_json, Number(receipt.response_status || 200));
      }
      await client.query('ROLLBACK');
      return json(res, { error: 'request_in_progress' }, 409);
    }

    const runResult = await client.query(
      `SELECT * FROM runs
       WHERE run_id=$1 AND player_id=$2
       FOR UPDATE`,
      [runId, id],
    );
    if (runResult.rowCount !== 1) {
      const response = { error: 'invalid_run' };
      await finishReceipt(client, rid, 404, response);
      await client.query('COMMIT');
      return json(res, response, 404);
    }

    const run = runResult.rows[0];

    if (Date.now() - Number(run.created_at) > ROUND_TTL_MS) {
      await client.query('UPDATE runs SET closed=TRUE WHERE run_id=$1', [runId]);
      const response = { error: 'run_expired' };
      await finishReceipt(client, rid, 410, response);
      await client.query('COMMIT');
      return json(res, response, 410);
    }

    if (run.closed) {
      const response = { error: 'run_already_closed' };
      await finishReceipt(client, rid, 409, response);
      await client.query('COMMIT');
      return json(res, response, 409);
    }

    if (
      run.category !== validation.category ||
      Number(run.stage) !== validation.stage ||
      Boolean(run.hard_mode) !== validation.hardMode
    ) {
      const response = { error: 'run_contract_mismatch' };
      await finishReceipt(client, rid, 409, response);
      await client.query('COMMIT');
      return json(res, response, 409);
    }

    const expectedIds = new Set(
      Array.isArray(run.question_ids) ? run.question_ids.map(Number) : [],
    );
    if (expectedIds.size !== ASTROQUIZ_CONTRACT.questionsPerRound ||
        validation.answers.length !== ASTROQUIZ_CONTRACT.questionsPerRound) {
      const response = { error: 'invalid_round_size' };
      await finishReceipt(client, rid, 400, response);
      await client.query('COMMIT');
      return json(res, response, 400);
    }

    for (const answer of validation.answers) {
      if (!expectedIds.has(answer.qid)) {
        const response = { error: 'question_not_in_run' };
        await finishReceipt(client, rid, 400, response);
        await client.query('COMMIT');
        return json(res, response, 400);
      }
    }

    const playerResult = await client.query(
      'SELECT * FROM players WHERE player_id=$1 FOR UPDATE',
      [id],
    );
    const player = playerResult.rows[0] || await ensurePlayer(client, id);

    let correct = 0;
    let score = 0;
    let streak = 0;
    const maxTime = answerMaxTimeMs({
      hardMode: validation.hardMode,
      stage: validation.stage,
      playerTimeBonusSecs: Number(player.time_bonus_secs || 0),
    });

    for (const answer of validation.answers) {
      const ok =
        answer.answerIndex >= 0 &&
        answer.answerIndex === Number(answer.question.correta) &&
        answer.elapsedMs <= maxTime;

      if (ok) {
        correct += 1;
        streak += 1;
        score += (validation.hardMode ? ASTROQUIZ_CONTRACT.hardScorePerCorrect
          : ASTROQUIZ_CONTRACT.normalScorePerCorrect) * comboMultiplier(streak);
      } else {
        streak = 0;
      }

      await client.query(
        `INSERT INTO answers(
           run_id,question_id,answer_index,elapsed_ms,correct,created_at
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          runId,
          answer.qid,
          answer.answerIndex,
          answer.elapsedMs,
          ok,
          Date.now(),
        ],
      );
    }

    const reward = Math.min(
      ASTROQUIZ_CONTRACT.maxCoins,
      correct * ASTROQUIZ_CONTRACT.rewardPerCorrect,
    );
    const currentCoins = Number(player.coins);
    const currentBest = Number(player.best_score);
    const newCoins = Math.min(
      ASTROQUIZ_CONTRACT.maxCoins,
      currentCoins + reward,
    );
    const newBest = Math.max(currentBest, score);

    await client.query(
      `UPDATE players
       SET coins=$1,best_score=$2,updated_at=$3
       WHERE player_id=$4`,
      [newCoins, newBest, Date.now(), id],
    );

    await client.query(
      'UPDATE runs SET closed=TRUE WHERE run_id=$1',
      [runId],
    );

    const latest = await client.query(
      'SELECT * FROM players WHERE player_id=$1',
      [id],
    );

    const response = {
      runId,
      score,
      correct,
      total: validation.answers.length,
      coins: Number(latest.rows[0].coins),
      coinsAwarded: reward,
      bestScore: Number(latest.rows[0].best_score),
      lives: Number(latest.rows[0].lives),
      time_bonus_secs: Number(latest.rows[0].time_bonus_secs),
      unlocked: String(latest.rows[0].unlocked || 'p0|p1'),
    };

    await finishReceipt(client, rid, 200, response);
    await client.query('COMMIT');
    return json(res, response);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === 'idempotency_conflict') {
      return json(res, { error: 'idempotency_conflict' }, 409);
    }
    console.error(error);
    return json(res, { error: 'server_error' }, 500);
  } finally {
    client.release();
  }
});

app.post('/v1/life/consume', async (req, res) => {
  const versionError = releaseContractHeaders(req, res);
  if (versionError) return versionError;

  const id = requirePlayer(req, res);
  if (!id) return;
  const rid = requireRequestId(req, res);
  if (!rid) return;

  if (!isPlainObject(req.body) || Object.keys(req.body).length !== 0) {
    return json(res, { error: 'invalid_request_body' }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { receipt, fresh } = await beginReceipt(client, rid, id, '/v1/life/consume');
    if (!fresh) {
      if (receipt?.status === 'completed' && receipt.response_json != null) {
        await client.query('COMMIT');
        return json(res, receipt.response_json, Number(receipt.response_status || 200));
      }
      await client.query('ROLLBACK');
      return json(res, { error: 'request_in_progress' }, 409);
    }

    const playerResult = await client.query(
      'SELECT * FROM players WHERE player_id=$1 FOR UPDATE',
      [id],
    );
    const player = playerResult.rows[0] || await ensurePlayer(client, id);

    if (Number(player.lives) <= 0) {
      const response = { error: 'no_extra_life', state: publicState(player) };
      await finishReceipt(client, rid, 409, response);
      await client.query('COMMIT');
      return json(res, response, 409);
    }

    const updated = await client.query(
      `UPDATE players
       SET lives=lives-1,updated_at=$1
       WHERE player_id=$2
       RETURNING *`,
      [Date.now(), id],
    );

    const response = publicState(updated.rows[0]);
    await finishReceipt(client, rid, 200, response);
    await client.query('COMMIT');
    return json(res, response);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === 'idempotency_conflict') {
      return json(res, { error: 'idempotency_conflict' }, 409);
    }
    console.error(error);
    return json(res, { error: 'server_error' }, 500);
  } finally {
    client.release();
  }
});

app.post('/v1/purchase', async (req, res) => {
  const versionError = releaseContractHeaders(req, res);
  if (versionError) return versionError;

  const id = requirePlayer(req, res);
  if (!id) return;
  const rid = requireRequestId(req, res);
  if (!rid) return;

  if (!isPlainObject(req.body) || Object.keys(req.body).some((key) => key !== 'itemId')) {
    return json(res, { error: 'invalid_purchase_request' }, 400);
  }

  const itemId = req.body.itemId;
  const item = CATALOG[String(itemId || '')];
  if (!item || !Object.isFrozen(item)) {
    return json(res, { error: 'invalid_item' }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { receipt, fresh } = await beginReceipt(client, rid, id, '/v1/purchase');
    if (!fresh) {
      if (receipt?.status === 'completed' && receipt.response_json != null) {
        await client.query('COMMIT');
        return json(res, receipt.response_json, Number(receipt.response_status || 200));
      }
      await client.query('ROLLBACK');
      return json(res, { error: 'request_in_progress' }, 409);
    }

    const playerResult = await client.query(
      'SELECT * FROM players WHERE player_id=$1 FOR UPDATE',
      [id],
    );
    const player = playerResult.rows[0] || await ensurePlayer(client, id);
    const unlocked = String(player.unlocked || 'p0|p1').split('|').filter(Boolean);

    if (item.kind === 'category' && unlocked.includes(String(itemId))) {
      const response = publicState(player);
      await finishReceipt(client, rid, 200, response);
      await client.query('COMMIT');
      return json(res, response);
    }

    if (Number(player.coins) < item.price) {
      const response = {
        error: 'insufficient_coins',
        state: publicState(player),
      };
      await finishReceipt(client, rid, 409, response);
      await client.query('COMMIT');
      return json(res, response, 409);
    }

    const coins = Number(player.coins) - item.price;
    let lives = Number(player.lives);
    let time = Number(player.time_bonus_secs);

    if (item.kind === 'lives') {
      lives = Math.min(ASTROQUIZ_CONTRACT.maxLives, lives + item.value);
    }
    if (item.kind === 'time') {
      time = Math.min(ASTROQUIZ_CONTRACT.maxTimeBonusSecs, time + item.value);
    }

    let nextUnlocked = unlocked;
    if (item.kind === 'category') {
      nextUnlocked = [...new Set([...unlocked, String(itemId)])];
    }

    const updated = await client.query(
      `UPDATE players
       SET coins=$1,lives=$2,time_bonus_secs=$3,unlocked=$4,updated_at=$5
       WHERE player_id=$6
       RETURNING *`,
      [coins, lives, time, nextUnlocked.join('|'), Date.now(), id],
    );

    const response = publicState(updated.rows[0]);
    await finishReceipt(client, rid, 200, response);
    await client.query('COMMIT');
    return json(res, response);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === 'idempotency_conflict') {
      return json(res, { error: 'idempotency_conflict' }, 409);
    }
    console.error(error);
    return json(res, { error: 'server_error' }, 500);
  } finally {
    client.release();
  }
});

app.use((_req, res) => json(res, { error: 'not_found' }, 404));

app.listen(PORT, () => {
  console.log(
    `AstroQuiz authority listening on ${PORT} — contract ${ASTROQUIZ_CONTRACT.version}/${ASTROQUIZ_CONTRACT.build}`,
  );
});
