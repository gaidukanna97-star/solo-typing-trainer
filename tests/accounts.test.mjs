// Особисті кабінети (ім'я + пароль, локально) та гейміфікація (XP, звання, досягнення).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyRoot, createAccount, login, logout, deleteAccount, changePassword, loadRoot, saveRoot,
  checkCredentials, userId, listNames, currentUser, hashPassword, ACCOUNTS_KEY,
} from '../src/core/accounts.js';
import { emptyState, saveState, recordAttempt, importState, exportState } from '../src/core/storage.js';
import { GRADES, ACHIEVEMENTS, XP, gradeFor, dayKey, dayStreak, awardAttempt, awardDaily } from '../src/core/gamification.js';
import { createSession, press, summarize } from '../src/core/session.js';
import { loadCurriculum } from '../scripts/outline.mjs';

const FAST = { iterations: 1000 }; // у тестах менше ітерацій, щоб не чекати

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

test('перевірка імені та пароля', () => {
  assert.equal(checkCredentials('Оля', 'таємно'), null);
  assert.match(checkCredentials('О', 'таємно'), /Ім’я має містити/);
  assert.match(checkCredentials('   ', 'таємно'), /Ім’я має містити/);
  assert.match(checkCredentials('Оля', '123'), /Пароль має містити/);
  assert.equal(userId('  Оля   Петренко '), userId('оля петренко'), 'ім’я без урахування регістру та зайвих пробілів');
});

test('створення кабінету, вхід, хибний пароль', async () => {
  const root = emptyRoot();
  await createAccount(root, 'Оля', 'таємно', 1000, FAST);
  assert.equal(currentUser(root).name, 'Оля');
  const stored = JSON.stringify(root);
  assert.ok(!stored.includes('таємно'), 'пароль не зберігається відкритим текстом');
  assert.match(root.users[userId('Оля')].hash, /^[0-9a-f]{64}$/);

  logout(root);
  assert.equal(currentUser(root), null);
  await assert.rejects(login(root, 'Оля', 'не той'), /Невірне ім’я або пароль/);
  await assert.rejects(login(root, 'Хтось', 'таємно'), /Невірне ім’я або пароль/);
  assert.equal(root.current, null);
  await login(root, 'ОЛЯ', 'таємно');
  assert.equal(currentUser(root).name, 'Оля');

  await assert.rejects(createAccount(root, 'оля', 'інший', 2000, FAST), /уже є на цьому пристрої/);
  await assert.rejects(createAccount(root, 'Я', 'пароль', 2000, FAST), /Ім’я має містити/);
});

test('однакові паролі в різних кабінетах мають різні хеші (сіль)', async () => {
  const root = emptyRoot();
  await createAccount(root, 'Оля', 'однаковий', 1, FAST);
  await createAccount(root, 'Іван', 'однаковий', 2, FAST);
  const [a, b] = Object.values(root.users);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await hashPassword('однаковий', a.salt, a.iterations), a.hash);
});

test('кабінети незалежні: у кожного свій прогрес', async () => {
  const root = emptyRoot();
  await createAccount(root, 'Оля', 'пароль1', 1, FAST);
  const olya = currentUser(root).data;
  olya.settings.lang = 'uk';
  olya.profiles.uk.createdAt = 1;
  recordAttempt(olya.profiles.uk, 's1-fj', attempt('аоао аоао'), true, 1, 10);
  await createAccount(root, 'Іван', 'пароль2', 2, FAST);
  assert.deepEqual(currentUser(root).data, emptyState(), 'новий кабінет порожній');
  await login(root, 'Оля', 'пароль1');
  assert.equal(currentUser(root).data.profiles.uk.lessons['s1-fj'].done, true);
  assert.deepEqual(listNames(root), ['Іван', 'Оля']);
});

test('кабінет і прогрес зберігаються після перезавантаження', async () => {
  const storage = fakeStorage();
  const root = loadRoot(storage);
  await createAccount(root, 'Оля', 'таємно', 1, FAST);
  const data = currentUser(root).data;
  data.settings.lang = 'en';
  data.game.xp = 320;
  recordAttempt(data.profiles.en, 's1-fj', attempt('fjfj fjfj'), true, 1, 10);
  assert.equal(saveRoot(storage, root), true);

  const again = loadRoot(storage);
  assert.equal(currentUser(again).name, 'Оля', 'вхід зберігся');
  assert.equal(currentUser(again).data.game.xp, 320);
  assert.equal(currentUser(again).data.profiles.en.lessons['s1-fj'].done, true);
  logout(again);
  saveRoot(storage, again);
  assert.equal(currentUser(loadRoot(storage)), null, 'після виходу потрібен пароль');
  await login(again, 'Оля', 'таємно');
});

