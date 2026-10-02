// Локальне збереження прогресу. Сховище передається ззовні (localStorage у браузері,
// об'єкт-замінник у тестах), тому модуль не залежить від DOM.

import { DEFAULT_SETTINGS, HISTORY_LIMIT } from './config.js';

export const STORAGE_KEY = 'solo-typing-v1';
export const SCHEMA_VERSION = 1;

export function emptyProfile() {
  return {
    createdAt: null,
    placed: false, // відкрито всі етапи через діагностику або вибір рівня
    lessons: {}, // id → { attempts, passes, streak, done, bestSpm, bestAcc, lastSpm, lastAcc }
    chars: {}, // символ → { n, err, ms, timed }
    bigrams: {}, // перехід → { n, err, ms }
    history: [], // { t, id, spm, acc, errors, ms, passed }
  };
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    profiles: { uk: emptyProfile(), en: emptyProfile() },
  };
}

function isObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Перевіряє структуру й доповнює відсутні поля. Кидає помилку для непридатних даних. */
export function validateState(raw) {
  if (!isObject(raw) || raw.version !== SCHEMA_VERSION || !isObject(raw.profiles)) {
    throw new Error('Це не файл прогресу «Соло» або його версія не підтримується.');
  }
  const state = emptyState();
  if (isObject(raw.settings)) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof raw.settings[key] === typeof DEFAULT_SETTINGS[key] || (key === 'lang' && ['uk', 'en'].includes(raw.settings[key]))) {
        state.settings[key] = raw.settings[key];
      }
    }
  }
  for (const lang of ['uk', 'en']) {
    const p = raw.profiles[lang];
    if (!isObject(p)) continue;
    const target = state.profiles[lang];
    target.createdAt = typeof p.createdAt === 'number' ? p.createdAt : null;
    target.placed = p.placed === true;
    for (const field of ['lessons', 'chars', 'bigrams']) {
      if (isObject(p[field])) target[field] = p[field];
    }
    if (Array.isArray(p.history)) target.history = p.history.filter(isObject).slice(-HISTORY_LIMIT);
  }
  return state;
}

export function loadState(storage) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    return text ? validateState(JSON.parse(text)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // сховище недоступне або переповнене — працюємо далі без збереження
  }
}

export function exportState(state) {
  return JSON.stringify({ app: 'solo-typing', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function importState(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл не є коректним JSON.');
  }
  return validateState(raw);
}

function mergeCounters(target, source) {
  for (const [key, v] of Object.entries(source)) {
    const t = (target[key] ??= { n: 0, err: 0, ms: 0, timed: 0 });
    t.n += v.n; t.err += v.err; t.ms += v.ms; t.timed = (t.timed || 0) + (v.timed ?? v.n);
  }
}

/**
 * Записує результат залікової спроби у профіль. Повертає { record, previousBest, justDone }.
 * needed — скільки успішних спроб поспіль зараховують вправу.
 */
export function recordAttempt(profile, lessonId, metrics, passed, needed, now) {
  const rec = (profile.lessons[lessonId] ??= {
    attempts: 0, passes: 0, streak: 0, done: false, bestSpm: 0, bestAcc: 0, lastSpm: 0, lastAcc: 0,
  });
  const previousBest = rec.attempts ? { spm: rec.bestSpm, acc: rec.bestAcc } : null;
  rec.attempts++;
  rec.lastSpm = metrics.spm;
  rec.lastAcc = metrics.accuracy;
  const wasDone = rec.done;
  if (passed) {
    rec.passes++;
    rec.streak++;
    // Особистий рекорд швидкості зараховується лише для успішної (точної) спроби.
    if (metrics.spm > rec.bestSpm) rec.bestSpm = metrics.spm;
    if (rec.streak >= needed) rec.done = true;
  } else {
    rec.streak = 0;
  }
  if (metrics.accuracy > rec.bestAcc) rec.bestAcc = metrics.accuracy;

  mergeCounters(profile.chars, metrics.chars);
  mergeCounters(profile.bigrams, metrics.bigrams);
  profile.history.push({
    t: now, id: lessonId, spm: metrics.spm, acc: metrics.accuracy,
    errors: metrics.errors, ms: metrics.elapsedMs, rhythm: metrics.rhythm, passed,
  });
  if (profile.history.length > HISTORY_LIMIT) profile.history.splice(0, profile.history.length - HISTORY_LIMIT);
  return { record: rec, previousBest, justDone: rec.done && !wasDone };
}
