// node scripts/build-data.mjs — перевіряє контрольні суми сировини та будує data/derived/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, LANGS, read, sha256, serialize, buildLanguage } from './sources.mjs';

const manifest = JSON.parse(read('dictionaries/manifest.json'));
for (const ds of manifest.datasets) {
  for (const file of ds.files) {
    const actual = sha256(join('dictionaries', file.path));
    if (actual !== file.sha256) {
      console.error(`Контрольна сума не збігається: ${file.path}`);
      process.exit(1);
    }
  }
}
console.log('Контрольні суми сировини збігаються з маніфестом.');

mkdirSync(join(ROOT, 'data/derived'), { recursive: true });
const report = {};
for (const lang of Object.keys(LANGS)) {
  const { words, ngrams } = buildLanguage(lang);
  writeFileSync(join(ROOT, `data/derived/${lang}-words.json`), serialize(words));
  writeFileSync(join(ROOT, `data/derived/${lang}-ngrams.json`), serialize(ngrams));
  report[lang] = words.meta;
  console.log(lang, words.meta.counts);
}
writeFileSync(join(ROOT, 'data/derived/report.json'), JSON.stringify(report, null, 2) + '\n');
