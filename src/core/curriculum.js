// Навчальна програма: три етапи.
//   Етап 1 — клавіатурні гами (чиста механіка, поступове відкриття клавіш);
//   Етап 2 — реальні слова лише з уже відкритих символів;
//   Етап 3 — Академія: частотні біграми/триграми, морфеми, переходи, знаки, темп, тексти.
// Програма описана через фізичні клавіші, тому однакова для QWERTY та ЙЦУКЕН;
// символи, слова й n-грами підставляються з розкладки та похідних словників.

import {
  LAYOUTS, KEYS, KEY_BY_CODE, HOME_CODE, FINGERS, FINGER_ORDER,
  fingerForChar, keyForChar, transitionInfo, charsOf, normalizeText, isSupported,
} from './layouts.js';
import { weakChars, slowBigrams, errorBigrams } from './analysis.js';

// --- Детермінований генератор випадкових чисел ------------------------------
export function rng(seed) {
  let a = (seed >>> 0) + 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function sample(r, arr, n) {
  const pool = [...arr];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

// --- Опис шляху (етапи 1 і 2) -------------------------------------------------
const K = (id, ...codes) => ({ t: 'keys', id, codes });
const S = (id) => ({ t: 'scale', id });
const W = (id, mode = 'new') => ({ t: 'words', id, mode });

const PATH = [
  K('fj', 'KeyF', 'KeyJ'), K('dk', 'KeyD', 'KeyK'), K('sl', 'KeyS', 'KeyL'), K('a;', 'KeyA', 'Semicolon'),
  S('seq'), S('mirror'), S('alt'), W('home'),
  K('gh', 'KeyG', 'KeyH'), W('gh'),
  K('ru', 'KeyR', 'KeyU'), W('ru'),
  K('ei', 'KeyE', 'KeyI'), W('ei'),
  K('wo', 'KeyW', 'KeyO'), W('wo'),
  K('qp', 'KeyQ', 'KeyP'), W('qp'),
  K('ty', 'KeyT', 'KeyY'), W('ty'),
  K('vm', 'KeyV', 'KeyM'), W('vm'),
  K('c,', 'KeyC', 'Comma'), W('c,'),
  K('x.', 'KeyX', 'Period'), W('x.'),
  K('z/', 'KeyZ', 'Slash'), W('z/'),
  K('bn', 'KeyB', 'KeyN'), W('bn'),
  S('vertical'), S('onefinger'),
  K('br', 'BracketLeft', 'BracketRight', 'Quote'), W('br'),
  W('doubles', 'doubles'), W('samefinger', 'samefinger'), W('alternate', 'alternate'),
  S('shift'), W('caps', 'caps'),
  S('special'), W('special', 'special'),
  S('digits'), W('hyphen', 'hyphen'),
  S('punct'), S('rhythm'),
];

const PUNCT = [',', '.', '?', '!', ':', ';', '"'];
const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
// Колонки клавіатури: верхній, домашній, нижній ряд.
const COLUMNS = [
  ['KeyQ', 'KeyA', 'KeyZ'], ['KeyW', 'KeyS', 'KeyX'], ['KeyE', 'KeyD', 'KeyC'], ['KeyR', 'KeyF', 'KeyV'],
  ['KeyT', 'KeyG', 'KeyB'], ['KeyY', 'KeyH', 'KeyN'], ['KeyU', 'KeyJ', 'KeyM'], ['KeyI', 'KeyK', 'Comma'],
  ['KeyO', 'KeyL', 'Period'], ['KeyP', 'Semicolon', 'Slash'],
];

export const show = (ch) => (ch === ' ' ? 'пробіл' : `«${ch}»`);
const upper = (ch) => ch.toUpperCase();
const capitalize = (w) => upper(w[0]) + w.slice(1);

function fingerList(layout, chars) {
  return chars.map((c) => `${show(c)} — ${FINGERS[fingerForChar(layout, c)].name}`).join(', ');
}

const SCALE_INFO = {
  seq: ['Гама: зліва направо і назад', 'Послідовний рух пальцями по домашньому ряду зліва направо і справа наліво. Натискай рівно, без поспіху.'],
  mirror: ['Гама: дзеркальні пари', 'Дзеркальні пари від країв до центру й назад: мізинці, безіменні, середні, вказівні. Ліва й права рука роблять однаковий рух.'],
  alt: ['Гама: чергування рук', 'Чергування лівої та правої руки й ізоляція однойменних пальців. Один палець рухається — решта лежать на місці.'],
  vertical: ['Гама: домашній → верхній → нижній ряд', 'Вертикальні переходи: кожен палець іде вгору, вниз і щоразу повертається на домашню клавішу.'],
  onefinger: ['Гама: один палець — кілька клавіш', 'Контроль одного пальця на всіх закріплених за ним клавішах. Вказівні мають по шість клавіш — їм найбільше роботи.'],
  shift: ['Великі літери: Shift', 'Shift натискається мізинцем руки, протилежної до літери: ліва літера — правий Shift, права — лівий.'],
  special: ['Апостроф і літера ґ', 'Апостроф — клавіша ліворуч від «1» (лівий мізинець). Літера ґ — правий Alt + г (правий вказівний) або окрема клавіша вашої розкладки. Літери і, ї, є, ґ — різні клавіші, їх не можна підміняти.'],
  digits: ['Цифри й дефіс', 'Цифровий ряд: кожна цифра належить тому самому пальцю, що й клавіші під нею. Після цифри палець повертається на домашній ряд.'],
  punct: ['Розділові знаки', 'Кома, крапка, знак питання, оклику, двокрапка, крапка з комою, лапки — окремі рухи. Після знака — пробіл великим пальцем.'],
  rhythm: ['Рівний ритм і зміна темпу', 'Друкуй під метроном: кожне натискання — на удар. Темп зростає тричі протягом вправи; важлива рівність, а не поспіх.'],
};

const WORD_INFO = {
  doubles: ['Слова з подвоєнням', 'Повтор тієї самої клавіші: палець двічі натискає, не відриваючись далеко від клавіші.'],
  samefinger: ['Слова: один палець між рядами', 'У кожному слові є перехід одним пальцем між рядами — найповільніший рух. Не поспішай на ньому.'],
  alternate: ['Слова з чергуванням рук', 'Кожна наступна літера набирається іншою рукою. Такі слова друкуються найшвидше — лови ритм.'],
  caps: ['Слова з великої літери', 'Власне слово не змінюється, додається Shift протилежним мізинцем на першій літері.'],
  special: ['Слова з апострофом та ґ, є, ї, і', 'Українські слова з апострофом і літерами ґ, є, ї, і. Кожна з цих літер має власну клавішу.'],
  apostrophe: ['Слова з апострофом', 'Скорочення з апострофом: апостроф набирає правий мізинець, не зупиняючи слово.'],
  hyphen: ['Слова з дефісом', 'Дефіс — правий мізинець у цифровому ряду. Слово через дефіс набирається без паузи.'],
};

// --- Побудова програми ---------------------------------------------------------

function wordsWithin(wordList, open) {
  return wordList.filter((w) => Array.from(w).every((c) => open.has(c)));
}

function buildPath(cur) {
  const { layout, wordList, content } = cur;
  const open = new Set([' ']);
  const lessons = [];
  let lastKeys = [];
  let wordCount = 0;

  const add = (lesson) => {
    lessons.push({ ...lesson, open: new Set(open), index: lessons.length });
  };

  for (const spec of PATH) {
    if (spec.t === 'keys') {
      const chars = charsOf(layout, spec.codes);
      chars.forEach((c) => open.add(c));
      lastKeys = chars;
      add({
        id: `s1-${spec.id}`, stage: 1, kind: 'keys', rule: 'scales', mechanics: true,
        title: `Нові клавіші: ${chars.map(upper).join(' ')}`,
        goal: `${fingerList(layout, chars)}. Після кожного натискання палець повертається на домашній ряд.`,
        newChars: chars, codes: spec.codes,
      });
      continue;
    }

    if (spec.t === 'scale') {
      if (spec.id === 'special' && layout.id !== 'uk') continue;
      let newChars = [];
      if (spec.id === 'shift') newChars = [...open].filter((c) => layout.letters.test(c)).map(upper);
      if (spec.id === 'special') newChars = ["'", 'ґ', 'Ґ'];
      if (spec.id === 'digits') newChars = [...charsOf(layout, DIGIT_CODES), '-'];
      if (spec.id === 'punct') newChars = PUNCT.filter((c) => layout.charMap.has(c));
      newChars.forEach((c) => open.add(c));
      const [title, goal] = SCALE_INFO[spec.id];
      add({ id: `s1-${spec.id}`, stage: 1, kind: spec.id, rule: 'scales', mechanics: true, title, goal, newChars });
      continue;
    }

    // Слова: лише з уже відкритих символів.
    let mode = spec.mode;
    if (mode === 'special' && layout.id !== 'uk') continue;
    const base = wordsWithin(wordList, open);
    let candidates = base;
    let focus = [];
    let title;
    let goal;
    if (mode === 'new') {
      focus = lastKeys.filter((c) => layout.letters.test(c));
      // В англійській розкладці клавіша апострофа відкриває скорочення.
      if (lastKeys.includes("'")) {
        mode = 'apostrophe';
        candidates = wordsWithin(content.apostropheWords, open);
      }
    }
    if (mode === 'new') {
      wordCount++;
      title = spec.id === 'home' ? 'Слова з домашнього ряду' : `Слова з клавішами ${focus.map(upper).join(' ')}`;
      goal = spec.id === 'home'
        ? 'Перші справжні слова — лише з восьми клавіш домашнього ряду. Пальці не залишають вихідної позиції.'
        : `Слова лише з уже відкритих клавіш; закріплюємо нові: ${fingerList(layout, focus)}.`;
    } else {
      [title, goal] = WORD_INFO[mode];
      if (mode === 'doubles') candidates = base.filter((w) => /(.)\1/u.test(w));
      if (mode === 'samefinger') candidates = base.filter((w) => hasTransition(layout, w, (t) => t.sameFinger && t.rowChange));
      if (mode === 'alternate') candidates = base.filter((w) => w.length >= 4 && everyTransition(layout, w, (t) => t.alternate));
      if (mode === 'caps') candidates = base.filter((w) => w.length >= 3 && !/['-]/.test(w)).slice(0, 300);
      if (mode === 'hyphen') candidates = base.filter((w) => w.includes('-'));
      if (mode === 'special') {
        candidates = [
          ...wordsWithin([...content.apostropheWords, ...content.gWords], open),
          ...base.filter((w) => /[єїі]/.test(w)).slice(0, 60),
        ];
        focus = ["'", 'ґ', 'є', 'ї'];
      }
    }
    if (new Set(candidates).size < 8) continue; // замало реальних слів — вправу не створюємо
    add({
      id: `s2-${spec.id}`, stage: 2, kind: 'words', mode, rule: 'words', mechanics: false,
      title, goal, focus, candidates,
      maxLen: mode === 'new' ? Math.min(12, 4 + wordCount) : 14,
      target: mode === 'new' ? Math.min(140, 80 + wordCount * 6) : 120,
    });
  }
  cur.allChars = new Set(open);
  return lessons;
}

function hasTransition(layout, word, test) {
  const c = Array.from(word);
  for (let i = 0; i + 1 < c.length; i++) {
    const t = transitionInfo(layout, c[i], c[i + 1]);
    if (t && test(t)) return true;
  }
  return false;
}
function everyTransition(layout, word, test) {
  const c = Array.from(word);
  for (let i = 0; i + 1 < c.length; i++) {
    const t = transitionInfo(layout, c[i], c[i + 1]);
    if (!t || !test(t)) return false;
  }
  return true;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildAcademy(cur) {
  const { layout, ngrams, wordList, content } = cur;
  const modules = [];
  const lessons = [];
  // В Академії доступні всі символи розкладки, зокрема знаки %, +, = у реченнях із числами.
  const everyChar = new Set(layout.charMap.keys());
  const mod = (id, title, about, items) => {
    const ids = [];
    items.forEach((item, i) => {
      const lesson = {
        id: `a-${id}-${i + 1}`, stage: 3, module: id, rule: 'academy', mechanics: false,
        open: everyChar, ...item,
      };
      lessons.push(lesson);
      ids.push(lesson.id);
    });
    modules.push({ id, title, about, lessons: ids });
  };
  const wordsWith = (g) => wordList.filter((w) => w.includes(g)).slice(0, 14);
  const usable = (list) => list.map(([g]) => g).filter((g) => wordsWith(g).length >= 3);
  const ngramLessons = (grams, what) => chunk(grams, 4).map((gs) => ({
    kind: 'ngrams', grams: gs,
    title: `${what}: ${gs.join(' · ')}`,
    goal: `${what} ${gs.map((g) => `«${g}»`).join(', ')}: спершу сама комбінація, потім слова з нею. ${gs.map((g) => describeGram(layout, g)).join(' ')}`,
  }));

  const bigrams = usable(ngrams.bigrams);
  mod('bigrams', 'Частотні біграми', 'Дванадцять найчастотніших пар літер усередині слів. Вага пари — сума частот слів, у яких вона трапляється.',
    ngramLessons(bigrams.slice(0, 12), 'Біграми'));

  mod('trigrams', 'Частотні триграми', 'Дванадцять найчастотніших трійок літер: з них складається більшість слів.',
    ngramLessons(usable(ngrams.trigrams).slice(0, 12), 'Триграми'));

  const suffixes = content.suffixes.filter((s) => wordList.filter((w) => w.endsWith(s.end) && w.length > s.end.length).length >= 4);
  mod('morphemes', 'Суфікси й закінчення', 'Типові морфеми мови: закінчення слова має набиратися одним рухом.',
    chunk(suffixes, 4).map((group) => ({
      kind: 'suffixes', suffixes: group,
      title: `Морфеми: ${group.map((s) => s.label).join(' ')}`,
      goal: `Закінчення ${group.map((s) => s.label).join(', ')} набирай як один суцільний рух, без паузи перед останніми літерами.`,
    })));

  const byType = (test) => ngrams.bigrams.map(([g]) => g).filter((g) => {
    const t = transitionInfo(layout, g[0], g[1]);
    return t && test(t) && wordsWith(g).length >= 3;
  });
  mod('samefinger', 'Складні переходи одним пальцем', 'Пари, де обидві літери набирає той самий палець. Це найповільніші рухи, тому їх тренують окремо.',
    ngramLessons(byType((t) => t.sameFinger).slice(0, 8), 'Один палець'));

  const alternating = wordList.filter((w) => w.length >= 5 && everyTransition(layout, w, (t) => t.alternate)).slice(0, 80);
  mod('flow', 'Чергування рук і перекати', 'Найшвидші рухи: літери по черзі різними руками та «перекати» сусідніми пальцями однієї руки.', [
    {
      kind: 'wordset', candidates: alternating, target: 130,
      title: 'Чергування рук',
      goal: 'У цих словах кожну наступну літеру набирає інша рука. Тримай рівний темп, як у барабанному дробі.',
    },
    ...ngramLessons(byType((t) => t.roll).slice(0, 8), 'Перекати'),
  ]);

  mod('doubles', 'Подвоєння літер', 'Дві однакові літери поспіль: два чітких натискання одним пальцем.',
    ngramLessons(byType((t) => t.sameKey).slice(0, 4), 'Подвоєння'));

  const hyphenWords = wordList.filter((w) => w.includes('-'));
  mod('signs', 'Великі літери, знаки й числа', 'Shift, апостроф, дефіс, кома, крапка, лапки та числа в реальних реченнях.', [
    {
      kind: 'texts', pool: content.punctuation, count: 3, rule: 'text',
      title: 'Речення з розділовими знаками',
      goal: 'Великі літери, кома, крапка, лапки, знаки питання й оклику. Shift — протилежним мізинцем.',
    },
    {
      kind: 'wordset', candidates: [...content.apostropheWords, ...content.gWords, ...hyphenWords], target: 130,
      title: 'Апостроф і дефіс',
      goal: 'Слова з апострофом і дефісом. Знак усередині слова не має зупиняти рух.',
    },
    {
      kind: 'texts', pool: content.numbers, count: 3, rule: 'text',
      title: 'Числа в реченнях',
      goal: 'Цифри набираються тими самими пальцями, що й клавіші під ними. Після числа — назад на домашній ряд.',
    },
  ]);

  mod('tempo', 'Короткі серії на темп', 'Короткі серії найчастотніших слів. Тут є вимога до швидкості, але точність усе одно обов’язкова.', [
    {
      kind: 'wordset', candidates: wordList.filter((w) => w.length <= 4 && !/['-]/.test(w)).slice(0, 60), target: 80, rule: 'tempo',
      title: 'Спринт: короткі слова',
      goal: 'Найчастотніші короткі слова. Мета — темп без зупинок, точність не нижче 97%.',
    },
    {
      kind: 'wordset', candidates: wordList.filter((w) => !/['-]/.test(w)).slice(0, 200), target: 120, rule: 'tempo',
      title: 'Спринт: двісті найчастотніших слів',
      goal: 'Слова, з яких складається половина будь-якого тексту. Набирай їх цілими рухами, а не по літерах.',
    },
  ]);

  mod('sentences', 'Речення', 'Перенесення навички в зв’язний текст: речення з великими літерами та розділовими знаками.',
    [0, 1, 2].map((k) => ({
      kind: 'texts', pool: content.sentences.filter((_, i) => i % 3 === k), count: 3, rule: 'text',
      title: `Речення, серія ${k + 1}`,
      goal: 'Три речення поспіль. Дивись на текст на крок уперед і тримай рівний ритм.',
    })));

  mod('paragraphs', 'Абзаци', 'Суцільний текст — те, заради чого все навчання. Рівний ритм і точність на довгій дистанції.',
    [0, 1, 2].map((k) => ({
      kind: 'texts', pool: content.paragraphs.slice(k * 2, k * 2 + 2), count: 1, rule: 'text',
      title: `Абзац ${k + 1}`,
      goal: 'Цілий абзац без зупинок. Якщо помиляєшся — знизь темп, а не кидай ритм.',
    })));

  return { modules: modules.filter((m) => m.lessons.length), lessons };
}

/** Опис переходу для підказки: якими пальцями набирається комбінація. */
export function describeGram(layout, gram) {
  const fingers = Array.from(gram).map((c) => fingerForChar(layout, c)).filter(Boolean);
  const uniq = [...new Set(fingers)];
  if (uniq.length === 1) return `«${gram}» — ${FINGERS[uniq[0]].by} пальцем.`;
  return `«${gram}» — ${fingers.map((f) => FINGERS[f].by).join(', ')}.`;
}

/**
 * data: { words: [[слово, частота]], ngrams: { bigrams, trigrams }, content }.
 * Повертає програму: { lang, layout, lessons, byId, modules, wordList, allChars }.
 */
export function buildCurriculum(lang, data) {
  const layout = LAYOUTS[lang];
  const content = { ...data.content };
  for (const key of ['punctuation', 'numbers', 'sentences', 'paragraphs']) {
    content[key] = content[key].map(normalizeText);
  }
  const cur = {
    lang, layout, content,
    wordList: data.words.map(([w]) => w),
    frequency: new Map(data.words),
    ngrams: data.ngrams,
  };
  const path = buildPath(cur);
  const academy = buildAcademy(cur);
  cur.lessons = [...path, ...academy.lessons].map((l, index) => ({ ...l, index }));
  cur.modules = academy.modules;
  cur.byId = new Map(cur.lessons.map((l) => [l.id, l]));
  return cur;
}

// --- Генерація тексту вправи ---------------------------------------------------

const homeOf = (layout, ch) => layout.byCode[HOME_CODE[fingerForChar(layout, ch)]].base;

function keysDrill(cur, lesson, r) {
  const { layout } = cur;
  const news = lesson.newChars;
  const known = [...lesson.open].filter((c) => c !== ' ' && !news.includes(c));
  const groups = [];
  for (const c of news) {
    const h = homeOf(layout, c);
    if (h === c || !lesson.open.has(h)) groups.push(c + c + c, c + c, c + c + c);
    else groups.push(h + c + h, h + c + h, c + h + c, h + c + c + h);
  }
  for (let i = 0; i < news.length; i++) {
    for (let j = i + 1; j < news.length; j++) {
      const [a, b] = [news[i], news[j]];
      groups.push(a + b, b + a, a + b + a, b + a + b);
    }
  }
  const pool = [...news, ...news, ...known.slice(-8)];
  for (let n = 0; n < 8; n++) {
    let g = pick(r, news);
    const len = 2 + Math.floor(r() * 3);
    while (g.length < len) g = r() < 0.5 ? g + pick(r, pool) : pick(r, pool) + g;
    // Група з однієї повтореної літери вже є вище — тут потрібне змішування.
    if (new Set(g).size === 1 && new Set(pool).size > 1) g = g.slice(1) + pool.find((c) => c !== g[0]);
    groups.push(g);
  }
  return groups.join(' ');
}

function homeHalves(cur, open) {
  const chars = FINGER_ORDER.map((f) => cur.layout.byCode[HOME_CODE[f]].base).filter((c) => !open || open.has(c));
  const left = chars.filter((c) => FINGERS[fingerForChar(cur.layout, c)].hand === 'L');
  const right = chars.filter((c) => FINGERS[fingerForChar(cur.layout, c)].hand === 'R');
  return { left, right };
}
const rev = (arr) => [...arr].reverse();

function seqDrill(cur, open) {
  const { left, right } = homeHalves(cur, open);
  const L = left.join(''); const R = right.join('');
  const Lr = rev(left).join(''); const Rr = rev(right).join('');
  return [L, R, L, R, Rr, Lr, Rr, Lr, L + R, Rr + Lr, L, R, Rr, Lr, L + R, Rr + Lr].join(' ');
}

function mirrorDrill(cur) {
  const { left, right } = homeHalves(cur);
  const pairs = left.map((c, i) => c + right[right.length - 1 - i]); // від країв до центру
  const back = rev(pairs);
  const flip = (p) => p[1] + p[0];
  return [
    ...pairs, ...back, pairs.slice(0, 2).join(''), pairs.slice(2).join(''),
    back.slice(0, 2).join(''), back.slice(2).join(''),
    ...pairs.map(flip), ...back.map(flip), pairs.join(''), back.join(''),
  ].join(' ');
}

function altDrill(cur) {
  const { left, right } = homeHalves(cur);
  const cross = left.map((c, i) => c + right[i]);
  const mirror = rev(left).map((c, i) => c + right[i]); // однойменні пальці: вказівні, середні…
  return [
    ...cross, ...cross.map((p) => p[1] + p[0]), cross.slice(0, 2).join(''), cross.slice(2).join(''),
    ...mirror.flatMap((p) => [p[0] + p[0], p[1] + p[1], p]),
    ...mirror.map((p) => p + p),
  ].join(' ');
}

function verticalDrill(cur) {
  const b = (code) => cur.layout.byCode[code].base;
  const a = COLUMNS.map(([u, h, l]) => b(h) + b(u) + b(h) + b(l) + b(h));
  const c = rev(COLUMNS).map(([u, h, l]) => b(u) + b(h) + b(l));
  return [...a, ...c].join(' ');
}

function oneFingerDrill(cur, lesson) {
  const b = (code) => cur.layout.byCode[code].base;
  const out = [];
  for (const finger of FINGER_ORDER) {
    const home = b(HOME_CODE[finger]);
    const others = KEYS.filter((k) => k.finger === finger && k.row >= 1 && k.row <= 3 && k.code !== HOME_CODE[finger])
      .map((k) => b(k.code)).filter((c) => lesson.open.has(c));
    for (const c of others) out.push(home + c + home);
    out.push(others.join(''));
  }
  return out.join(' ');
}

function shiftDrill(cur, lesson, r) {
  const letters = [...lesson.open].filter((c) => cur.layout.letters.test(c));
  const { left, right } = homeHalves(cur);
  const homeLetters = [...left, ...right].filter((c) => cur.layout.letters.test(c));
  const groups = homeLetters.map((c) => upper(c) + c);
  for (let i = 0; i < 12; i++) {
    const a = pick(r, letters);
    groups.push(upper(a) + pick(r, homeLetters) + pick(r, homeLetters));
  }
  return groups.join(' ');
}

function specialDrill(cur) {
  // Лише для української: апостроф і ґ поруч із сусідніми рухами.
  return "ф'ф ф'ф о'о м'я п'є б'ю в'ї гґг гґг ґа ґу аґ ґе ґі м'я п'ю з'ї ґґ б'є в'я ґа".split(' ').join(' ');
}

function digitsDrill(cur, r) {
  const { layout } = cur;
  const digits = charsOf(layout, DIGIT_CODES);
  const groups = digits.map((d) => { const h = homeOf(layout, d); return h + d + h; });
  const dash = homeOf(layout, '-');
  groups.push(dash + '-' + dash);
  for (let i = 0; i < 8; i++) {
    let n = '';
    const len = 2 + Math.floor(r() * 3);
    while (n.length < len) n += pick(r, digits);
    groups.push(n);
  }
  groups.push(`${pick(r, digits)}-${pick(r, digits)}`, `${pick(r, digits)}${pick(r, digits)}-${pick(r, digits)}${pick(r, digits)}`);
  return groups.join(' ');
}

function punctDrill(cur, lesson, r) {
  const words = sample(r, cur.wordList.filter((w) => w.length >= 2 && w.length <= 6 && !/['-]/.test(w)).slice(0, 150), 12);
  const [a, b, c, d, e, f, g, h, i, j, k, l] = words;
  return `${a}, ${b}. ${capitalize(c)}? ${capitalize(d)}! ${e}: ${f}; ${g}. "${capitalize(h)}", ${i}. ${capitalize(j)}, ${k}? ${capitalize(l)}!`;
}

function rhythmDrill(cur, r) {
  const { left, right } = homeHalves(cur);
  const cross = left.map((c, i) => c + right[i]).map((p) => p + p);
  const words = sample(r, cur.wordList.filter((w) => w.length >= 3 && w.length <= 4 && !/['-]/.test(w)).slice(0, 80), 18);
  return [...cross, ...words.slice(0, 8), ...cross, ...words.slice(8)].join(' ');
}

/** Добір слів: нові клавіші, слабкі місця користувача та загальна частотність. */
export function pickWords(r, candidates, { focus = [], weak = [], target = 110, maxLen = 99, transform = null } = {}) {
  let pool = candidates.filter((w) => w.length <= maxLen);
  if (new Set(pool).size < 8) pool = candidates;
  const has = (w, parts) => parts.some((p) => w.includes(p));
  const A = focus.length ? pool.filter((w) => has(w, focus)).slice(0, 60) : [];
  const C = weak.length ? pool.filter((w) => has(w, weak)).slice(0, 40) : [];
  const B = pool.slice(0, 80);
  const gap = Math.min(4, Math.max(1, new Set(pool).size - 2));
  const out = [];
  let len = 0;
  let guard = 0;
  while (len < target && guard++ < 600) {
    const x = r();
    const src = x < 0.5 && A.length ? A : x < 0.8 && C.length ? C : B;
    const w = pick(r, src);
    if (out.slice(-gap).includes(w)) continue;
    out.push(w);
    len += w.length + 1;
  }
  return (transform ? out.map(transform) : out).join(' ');
}

/** Слабкі місця користувача, обмежені відкритими символами. */
export function weakSpots(cur, profile, open) {
  if (!profile) return { chars: [], bigrams: [] };
  const ok = (s) => Array.from(s).every((c) => open.has(c) && c !== ' ');
  const chars = weakChars(profile).map((x) => x.ch).filter(ok).slice(0, 3);
  const bigrams = [
    ...errorBigrams(profile.bigrams).map((x) => x.pair),
    ...slowBigrams(profile.bigrams).map((x) => x.pair),
  ].filter((p, i, arr) => ok(p) && arr.indexOf(p) === i).slice(0, 3);
  return { chars, bigrams };
}

/** Текст вправи. seed змінює варіант; profile вмикає адаптацію до слабких місць. */
export function generateText(cur, lesson, { seed = 0, profile = null } = {}) {
  const r = rng(hash(lesson.id) + seed * 7919);
  const weak = weakSpots(cur, profile, lesson.open);
  const weakParts = [...weak.chars, ...weak.bigrams];
  switch (lesson.kind) {
    case 'keys': return keysDrill(cur, lesson, r);
    case 'seq': return seqDrill(cur);
    case 'mirror': return mirrorDrill(cur);
    case 'alt': return altDrill(cur);
    case 'vertical': return verticalDrill(cur);
    case 'onefinger': return oneFingerDrill(cur, lesson);
    case 'shift': return shiftDrill(cur, lesson, r);
    case 'special': return specialDrill(cur);
    case 'digits': return digitsDrill(cur, r);
    case 'punct': return punctDrill(cur, lesson, r);
    case 'rhythm': return rhythmDrill(cur, r);
    case 'words':
      return pickWords(r, lesson.candidates, {
        focus: lesson.focus, weak: weakParts, target: lesson.target, maxLen: lesson.maxLen,
        transform: lesson.mode === 'caps' ? capitalize : null,
      });
    case 'wordset':
      return pickWords(r, lesson.candidates, { weak: weakParts, target: lesson.target });
    case 'ngrams':
      return lesson.grams.map((g) => {
        const few = lesson.grams.length < 3; // мало комбінацій — більше слів на кожну
        const ws = sample(r, cur.wordList.filter((w) => w.includes(g)).slice(0, 14), few ? 9 : 3);
        const line = [g, g, ws[0], g, ws[1], ws[2]];
        if (few) line.push(g, g, ...ws.slice(3, 6), g, ...ws.slice(6));
        return line.join(' ');
      }).join(' ');
    case 'suffixes':
      return lesson.suffixes.map((s) => {
        const ws = sample(r, cur.wordList.filter((w) => w.endsWith(s.end) && w.length > s.end.length).slice(0, 16), 4);
        return [s.end, s.end, ...ws].join(' ');
      }).join(' ');
    case 'texts':
      return sample(r, lesson.pool, lesson.count).join(' ');
    default:
      throw new Error(`Невідомий тип вправи: ${lesson.kind}`);
  }
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// --- Прогрес і доступність ------------------------------------------------------

export const isDone = (profile, id) => profile.lessons[id]?.done === true;

/** Вправа доступна, якщо попередня зарахована (або рівень відкрито діагностикою). */
export function isAvailable(cur, profile, lesson) {
  if (lesson.index === 0 || isDone(profile, lesson.id)) return true;
  const prev = cur.lessons[lesson.index - 1];
  if (isDone(profile, prev.id)) return true;
  if (!profile.placed) return false;
  // Після діагностики відкриті етапи 1–2 і перша вправа Академії; далі Академія йде по порядку.
  return lesson.stage < 3 || prev.stage < 3;
}

/** Наступна вправа за програмою: перша незарахована з доступних. */
export function nextLesson(cur, profile) {
  if (profile.placed) {
    const academy = cur.lessons.find((l) => l.stage === 3 && !isDone(profile, l.id));
    if (academy) return academy;
  }
  return cur.lessons.find((l) => !isDone(profile, l.id) && isAvailable(cur, profile, l)) || null;
}

/** Символи, які учень уже відкрив. */
export function userOpenChars(cur, profile) {
  if (profile.placed) return cur.allChars;
  let open = cur.lessons[0].open;
  for (const l of cur.lessons) {
    if (isDone(profile, l.id) && l.open.size >= open.size) open = l.open;
  }
  return open;
}

export function moduleProgress(cur, profile, module) {
  const done = module.lessons.filter((id) => isDone(profile, id)).length;
  return { done, total: module.lessons.length, complete: done === module.lessons.length };
}

// --- Вільні вправи: розігрів, повторення слабких місць, реальний текст ----------

export function warmupText(cur, profile) {
  return seqDrill(cur, userOpenChars(cur, profile));
}

/** Повторення слабких клавіш і переходів. Повертає null, якщо статистики ще замало. */
export function reviewExercise(cur, profile, seed = 0) {
  const open = userOpenChars(cur, profile);
  const weak = weakSpots(cur, profile, open);
  if (!weak.chars.length && !weak.bigrams.length) return null;
  const r = rng(977 + seed * 7919);
  const base = wordsWithin(cur.wordList, open);
  const parts = [];
  for (const c of weak.chars) {
    const h = homeOf(cur.layout, c);
    parts.push(h === c ? `${c}${c}${c} ${c}${c}` : `${h}${c}${h} ${c}${h}${c}`);
    parts.push(...sample(r, base.filter((w) => w.includes(c)).slice(0, 20), 4));
  }
  for (const g of weak.bigrams) {
    parts.push(g, g, g);
    parts.push(...sample(r, base.filter((w) => w.includes(g)).slice(0, 20), 4));
  }
  const what = [
    weak.chars.length ? `клавіші ${weak.chars.map(show).join(', ')}` : '',
    weak.bigrams.length ? `переходи ${weak.bigrams.map((g) => `«${g}»`).join(', ')}` : '',
  ].filter(Boolean).join(' та ');
  return {
    text: parts.join(' '),
    weak,
    title: 'Повторення слабких місць',
    goal: `Вправа складена з твоєї статистики: ${what}. ${[...weak.chars.map((c) => `${show(c)} — ${FINGERS[fingerForChar(cur.layout, c)].name}.`), ...weak.bigrams.map((g) => describeGram(cur.layout, g))].join(' ')}`,
  };
}

/** Реальний текст із відкритих символів: речення, якщо відкрито все, інакше частотні слова. */
export function realText(cur, profile, seed = 0) {
  const open = userOpenChars(cur, profile);
  const r = rng(4242 + seed * 7919);
  const sentences = cur.content.sentences.filter((s) => Array.from(s).every((c) => open.has(c)));
  if (sentences.length >= 3) return sample(r, sentences, 3).join(' ');
  const base = wordsWithin(cur.wordList, open);
  if (new Set(base).size < 8) return seqDrill(cur, open);
  return pickWords(r, base, { target: 150, weak: Object.values(weakSpots(cur, profile, open)).flat() });
}

/** Заняття на 15–25 хвилин: розігрів → цільова навичка → закріплення → реальний текст. */
export function dailyPlan(cur, profile) {
  const target = nextLesson(cur, profile);
  return [
    { type: 'warmup', title: 'Розігрів', about: 'Гама по відкритих клавішах домашнього ряду — 2 хвилини.' },
    target
      ? { type: 'lesson', id: target.id, title: 'Цільова навичка', about: `${target.title} — розучування і три залікові спроби.` }
      : { type: 'text', title: 'Цільова навичка', about: 'Програму пройдено — тренуємо зв’язний текст.' },
    { type: 'review', title: 'Закріплення', about: 'Слабкі клавіші та повільні переходи з твоєї статистики.' },
    { type: 'text', title: 'Реальний текст', about: 'Слова й речення лише з відкритих символів.' },
  ];
}

/** Чи можна набрати текст у цій розкладці (для власних текстів і перевірки перед стартом). */
export function checkText(cur, text) {
  return isSupported(cur.layout, text);
}

export { keyForChar, KEY_BY_CODE };
