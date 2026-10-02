// Відтворювана обробка частотних списків: сировина з dictionaries/ → data/derived/.
// Чисті функції без доступу до файлової системи, щоб їх можна було перевіряти тестами.

export const ALGO_VERSION = '1.0.0';

export const WORD_PATTERNS = {
  en: /^[a-z]+(?:['-][a-z]+)*$/u,
  uk: /^[а-щьюяєіїґ]+(?:['-][а-щьюяєіїґ]+)*$/u,
};
// Однолітерні токени, які є справжніми словами.
export const SINGLE_LETTER_WORDS = { en: 'ai', uk: 'авзійоуяє' };
// Дозволені дволітерні слова: субтитри містять багато вигуків і скорочень такої довжини.
export const TWO_LETTER_WORDS = {
  en: 'to it of is in we me he my on do no be so go if up at oh as an us or by am hi'.split(' '),
  uk: 'не що на це ти ми як за ви до ні то ну ще та по же її чи де от їх те бо би зі із ці цю їй ця їм ті ой ту аж їв їж ай'.split(' '),
};
export const MAX_WORD_LENGTH = 16;
export const WORD_LIMIT = 6000;
export const NGRAM_LIMIT = 200;

/** NFC, нижній регістр, усі варіанти апострофа → U+0027. Літери і, ї, є, ґ не змінюються. */
export function normalizeWord(raw) {
  return raw.normalize('NFC').toLowerCase().replace(/[’ʼ‘`′]/g, "'");
}

/** Рядки «слово кількість» у UTF-8. */
export function parseFrequencyList(text) {
  const out = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^(\S+)\s+(\d+)$/.exec(line.trim());
    if (m) out.push([m[1], Number(m[2])]);
  }
  return out;
}

/** Рядки блок-листа: точне слово або префікс із зірочкою («stem*»). */
export function parseBlocklist(text) {
  const exact = new Set();
  const prefixes = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('*')) prefixes.push(line.slice(0, -1));
    else exact.add(line);
  }
  return { exact, prefixes };
}

export function isBlocked(word, blocklist) {
  return blocklist.exact.has(word) || blocklist.prefixes.some((p) => word.startsWith(p));
}

/** Нормалізація, фільтр символів і довжини, злиття дублікатів. Повертає Map слово → частота. */
export function collectCandidates(lang, entries) {
  const merged = new Map();
  const stats = { input: entries.length, badCharset: 0, badLength: 0, duplicatesMerged: 0 };
  const pattern = WORD_PATTERNS[lang];
  for (const [raw, freq] of entries) {
    const w = normalizeWord(raw);
    if (!pattern.test(w)) { stats.badCharset++; continue; }
    const len = Array.from(w).length;
    if (len > MAX_WORD_LENGTH || (len === 1 && !SINGLE_LETTER_WORDS[lang].includes(w))
      || (len === 2 && !TWO_LETTER_WORDS[lang].includes(w))) { stats.badLength++; continue; }
    if (merged.has(w)) stats.duplicatesMerged++;
    merged.set(w, (merged.get(w) || 0) + freq);
  }
  return { merged, stats };
}

function isValid(word, valid) {
  if (valid.has(word)) return true;
  if (!word.includes('-')) return false;
  const parts = word.split('-');
  // Частини мають бути різними словами: відсіює заїкання на кшталт «i-i» чи «ні-ні-ні».
  return new Set(parts).size === parts.length && parts.every((p) => p.length > 1 && valid.has(p));
}

/** Фільтр словником і блок-листом, стабільне сортування, обрізання до ліміту. */
export function selectWords(merged, valid, blocklist, limit = WORD_LIMIT) {
  const stats = { notInDictionary: 0, blocked: 0 };
  const all = [];
  for (const [w, f] of merged) {
    if (isBlocked(w, blocklist)) { stats.blocked++; continue; }
    if (!isValid(w, valid)) { stats.notInDictionary++; continue; }
    all.push([w, f]);
  }
  all.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { all, words: all.slice(0, limit), stats };
}

/**
 * Частотність внутрішньословних n-грам: вага = сума частот слів, у яких n-грама зустрічається
 * (одне слово враховується один раз). N-грами з апострофом чи дефісом не рахуються.
 */
export function ngramTable(words, n, limit = NGRAM_LIMIT) {
  const weights = new Map();
  for (const [w, f] of words) {
    const chars = Array.from(w);
    const seen = new Set();
    for (let i = 0; i + n <= chars.length; i++) {
      const g = chars.slice(i, i + n).join('');
      if (/['-]/.test(g) || seen.has(g)) continue;
      seen.add(g);
      weights.set(g, (weights.get(g) || 0) + f);
    }
  }
  return [...weights].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit);
}

/**
 * Повний конвеєр для однієї мови. Детермінований: ті самі входи дають той самий результат.
 * validate(candidates:Set) → Set словникових форм (див. hunspell.js).
 */
export function processLanguage({ lang, freqText, validate, blocklistText, source, sha256 }) {
  const entries = parseFrequencyList(freqText);
  const { merged, stats: s1 } = collectCandidates(lang, entries);
  const valid = validate(new Set(merged.keys()));
  const { all, words, stats: s2 } = selectWords(merged, valid, parseBlocklist(blocklistText));
  const meta = {
    language: lang,
    source,
    sourceSha256: sha256,
    algorithmVersion: ALGO_VERSION,
    unicode: 'NFC',
    case: 'lowercase',
    apostrophes: "’ ʼ ‘ ` ′ → ' (U+0027)",
    allowedPattern: WORD_PATTERNS[lang].source,
    counts: { ...s1, afterCharsetAndDedup: merged.size, ...s2, valid: all.length, kept: words.length },
  };
  return {
    words: { meta, format: '[слово, частота]', words },
    ngrams: {
      meta: {
        language: lang,
        source,
        algorithmVersion: ALGO_VERSION,
        weight: 'сума частот слів, що містять n-граму',
        basedOnWords: all.length,
      },
      bigrams: ngramTable(all, 2),
      trigrams: ngramTable(all, 3),
    },
  };
}
