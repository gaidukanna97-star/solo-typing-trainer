// node scripts/outline.mjs — зберігає план програми у data/curriculum/outline-<мова>.json:
// усі вправи трьох етапів, відкриті символи та зразок тексту (варіант 0).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, read } from './sources.mjs';
import { buildCurriculum, generateText } from '../src/core/curriculum.js';

export function loadCurriculum(lang) {
  return buildCurriculum(lang, {
    words: JSON.parse(read(`data/derived/${lang}-words.json`)).words,
    ngrams: JSON.parse(read(`data/derived/${lang}-ngrams.json`)),
    content: JSON.parse(read(`data/curriculum/content-${lang}.json`)),
  });
}

export function outline(lang) {
  const cur = loadCurriculum(lang);
  return {
    language: lang,
    note: 'Згенеровано scripts/outline.mjs із data/derived/ та content-*.json. Не редагувати вручну.',
    modules: cur.modules,
    lessons: cur.lessons.map((l) => ({
      id: l.id, stage: l.stage, module: l.module ?? null, title: l.title, goal: l.goal,
      rule: l.rule, mechanics: l.mechanics,
      newChars: l.newChars ?? [],
      openChars: l.stage < 3 ? [...l.open].join('') : 'усі символи розкладки',
      sample: generateText(cur, l, { seed: 0 }),
    })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('outline.mjs')) {
  for (const lang of ['uk', 'en']) {
    const data = outline(lang);
    writeFileSync(join(ROOT, `data/curriculum/outline-${lang}.json`), JSON.stringify(data, null, 2) + '\n');
    console.log(lang, data.lessons.length, 'вправ;', data.modules.length, 'модулів Академії');
  }
}
