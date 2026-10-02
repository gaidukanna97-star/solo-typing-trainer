// Сторінки застосунку. Кожна функція малює сторінку в root і може повернути функцію очищення.

import {
  generateText, isAvailable, isDone, nextLesson, moduleProgress, userOpenChars,
  warmupText, reviewExercise, realText, dailyPlan, show, describeGram,
} from '../core/curriculum.js';
import { LEVELS, PASS_RULES, PLACEMENT } from '../core/config.js';
import { KEYS, FINGERS, fingerForChar, keyForChar } from '../core/layouts.js';
import { weakChars, slowBigrams, errorBigrams } from '../core/analysis.js';
import { drillText } from '../core/feedback.js';
import { exportState, importState, emptyProfile, emptyState } from '../core/storage.js';
import { awardDaily } from '../core/gamification.js';
import { prepareCustomText, MAX_FILE, MAX_TEXT } from '../core/customtext.js';
import { runExercise } from './trainer.js';
import { keyboardHtml, legendHtml } from './keyboard.js';
import { esc, $, $$, formatTime, showChar, download, announce } from './dom.js';

export const LANG_LABEL = { uk: 'Українська', en: 'English' };
const STAGE = {
  1: ['Етап 1 · Клавіатурні гами', 'Звичка не дивитися на клавіатуру й повертати пальці на домашній ряд. Короткі повторювані рухи, нові клавіші відкриваються по дві.'],
  2: ['Етап 2 · Слова з відкритих клавіш', 'Реальні частотні слова, у яких немає жодного ще не вивченого символу. Добір слів підлаштовується під твої помилки й повільні переходи.'],
  3: ['Етап 3 · Академія', 'Частотні біграми й триграми, морфеми, складні переходи, знаки, темп і зв’язний текст.'],
};

const lessonBadge = (lesson) => STAGE[lesson.stage][0];

function lessonExercise(app, lesson) {
  return {
    id: lesson.id,
    title: lesson.title,
    goal: lesson.goal,
    badge: lessonBadge(lesson),
    rule: lesson.rule,
    lesson,
    mechanics: lesson.mechanics,
    tempo: lesson.kind === 'rhythm' ? [90, 120, 150] : null,
    make: (seed) => generateText(app.cur, lesson, { seed, profile: app.profile }),
  };
}

// --- Створення профілю ----------------------------------------------------------

export function onboarding(app, root) {
  const lang = app.state.settings.lang;
  if (!lang) {
    root.innerHTML = `
      <section class="card narrow">
        <h1>Соло — тренажер сенсорного набору</h1>
        <p>Десять пальців, жодного погляду на клавіатуру. Спершу точність і рівний ритм, швидкість — потім.</p>
        <h2>Крок 1 із 2. Якою мовою будемо набирати?</h2>
        <div class="choice">
          <button type="button" class="btn btn-primary" data-lang="uk">Українська · ЙЦУКЕН</button>
          <button type="button" class="btn btn-primary" data-lang="en">English · QWERTY</button>
        </div>
        <p class="muted">Мову можна змінити будь-коли: прогрес для кожної мови зберігається окремо, у цьому браузері. Потрібна фізична клавіатура.</p>
      </section>`;
    $$('[data-lang]', root).forEach((btn) => btn.addEventListener('click', () => app.setLang(btn.dataset.lang)));
    $('[data-lang]', root).focus();
    return;
  }
  root.innerHTML = `
    <section class="card narrow">
      <h1>Новий профіль · ${LANG_LABEL[lang]}</h1>
      <h2>Крок 2 із 2. Звідки почнемо?</h2>
      <div class="choice choice-col">
        <button type="button" class="btn btn-primary" data-start="zero">Я початківець — почати з домашнього ряду</button>
        <button type="button" class="btn" data-start="test">Пройти коротку діагностику (1 хвилина)</button>
        <button type="button" class="btn" data-start="open">Я вже друкую наосліп — відкрити всі етапи</button>
      </div>
      <p class="muted">Діагностика: один абзац без підказок. Якщо точність від ${PLACEMENT.minAcc}% і темп від ${PLACEMENT.minSpm} SPM — відкриємо всі етапи й Академію.</p>
      <p><button type="button" class="btn btn-ghost" id="ob-back">← Обрати іншу мову</button></p>
    </section>`;
  const begin = (placed) => {
    app.profile.createdAt = Date.now();
    app.profile.placed = placed;
    app.save();
    app.go('#/');
  };
  $('[data-start="zero"]', root).addEventListener('click', () => begin(false));
  $('[data-start="open"]', root).addEventListener('click', () => begin(true));
  $('[data-start="test"]', root).addEventListener('click', () => app.go('#/diagnostic'));
  $('#ob-back', root).addEventListener('click', () => app.setLang(null));
  $('[data-start="zero"]', root).focus();
}

