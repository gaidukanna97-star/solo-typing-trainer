// Зріз швидкості та сертифікати.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examText, tierFor, missingFor, addCertificate, bestCertificate } from '../src/core/certificate.js';
import { CERT_TIERS, EXAM_MIN_CHARS, CERT_LIMIT } from '../src/core/config.js';
import { isSupported } from '../src/core/layouts.js';
import { emptyState } from '../src/core/storage.js';
import { awardAttempt, XP } from '../src/core/gamification.js';
import { loadCurriculum } from '../scripts/outline.mjs';

const m = (spm, accuracy, extra = {}) => ({ completed: true, length: 480, spm, accuracy, errors: 3, elapsedMs: 120000, ...extra });

test('пороги сертифікатів: золото від 250 SPM, обидві умови обов’язкові', () => {
  assert.deepEqual(CERT_TIERS.map((t) => [t.id, t.minSpm, t.minAcc]), [['gold', 250, 98], ['silver', 200, 97], ['bronze', 150, 96]]);
  assert.equal(tierFor(m(250, 98)).id, 'gold');
  assert.equal(tierFor(m(320, 99.5)).id, 'gold');
  assert.equal(tierFor(m(249.9, 100)).id, 'silver');
  assert.equal(tierFor(m(200, 97)).id, 'silver');
  assert.equal(tierFor(m(150, 96)).id, 'bronze');
  assert.equal(tierFor(m(149, 100)), null);
});

test('швидкість без точності сертифіката не дає', () => {
  assert.equal(tierFor(m(400, 95.9)), null, 'дуже швидко, але неточно');
  assert.equal(tierFor(m(300, 97.5)).id, 'silver', 'золотий темп із точністю срібла — срібло');
  assert.equal(tierFor(m(300, 96.5)).id, 'bronze');
  assert.equal(tierFor(m(300, 99, { completed: false })), null, 'незавершений зріз');
  assert.equal(tierFor(m(300, 99, { length: 120 })), null, 'короткий текст не є зрізом');
  assert.equal(tierFor(m(1201, 100)), null, 'нелюдський темп — автоматичне введення');
  assert.equal(tierFor(m(1200, 100)).id, 'gold');
});

test('підказка, чого бракує до наступного рівня', () => {
  assert.deepEqual(missingFor(m(120, 94)), { tier: CERT_TIERS[2], spm: 30, acc: 2 });
  const toGold = missingFor(m(210, 97.2));
  assert.equal(toGold.tier.id, 'gold');
  assert.equal(toGold.spm, 40);
  assert.equal(toGold.acc, 0.8);
  assert.equal(missingFor(m(260, 99)), null, 'вище за золото рівня немає');
});

test('текст зрізу: зв’язний, достатньо довгий, набирається в розкладці, різний у різних спробах', () => {
  for (const lang of ['uk', 'en']) {
    const cur = loadCurriculum(lang);
    const texts = [0, 1, 2, 3].map((seed) => examText(cur, seed));
    for (const text of texts) {
      assert.ok(text.length >= EXAM_MIN_CHARS, `${lang}: ${text.length} символів`);
      assert.ok(text.length < EXAM_MIN_CHARS + 400, 'не надто довгий');
      assert.ok(isSupported(cur.layout, text));
      assert.match(text, /[.!?]$/, 'закінчується цілим реченням');
    }
    assert.ok(new Set(texts).size > 1, 'тексти відрізняються');
    assert.equal(examText(cur, 2), texts[2], 'той самий варіант — той самий текст');
  }
});

test('сертифікат записується в кабінет, дає досвід і досягнення', () => {
  const cur = loadCurriculum('uk');
  const state = emptyState();
  const metrics = m(262.4, 98.6);
  const tier = tierFor(metrics);
  const index = addCertificate(state, { tier, lang: 'uk', metrics, now: 1000 });
  assert.equal(index, 0);
  assert.deepEqual(state.game.certs[0], { t: 1000, lang: 'uk', tier: 'gold', spm: 262.4, acc: 98.6, errors: 3, ms: 120000, chars: 480 });
  const reward = awardAttempt(state, { cur, lang: 'uk', lesson: null, exId: 'exam', metrics, passed: true, cert: tier, now: 1000 });
  assert.equal(reward.xp, XP.free + XP.cert);
  assert.deepEqual(reward.achievements.map((a) => a.id).sort(), ['cert', 'first', 'gold']);

  addCertificate(state, { tier: CERT_TIERS[2], lang: 'en', metrics: m(170, 96.2), now: 2000 });
  addCertificate(state, { tier: CERT_TIERS[0], lang: 'en', metrics: m(255, 98), now: 3000 });
  assert.equal(bestCertificate(state.game.certs).spm, 262.4, 'найкращий — найвищий рівень, далі за швидкістю');
  for (let i = 0; i < CERT_LIMIT + 5; i++) addCertificate(state, { tier: CERT_TIERS[2], lang: 'uk', metrics: m(160, 97), now: 4000 + i });
  assert.equal(state.game.certs.length, CERT_LIMIT);
  assert.equal(bestCertificate([]), null);
});
