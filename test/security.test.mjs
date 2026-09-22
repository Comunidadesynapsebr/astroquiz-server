import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASTROQUIZ_CONTRACT,
  answerMaxTimeMs,
  comboMultiplier,
  validateRound,
} from '../security/asteios-artenos.mjs';

const questionMap = new Map([
  [1, { id: 1, assetId: 'p0', correta: 0, respostas: ['A', 'B', 'C', 'D'] }],
  [2, { id: 2, assetId: 'p0', correta: 1, respostas: ['A', 'B', 'C', 'D'] }],
]);

test('contract uses fixed economy values', () => {
  assert.equal(ASTROQUIZ_CONTRACT.rewardPerCorrect, 2);
  assert.equal(ASTROQUIZ_CONTRACT.rewardAdCoins, 30);
  assert.equal(ASTROQUIZ_CONTRACT.rewardAdDailyLimit, 3);
  assert.equal(ASTROQUIZ_CONTRACT.maxCoins, 999999);
});

test('round validation rejects clamped/modified values', () => {
  const base = {
    category: 'p0',
    stage: 1,
    hardMode: false,
    answers: [{ questionId: 1, answerIndex: 0, elapsedMs: 1000 }],
  };
  assert.equal(validateRound(base, questionMap).ok, true);
  assert.equal(validateRound({ ...base, stage: 1.5 }).ok, false);
  assert.equal(validateRound({ ...base, hardMode: 'false' }).ok, false);
  assert.equal(validateRound({ ...base, category: 'p999' }).ok, false);
  assert.equal(validateRound({ ...base, answers: [{ questionId: 1, answerIndex: 999, elapsedMs: 1000 }] }).ok, false);
});

test('combo and timer rules are deterministic', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(3), 2);
  assert.equal(comboMultiplier(6), 3);
  assert.equal(answerMaxTimeMs({ hardMode: true, stage: 10, playerTimeBonusSecs: 60 }), 8750);
  assert.equal(answerMaxTimeMs({ hardMode: false, stage: 10, playerTimeBonusSecs: 0 }), 14000);
});