export function diagnostic(app, root) {
  const { cur, profile } = app;
  return runExercise(root, app, {
    id: 'diagnostic',
    title: 'Діагностика',
    goal: 'Набери абзац так, як друкуєш зазвичай. Підказок немає. За результатом запропонуємо, з чого почати.',
    badge: 'Початкова діагностика',
    rule: 'free',
    make: (seed) => cur.content.sentences.filter((_, i) => i % 5 === seed % 5).slice(0, 3).join(' '),
  }, {
    practice: false,
    verdict: (m) => {
      const ok = m.accuracy >= PLACEMENT.minAcc && m.spm >= PLACEMENT.minSpm;
      profile.createdAt ??= Date.now();
      profile.placed = ok;
      app.save();
      return ok
        ? { text: `Ти вже впевнено набираєш (${m.spm} SPM, ${m.accuracy}%). Відкрито всі етапи й Академію; гами та слова можна повторити будь-коли.`, primary: { label: 'До навчального шляху', run: () => app.go('#/') } }
        : { text: `Радимо почати з домашнього ряду: ${m.accuracy < PLACEMENT.minAcc ? `точність ${m.accuracy}% нижча за ${PLACEMENT.minAcc}%` : `темп ${m.spm} SPM нижчий за ${PLACEMENT.minSpm}`}. Правильна постановка рук дасть швидкість пізніше.`, primary: { label: 'Почати з першої вправи', run: () => app.go('#/') } };
    },
  });
}

// --- Навчальний шлях ----------------------------------------------------------------

function lessonItem(app, lesson) {
  const { cur, profile } = app;
  const rec = profile.lessons[lesson.id];
  const done = isDone(profile, lesson.id);
  const open = isAvailable(cur, profile, lesson);
  const best = rec?.bestSpm ? ` · рекорд ${rec.bestSpm} SPM` : '';
  if (!open) {
    return `<li><span class="lesson is-locked" aria-disabled="true"><span class="st">Закрито</span><span class="lt">${esc(lesson.title)}</span><small>спершу закріпи попередню вправу</small></span></li>`;
  }
  const status = done ? '✓ Закріплено' : rec?.attempts ? `У роботі · ${rec.streak}/${app.state.settings.streak}` : 'Відкрито';
  return `<li><a class="lesson ${done ? 'is-done' : 'is-open'}" href="#/lesson/${lesson.id}"><span class="st">${status}</span><span class="lt">${esc(lesson.title)}</span><small>${rec?.attempts ? `спроб: ${rec.attempts}${best}` : 'ще не розпочато'}</small></a></li>`;
}

export function home(app, root) {
  const { cur, profile } = app;
  const next = nextLesson(cur, profile);
  const total = cur.lessons.length;
  const done = cur.lessons.filter((l) => isDone(profile, l.id)).length;
  const best = Math.max(0, ...cur.lessons.map((l) => profile.lessons[l.id]?.bestSpm || 0));
  const level = [...LEVELS].reverse().find((l) => best >= l.minSpm && best > 0);
  const openCount = [...userOpenChars(cur, profile)].filter((c) => cur.layout.letters.test(c)).length;
  const stage = (n) => {
    const lessons = cur.lessons.filter((l) => l.stage === n);
    const d = lessons.filter((l) => isDone(profile, l.id)).length;
    return `
      <section class="stage" aria-labelledby="st-${n}">
        <h2 id="st-${n}">${STAGE[n][0]} <span class="count">${d} / ${lessons.length}</span></h2>
        <p class="muted">${STAGE[n][1]}</p>
        <ol class="lessons">${lessons.map((l) => lessonItem(app, l)).join('')}</ol>
      </section>`;
  };
  const academy = cur.modules.map((m) => {
    const p = moduleProgress(cur, profile, m);
    return `<li>${esc(m.title)} — ${p.done} / ${p.total}${p.complete ? ' ✓' : ''}</li>`;
  }).join('');

  root.innerHTML = `
    <h1>Навчальний шлях · ${LANG_LABEL[cur.lang]}</h1>
    <section class="card next-card" aria-labelledby="next-h">
      <h2 id="next-h">Наступний крок</h2>
      ${next ? `<p class="next-title">${esc(next.title)} <span class="tag">${lessonBadge(next)}</span></p><p>${esc(next.goal)}</p>`
    : '<p class="next-title">Програму пройдено 🎉</p><p>Підтримуй форму: заняття дня, слабкі місця або власний текст.</p>'}
      <div class="row">
        ${next ? `<a class="btn btn-primary" id="go-next" href="#/lesson/${next.id}">Почати вправу</a>` : ''}
        <a class="btn" href="#/daily">Заняття дня · 15–25 хв</a>
        <a class="btn" href="#/review">Повторити слабкі місця</a>
        <a class="btn" href="#/exam">Зріз швидкості · сертифікат</a>
      </div>
    </section>
    <dl class="summary">
      <div><dt>Закріплено вправ</dt><dd>${done} / ${total}</dd></div>
      <div><dt>Відкрито літер</dt><dd>${openCount}</dd></div>
      <div><dt>Найкращий темп</dt><dd>${best || '—'}${best ? ' SPM' : ''}</dd></div>
      <div><dt>Рівень</dt><dd>${level ? esc(level.name) : 'Ознайомлення'}</dd></div>
    </dl>
    <p class="muted">Порядок проходження: гами та слова чергуються — щойно відкрито нові клавіші, одразу закріплюємо їх словами. Кожну відкриту вправу можна повторити.
      Постава, пальці та поради з проходження — у <a href="#/guide">посібнику</a>.</p>
    ${stage(1)}${stage(2)}
    <section class="stage" aria-labelledby="st-3">
      <h2 id="st-3">${STAGE[3][0]}</h2>
      <p class="muted">${STAGE[3][1]}</p>
      <ul class="plain">${academy}</ul>
      <p><a class="btn" href="#/academy">Відкрити Академію</a></p>
    </section>`;
  $('#go-next', root)?.focus({ preventScroll: true });
}

