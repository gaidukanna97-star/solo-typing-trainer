// Фізичні клавіші, пальці та розкладки.
// Базове правило: одна фізична клавіша (KeyboardEvent.code) — один визначений палець.
// Призначення пальця належить клавіші, тому воно однакове для QWERTY і ЙЦУКЕН.

export const FINGERS = {
  lp: { hand: 'L', name: 'лівий мізинець', by: 'лівим мізинцем' },
  lr: { hand: 'L', name: 'лівий безіменний', by: 'лівим безіменним' },
  lm: { hand: 'L', name: 'лівий середній', by: 'лівим середнім' },
  li: { hand: 'L', name: 'лівий вказівний', by: 'лівим вказівним' },
  ri: { hand: 'R', name: 'правий вказівний', by: 'правим вказівним' },
  rm: { hand: 'R', name: 'правий середній', by: 'правим середнім' },
  rr: { hand: 'R', name: 'правий безіменний', by: 'правим безіменним' },
  rp: { hand: 'R', name: 'правий мізинець', by: 'правим мізинцем' },
  th: { hand: 'T', name: 'великий палець', by: 'великим пальцем' },
};
export const FINGER_ORDER = ['lp', 'lr', 'lm', 'li', 'ri', 'rm', 'rr', 'rp'];

// Ряди: 0 — цифровий, 1 — верхній, 2 — домашній, 3 — нижній, 4 — пробіл.
const ROWS = [
  'Backquote:lp Digit1:lp Digit2:lr Digit3:lm Digit4:li Digit5:li Digit6:ri Digit7:ri Digit8:rm Digit9:rr Digit0:rp Minus:rp Equal:rp',
  'KeyQ:lp KeyW:lr KeyE:lm KeyR:li KeyT:li KeyY:ri KeyU:ri KeyI:rm KeyO:rr KeyP:rp BracketLeft:rp BracketRight:rp Backslash:rp',
  'KeyA:lp KeyS:lr KeyD:lm KeyF:li KeyG:li KeyH:ri KeyJ:ri KeyK:rm KeyL:rr Semicolon:rp Quote:rp',
  'KeyZ:lp KeyX:lr KeyC:lm KeyV:li KeyB:li KeyN:ri KeyM:ri Comma:rm Period:rr Slash:rp',
  'Space:th',
];

/** Список усіх підтримуваних клавіш: { code, finger, row, col }. */
export const KEYS = ROWS.flatMap((line, row) =>
  line.split(' ').map((item, col) => {
    const [code, finger] = item.split(':');
    return { code, finger, row, col };
  }));

export const KEY_BY_CODE = Object.fromEntries(KEYS.map((k) => [k.code, k]));

/** Домашня клавіша кожного пальця. */
export const HOME_CODE = {
  lp: 'KeyA', lr: 'KeyS', lm: 'KeyD', li: 'KeyF',
  ri: 'KeyJ', rm: 'KeyK', rr: 'KeyL', rp: 'Semicolon', th: 'Space',
};
export const HOME_CODES = FINGER_ORDER.map((f) => HOME_CODE[f]);

// Символи в тому ж порядку, що й KEYS.
const LAYOUT_DEFS = {
  en: {
    name: 'English (QWERTY)',
    base: "`1234567890-=" + 'qwertyuiop[]\\' + "asdfghjkl;'" + 'zxcvbnm,./' + ' ',
    shift: '~!@#$%^&*()_+' + 'QWERTYUIOP{}|' + 'ASDFGHJKL:"' + 'ZXCVBNM<>?' + ' ',
    altgr: {},
    letters: /^[a-z]$/,
    foreign: /[а-яіїєґ]/i,
  },
  uk: {
    name: 'Українська (ЙЦУКЕН)',
    base: "'1234567890-=" + 'йцукенгшщзхї\\' + 'фівапролджє' + 'ячсмитьбю.' + ' ',
    shift: '₴!"№;%:?*()_+' + 'ЙЦУКЕНГШЩЗХЇ/' + 'ФІВАПРОЛДЖЄ' + 'ЯЧСМИТЬБЮ,' + ' ',
    // ґ у стандартній розширеній розкладці Windows — AltGr + г (клавіша KeyU).
    altgr: { 'ґ': 'KeyU', 'Ґ': 'KeyU' },
    letters: /^[а-щьюяєіїґ]$/,
    foreign: /[a-zыэъё]/i,
  },
};