test('зміна пароля та видалення кабінету', async () => {
  const root = emptyRoot();
  await createAccount(root, 'Оля', 'старий', 1, FAST);
  const id = root.current;
  await assert.rejects(changePassword(root, id, 'не той', 'новий'), /Поточний пароль невірний/);
  await assert.rejects(changePassword(root, id, 'старий', '1'), /щонайменше/);
  await changePassword(root, id, 'старий', 'новий');
  logout(root);
  await assert.rejects(login(root, 'Оля', 'старий'));
  await login(root, 'Оля', 'новий');
  deleteAccount(root, id);
  assert.equal(root.current, null);
  assert.deepEqual(listNames(root), []);
});

test('прогрес, збережений до появи кабінетів, переходить до першого кабінету', async () => {
  const storage = fakeStorage();
  const old = emptyState();
  old.settings.lang = 'uk';
  old.profiles.uk.createdAt = 5;
  recordAttempt(old.profiles.uk, 's1-fj', attempt('аоао аоао'), true, 1, 10);
  saveState(storage, old);

  const root = loadRoot(storage);
  assert.ok(root.legacy, 'старий прогрес знайдено');
  await createAccount(root, 'Оля', 'таємно', 1, FAST);
  assert.equal(currentUser(root).data.profiles.uk.lessons['s1-fj'].done, true);
  assert.equal(root.legacy, null);
  saveRoot(storage, root);
  await createAccount(root, 'Іван', 'таємно', 2, FAST);
  assert.deepEqual(currentUser(root).data.profiles.uk.lessons, {}, 'другому кабінету чужий прогрес не дістається');
  assert.equal(loadRoot(storage).legacy, null);
});

test('пошкоджені дані кабінетів не ламають застосунок', () => {
  for (const junk of ['{', 'null', '[]', '{"version":9,"users":{}}', '{"version":1,"users":{"u:x":{"name":"x"}},"current":"u:x"}', '{"version":1,"users":{"__proto__":{"name":"x"}}}']) {
    const storage = fakeStorage();
    storage.setItem(ACCOUNTS_KEY, junk);
    const root = loadRoot(storage);
    assert.deepEqual(root.users, {});
    assert.equal(root.current, null);
  }
  const broken = { getItem() { throw new Error('заборонено'); }, setItem() { throw new Error('переповнено'); } };
  assert.deepEqual(loadRoot(broken), emptyRoot());
  assert.equal(saveRoot(broken, emptyRoot()), false);
});

test('звання визначаються досвідом', () => {
  assert.deepEqual(GRADES.map((g) => g.name), ['Новачок', 'Учень', 'Практик', 'Знавець', 'Профі', 'Майстер', 'Віртуоз']);
  assert.equal(gradeFor(0).grade.name, 'Новачок');
  assert.equal(gradeFor(149).grade.name, 'Новачок');
  assert.equal(gradeFor(149).toNext, 1);
  assert.equal(gradeFor(150).grade.name, 'Учень');
  assert.equal(gradeFor(2500).grade.name, 'Профі');
  const top = gradeFor(99999);
  assert.equal(top.grade.name, 'Віртуоз');
  assert.equal(top.next, null);
  assert.equal(top.progress, 1);
  assert.equal(gradeFor(325).progress, 0.5);
});