export function lesson(app, root, id) {
  const l = app.cur.byId.get(id);
  if (!l) return notFound(root);
  if (!isAvailable(app.cur, app.profile, l)) {
    const prev = app.cur.lessons[l.index - 1];
    root.innerHTML = `<section class="card narrow"><h1>Вправу ще закрито</h1>
      <p>«${esc(l.title)}» відкриється, коли буде закріплено попередню вправу: «${esc(prev.title)}».</p>
      <p><a class="btn btn-primary" href="#/lesson/${prev.id}">До попередньої вправи</a> <a class="btn" href="#/">До шляху</a></p></section>`;
    $('a.btn-primary', root).focus();
    return;
  }
  return runExercise(root, app, lessonExercise(app, l));
}

export function academy(app, root) {
  const { cur, profile } = app;
  const rule = PASS_RULES.academy;
  const firstAcademy = cur.lessons.find((l) => l.stage === 3);
  const unlocked = isAvailable(cur, profile, firstAcademy);
  const modules = cur.modules.map((m, i) => {
    const p = moduleProgress(cur, profile, m);
    const pct = Math.round((p.done / p.total) * 100);
    return `
      <section class="card module" aria-labelledby="mod-${m.id}">
        <h2 id="mod-${m.id}">Модуль ${i + 1}. ${esc(m.title)} ${p.complete ? '<span class="tag tag-ok">завершено ✓</span>' : ''}</h2>
        <p>${esc(m.about)}</p>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}" aria-label="Прогрес модуля «${esc(m.title)}»"><span style="width:${pct}%"></span></div>
        <p class="muted">Закріплено ${p.done} із ${p.total} вправ.</p>
        <ol class="lessons">${m.lessons.map((id) => lessonItem(app, cur.byId.get(id))).join('')}</ol>
      </section>`;
  }).join('');
  root.innerHTML = `
    <h1>Академія · ${LANG_LABEL[cur.lang]}</h1>
    <p>${STAGE[3][1]} Модулі йдуть по порядку: кожна наступна вправа відкривається після закріплення попередньої.</p>
    <p class="notice"><strong>Критерій завершення модуля:</strong> усі його вправи закріплено. Вправа закріплена після
      ${app.state.settings.streak} успішних залікових спроб поспіль: точність від ${rule.minAcc}%${app.state.settings.speedGate ? ` і темп від ${rule.minSpm} SPM (для текстів — від ${PASS_RULES.text.minSpm}, для спринтів — від ${PASS_RULES.tempo.minSpm})` : ''}.
      Швидкість без точності не зараховується.</p>
    ${unlocked ? '' : `<p class="notice notice-warn">Академія відкриється після етапів 1 і 2 — коли всі клавіші буде вивчено. Якщо ти вже друкуєш наосліп, пройди <a href="#/diagnostic">діагностику</a>.</p>`}
    ${modules}`;
}

// --- Заняття дня, повторення, точкові вправи -------------------------------------

function freeExercise(app, kind, seedBase = 0) {
  const { cur, profile } = app;
  if (kind === 'warmup') {
    return {
      id: 'warmup', title: 'Розігрів', badge: 'Заняття дня', rule: 'scales', mechanics: true,
      goal: 'Гама по відкритих клавішах домашнього ряду. Знайди виступи на двох клавішах під вказівними пальцями й тримай рівний ритм.',
      make: () => warmupText(cur, profile),
    };
  }
  if (kind === 'review') {
    const first = reviewExercise(cur, profile, seedBase);
    if (!first) return null;
    return {
      id: 'review', title: first.title, goal: first.goal, badge: 'Адаптивна вправа', rule: 'words',
      make: (seed) => reviewExercise(cur, profile, seed)?.text || first.text,
    };
  }
  return {
    id: 'realtext', title: 'Реальний текст', badge: 'Заняття дня', rule: 'words',
    goal: 'Слова й речення лише з уже відкритих символів. Мета — перенести рух у звичайний текст.',
    make: (seed) => realText(cur, profile, seed),
  };
}

