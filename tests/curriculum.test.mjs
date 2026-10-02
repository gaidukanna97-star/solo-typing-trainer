// ТЗ п. 8.3: вправи другого етапу не містять невідкритих символів; добір вправ і адаптація.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCurriculum } from '../scripts/outline.mjs';
import {
  generateText, isAvailable, nextLesson, userOpenChars, reviewExercise, realText, warmupText,
  dailyPlan, moduleProgress, weakSpots,
} from '../src/core/curriculum.js';
import { isSupported, charsOf, HOME_CODES, transitionInfo } from '../src/core/layouts.js';
import { emptyProfile } from '../src/core/storage.js';
import { nextAction, drillText } from '../src/core/feedback.js';
import { createSession, press, summarize } from '../src/core/session.js';
import { PASS_RULES } from '../src/core/config.js';
import { prepareCustomText } from '../src/core/customtext.js';

const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];
const curricula = { uk: loadCurriculum('uk'), en: loadCurriculum('en') };

for (const [lang, cur] of Object.entries(curricula)) {
  test(`${lang}: є повний маршрут через три етапи`, () => {
    for (const stage of [1, 2, 3]) assert.ok(cur.lessons.filter((l) => l.stage === stage).length >= 10, `етап ${stage}`);
    assert.ok(cur.modules.length >= 8, 'модулі Академії');
    assert.equal(new Set(cur.lessons.map((l) => l.id)).size, cur.lessons.length, 'унікальні id');
    assert.equal(cur.lessons[0].stage, 1);
  });

  test(`${lang}: вправи етапу 2 складаються лише з уже відкритих символів`, () => {
    const stage2 = cur.lessons.filter((l) => l.stage === 2);
    for (const lesson of stage2) {
      for (const seed of SEEDS) {
        const text = generateText(cur, lesson, { seed });
        for (const ch of text) assert.ok(lesson.open.has(ch), `${lesson.id} (варіант ${seed}): невідкритий символ «${ch}» у «${text}»`);
        assert.ok(new Set(text.split(' ')).size >= 4, `${lesson.id}: достатньо різних слів`);
      }
    }
  });

  test(`${lang}: гами етапу 1 теж не виходять за відкриті клавіші`, () => {
    for (const lesson of cur.lessons.filter((l) => l.stage === 1)) {
      for (const seed of SEEDS) {
        const text = generateText(cur, lesson, { seed });
        for (const ch of text) assert.ok(lesson.open.has(ch), `${lesson.id}: «${ch}» у «${text}»`);
      }
    }
  });

  test(`${lang}: відкритих символів стає тільки більше, нові клавіші — малими порціями`, () => {
    let prev = new Set();
    for (const lesson of cur.lessons.filter((l) => l.stage < 3)) {
      for (const ch of prev) assert.ok(lesson.open.has(ch), `${lesson.id}: символ «${ch}» зник`);
      if (lesson.kind === 'keys') assert.ok(lesson.newChars.length <= 3, `${lesson.id}: не більше трьох нових клавіш`);
      prev = lesson.open;
    }
  });

  test(`${lang}: перша вправа — вказівні пальці домашнього ряду, слова з'являються після домашнього ряду`, () => {
    assert.deepEqual(cur.lessons[0].newChars, charsOf(cur.layout, ['KeyF', 'KeyJ']));
    const firstWords = cur.lessons.find((l) => l.stage === 2);
    const home = new Set([...charsOf(cur.layout, HOME_CODES), ' ']);
    assert.deepEqual([...firstWords.open].sort(), [...home].sort());
  });

  test(`${lang}: слова етапу 2 — реальні слова з похідного словника або з явного списку`, () => {
    const known = new Set([...cur.wordList, ...cur.content.apostropheWords, ...cur.content.gWords]);
    for (const lesson of cur.lessons.filter((l) => l.stage === 2)) {
      for (const word of generateText(cur, lesson, { seed: 1 }).split(' ')) {
        assert.ok(known.has(word.toLowerCase()), `${lesson.id}: «${word}» немає у словнику`);
      }
      assert.equal(lesson.mechanics, false);
    }
    for (const lesson of cur.lessons.filter((l) => l.stage === 1)) assert.equal(lesson.mechanics, true, 'гами позначено як механіку');
  });

  test(`${lang}: усі вправи можна набрати в розкладці, тексти детерміновані`, () => {
    for (const lesson of cur.lessons) {
      for (const seed of SEEDS) {
        const text = generateText(cur, lesson, { seed });
        assert.ok(text.length >= 30, `${lesson.id}: задовгий/закороткий текст (${text.length})`);
        assert.ok(isSupported(cur.layout, text), `${lesson.id}: є символи поза розкладкою`);
        assert.ok(!/^ | $| {2}/.test(text), `${lesson.id}: зайві пробіли`);
        assert.equal(generateText(cur, lesson, { seed }), text, `${lesson.id}: той самий варіант — той самий текст`);
      }
    }
  });

  test(`${lang}: Академія — біграми, триграми, переходи одним пальцем`, () => {
    const byModule = (id) => cur.lessons.filter((l) => l.module === id);
    const top = cur.ngrams.bigrams.slice(0, 4).map(([g]) => g);
    assert.deepEqual(byModule('bigrams')[0].grams, top, 'перша вправа — найчастотніші біграми');
    assert.ok(byModule('trigrams').every((l) => l.grams.every((g) => Array.from(g).length === 3)));
    for (const l of byModule('samefinger')) {
      for (const g of l.grams) assert.equal(transitionInfo(cur.layout, g[0], g[1]).sameFinger, true, g);
    }
    const text = generateText(cur, byModule('bigrams')[0], { seed: 0 });
    for (const g of top) assert.ok(text.split(' ').filter((w) => w.includes(g)).length >= 4, `біграма «${g}» у вправі`);
    for (const id of ['morphemes', 'flow', 'signs', 'tempo', 'sentences', 'paragraphs']) assert.ok(byModule(id).length > 0, id);
  });

  test(`${lang}: послідовне відкриття вправ`, () => {
    const profile = emptyProfile();
    assert.equal(nextLesson(cur, profile).id, cur.lessons[0].id);
    assert.equal(isAvailable(cur, profile, cur.lessons[0]), true);
    assert.equal(isAvailable(cur, profile, cur.lessons[1]), false);
    profile.lessons[cur.lessons[0].id] = { done: true };
    assert.equal(isAvailable(cur, profile, cur.lessons[1]), true);
    assert.equal(isAvailable(cur, profile, cur.lessons[2]), false);
    assert.equal(nextLesson(cur, profile).id, cur.lessons[1].id);
    const firstAcademy = cur.lessons.find((l) => l.stage === 3);
    assert.equal(isAvailable(cur, profile, firstAcademy), false);
    // Діагностика відкриває етапи 1–2 і початок Академії, але не всю Академію одразу.
    profile.placed = true;
    assert.equal(isAvailable(cur, profile, cur.lessons[5]), true);
    assert.equal(isAvailable(cur, profile, firstAcademy), true);
    assert.equal(isAvailable(cur, profile, cur.lessons[firstAcademy.index + 1]), false);
    assert.equal(moduleProgress(cur, profile, cur.modules[0]).done, 0);
  });

  test(`${lang}: відкриті символи учня та вільні вправи не виходять за них`, () => {
    const profile = emptyProfile();
    const third = cur.lessons[2];
    for (const l of cur.lessons.slice(0, 3)) profile.lessons[l.id] = { done: true };
    const open = userOpenChars(cur, profile);
    assert.deepEqual([...open].sort(), [...third.open].sort());
    for (const text of [warmupText(cur, profile), realText(cur, profile, 1)]) {
      for (const ch of text) assert.ok(open.has(ch), `«${ch}» у «${text}»`);
    }
  });

  test(`${lang}: заняття дня має чотири частини`, () => {
    const plan = dailyPlan(cur, emptyProfile());
    assert.deepEqual(plan.map((s) => s.type), ['warmup', 'lesson', 'review', 'text']);
    assert.equal(plan[1].id, cur.lessons[0].id);
  });
}