test('досвід дає лише зарахована спроба; швидкість без точності не винагороджується', () => {
  const cur = loadCurriculum('uk');
  const lesson = cur.lessons[0];
  const state = emptyState();
  const base = { cur, lang: 'uk', lesson, exId: lesson.id, justDone: false, moduleDone: false, now: Date.UTC(2026, 9, 2, 10) };

  const sloppy = attempt('аоао аоао аоао аоао', { errorsAt: [0, 3, 6, 9], stepMs: 40 });
  const none = awardAttempt(state, { ...base, metrics: sloppy, passed: false });
  assert.equal(none.xp, 0);
  assert.equal(state.game.xp, 0);
  assert.deepEqual(none.achievements, []);

  const clean = attempt('ааа аа ааа ооо оо ооо ао оа аоа оао ооа ааоа ооа ооа оооа ооа оаао аоо');
  const first = awardAttempt(state, { ...base, metrics: clean, passed: true });
  assert.equal(first.xp, XP.pass + XP.flawless);
  assert.deepEqual(first.achievements.map((a) => a.id), ['first', 'flawless']);

  const done = awardAttempt(state, { ...base, metrics: clean, passed: true, justDone: true });
  assert.equal(done.xp, XP.pass + XP.flawless + XP.lessonDone);
  assert.deepEqual(done.achievements, [], 'досягнення не видається двічі');
  assert.equal(state.game.xp, 2 * (XP.pass + XP.flawless) + XP.lessonDone);
  assert.equal(state.game.passed, 2);

  const free = awardAttempt(state, { ...base, lesson: null, exId: 'review', metrics: attempt('аоао аоао', { errorsAt: [8] }), passed: true });
  assert.equal(free.xp, XP.free);
  assert.equal(awardAttempt(state, { ...base, lesson: null, exId: 'diagnostic', metrics: clean, passed: true }).xp, 0, 'діагностика досвіду не дає');
});

test('підвищення звання та досягнення за темп лише на словах', () => {
  const cur = loadCurriculum('en');
  const state = emptyState();
  state.game.xp = 140;
  const words = cur.byId.get('s2-home');
  const fast = attempt('salad falls lad add sad a salad lad falls dad lads ask add lad as fall dad sad asks falls', { stepMs: 250 });
  assert.ok(fast.spm >= 225 && fast.spm < 300);
  const scale = awardAttempt(state, { cur, lang: 'en', lesson: cur.lessons[0], exId: 's1-fj', metrics: fast, passed: true, now: 1e12 });
  assert.ok(!scale.achievements.some((a) => a.id.startsWith('speed')), 'гама-механіка не дає досягнень за темп');
  assert.equal(scale.before.grade.name, 'Новачок');
  assert.equal(scale.after.grade.name, 'Учень', 'звання підвищено');
  const real = awardAttempt(state, { cur, lang: 'en', lesson: words, exId: words.id, metrics: fast, passed: true, now: 1e12 });
  assert.deepEqual(real.achievements.map((a) => a.id).sort(), ['speed150', 'speed225']);
});

test('серія днів і заняття дня', () => {
  const day = (d) => new Date(2026, 9, d, 15).getTime();
  assert.equal(dayKey(day(2)), '2026-10-02');
  assert.equal(dayStreak([], day(5)), 0);
  assert.equal(dayStreak(['2026-10-03', '2026-10-04', '2026-10-05'], day(5)), 3);
  assert.equal(dayStreak(['2026-10-03', '2026-10-04'], day(5)), 2, 'учорашнє заняття ще тримає серію');
  assert.equal(dayStreak(['2026-10-01', '2026-10-02'], day(5)), 0, 'пропуск обриває серію');
  assert.equal(dayStreak(['2026-09-29', '2026-10-01', '2026-10-02'], day(2)), 2);

  const cur = loadCurriculum('uk');
  const state = emptyState();
  let got = [];
  for (const d of [1, 2, 3]) got = awardDaily(state, { cur, lang: 'uk', now: day(d) }).achievements;
  assert.deepEqual(got.map((a) => a.id), ['streak3']);
  assert.equal(state.game.xp, 3 * XP.daily);
  assert.deepEqual(state.game.days, ['2026-10-01', '2026-10-02', '2026-10-03']);
});

test('гейміфікація входить до експорту й переживає імпорт; чужі поля відкидаються', () => {
  const state = emptyState();
  state.game = { xp: 777, passed: 12, achievements: { first: 5 }, days: ['2026-10-02'] };
  assert.deepEqual(importState(exportState(state)).game, state.game);
  const odd = importState(JSON.stringify({ version: 1, profiles: {}, game: { xp: -5, passed: 'багато', achievements: { first: 'так' }, days: ['сьогодні', '2026-10-02'] } }));
  assert.deepEqual(odd.game, { xp: 0, passed: 0, achievements: {}, days: ['2026-10-02'] });
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});