export function review(app, root) {
  const ex = freeExercise(app, 'review');
  if (!ex) {
    root.innerHTML = `<section class="card narrow"><h1>Повторення слабких місць</h1>
      <p>Поки що слабких місць не знайдено: або статистики замало, або помилок майже немає. Пройди кілька залікових спроб — і вправа складеться з твоїх помилок і повільних переходів.</p>
      <p><a class="btn btn-primary" href="#/">До навчального шляху</a></p></section>`;
    $('a.btn-primary', root).focus();
    return;
  }
  return runExercise(root, app, ex, { practice: false });
}

export function drill(app, root) {
  const d = app.pendingDrill;
  if (!d) return app.go('#/');
  const { cur, profile } = app;
  const what = [...d.bigrams, ...d.chars];
  const text = drillText(cur.layout, cur.wordList, userOpenChars(cur, profile), d);
  const goal = [
    ...d.bigrams.map((g) => describeGram(cur.layout, g)),
    ...d.chars.map((c) => `${show(c)} — ${FINGERS[fingerForChar(cur.layout, c)].name}.`),
  ].join(' ');
  return runExercise(root, app, {
    id: 'drill', title: `Точкове повторення: ${what.map(showChar).join(', ')}`, badge: 'Адаптивна вправа', rule: 'scales', mechanics: true,
    goal: `${goal} Спершу сама комбінація, потім слова з нею. Повільно й точно.`,
    startPhase: 'practice',
    make: () => text,
  }, { onContinue: { label: 'Повернутися до вправи', run: () => app.go(d.returnTo || '#/') } });
}

export function daily(app, root) {
  const { cur, profile } = app;
  app.daily ??= { steps: dailyPlan(cur, profile), i: 0 };
  const plan = app.daily;
  if (plan.i >= plan.steps.length) {
    app.daily = null;
    const reward = awardDaily(app.state, { cur, lang: cur.lang, now: Date.now() });
    app.save();
    app.updateUser();
    const extra = [
      reward.after.index > reward.before.index ? `Нове звання: «${reward.after.grade.name}»!` : '',
      reward.achievements.length ? `Нові досягнення: ${reward.achievements.map((a) => `«${a.title}»`).join(', ')}.` : '',
    ].join(' ');
    root.innerHTML = `<section class="card narrow"><h1>Заняття завершено</h1>
      <p><strong class="xp">+${reward.xp} XP</strong> за повне заняття. ${esc(extra)}</p>
      <p>Розігрів, цільова навичка, закріплення й реальний текст — усе пройдено. Повертайся завтра: коротко й щодня краще, ніж довго й зрідка.</p>
      <p><a class="btn btn-primary" href="#/">До навчального шляху</a> <a class="btn" href="#/cabinet">Відкрити кабінет</a></p></section>`;
    $('a.btn-primary', root).focus();
    return;
  }
  const step = plan.steps[plan.i];
  let ex;
  if (step.type === 'lesson') ex = lessonExercise(app, cur.byId.get(step.id));
  else ex = freeExercise(app, step.type, plan.i) || freeExercise(app, 'text');
  const stepper = plan.steps.map((s, i) =>
    `<li class="${i === plan.i ? 'is-current' : i < plan.i ? 'is-past' : ''}"${i === plan.i ? ' aria-current="step"' : ''}><strong>${i + 1}. ${esc(s.title)}</strong><small>${esc(s.about)}</small></li>`).join('');
  root.innerHTML = `<ol class="stepper" aria-label="План заняття на 15–25 хвилин">${stepper}</ol><div id="daily-ex"></div>`;
  const last = plan.i === plan.steps.length - 1;
  return runExercise($('#daily-ex', root), app, { ...ex, badge: `Заняття дня · крок ${plan.i + 1} із ${plan.steps.length}` }, {
    practice: step.type === 'lesson',
    onContinue: {
      label: last ? 'Завершити заняття' : `Далі: ${plan.steps[plan.i + 1].title}`,
      run: () => { plan.i++; app.render(); },
    },
  });
}

// --- Статистика -----------------------------------------------------------------------

function heatMap(app) {
  const { cur, profile } = app;
  const byCode = {};
  for (const [ch, v] of Object.entries(profile.chars)) {
    const key = keyForChar(cur.layout, ch);
    if (!key) continue;
    const t = (byCode[key.code] ??= { n: 0, err: 0 });
    t.n += v.n; t.err += v.err;
  }
  const heat = {};
  for (const k of KEYS) {
    const t = byCode[k.code];
    if (!t || t.n < 10) continue;
    const rate = t.err / t.n;
    heat[k.code] = { level: rate < 0.02 ? 1 : rate < 0.05 ? 2 : rate < 0.1 ? 3 : 4, label: `${Math.round(rate * 100)}%` };
  }
  return heat;
}