test('добір слів адаптується до слабких клавіш і переходів', () => {
  const cur = curricula.en;
  const lesson = cur.byId.get('s2-bn');
  const profile = emptyProfile();
  const count = (p) => SEEDS.reduce((sum, seed) =>
    sum + generateText(cur, lesson, { seed, profile: p }).split(' ').filter((w) => w.includes('q')).length, 0);
  const before = count(profile);
  profile.chars.q = { n: 40, err: 12, ms: 0, timed: 0 };
  assert.deepEqual(weakSpots(cur, profile, lesson.open).chars, ['q']);
  assert.ok(count(profile) > before + 5, 'слів зі слабкою клавішею стало помітно більше');

  profile.placed = true; // усі клавіші відкрито
  const review = reviewExercise(cur, profile, 0);
  assert.ok(review.text.split(' ').filter((w) => w.includes('q')).length >= 4);
  assert.match(review.goal, /лівий мізинець/);
  assert.equal(reviewExercise(cur, emptyProfile(), 0), null, 'без статистики повторення не вигадується');
});

test('слабка клавіша, яку ще не відкрито, у вправу не потрапляє', () => {
  const cur = curricula.uk;
  const lesson = cur.byId.get('s2-home');
  const profile = emptyProfile();
  profile.chars['щ'] = { n: 40, err: 20, ms: 0, timed: 0 };
  assert.deepEqual(weakSpots(cur, profile, lesson.open).chars, []);
  for (const seed of SEEDS) assert.ok(!generateText(cur, lesson, { seed, profile }).includes('щ'));
});

