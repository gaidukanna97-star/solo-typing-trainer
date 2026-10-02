// Рушій спроби набору. Чистий стан без DOM: його можна перевіряти тестами.
//
// Режими:
//   stop      — зупинка на помилці: хибний символ не просуває курсор, позиція лишається позначеною;
//   backspace — хибний символ вводиться, його треба стерти клавішею Backspace.
// У будь-якому режимі кожне хибне натискання назавжди входить до статистики помилок,
// а позиція, де воно сталося, позначається як «виправлена», а не «чиста».

import { normalizeTyped } from './layouts.js';
import { LEVELS, PAUSE_MS } from './config.js';

export function createSession(text, { mode = 'stop' } = {}) {
  return {
    target: Array.from(text),
    mode,
    pos: 0,
    typed: [], // режим backspace: що зараз стоїть на позиціях < pos
    hadError: new Set(), // позиції, де була хоча б одна помилка
    events: [], // { t, pos, expected, typed, ok }
    keystrokes: 0,
    errors: 0,
    startedAt: null,
    endedAt: null,
    done: false,
  };
}

/** Натискання друкованого символу. Повертає 'correct' | 'error' | 'done' | 'ignored'. */
export function press(s, rawChar, t) {
  if (s.done || s.pos >= s.target.length) return 'ignored';
  const ch = normalizeTyped(rawChar);
  const expected = s.target[s.pos];
  if (s.startedAt === null) s.startedAt = t;
  const ok = ch === expected;
  s.keystrokes++;
  s.events.push({ t, pos: s.pos, expected, typed: ch, ok });
  if (!ok) {
    s.errors++;
    s.hadError.add(s.pos);
    if (s.mode === 'stop') return 'error';
  }
  s.typed[s.pos] = ch;
  s.pos++;
  if (s.pos >= s.target.length && (s.mode === 'stop' || s.typed.every((c, i) => c === s.target[i]))) {
    s.done = true;
    s.endedAt = t;
    return 'done';
  }
  if (s.pos > s.target.length) s.pos = s.target.length; // у кінці тексту з помилками чекаємо Backspace
  return ok ? 'correct' : 'error';
}

/** Backspace працює лише в режимі backspace. Статистика помилок не зменшується. */
export function backspace(s) {
  if (s.done || s.mode !== 'backspace' || s.pos === 0) return false;
  s.pos--;
  s.typed.length = s.pos;
  return true;
}

/** Стан позиції для відображення: pending | current | correct | corrected | wrong. */
export function charState(s, i) {
  if (i === s.pos && !s.done) return s.hadError.has(i) && s.mode === 'stop' ? 'current-error' : 'current';
  if (i > s.pos || (i === s.pos && s.done)) return 'pending';
  if (s.mode === 'backspace' && s.typed[i] !== s.target[i]) return 'wrong';
  return s.hadError.has(i) ? 'corrected' : 'correct';
}

const round1 = (x) => Math.round(x * 10) / 10;

/** SPM = правильно набрані символи / хвилини. */
export function spm(correctChars, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  return round1(correctChars / (elapsedMs / 60000));
}

/** Точність за всіма натисканнями, включно з виправленими помилками, у відсотках. */
export function accuracy(keystrokes, errors) {
  if (keystrokes <= 0) return 0;
  return round1(((keystrokes - errors) / keystrokes) * 100);
}

/** Найвищий рівень, для якого виконано і швидкість, і точність. Без точності швидкість не зараховується. */
export function levelFor(spmValue, acc, levels = LEVELS) {
  let best = null;
  for (const lvl of levels) {
    if (acc >= lvl.minAcc && spmValue >= lvl.minSpm) best = lvl;
  }
  return best;
}

/** Підсумок спроби. now — час завершення для незавершеної спроби. */
export function summarize(s, now) {
  const end = s.endedAt ?? now ?? (s.events.length ? s.events[s.events.length - 1].t : 0);
  const elapsedMs = s.startedAt === null ? 0 : Math.max(0, end - s.startedAt);
  let correctChars = 0;
  for (let i = 0; i < s.pos; i++) if (s.typed[i] === s.target[i]) correctChars++;

  const errorsByChar = {};
  const chars = {}; // expected → { n, err, ms, timed }
  const bigrams = {}; // пара очікуваних символів → { n, err, ms }
  const intervals = [];
  const bump = (obj, key) => (obj[key] ??= { n: 0, err: 0, ms: 0, timed: 0 });

  let prev = null;
  for (const e of s.events) {
    const c = bump(chars, e.expected);
    c.n++;
    const pair = prev && prev.ok && e.pos === prev.pos + 1 ? prev.expected + e.expected : null;
    if (!e.ok) {
      c.err++;
      errorsByChar[e.expected] = (errorsByChar[e.expected] || 0) + 1;
      if (pair) bump(bigrams, pair).err++;
    } else if (pair) {
      const dt = e.t - prev.t;
      const b = bump(bigrams, pair);
      b.n++;
      if (dt <= PAUSE_MS) {
        b.ms += dt; b.timed++;
        c.ms += dt; c.timed++;
        intervals.push(dt);
      }
    }
    prev = e;
  }

  // Нерівномірність ритму — коефіцієнт варіації інтервалів між правильними натисканнями, %.
  let rhythm = null;
  if (intervals.length >= 5) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    rhythm = mean > 0 ? Math.round((Math.sqrt(variance) / mean) * 100) : null;
  }

  const spmValue = spm(correctChars, elapsedMs);
  const acc = accuracy(s.keystrokes, s.errors);
  return {
    completed: s.done,
    length: s.target.length,
    correctChars,
    keystrokes: s.keystrokes,
    errors: s.errors,
    correctedPositions: s.hadError.size,
    elapsedMs,
    spm: spmValue,
    wpm: round1(spmValue / 5),
    accuracy: acc,
    rhythm,
    errorsByChar,
    chars,
    bigrams,
    intervals,
    level: levelFor(spmValue, acc),
  };
}

/** Чи зарахована спроба: точність обов'язкова, швидкість — лише якщо правило її вимагає. */
export function isPassed(metrics, rule, { speedGate = true } = {}) {
  if (!metrics.completed) return false;
  if (metrics.accuracy < rule.minAcc) return false;
  if (speedGate && metrics.spm < rule.minSpm) return false;
  return true;
}