function chart(history) {
  const pts = history.slice(-40);
  if (pts.length < 2) return '<p class="muted">Графік з’явиться після двох залікових спроб.</p>';
  const W = 640; const H = 160; const pad = 24;
  const max = Math.max(60, ...pts.map((p) => p.spm));
  const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.spm).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.spm).toFixed(1)}" r="3.5" class="${p.passed ? 'dot-pass' : 'dot-fail'}"><title>${p.spm} SPM, ${p.acc}%${p.passed ? ', зараховано' : ', не зараховано'}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Темп останніх ${pts.length} залікових спроб, від ${pts[0].spm} до ${pts[pts.length - 1].spm} SPM">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="axis"/><text x="${pad}" y="14" class="axis-t">${Math.round(max)} SPM</text>
    <polyline points="${line}" class="line"/>${dots}</svg>
    <p class="muted">Зафарбована точка — зарахована спроба, порожня — не зарахована.</p>`;
}

export function statsHtml(app) {
  const { cur, profile } = app;
  const weak = weakChars(profile);
  const slow = slowBigrams(profile.bigrams);
  const errB = errorBigrams(profile.bigrams);
  const h = profile.history;
  const totalMs = h.reduce((a, b) => a + b.ms, 0);
  const passedCount = h.filter((x) => x.passed).length;
  const rhythm = h.filter((x) => x.rhythm != null).slice(-10);
  const avgRhythm = rhythm.length ? Math.round(rhythm.reduce((a, b) => a + b.rhythm, 0) / rhythm.length) : null;
  const title = (id) => cur.byId.get(id)?.title || ({ review: 'Повторення слабких місць', drill: 'Точкове повторення', warmup: 'Розігрів', realtext: 'Реальний текст', custom: 'Власний текст', diagnostic: 'Діагностика' })[id] || id;
  const rows = h.slice(-12).reverse().map((x) => `<tr><td>${new Date(x.t).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(title(x.id))}</td><td>${x.spm}</td><td>${x.acc}%</td><td>${x.errors}</td><td>${formatTime(x.ms)}</td><td>${x.passed ? '✓ так' : '✗ ні'}</td></tr>`).join('');
  const fingerOf = (pair) => describeGram(cur.layout, pair);

  return `
    <h2 class="section-title">Статистика · ${LANG_LABEL[cur.lang]}</h2>
    <dl class="summary">
      <div><dt>Залікових спроб</dt><dd>${h.length}</dd></div>
      <div><dt>Зараховано</dt><dd>${passedCount}</dd></div>
      <div><dt>Час набору</dt><dd>${formatTime(totalMs)}</dd></div>
      <div><dt>Нерівномірність ритму</dt><dd>${avgRhythm === null ? '—' : `${avgRhythm}%`}</dd></div>
    </dl>
    <section class="card"><h2>Темп за спробами</h2>${chart(h)}</section>
    <section class="card"><h2>Карта помилок</h2>
      <p class="muted">На клавіші — частка хибних натискань. Що темніша клавіша, то частіше на ній помилки. Клавіші без підпису ще не мають достатньо даних.</p>
      ${keyboardHtml(cur.layout, { heat: heatMap(app) })}
    </section>
    <div class="result-cols">
      <section class="card"><h2>Слабкі клавіші</h2>
        ${weak.length ? `<ul class="plain">${weak.map((w) => `<li><kbd>${esc(showChar(w.ch))}</kbd> — помилок ${w.err} із ${w.n} (${Math.round(w.rate * 100)}%), ${esc(FINGERS[fingerForChar(cur.layout, w.ch)]?.name || '')}</li>`).join('')}</ul>` : '<p class="muted">Слабких клавіш не знайдено.</p>'}
      </section>
      <section class="card"><h2>Повільні переходи</h2>
        ${slow.length ? `<ul class="plain">${slow.map((s) => `<li><kbd>${esc(s.pair)}</kbd> — ${Math.round(s.ms)} мс, у ${s.ratio.toFixed(1)} раза повільніше за твою медіану. ${esc(fingerOf(s.pair))}</li>`).join('')}</ul>` : '<p class="muted">Повільних переходів не знайдено.</p>'}
        ${errB.length ? `<h3>Переходи з помилками</h3><ul class="plain">${errB.map((s) => `<li><kbd>${esc(s.pair)}</kbd> — помилок ${s.err}</li>`).join('')}</ul>` : ''}
      </section>
    </div>
    <p><a class="btn" href="#/review">Повторити слабкі місця</a></p>
    <section class="card"><h2>Останні спроби</h2>
      ${rows ? `<div class="scroll"><table><thead><tr><th>Коли</th><th>Вправа</th><th>SPM</th><th>Точність</th><th>Помилки</th><th>Час</th><th>Зараховано</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Ще немає залікових спроб.</p>'}
    </section>
    <p class="muted">Це твоя особиста статистика. Рейтингу між користувачами немає: інші люди твоїх результатів не бачать.</p>`;
}

