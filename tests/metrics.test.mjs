// ТЗ п. 8.1, 8.2: формули SPM і точності; виправлена помилка лишається у статистиці.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, press, backspace, summarize, spm, accuracy, levelFor, isPassed, charState } from '../src/core/session.js';
import { PASS_RULES } from '../src/core/config.js';

/** Набирає рядок keys з фіксованим кроком часу. '<' означає Backspace. */
function type(session, keys, stepMs = 400, startAt = 0) {
  let t = startAt;
  for (const k of keys) {
    if (k === '<') backspace(session);
    else press(session, k, t);
    t += stepMs;
  }
  return session;
}

test('SPM: фіксовані приклади', () => {
  assert.equal(spm(150, 60000), 150);
  assert.equal(spm(100, 30000), 200);
  assert.equal(spm(45, 90000), 30);
  assert.equal(spm(10, 0), 0);
});

test('точність: фіксовані приклади', () => {
  assert.equal(accuracy(100, 0), 100);
  assert.equal(accuracy(100, 5), 95);
  assert.equal(accuracy(40, 1), 97.5);
  assert.equal(accuracy(0, 0), 0);
});

test('SPM і WPM у підсумку спроби', () => {
  // 11 символів, перше натискання в 0 мс, останнє в 6000 мс → 110 SPM, 22 WPM.
  const s = type(createSession('asdf jkl; a'), 'asdf jkl; a', 600);
  const m = summarize(s);
  assert.equal(m.completed, true);
  assert.equal(m.elapsedMs, 6000);
  assert.equal(m.spm, 110);
  assert.equal(m.wpm, 22);
  assert.equal(m.accuracy, 100);
  assert.equal(m.errors, 0);
});

test('режим «зупинка на помилці»: хибний символ не просуває курсор і входить у статистику', () => {
  const s = createSession('abc', { mode: 'stop' });
  assert.equal(press(s, 'a', 0), 'correct');
  assert.equal(press(s, 'x', 100), 'error');
  assert.equal(s.pos, 1);
  assert.equal(charState(s, 1), 'current-error');
  assert.equal(press(s, 'b', 200), 'correct');
  assert.equal(charState(s, 1), 'corrected', 'виправлена позиція не стає «чистою»');
  assert.equal(press(s, 'c', 300), 'done');
  const m = summarize(s);
  assert.equal(m.errors, 1);
  assert.equal(m.keystrokes, 4);
  assert.equal(m.accuracy, 75);
  assert.deepEqual(m.errorsByChar, { b: 1 });
  assert.equal(m.correctedPositions, 1);
});

test('режим Backspace: виправлена помилка все одно входить до статистики', () => {
  const s = type(createSession('abc', { mode: 'backspace' }), 'ax<bc');
  const m = summarize(s);
  assert.equal(m.completed, true);
  assert.equal(m.correctChars, 3);
  assert.equal(m.errors, 1);
  assert.equal(m.keystrokes, 4);
  assert.equal(m.accuracy, 75);
  assert.equal(charState(s, 1), 'corrected');
});

test('режим Backspace: спроба не завершується з невиправленою помилкою', () => {
  const s = type(createSession('ab', { mode: 'backspace' }), 'ax');
  assert.equal(s.done, false);
  assert.equal(charState(s, 1), 'wrong');
  assert.equal(press(s, 'b', 5000), 'ignored', 'за межами тексту натискання не рахуються');
  type(s, '<b', 400, 6000);
  assert.equal(s.done, true);
});

test('швидкість не зараховується без точності', () => {
  // 20 символів дуже швидко, але з 4 помилками → точність 83,3%.
  const s = createSession('aaaaaaaaaaaaaaaaaaaa');
  let t = 0;
  for (let i = 0; i < 20; i++) {
    if (i % 5 === 0) press(s, 'x', t += 50);
    press(s, 'a', t += 50);
  }
  const m = summarize(s);
  assert.ok(m.spm > 300);
  assert.ok(m.accuracy < 95);
  assert.equal(m.level, null, 'рівень не присвоюється');
  for (const rule of Object.values(PASS_RULES)) assert.equal(isPassed(m, rule), false);
});

test('рівень визначається і швидкістю, і точністю', () => {
  assert.equal(levelFor(320, 99).id, 'speed');
  assert.equal(levelFor(320, 97).id, 'working');
  assert.equal(levelFor(160, 97).id, 'confident');
  assert.equal(levelFor(160, 96).id, 'basic');
  assert.equal(levelFor(40, 95).id, 'intro');
  assert.equal(levelFor(400, 94), null);
});

test('темп не блокує початківця, якщо вимогу швидкості вимкнено', () => {
  const s = type(createSession('th the then'), 'th the then', 2000);
  const m = summarize(s);
  assert.equal(isPassed(m, PASS_RULES.academy), false);
  assert.equal(isPassed(m, PASS_RULES.academy, { speedGate: false }), true);
  assert.equal(isPassed(m, PASS_RULES.scales), true);
});

test('незавершена спроба не зараховується', () => {
  const s = type(createSession('abcdef'), 'abc');
  assert.equal(isPassed(summarize(s, 5000), PASS_RULES.scales), false);
});

test('затримки переходів і ритм', () => {
  const s = createSession('abab ab');
  [0, 100, 200, 300, 400, 500, 600].forEach((t, i) => press(s, 'abab ab'[i], t));
  const m = summarize(s);
  assert.equal(m.bigrams.ab.n, 3);
  assert.equal(m.bigrams.ab.ms, 300);
  assert.equal(m.rhythm, 0, 'рівні інтервали → нульова нерівномірність');
});

test('апостроф нормалізується, українські літери не підміняються', () => {
  const s = createSession("п'є");
  assert.equal(press(s, 'п', 0), 'correct');
  assert.equal(press(s, '’', 100), 'correct', 'типографський апостроф дорівнює клавіатурному');
  assert.equal(press(s, 'е', 200), 'error', '«е» не зараховується замість «є»');
  assert.equal(press(s, 'є', 300), 'done');
  const g = createSession('ґіїє');
  assert.equal(press(g, 'г', 0), 'error');
  assert.equal(press(g, 'ґ', 1), 'correct');
  assert.equal(press(g, 'i', 2), 'error', 'латинська i не дорівнює українській і');
  assert.equal(press(g, 'і', 3), 'correct');
  assert.equal(press(g, 'і', 4), 'error', '«і» не зараховується замість «ї»');
});
