export const ASTROQUIZ_CONTRACT = Object.freeze({
  version: '8.1',
  build: 9,
  maxCoins: 999_999,
  maxLives: 99,
  maxTimeBonusSecs: 60,
  maxStage: 10,
  questionsPerRound: 8,
  maxElapsedMs: 60_000,
  rewardPerCorrect: 2,
  normalScorePerCorrect: 10,
  hardScorePerCorrect: 20,
  maxComboMultiplier: 3,
  rewardAdCoins: 30,
  rewardAdDailyLimit: 3,
  rewardAdCooldownMs: 3 * 60 * 60 * 1000,
});

export const CATALOG = Object.freeze({
  p2: Object.freeze({ price: 150, kind: 'category' }),
  p3: Object.freeze({ price: 150, kind: 'category' }),
  p4: Object.freeze({ price: 220, kind: 'category' }),
  p5: Object.freeze({ price: 150, kind: 'category' }),
  p6: Object.freeze({ price: 220, kind: 'category' }),
  p7: Object.freeze({ price: 250, kind: 'category' }),
  p8: Object.freeze({ price: 220, kind: 'category' }),
  p9: Object.freeze({ price: 350, kind: 'category' }),
  p10: Object.freeze({ price: 350, kind: 'category' }),
  p11: Object.freeze({ price: 220, kind: 'category' }),
  p12: Object.freeze({ price: 350, kind: 'category' }),
  p13: Object.freeze({ price: 220, kind: 'category' }),
  life_1: Object.freeze({ price: 80, kind: 'lives', value: 1 }),
  life_3: Object.freeze({ price: 200, kind: 'lives', value: 3 }),
  life_5: Object.freeze({ price: 350, kind: 'lives', value: 5 }),
  time_5: Object.freeze({ price: 130, kind: 'time', value: 5 }),
  time_10: Object.freeze({ price: 260, kind: 'time', value: 10 }),
  time_20: Object.freeze({ price: 480, kind: 'time', value: 20 }),
});

export const FREE_CATEGORIES = Object.freeze(['p0', 'p1']);
export const CATEGORY_IDS = Object.freeze([...FREE_CATEGORIES, ...Object.keys(CATALOG).filter((id) => /^p(?:2|[3-9]|1[0-3])$/.test(id))]);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isInteger(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

export function isSafeText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function validateRound(body, questionMap) {
  if (!isPlainObject(body)) return { ok: false, error: 'invalid_round' };

  const { category, stage, hardMode, answers } = body;

  if (!isSafeText(category, 16) || !CATEGORY_IDS.includes(category)) {
    return { ok: false, error: 'invalid_category' };
  }
  if (!isInteger(stage) || stage < 1 || stage > ASTROQUIZ_CONTRACT.maxStage) {
    return { ok: false, error: 'invalid_stage' };
  }
  if (typeof hardMode !== 'boolean') {
    return { ok: false, error: 'invalid_hard_mode' };
  }
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > ASTROQUIZ_CONTRACT.questionsPerRound) {
    return { ok: false, error: 'invalid_answers' };
  }

  const seen = new Set();
  const normalized = [];

  for (const answer of answers) {
    if (!isPlainObject(answer)) return { ok: false, error: 'invalid_answer' };

    const qid = answer.questionId;
    const answerIndex = answer.answerIndex;
    const elapsedMs = answer.elapsedMs;

    if (!isInteger(qid) || qid < 0 || seen.has(qid)) {
      return { ok: false, error: 'invalid_question_id' };
    }
    if (!isInteger(answerIndex) || answerIndex < -1 || answerIndex > 7) {
      return { ok: false, error: 'invalid_answer_index' };
    }
    if (!isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > ASTROQUIZ_CONTRACT.maxElapsedMs) {
      return { ok: false, error: 'invalid_elapsed_ms' };
    }

    const question = questionMap.get(qid);
    if (!question || String(question.assetId) !== category) {
      return { ok: false, error: 'question_category_mismatch' };
    }
    if (!Array.isArray(question.respostas) || !isInteger(question.correta) ||
        question.correta < 0 || question.correta >= question.respostas.length) {
      return { ok: false, error: 'invalid_question_data' };
    }
    if (answerIndex >= question.respostas.length) {
      return { ok: false, error: 'invalid_answer_index' };
    }

    seen.add(qid);
    normalized.push({ qid, answerIndex, elapsedMs, question });
  }

  return { ok: true, category, stage, hardMode, answers: normalized };
}

export function comboMultiplier(streak) {
  if (streak >= 6) return 3;
  if (streak >= 3) return 2;
  return 1;
}

export function answerMaxTimeMs({ hardMode, stage, playerTimeBonusSecs }) {
  const base = hardMode
    ? Math.max(8_500, 11_000 - (stage - 1) * 250)
    : Math.max(14_000, 18_000 - (stage - 1) * 500);

  const bonus = hardMode ? 0 : Math.min(
    ASTROQUIZ_CONTRACT.maxTimeBonusSecs,
    Math.max(0, playerTimeBonusSecs || 0),
  ) * 1000;

  return base + bonus;
}