// --- Власний текст -----------------------------------------------------------------------

export function custom(app, root) {
  const { cur } = app;
  let cleanup = null;
  root.innerHTML = `
    <h1>Власний текст</h1>
    <section class="card">
      <p>Встав текст або завантаж файл <strong>.txt</strong> чи <strong>.md</strong> (до 200 КБ, UTF-8). Текст обробляється лише у твоєму браузері й нікуди не надсилається.
        Символи, яких немає в розкладці «${esc(cur.layout.name)}», буде вилучено; для вправи береться до ${MAX_TEXT} символів.</p>
      <label for="cu-text">Текст для набору</label>
      <textarea id="cu-text" rows="6" spellcheck="false"></textarea>
      <div class="row">
        <label class="btn" for="cu-file">Завантажити файл…</label>
        <input type="file" id="cu-file" accept=".txt,.md,text/plain,text/markdown" class="visually-hidden">
        <button type="button" class="btn btn-primary" id="cu-start">Почати набір</button>
      </div>
      <p class="notice" id="cu-msg" role="alert" hidden></p>
    </section>
    <div id="cu-ex"></div>`;
  const msg = (text, kind) => {
    const el = $('#cu-msg', root);
    el.hidden = !text;
    el.className = `notice ${kind}`;
    el.textContent = text;
  };
  let filename = '';
  $('#cu-file', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) return msg(`Файл «${file.name}» не підтримується: потрібен .txt або .md.`, 'notice-error');
    if (file.size > MAX_FILE) return msg('Файл завеликий: максимум 200 КБ.', 'notice-error');
    if (file.size === 0) return msg('Файл порожній.', 'notice-error');
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      filename = file.name;
      $('#cu-text', root).value = raw;
      msg(`Файл «${file.name}» завантажено. Натисни «Почати набір».`, '');
    } catch {
      msg('Не вдалося прочитати файл: він не в кодуванні UTF-8 або це не текст.', 'notice-error');
    }
  });
  $('#cu-text', root).addEventListener('input', () => { filename = ''; });
  $('#cu-start', root).addEventListener('click', () => {
    try {
      const { text, removed, cut } = prepareCustomText(cur.layout, $('#cu-text', root).value, filename);
      const notes = [];
      if (removed.length) notes.push(`Вилучено символи, яких немає в розкладці: ${removed.join(' ')}`);
      if (cut) notes.push(`Текст скорочено до ${text.length} символів.`);
      msg(notes.join(' '), notes.length ? 'notice-warn' : '');
      cleanup?.();
      cleanup = runExercise($('#cu-ex', root), app, {
        id: 'custom', title: 'Набір власного тексту', badge: 'Вільна практика', rule: 'free',
        goal: 'Власний текст. Результат потрапляє до статистики слабких клавіш і переходів.',
        make: () => text,
      }, { practice: false });
    } catch (err) {
      msg(err.message, 'notice-error');
    }
  });
  return () => cleanup?.();
}

// --- Джерела та ліцензії ---------------------------------------------------------------