test('зворотний зв’язок: одна конкретна наступна дія', () => {
  const cur = curricula.uk;
  const ctx = { layout: cur.layout, rule: PASS_RULES.words, streak: 0, needed: 3, next: cur.lessons[1] };

  // Двічі помилка на переході «ол» → порада повторити саме цей перехід із назвами пальців.
  const s = createSession('ол ол ол ол ол ол ол');
  let t = 0;
  for (const [i, ch] of Array.from('ол ол ол ол ол ол ол').entries()) {
    if (i === 1 || i === 4) press(s, 'д', t += 200);
    press(s, ch, t += 200);
  }
  const m = summarize(s);
  const advice = nextAction(m, { ...ctx, passed: false });
  assert.deepEqual(advice.action, { type: 'drill', chars: [], bigrams: ['ол'] });
  assert.match(advice.text, /Повтори перехід «ол»/);
  assert.match(advice.text, /правим вказівним, правим середнім/);

  // Розсіяні помилки → знизити темп до точності.
  const s2 = createSession('фіва олдж');
  t = 0;
  for (const [i, ch] of Array.from('фіва олдж').entries()) {
    if (i === 0 || i === 6) press(s2, 'ц', t += 100);
    press(s2, ch, t += 100);
  }
  const slow = nextAction(summarize(s2), { ...ctx, passed: false });
  assert.match(slow.text, /Знизь темп до \d+ SPM, доки точність не буде 96%/);

  // Чиста спроба: спершу добрати серію, потім — наступна вправа.
  const s3 = createSession('фіва олдж');
  Array.from('фіва олдж').forEach((ch, i) => press(s3, ch, i * 300));
  const clean = summarize(s3);
  assert.match(nextAction(clean, { ...ctx, passed: true, streak: 1 }).text, /Ще 2 успішні спроби поспіль/);
  const done = nextAction(clean, { ...ctx, passed: true, streak: 3 });
  assert.equal(done.action.type, 'next');
  assert.ok(done.text.includes(cur.lessons[1].title));

  const drill = drillText(cur.layout, cur.wordList, cur.lessons[7].open, advice.action);
  for (const ch of drill) assert.ok(cur.lessons[7].open.has(ch));
});

test('власний текст: безпечна перевірка формату', () => {
  const { layout } = curricula.uk;
  const ok = prepareCustomText(layout, '# Заголовок\n\nЦе **власний** текст — для набору, [посилання](https://example.com).', 'нотатки.md');
  assert.equal(ok.text, 'Заголовок Це власний текст - для набору, посилання.');
  assert.deepEqual(ok.removed, []);
  const mixed = prepareCustomText(layout, 'Український текст із hello латиницею всередині речення.', 'a.txt');
  assert.ok(mixed.removed.includes('h'));
  assert.ok(!/[a-z]/.test(mixed.text));
  assert.ok(mixed.text.includes('і'), 'українська «і» лишається');
  assert.throws(() => prepareCustomText(layout, 'текст', 'virus.exe'), /лише файли \.txt і \.md/);
  assert.throws(() => prepareCustomText(layout, 'коротко', 'a.txt'), /замало тексту/);
  assert.throws(() => prepareCustomText(layout, 'PK\u0003\u0004 бінарний вміст файлу архіву', 'a.txt'), /не схожий на текст/);
  assert.ok(prepareCustomText(layout, 'слово '.repeat(400), '').cut);
});
