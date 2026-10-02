// ТЗ п. 8.9: після перезавантаження зберігаються відкриті уроки та особисті результати.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadState, saveState, emptyState, recordAttempt, exportState, importState, STORAGE_KEY,
} from '../src/core/storage.js';
import { createSession, press, summarize, isPassed } from '../src/core/session.js';
import { PASS_RULES, HISTORY_LIMIT } from '../src/core/config.js';
import { loadCurriculum } from '../scripts/outline.mjs';
import { isAvailable, isDone, nextLesson, generateText } from '../src/core/curriculum.js';

/** Замінник localStorage: зберігає лише рядки, як справжній. */
function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    raw: data,
  };
}

function attempt(text, { errorsAt = [], stepMs = 300 } = {}) {
  const s = createSession(text);
  let t = 0;
  Array.from(text).forEach((ch, i) => {
    if (errorsAt.includes(i)) press(s, '~', t += stepMs);
    press(s, ch, t += stepMs);
  });
  return summarize(s);
}

test('порожнє сховище дає новий профіль', () => {
  const state = loadState(fakeStorage());
  assert.equal(state.settings.lang, null);
  assert.deepEqual(state.profiles.uk.lessons, {});
});

test('після «перезавантаження» зберігаються відкриті уроки та особисті результати', () => {
  const storage = fakeStorage();
  const cur = loadCurriculum('uk');
  const [first, second, third] = cur.lessons;
  const rule = PASS_RULES[first.rule];

  // Сеанс 1: три успішні залікові спроби поспіль закріплюють першу вправу.
  let state = loadState(storage);
  state.settings.lang = 'uk';
  state.settings.fontSize = 30;
  const profile = state.profiles.uk;
  profile.createdAt = 1;
  for (let seed = 0; seed < 3; seed++) {
    const m = attempt(generateText(cur, first, { seed }));
    assert.equal(isPassed(m, rule), true);
    const { justDone } = recordAttempt(profile, first.id, m, true, 3, 1000 + seed);
    assert.equal(justDone, seed === 2, 'закріплено саме після третьої спроби');
  }
  const bestBefore = profile.lessons[first.id].bestSpm;
  assert.ok(bestBefore > 0);
  assert.equal(saveState(storage, state), true);

  // Сеанс 2: стан читається наново лише з рядка у сховищі.
  state = null;
  const reloaded = loadState(storage);
  const p = reloaded.profiles.uk;
  assert.equal(reloaded.settings.lang, 'uk');
  assert.equal(reloaded.settings.fontSize, 30);
  assert.equal(isDone(p, first.id), true);
  assert.equal(p.lessons[first.id].bestSpm, bestBefore, 'особистий рекорд збережено');
  assert.equal(p.lessons[first.id].attempts, 3);
  assert.equal(p.history.length, 3);
  assert.equal(isAvailable(cur, p, second), true, 'наступний урок лишився відкритим');
  assert.equal(isAvailable(cur, p, third), false);
  assert.equal(nextLesson(cur, p).id, second.id);
  assert.ok(Object.keys(p.chars).length > 0, 'статистику клавіш збережено');
  assert.deepEqual(reloaded.profiles.en.lessons, {}, 'профілі мов незалежні');
});

test('невдала спроба обнуляє серію і не дає рекорду швидкості', () => {
  const profile = emptyState().profiles.en;
  const good = attempt('fj fj fj fj fj fj fj');
  recordAttempt(profile, 'x', good, true, 3, 1);
  recordAttempt(profile, 'x', good, true, 3, 2);
  assert.equal(profile.lessons.x.streak, 2);
  const fast = attempt('fj fj fj fj fj fj fj', { errorsAt: [0, 3, 6, 9], stepMs: 60 });
  assert.ok(fast.spm > good.spm && fast.accuracy < 95);
  const out = recordAttempt(profile, 'x', fast, false, 3, 3);
  assert.equal(profile.lessons.x.streak, 0, 'серію перервано');
  assert.equal(profile.lessons.x.done, false);
  assert.equal(profile.lessons.x.bestSpm, good.spm, 'швидка неточна спроба не стала рекордом');
  assert.equal(out.previousBest.spm, good.spm);
  assert.equal(profile.chars.f.err + profile.chars.j.err, 4, 'помилки потрапили до статистики клавіш');
});

test('історія обмежена, щоб не переповнити сховище', () => {
  const profile = emptyState().profiles.en;
  const m = attempt('fj fj');
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) recordAttempt(profile, 'x', m, true, 3, i);
  assert.equal(profile.history.length, HISTORY_LIMIT);
  assert.equal(profile.history.at(-1).t, HISTORY_LIMIT + 24);
});

test('пошкоджені дані у сховищі не ламають застосунок', () => {
  for (const junk of ['{', 'null', '[]', '{"version":99,"profiles":{}}', '"рядок"']) {
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEY, junk);
    assert.deepEqual(loadState(storage), emptyState());
  }
  const broken = { getItem() { throw new Error('заборонено'); }, setItem() { throw new Error('переповнено'); } };
  assert.deepEqual(loadState(broken), emptyState());
  assert.equal(saveState(broken, emptyState()), false);
});

test('експорт та імпорт прогресу', () => {
  const state = emptyState();
  state.settings.lang = 'en';
  state.profiles.en.createdAt = 5;
  recordAttempt(state.profiles.en, 's1-fj', attempt('fj fj fj'), true, 1, 10);
  const restored = importState(exportState(state));
  assert.deepEqual(restored, state);
  assert.throws(() => importState('не json'), /коректним JSON/);
  assert.throws(() => importState('{"foo":1}'), /не файл прогресу/);
  // Чужі поля та хибні типи налаштувань відкидаються.
  const odd = importState(JSON.stringify({ version: 1, settings: { fontSize: 'велетенський', evil: 1, lang: 'xx' }, profiles: { uk: { placed: 'yes' } } }));
  assert.equal(odd.settings.fontSize, emptyState().settings.fontSize);
  assert.equal(odd.settings.lang, null);
  assert.equal(odd.settings.evil, undefined);
  assert.equal(odd.profiles.uk.placed, false);
});