export async function sources(app, root) {
  root.innerHTML = '<h1>Джерела та ліцензії</h1><p class="muted">Завантаження…</p>';
  let manifest = null;
  let report = null;
  try {
    [manifest, report] = await Promise.all([
      fetch('dictionaries/manifest.json').then((r) => r.json()),
      fetch('data/derived/report.json').then((r) => r.json()),
    ]);
  } catch { /* покажемо статичну частину */ }
  const rows = manifest ? manifest.datasets.map((d) => `
    <tr><td><strong>${esc(d.id)}</strong><br><span class="muted">${esc(d.language)} · ${esc(d.kind)}</span></td>
      <td><a href="${esc(d.source)}" rel="noopener">${esc(d.source)}</a><br><span class="muted">ревізія ${esc(d.revision.slice(0, 12))}</span></td>
      <td>${esc(d.license)}<br><a href="dictionaries/${esc(d.licenseFile)}">текст ліцензії</a></td>
      <td>${esc(d.use)}</td></tr>`).join('') : '';
  const counts = report ? Object.values(report).map((m) => `
    <li><strong>${esc(m.language)}</strong>: на вході ${m.counts.input} записів → після фільтра символів і злиття дублікатів ${m.counts.afterCharsetAndDedup}
      → відсіяно словником ${m.counts.notInDictionary}, блок-листом ${m.counts.blocked} → придатних ${m.counts.valid} → у застосунку ${m.counts.kept} найчастотніших.
      Алгоритм v${esc(m.algorithmVersion)}, Unicode ${esc(m.unicode)}, SHA-256 сировини <code>${esc(m.sourceSha256.slice(0, 16))}…</code></li>`).join('') : '';
  root.innerHTML = `
    <h1>Джерела та ліцензії</h1>
    <section class="card"><h2>Словники</h2>
      <p>Сировина — незмінні знімки відкритих джерел із каталогу хакатону (стан на ${manifest ? esc(manifest.snapshotDate) : '30.08.2026'}). Файли в <code>dictionaries/</code> не редагуються; їхні контрольні суми записано в <a href="dictionaries/manifest.json">маніфесті</a> й перевіряються автоматичним тестом.</p>
      ${rows ? `<div class="scroll"><table><thead><tr><th>Набір</th><th>Джерело</th><th>Ліцензія</th><th>Як використано</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="notice notice-warn">Маніфест недоступний офлайн до першого завантаження.</p>'}
    </section>
    <section class="card"><h2>Похідні дані</h2>
      <p>Списки слів і таблиці біграм/триграм у <code>data/derived/</code> будує скрипт <code>scripts/build-data.mjs</code>. Обробка відтворювана: повторний запуск дає байт-у-байт той самий результат.</p>
      <ul class="plain">${counts}</ul>
      <ul>
        <li>Нормалізація: Unicode NFC, нижній регістр; усі варіанти апострофа (’ ʼ ‘ ′) → <code>'</code>. Літери і, ї, є, ґ ніколи не замінюються.</li>
        <li>Дозволені символи: літери мови, апостроф і дефіс усередині слова.</li>
        <li>Перевірка словником Hunspell: слово має бути словниковою формою; основи з великої літери (власні назви) не приймаються. Так відсіюються й російські слова з українських субтитрів.</li>
        <li>Блок-лист неприйнятної лексики: <code>data/filters/</code>.</li>
        <li>Вага біграми чи триграми = сума частот слів, у яких вона трапляється. Частотність переходів між словами не обчислюється — для неї потрібен окремий корпус.</li>
      </ul>
    </section>
    <section class="card"><h2>Тексти вправ</h2>
      <p>Речення й абзаци Академії написані спеціально для цього проєкту (<code>data/curriculum/content-*.json</code>) і поширюються за ліцензією проєкту. Слова з апострофом і літерою ґ та англійські скорочення додано вручну, бо частотні списки субтитрів розбивають слова за апострофом.</p>
      <p>Готові курси, вправи TT і радіодиктанти з каталогу хакатону <strong>не використано</strong>: їхня ліцензія не оголошена (статус REVIEW_REQUIRED).</p>
    </section>
    <section class="card"><h2>Ліцензія проєкту</h2>
      <p>Код і похідні дані — <a href="LICENSE">GPL-3.0-or-later</a>. Причина: український список слів відфільтровано словником <code>brown-uk/dict_uk</code> (GPL-3.0); джерела під MIT і BSD сумісні з GPL.</p>
      <p>Логотип і назва «Аметрін ФК» — товарний знак компанії. Ліцензія проєкту на них не поширюється: використовувати їх у власних версіях застосунку без дозволу правовласника не можна.</p>
    </section>
    <section class="card"><h2>Приватність</h2>
      <ul>
        <li><strong>Що зберігає сервер кабінетів:</strong> ім’я кабінету, хеш пароля, секретне питання, хеш відповіді на нього та прогрес навчання (результати вправ, статистика клавіш, звання, досягнення, сертифікати, налаштування). Більше нічого: ні пошти, ні телефону, ні IP-журналів застосунку, ні аналітики.</li>
        <li>Сервер — функція Vercel із приватним сховищем Vercel Blob. Тексти, які ти набираєш (зокрема власні), на сервер не надсилаються.</li>
        <li>Копія кабінету лежить і в браузері (localStorage), тому тренажер працює без мережі; після виходу з кабінету копія з браузера прибирається.</li>
        <li>Пароль і відповідь на секретне питання не зберігаються — лише їхні хеші із сіллю (scrypt на сервері). Відновити пароль можна за секретним питанням; після п’яти невдалих спроб — пауза на 10 хвилин.</li>
        <li>Можна тренуватися без кабінету — як гість. Тоді на сервер не надсилається нічого: прогрес лежить лише в цьому браузері.</li>
        <li>Якщо сервер недоступний, можна створити локальний кабінет — він існує лише в цьому браузері.</li>
        <li>Камера, мікрофон і біометрія не використовуються. Тренажер не контролює погляд і не стверджує, що може це робити: підглядання стає зайвим завдяки побудові вправ.</li>
        <li>Рейтингу між користувачами немає — звання, досягнення й результати особисті.</li>
        <li>Видалити кабінет разом з усіма даними із сервера можна на сторінці «Кабінет»; скинути прогрес — у «Налаштуваннях».</li>
      </ul>
    </section>
    <section class="card"><h2>Використання AI</h2>
      <p>У готовому продукті AI не використовується: усі вправи, добір слів і рекомендації — детерміновані алгоритми, що працюють офлайн і не залежать від сервера кабінетів. Під час розробки застосовано AI-асистента (Claude Code) для написання коду, тестів і навчальних текстів; подробиці — у README.</p>
    </section>`;
}

// --- Налаштування ---------------------------------------------------------------------------

export function settings(app, root) {
  const s = app.state.settings;
  const sel = (name, options) => `<select id="set-${name}">${options.map(([v, label]) => `<option value="${v}"${String(s[name]) === String(v) ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  root.innerHTML = `
    <h1>Налаштування</h1>
    <section class="card form">
      <h2>Набір</h2>
      <p><label for="set-lang">Мова набору</label> ${sel('lang', [['uk', 'Українська · ЙЦУКЕН'], ['en', 'English · QWERTY']])}</p>
      <p><label for="set-errorMode">Поведінка на помилці</label> ${sel('errorMode', [['stop', 'Зупинка на помилці: далі лише після правильного символу'], ['backspace', 'Виправлення клавішею Backspace']])}</p>
      <p><label for="set-streak">Успішних спроб поспіль для закріплення вправи</label> ${sel('streak', [[3, '3 (рекомендовано)'], [2, '2'], [1, '1']])}</p>
      <p><label><input type="checkbox" id="set-speedGate"${s.speedGate ? ' checked' : ''}> Вимагати мінімальний темп у вправах Академії</label><br>
        <span class="muted">Якщо вимкнути, вправи зараховуються лише за точністю — зручно для початківців. Точність обов’язкова завжди.</span></p>
      <h2>Вигляд і звук</h2>
      <p><label for="set-fontSize">Розмір тексту вправи: <output id="fs-out">${s.fontSize}</output> px</label>
        <input type="range" id="set-fontSize" min="18" max="36" step="2" value="${s.fontSize}"></p>
      <p><label for="set-theme">Тема</label> ${sel('theme', [['auto', 'Як у системі'], ['light', 'Світла'], ['dark', 'Темна']])}</p>
      <p><label><input type="checkbox" id="set-animations"${s.animations ? ' checked' : ''}> Анімації</label></p>
      <p><label><input type="checkbox" id="set-sound"${s.sound ? ' checked' : ''}> Звук (сигнал помилки й метроном)</label></p>
    </section>
    <section class="card">
      <h2>Прогрес</h2>
      <p>Прогрес зберігається у твоєму кабінеті. Додатково його можна зберегти у файл — як резервну копію або для перенесення в інший кабінет.</p>
      <div class="row">
        <button type="button" class="btn" id="set-export">Експортувати прогрес у файл</button>
        <label class="btn" for="set-import">Імпортувати з файлу…</label>
        <input type="file" id="set-import" accept=".json,application/json" class="visually-hidden">
      </div>
      <p class="notice" id="set-msg" role="alert" hidden></p>
      <h2>Видалення</h2>
      <p><button type="button" class="btn btn-danger" id="set-reset">Видалити профіль «${LANG_LABEL[s.lang]}»</button>
        <button type="button" class="btn btn-danger" id="set-wipe">Скинути весь прогрес кабінету</button></p>
    </section>`;
  const msg = (text, kind = '') => {
    const el = $('#set-msg', root);
    el.hidden = false; el.className = `notice ${kind}`; el.textContent = text;
  };
  const bind = (name, read) => $(`#set-${name}`, root).addEventListener('change', (e) => {
    s[name] = read(e.target);
    app.save();
    app.applySettings();
    announce('Налаштування збережено.');
  });
  bind('errorMode', (el) => el.value);
  bind('streak', (el) => Number(el.value));
  bind('speedGate', (el) => el.checked);
  bind('theme', (el) => el.value);
  bind('animations', (el) => el.checked);
  bind('sound', (el) => el.checked);
  bind('fontSize', (el) => Number(el.value));
  $('#set-fontSize', root).addEventListener('input', (e) => { $('#fs-out', root).textContent = e.target.value; });
  $('#set-lang', root).addEventListener('change', (e) => app.setLang(e.target.value, '#/settings'));
  $('#set-export', root).addEventListener('click', () => {
    download(`solo-progress-${new Date().toISOString().slice(0, 10)}.json`, exportState(app.state));
    msg('Файл прогресу збережено.');
  });
  $('#set-import', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Файл завеликий.');
      const next = importState(await file.text());
      app.replaceState(next);
    } catch (err) {
      msg(`Імпорт не вдався: ${err.message}`, 'notice-error');
    }
  });
  $('#set-reset', root).addEventListener('click', () => {
    if (!confirm(`Видалити весь прогрес профілю «${LANG_LABEL[s.lang]}»? Цю дію не можна скасувати.`)) return;
    app.state.profiles[s.lang] = emptyProfile();
    app.replaceState(app.state);
  });
  $('#set-wipe', root).addEventListener('click', () => {
    if (!confirm('Скинути весь прогрес, звання й досягнення цього кабінету? Цю дію не можна скасувати.')) return;
    app.replaceState(emptyState());
  });
}

export function notFound(root) {
  root.innerHTML = '<section class="card narrow"><h1>Сторінку не знайдено</h1><p><a class="btn btn-primary" href="#/">До навчального шляху</a></p></section>';
}
