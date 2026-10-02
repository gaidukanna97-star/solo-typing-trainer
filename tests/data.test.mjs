// ТЗ п. 8.5–8.8, 8.10: кодування словників, контрольні суми, відтворюваність обробки, офлайн.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, LANGS, read, sha256, serialize, buildLanguage } from '../scripts/sources.mjs';
import { outline } from '../scripts/outline.mjs';
import {
  normalizeWord, parseFrequencyList, collectCandidates, selectWords, parseBlocklist, ngramTable, WORD_PATTERNS,
} from '../src/data/process.js';
import { parseAff, expandEntry, validateCandidates } from '../src/data/hunspell.js';

const manifest = JSON.parse(read('dictionaries/manifest.json'));
const built = { en: buildLanguage('en'), uk: buildLanguage('uk') };

test('контрольні суми незмінної сировини збігаються з маніфестом', () => {
  let files = 0;
  for (const ds of manifest.datasets) {
    assert.ok(ds.license && ds.source && ds.revision, `${ds.id}: джерело, ревізія, ліцензія`);
    assert.ok(existsSync(join(ROOT, 'dictionaries', ds.licenseFile)), `${ds.id}: файл ліцензії`);
    for (const file of ds.files) {
      assert.equal(sha256(join('dictionaries', file.path)), file.sha256, file.path);
      files++;
    }
  }
  assert.ok(files >= 14);
});

test('у каталозі dictionaries/ немає файлів поза маніфестом', () => {
  const listed = new Set(manifest.datasets.flatMap((d) => d.files.map((f) => f.path)));
  const walk = (dir) => readdirSync(join(ROOT, 'dictionaries', dir), { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]));
  for (const path of walk('')) {
    if (path !== 'manifest.json') assert.ok(listed.has(path), `${path} не описано в маніфесті`);
  }
});

test('вхідні словники читаються у правильному кодуванні (UTF-8)', () => {
  for (const [lang, cfg] of Object.entries(LANGS)) {
    for (const rel of [cfg.freq, cfg.dic, cfg.aff]) {
      const bytes = readFileSync(join(ROOT, rel));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // кидає помилку на хибних байтах
      assert.ok(!text.includes('�'), `${rel}: без символів заміни`);
    }
    const entries = parseFrequencyList(read(cfg.freq));
    assert.equal(entries.length, 50000, `${lang}: 50 000 записів`);
  }
  const uk = new Map(parseFrequencyList(read(LANGS.uk.freq)));
  for (const w of ['що', 'він', 'її', 'є', 'їх', 'життя']) assert.ok(uk.has(w), `«${w}» прочитано кирилицею`);
  assert.ok(new Map(parseFrequencyList(read(LANGS.en.freq))).has('the'));
});

test('нормалізація слів не підміняє і, ї, є, ґ', () => {
  assert.equal(normalizeWord('Ґанок'), 'ґанок');
  assert.equal(normalizeWord('ЇЖАК'), 'їжак');
  assert.equal(normalizeWord('Є'), 'є');
  assert.equal(normalizeWord('Італія'), 'італія');
  assert.equal(normalizeWord('п’ять'), "п'ять");
  assert.equal(normalizeWord('пʼять'), "п'ять");
  assert.ok(WORD_PATTERNS.uk.test('ґедзь') && WORD_PATTERNS.uk.test("об'єкт") && WORD_PATTERNS.uk.test('будь-який'));
  assert.ok(!WORD_PATTERNS.uk.test('это') && !WORD_PATTERNS.uk.test('был') && !WORD_PATTERNS.uk.test('объект'), 'російські літери не проходять');
  assert.ok(!WORD_PATTERNS.uk.test('iнший'), 'латинська i не проходить як українська');
  const letters = new Set(built.uk.words.words.flatMap(([w]) => Array.from(w)));
  for (const ch of 'іїє') assert.ok(letters.has(ch), `літера «${ch}» є в похідному словнику`);
  for (const ch of 'ыэъё') assert.ok(!letters.has(ch));
});

test('повторний запуск обробки дає той самий результат, і він збігається зі збереженим', () => {
  for (const lang of ['en', 'uk']) {
    const again = buildLanguage(lang);
    assert.equal(serialize(again.words), serialize(built[lang].words), `${lang}: слова`);
    assert.equal(serialize(again.ngrams), serialize(built[lang].ngrams), `${lang}: n-грами`);
    assert.equal(read(`data/derived/${lang}-words.json`), serialize(built[lang].words), `${lang}: data/derived актуальний`);
    assert.equal(read(`data/derived/${lang}-ngrams.json`), serialize(built[lang].ngrams));
    assert.equal(read(`data/curriculum/outline-${lang}.json`), JSON.stringify(outline(lang), null, 2) + '\n', `${lang}: план програми актуальний`);
  }
});

