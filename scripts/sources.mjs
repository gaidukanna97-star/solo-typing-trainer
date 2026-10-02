// Опис сировини та шляхів. Використовується збіркою даних і тестами.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCandidates } from '../src/data/hunspell.js';
import { processLanguage } from '../src/data/process.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const LANGS = {
  en: {
    freq: 'dictionaries/en/frequencywords-2018/en_50k.txt',
    dic: 'dictionaries/en/hunspell-en/index.dic',
    aff: 'dictionaries/en/hunspell-en/index.aff',
    blocklist: 'data/filters/blocklist-en.txt',
    source: 'frequencywords-2018-en',
  },
  uk: {
    freq: 'dictionaries/uk/frequencywords-2018/uk_50k.txt',
    dic: 'dictionaries/uk/hunspell-uk/index.dic',
    aff: 'dictionaries/uk/hunspell-uk/index.aff',
    blocklist: 'data/filters/blocklist-uk.txt',
    source: 'frequencywords-2018-uk',
  },
};

export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
export const sha256 = (rel) => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');

/** Стабільна серіалізація: один запис слова на рядок, щоб диф у git був читабельним. */
export function serialize(obj) {
  const rows = (arr) => '[\n' + arr.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]';
  const parts = Object.entries(obj).map(([k, v]) =>
    `  ${JSON.stringify(k)}: ${Array.isArray(v) ? rows(v) : JSON.stringify(v)}`);
  return '{\n' + parts.join(',\n') + '\n}\n';
}

export function buildLanguage(lang) {
  const cfg = LANGS[lang];
  const dic = read(cfg.dic);
  const aff = read(cfg.aff);
  return processLanguage({
    lang,
    freqText: read(cfg.freq),
    validate: (candidates) => validateCandidates(dic, aff, candidates),
    blocklistText: read(cfg.blocklist),
    source: cfg.source,
    sha256: sha256(cfg.freq),
  });
}
