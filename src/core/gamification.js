// Гейміфікація: досвід (XP), звання та досягнення.
// Правило те саме, що й у навчанні: винагороду дає лише зарахована (точна) спроба.
// Швидкість без точності не приносить нічого.

import { isDone } from './curriculum.js';
import { emptyGame } from './storage.js';

export { emptyGame };

export const GRADES = [
  { id: 'novice', name: 'Новачок', xp: 0, about: 'Перші кроки: пальці знайомляться з домашнім рядом.' },
  { id: 'pupil', name: 'Учень', xp: 150, about: 'Домашній ряд уже знайомий, рухи стають упевненішими.' },
  { id: 'practitioner', name: 'Практик', xp: 500, about: 'Більшість клавіш відкрито, слова набираються без підглядання.' },
  { id: 'expert', name: 'Знавець', xp: 1200, about: 'Уся клавіатура під пальцями, попереду — темп.' },
  { id: 'pro', name: 'Профі', xp: 2500, about: 'Частотні комбінації набираються одним рухом.' },
  { id: 'master', name: 'Майстер', xp: 4500, about: 'Зв’язний текст рівно й точно.' },
  { id: 'virtuoso', name: 'Віртуоз', xp: 7000, about: 'Набір наосліп став другою натурою.' },
];

export const XP = { pass: 10, free: 5, accurate: 5, flawless: 10, lessonDone: 40, moduleDone: 100, daily: 30 };

/** Звання за кількістю XP і шлях до наступного. */
export function gradeFor(xp) {
  let index = 0;
  GRADES.forEach((g, i) => { if (xp >= g.xp) index = i; });
  const grade = GRADES[index];
  const next = GRADES[index + 1] || null;
  return {
    grade,
    index,
    next,
    toNext: next ? next.xp - xp : 0,
    progress: next ? (xp - grade.xp) / (next.xp - grade.xp) : 1,
  };
}