test('похідний словник: формат, сортування, фільтри', () => {
  for (const lang of ['en', 'uk']) {
    const { meta, words } = built[lang].words;
    assert.equal(words.length, 6000);
    assert.equal(meta.sourceSha256, sha256(LANGS[lang].freq));
    assert.equal(new Set(words.map(([w]) => w)).size, words.length, 'без дублікатів');
    for (let i = 1; i < words.length; i++) assert.ok(words[i - 1][1] >= words[i][1], 'за спаданням частоти');
    const blocklist = parseBlocklist(read(LANGS[lang].blocklist));
    for (const [w] of words) {
      assert.match(w, WORD_PATTERNS[lang]);
      assert.ok(!blocklist.exact.has(w) && !blocklist.prefixes.some((p) => w.startsWith(p)), `«${w}» у блок-листі`);
    }
    const c = meta.counts;
    assert.equal(c.input, 50000);
    assert.equal(c.afterCharsetAndDedup - c.notInDictionary - c.blocked, c.valid, 'лічильники сходяться');
  }
  const en = new Set(built.en.words.words.map(([w]) => w));
  for (const name of ['john', 'michael', 'london']) assert.ok(!en.has(name), `власна назва «${name}» відсіяна`);
  const uk = new Set(built.uk.words.words.map(([w]) => w));
  for (const ru of ['что', 'как', 'если', 'только', 'конечно']) assert.ok(!uk.has(ru), `російське «${ru}» відсіяне`);
});

test('n-грами: вага — сума частот слів, слово рахується один раз', () => {
  const table = ngramTable([['банан', 10], ['на', 5], ["п'ять", 7]], 2);
  const w = Object.fromEntries(table);
  assert.equal(w['на'], 15);
  assert.equal(w['ан'], 10, '«ан» двічі в слові, але слово враховано один раз');
  assert.equal(w["п'"], undefined, 'пари з апострофом не рахуються');
  assert.equal(w['ят'], 7);
  assert.equal(built.en.ngrams.bigrams[0][0], 'th');
  assert.equal(built.en.ngrams.trigrams[0][0], 'the');
});

test('обробка: дублікати зливаються, сортування стабільне', () => {
  const { merged, stats } = collectCandidates('uk', [['Слово', 3], ['слово', 2], ['это', 9], ['я', 1], ['ъ', 1], ['б', 5]]);
  assert.equal(merged.get('слово'), 5);
  assert.equal(stats.duplicatesMerged, 1);
  assert.equal(stats.badCharset, 2);
  assert.equal(stats.badLength, 1);
  const { words } = selectWords(new Map([['б', 1], ['а', 1], ['в', 2]]), new Set(['а', 'б', 'в']), parseBlocklist(''));
  assert.deepEqual(words.map(([w]) => w), ['в', 'а', 'б']);
});

test('Hunspell: розгортання форм і відсіювання власних назв', () => {
  const aff = parseAff('SFX A Y 2\nSFX A 0 s [^y]\nSFX A y ies y\nPFX B Y 1\nPFX B 0 un .\n');
  assert.deepEqual(expandEntry('cat', 'A', aff), ['cat', 'cats']);
  assert.deepEqual(expandEntry('city', 'A', aff), ['city', 'cities']);
  assert.deepEqual(expandEntry('do', 'AB', aff).sort(), ['do', 'dos', 'undo', 'undos']);
  const valid = validateCandidates('3\ncat/A\nJohn\ncity/A\n', 'SFX A Y 2\nSFX A 0 s [^y]\nSFX A y ies y\n', new Set(['cats', 'john', 'cities', 'dog']));
  assert.deepEqual([...valid].sort(), ['cats', 'cities']);
});

test('офлайн: service worker кешує всі модулі та дані, потрібні для базового навчання', () => {
  const sw = read('sw.js');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|json|css|html|svg|webmanifest))'/g)].map((m) => m[1]));
  const modules = ['src/core', 'src/ui'].flatMap((dir) => readdirSync(join(ROOT, dir)).map((f) => `${dir}/${f}`));
  const data = ['uk', 'en'].flatMap((l) => [`data/derived/${l}-words.json`, `data/derived/${l}-ngrams.json`, `data/curriculum/content-${l}.json`]);
  for (const file of [...modules, ...data, 'index.html', 'styles.css']) assert.ok(listed.has(file), `${file} немає у списку кешу`);
  for (const file of listed) assert.ok(existsSync(join(ROOT, file)), `${file} зі списку кешу не існує`);
  // Єдина зовнішня адреса — сервер кабінетів у src/core/remote.js; сторонніх скриптів, шрифтів і аналітики немає.
  for (const file of [...modules, 'index.html', 'styles.css']) {
    assert.ok(!/(?:src|href|fetch\(|import)\s*=?\s*\(?['"]https?:/.test(read(file)), `${file}: зовнішній ресурс`);
    const urls = [...read(file).matchAll(/https?:\/\/[^\s'"`)<]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('http://www.w3.org/'));
    if (file === 'src/core/remote.js') assert.deepEqual(urls, ['https://solo-typing-trainer.vercel.app/api/account']);
    else assert.deepEqual(urls, [], `${file}: зовнішня адреса`);
  }
});

test('у репозиторії немає секретів', () => {
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git', 'dictionaries', '.vercel', '.local-data'].includes(e.name)) return [];
    return e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`];
  });
  const secret = /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,})/;
  for (const file of walk('')) {
    if (/\.(js|mjs|json|html|css|md|yml|txt)$/.test(file)) assert.ok(!secret.test(read(file)), file);
    if (/^\.env(\..+)?$/.test(file) && file !== '.env.example') assert.match(read('.gitignore'), /^\.env\*$/m, `${file} має бути в .gitignore`);
    else if (/\.(js|mjs|json)$/.test(file)) assert.ok(!/BLOB_READ_WRITE_TOKEN\s*[:=]\s*['"]\w/.test(read(file)), `${file}: токен сховища в коді`);
  }
});