function buildLayout(id) {
  const def = LAYOUT_DEFS[id];
  const base = Array.from(def.base);
  const shift = Array.from(def.shift);
  const charMap = new Map();
  const byCode = {};
  KEYS.forEach((key, i) => {
    byCode[key.code] = { base: base[i], shift: shift[i] };
    charMap.set(base[i], { code: key.code, shift: false, altgr: false });
    if (shift[i] !== base[i]) charMap.set(shift[i], { code: key.code, shift: true, altgr: false });
  });
  for (const [ch, code] of Object.entries(def.altgr)) {
    charMap.set(ch, { code, shift: ch !== ch.toLowerCase(), altgr: true });
  }
  return { id, name: def.name, byCode, charMap, letters: def.letters, foreign: def.foreign };
}

export const LAYOUTS = { en: buildLayout('en'), uk: buildLayout('uk') };

/** Де на клавіатурі знаходиться символ: { code, shift, altgr } або null. */
export function keyForChar(layout, ch) {
  return layout.charMap.get(ch) || null;
}

/** Палець для символу (id з FINGERS) або null, якщо символу немає в розкладці. */
export function fingerForChar(layout, ch) {
  const k = keyForChar(layout, ch);
  return k ? KEY_BY_CODE[k.code].finger : null;
}

/** Shift натискається мізинцем руки, протилежної до літери. */
export function shiftFingerFor(code) {
  return FINGERS[KEY_BY_CODE[code].finger].hand === 'L' ? 'rp' : 'lp';
}

/** Символи нижнього регістру для списку клавіш. */
export function charsOf(layout, codes) {
  return codes.map((c) => layout.byCode[c].base);
}

export function isSupported(layout, text) {
  return Array.from(text).every((ch) => layout.charMap.has(ch));
}

/** Перелік символів тексту, яких немає в розкладці. */
export function unsupportedChars(layout, text) {
  return [...new Set(Array.from(text).filter((ch) => !layout.charMap.has(ch)))];
}

// --- Нормалізація -----------------------------------------------------------
// Задокументоване правило: усі варіанти апострофа (’ U+2019, ʼ U+02BC, ‘ U+2018, ′ U+2032)
// вважаються одним символом ' (U+0027). Літери і, ї, є, ґ ніколи не замінюються.
const APOSTROPHES = /[’ʼ‘′]/g;

/** Нормалізація одного набраного символу перед порівнянням. */
export function normalizeTyped(ch) {
  return ch.normalize('NFC').replace(APOSTROPHES, "'");
}

/** Нормалізація тексту вправи: NFC, апострофи, типографські лапки/тире/пробіли → клавіатурні. */
export function normalizeText(text) {
  return text
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(/[«»“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -  \t]/g, ' ')
    .replace(/[​-‍﻿́]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Чи схожий набраний символ на іншу розкладку (латиниця під час української вправи тощо). */
export function looksLikeWrongLayout(layout, ch) {
  return layout.foreign.test(ch);
}

// --- Аналіз переходів -------------------------------------------------------

/** Опис переходу між двома символами: ті самі/різні руки, палець, ряди. */
export function transitionInfo(layout, a, b) {
  const ka = keyForChar(layout, a);
  const kb = keyForChar(layout, b);
  if (!ka || !kb) return null;
  const A = KEY_BY_CODE[ka.code];
  const B = KEY_BY_CODE[kb.code];
  const fa = FINGERS[A.finger];
  const fb = FINGERS[B.finger];
  const sameKey = A.code === B.code;
  const sameFinger = A.finger === B.finger && !sameKey;
  const sameHand = fa.hand === fb.hand && fa.hand !== 'T';
  const adjacent = sameHand && Math.abs(FINGER_ORDER.indexOf(A.finger) - FINGER_ORDER.indexOf(B.finger)) === 1;
  return {
    sameKey,
    sameFinger,
    sameHand,
    alternate: fa.hand !== fb.hand && fa.hand !== 'T' && fb.hand !== 'T',
    roll: adjacent && A.row === B.row,
    rowChange: A.row !== B.row,
    fingers: [A.finger, B.finger],
  };
}

/** Схема складності слова (див. ТЗ 5.3). */
export function describeWord(layout, word, language, frequency, source) {
  const chars = Array.from(word);
  const bigrams = [];
  let sameFingerTransitions = 0;
  let rowChanges = 0;
  for (let i = 0; i + 1 < chars.length; i++) {
    bigrams.push(chars[i] + chars[i + 1]);
    const t = transitionInfo(layout, chars[i], chars[i + 1]);
    if (t && t.sameFinger) sameFingerTransitions++;
    if (t && t.rowChange) rowChanges++;
  }
  return {
    word, language, frequency, source, characters: chars, bigrams,
    difficulty: { length: chars.length, sameFingerTransitions, rowChanges },
    flags: [],
  };
}