/** Локальна дата YYYY-MM-DD. */
export function dayKey(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Скільки днів поспіль були заняття (серія жива, якщо останнє заняття сьогодні або вчора). */
export function dayStreak(days, now) {
  const set = new Set(days);
  let t = now;
  if (!set.has(dayKey(t))) {
    t -= DAY_MS;
    if (!set.has(dayKey(t))) return 0;
  }
  let n = 0;
  // Полудень, щоб перехід на літній/зимовий час не збив крок у добу.
  const noon = new Date(t);
  noon.setHours(12, 0, 0, 0);
  for (let cursor = noon.getTime(); set.has(dayKey(cursor)); cursor -= DAY_MS) n++;
  return n;
}

const stageDone = (c, stage) => c.cur.lessons.filter((l) => l.stage === stage).every((l) => isDone(c.profile, l.id));
const fastText = (c, spm) => c.passed && c.lesson && !c.lesson.mechanics && c.metrics.length >= 80 && c.metrics.spm >= spm;

export const ACHIEVEMENTS = [
  { id: 'first', title: 'Перший залік', about: 'Зарахувати першу спробу без підказок.', test: (c) => c.passed },
  { id: 'flawless', title: 'Без жодної помилки', about: 'Пройти залік на 100% (від 60 символів).', test: (c) => c.passed && c.metrics.accuracy === 100 && c.metrics.length >= 60 },
  { id: 'home', title: 'Домашній ряд', about: 'Закріпити перші слова з домашнього ряду.', test: (c) => isDone(c.profile, 's2-home') },
  { id: 'letters', title: 'Уся абетка', about: 'Відкрити всі літерні клавіші.', test: (c) => isDone(c.profile, 's1-br') },
  { id: 'stage1', title: 'Гами зіграно', about: 'Закріпити всі вправи першого етапу.', test: (c) => stageDone(c, 1) },
  { id: 'stage2', title: 'Словник під пальцями', about: 'Закріпити всі вправи другого етапу.', test: (c) => stageDone(c, 2) },
  { id: 'module', title: 'Перший модуль', about: 'Завершити будь-який модуль Академії.', test: (c) => c.moduleDone },
  { id: 'academy', title: 'Випускник Академії', about: 'Завершити всі модулі Академії.', test: (c) => stageDone(c, 3) },
  { id: 'speed150', title: 'Впевнений темп', about: '150 SPM у словах або тексті — із точністю, достатньою для заліку.', test: (c) => fastText(c, 150) },
  { id: 'speed225', title: 'Робочий темп', about: '225 SPM у словах або тексті.', test: (c) => fastText(c, 225) },
  { id: 'speed300', title: 'Швидкісний темп', about: '300 SPM у словах або тексті.', test: (c) => fastText(c, 300) },
  { id: 'streak3', title: 'Три дні поспіль', about: 'Займатися три дні поспіль.', test: (c) => c.streak >= 3 },
  { id: 'streak7', title: 'Тиждень поспіль', about: 'Займатися сім днів поспіль.', test: (c) => c.streak >= 7 },
  { id: 'hundred', title: 'Сто заліків', about: 'Зарахувати сто спроб.', test: (c) => c.game.passed >= 100 },
  { id: 'bilingual', title: 'Дві розкладки', about: 'Зарахувати спроби і українською, і англійською.', test: (c) => ['uk', 'en'].every((l) => c.state.profiles[l].history.some((h) => h.passed)) },
];

function markDay(game, now) {
  const key = dayKey(now);
  if (!game.days.includes(key)) {
    game.days.push(key);
    if (game.days.length > 400) game.days.splice(0, game.days.length - 400);
  }
}

/**
 * Нараховує винагороду за залікову спробу й перевіряє досягнення.
 * ctx: { cur, lang, lesson (або null для вільної вправи), exId, metrics, passed, justDone, moduleDone, now }.
 * Повертає { xp, parts: [{ label, xp }], achievements: [нові], before, after } (before/after — результат gradeFor).
 */
export function awardAttempt(state, ctx) {
  const game = (state.game ??= emptyGame());
  const before = gradeFor(game.xp);
  const parts = [];
  if (ctx.passed && ctx.exId !== 'diagnostic') {
    parts.push({ label: ctx.lesson ? 'зарахована спроба' : 'вільна вправа', xp: ctx.lesson ? XP.pass : XP.free });
    if (ctx.metrics.accuracy === 100) parts.push({ label: 'без жодної помилки', xp: XP.flawless });
    else if (ctx.metrics.accuracy >= 99) parts.push({ label: 'точність від 99%', xp: XP.accurate });
    if (ctx.justDone) parts.push({ label: 'вправу закріплено', xp: XP.lessonDone });
    if (ctx.moduleDone) parts.push({ label: 'модуль Академії завершено', xp: XP.moduleDone });
    game.passed++;
  }
  markDay(game, ctx.now);
  const xp = parts.reduce((sum, p) => sum + p.xp, 0);
  game.xp += xp;
  const achievements = checkAchievements(state, ctx);
  return { xp, parts, achievements, before, after: gradeFor(game.xp) };
}

/** Винагорода за повністю пройдене заняття дня. */
export function awardDaily(state, ctx) {
  const game = (state.game ??= emptyGame());
  const before = gradeFor(game.xp);
  markDay(game, ctx.now);
  game.xp += XP.daily;
  return { xp: XP.daily, parts: [{ label: 'заняття дня пройдено', xp: XP.daily }], achievements: checkAchievements(state, ctx), before, after: gradeFor(game.xp) };
}

function checkAchievements(state, ctx) {
  const game = state.game;
  const c = {
    passed: false, moduleDone: false, lesson: null, metrics: { accuracy: 0, length: 0, spm: 0 },
    ...ctx,
    state, game,
    profile: state.profiles[ctx.lang],
    streak: dayStreak(game.days, ctx.now),
  };
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (game.achievements[a.id]) continue;
    if (a.test(c)) {
      game.achievements[a.id] = ctx.now;
      fresh.push(a);
    }
  }
  return fresh;
}
