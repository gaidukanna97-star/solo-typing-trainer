// Тренувальний екран: розучування (з клавіатурою та підказкою) і залік (без підказок).

import { createSession, press, backspace, charState, summarize, isPassed } from '../core/session.js';
import { looksLikeWrongLayout, unsupportedChars } from '../core/layouts.js';
import { PASS_RULES } from '../core/config.js';
import { recordAttempt } from '../core/storage.js';
import { nextAction } from '../core/feedback.js';
import { nextLesson, moduleProgress } from '../core/curriculum.js';
import { awardAttempt } from '../core/gamification.js';
import { tierFor, addCertificate } from '../core/certificate.js';
import { keyboardHtml, legendHtml, highlightNext } from './keyboard.js';
import { esc, $, announce, formatTime, showChar } from './dom.js';

let audio = null;
function beep(freq, ms, gain = 0.05) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch { /* звук недоступний — працюємо без нього */ }
}

const LANG_NAME = { uk: 'українська', en: 'англійська' };

/**
 * ex: { id, title, goal, badge, rule, make(seed) → text, lesson?, mechanics?, tempo?, startPhase? }
 * opts: { onContinue?: { label, run }, verdict?(metrics) → { text, primary? }, practice?: boolean }
 * Повертає функцію очищення.
 */
export function runExercise(root, app, ex, opts = {}) {
  const { cur, profile } = app;
  const settings = app.state.settings;
  const layout = cur.layout;
  const rule = PASS_RULES[ex.rule];
  const allowPractice = opts.practice !== false;
  const record = profile.lessons[ex.id];
  let phase = allowPractice ? (ex.startPhase || (record?.attempts ? 'test' : 'practice')) : 'test';
  let seed = record?.attempts || 0;
  let session = null;
  let text = '';
  let ticker = null;
  let metro = null;
  let disposed = false;

  function stopTimers() {
    clearInterval(ticker); ticker = null;
    clearTimeout(metro); metro = null;
  }

  function start() {
    stopTimers();
    text = ex.make(seed);
    const bad = unsupportedChars(layout, text);
    root.innerHTML = shell();
    if (bad.length) {
      $('#tr-body', root).innerHTML = `<p class="notice notice-error" role="alert">Вправу не можна почати: у тексті є символи, яких немає в розкладці (${esc(bad.join(' '))}).</p>`;
      return;
    }
    session = createSession(text, { mode: settings.errorMode });
    renderText();
    update();
    const box = $('#typebox', root);
    box.addEventListener('keydown', onKey);
    box.addEventListener('blur', () => box.classList.add('is-idle'));
    box.addEventListener('focus', () => box.classList.remove('is-idle'));
    box.focus();
    root.querySelectorAll('[data-phase]').forEach((btn) => btn.addEventListener('click', () => {
      phase = btn.dataset.phase;
      start();
    }));
    $('#tr-restart', root).addEventListener('click', start);
  }

  function shell() {
    const test = phase === 'test';
    const tabs = allowPractice ? `
      <div class="phase-tabs" role="group" aria-label="Режим вправи">
        <button type="button" data-phase="practice" aria-pressed="${!test}">Розучування — з підказками</button>
        <button type="button" data-phase="test" aria-pressed="${test}">Залік — без підказок</button>
      </div>` : '';
    const rec = profile.lessons[ex.id];
    const streak = ex.lesson
      ? `<p class="muted">Закріплення: ${rec?.done ? 'вправу закріплено ✓' : `${rec?.streak || 0} із ${settings.streak} успішних спроб поспіль`}. Умова: точність від ${rule.minAcc}%${rule.minSpm && settings.speedGate ? `, темп від ${rule.minSpm} SPM` : ''}.</p>`
      : '';
    const keyboard = test
      ? '<p class="muted hint-hidden">Залік: екранну клавіатуру й підказку наступної клавіші приховано. Дивись лише на текст.</p>'
      : `<p class="next-hint" id="tr-hint" aria-live="off"></p><div id="tr-kb">${keyboardHtml(layout)}${legendHtml()}</div>`;
    return `
      <section class="trainer" aria-labelledby="tr-title">
        <p class="crumb">${esc(ex.badge || '')}${ex.mechanics ? ' · <span class="tag">механіка: це не слова</span>' : ''}</p>
        <h1 id="tr-title">${esc(ex.title)}</h1>
        <p class="goal">${esc(ex.goal)}</p>
        ${streak}
        ${matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches ? '<p class="notice notice-warn">Тренажер розрахований на фізичну клавіатуру. На сенсорному екрані сенсорний набір не тренується — підключи клавіатуру або відкрий сайт на комп’ютері.</p>' : ''}
        ${tabs}
        <div id="tr-body">
          <p class="notice" id="tr-notice" role="status">Розкладка: ${LANG_NAME[cur.lang]}. Постав пальці на домашній ряд і набери перший символ — відлік почнеться з нього.</p>
          <div class="typebox" id="typebox" tabindex="0" role="application"
            aria-label="Поле набору. Набирай текст вправи. Esc — почати спочатку, Tab — вийти з поля."
            style="font-size:${settings.fontSize}px"></div>
          <div class="tr-bar">
            <span id="tr-progress"></span>
            <span id="tr-time">0:00</span>
            <span id="tr-errors"></span>
            ${ex.tempo ? '<span class="metro" id="tr-metro">метроном</span>' : ''}
          </div>
          ${keyboard}
        </div>
        <div class="tr-actions">
          <button type="button" class="btn" id="tr-restart">Почати спочатку (Esc)</button>
          <a class="btn btn-ghost" href="#/">До навчального шляху</a>
        </div>
      </section>`;
  }

  function renderText() {
    // Слова — нерозривні блоки, щоб рядок не ламався посеред слова.
    const box = $('#typebox', root);
    let html = '';
    let word = '';
    session.target.forEach((ch, i) => {
      if (ch === ' ') {
        if (word) html += `<span class="w">${word}</span>`;
        word = '';
        html += `<span class="c sp" data-i="${i}"> </span>`;
      } else {
        word += `<span class="c" data-i="${i}">${esc(ch)}</span>`;
      }
    });
    if (word) html += `<span class="w">${word}</span>`;
    box.innerHTML = html;
  }

  function update() {
    const spans = root.querySelectorAll('#typebox .c');
    spans.forEach((el, i) => {
      const state = charState(session, i);
      const cls = `c${el.classList.contains('sp') ? ' sp' : ''} is-${state}`;
      if (el.className !== cls) el.className = cls;
    });
    spans[Math.min(session.pos, spans.length - 1)]?.scrollIntoView({ block: 'nearest' });
    $('#tr-progress', root).textContent = `Символ ${Math.min(session.pos + 1, session.target.length)} із ${session.target.length}`;
    $('#tr-errors', root).textContent = `Помилок: ${session.errors}`;
    if (phase === 'practice') {
      const hint = highlightNext($('#tr-kb', root), layout, session.target[session.pos]);
      $('#tr-hint', root).textContent = hint ? `Наступна клавіша: ${hint}` : '';
    }
  }

  function notice(msg, kind = '') {
    const el = $('#tr-notice', root);
    if (!el) return;
    el.className = `notice ${kind}`;
    el.textContent = msg;
  }

  function tickMetronome() {
    if (disposed || !session || session.done) return;
    const stepIndex = Math.min(ex.tempo.length - 1, Math.floor((session.pos / session.target.length) * ex.tempo.length));
    const spm = ex.tempo[stepIndex];
    const el = $('#tr-metro', root);
    if (el) {
      el.textContent = `метроном: ${spm} SPM`;
      el.classList.toggle('metro-on');
    }
    if (settings.sound) beep(880, 30, 0.04);
    metro = setTimeout(tickMetronome, 60000 / spm);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); start(); return; }
    if (e.key === 'Tab') return; // фокус має вільно виходити з поля
    if (e.ctrlKey && !e.getModifierState('AltGraph')) return; // комбінації браузера не чіпаємо
    if (e.metaKey) return;
    if (e.key === 'Alt' || e.key === 'AltGraph') { e.preventDefault(); return; } // випадковий Alt не відкриває меню браузера
    if (e.isComposing || e.key === 'Dead' || e.key === 'Process' || e.keyCode === 229) {
      notice('Натискання dead key або IME проігноровано. Вимкни режим введення ієрогліфів чи діакритики й продовжуй.', 'notice-warn');
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (backspace(session)) update();
      else if (settings.errorMode === 'stop') notice('Режим «зупинка на помилці»: Backspace не потрібен — просто набери правильний символ.', '');
      return;
    }
    if (Array.from(e.key).length !== 1) return; // Shift, стрілки, F-клавіші тощо
    e.preventDefault();
    if (e.altKey && !e.getModifierState('AltGraph')) return;

    const expected = session.target[session.pos];
    if (expected === undefined) return;
    if (looksLikeWrongLayout(layout, e.key)) {
      notice(`Схоже, увімкнено іншу розкладку. Перемкни на «${layout.name}» — це натискання не зараховано.`, 'notice-warn');
      return;
    }
    if (e.getModifierState('CapsLock') && layout.letters.test(e.key.toLowerCase())) {
      notice('Увімкнено Caps Lock. Вимкни його: великі літери набираються через Shift протилежним мізинцем.', 'notice-warn');
      return;
    }

    const first = session.startedAt === null;
    const result = press(session, e.key, performance.now());
    if (first) {
      ticker = setInterval(() => {
        const el = $('#tr-time', root);
        if (el && session.startedAt !== null) el.textContent = formatTime(performance.now() - session.startedAt);
      }, 500);
      if (ex.tempo) tickMetronome();
      notice(phase === 'test' ? 'Залік триває. Не дивись на клавіатуру.' : 'Розучування: підказка показує клавішу й палець.', '');
    }
    if (result === 'error') {
      if (settings.sound) beep(180, 70);
      const msg = `Помилка: потрібно «${showChar(expected)}», натиснуто «${showChar(e.key)}».`;
      notice(settings.errorMode === 'stop' ? `${msg} Набери правильний символ.` : `${msg} Виправ клавішею Backspace.`, 'notice-error');
      announce(msg);
    } else if (result === 'correct' && $('#tr-notice', root)?.classList.contains('notice-error')) {
      notice('Помилку враховано в статистиці. Продовжуй.', '');
    }
    update();
    if (result !== 'done' && session.pos >= session.target.length) {
      notice('Текст набрано, але лишилися невиправлені помилки. Повернися клавішею Backspace і виправ їх.', 'notice-error');
    }
    if (result === 'done') finish();
  }

  function finish() {
    stopTimers();
    const metrics = summarize(session);
    const isTest = phase === 'test';
    const gate = { speedGate: settings.speedGate };
    const passed = isPassed(metrics, rule, gate);
    let outcome = null;
    let reward = null;
    const extra = {};
    if (isTest) {
      const needed = ex.lesson ? settings.streak : Number.MAX_SAFE_INTEGER;
      const now = Date.now();
      outcome = recordAttempt(profile, ex.id, metrics, passed, needed, now);
      const cert = ex.exam ? tierFor(metrics) : null;
      if (cert) extra.certIndex = addCertificate(app.state, { tier: cert, lang: cur.lang, metrics, now });
      const module = ex.lesson?.module ? cur.modules.find((m) => m.id === ex.lesson.module) : null;
      reward = awardAttempt(app.state, {
        cur, lang: cur.lang, lesson: ex.lesson || null, exId: ex.id, metrics, passed,
        justDone: outcome.justDone, cert,
        moduleDone: Boolean(module && outcome.justDone && moduleProgress(cur, profile, module).complete),
        now,
      });
      app.save();
      app.updateUser();
      seed++;
    }
    const verdict = isTest && opts.verdict ? opts.verdict(metrics, passed, extra) : null;
    const next = nextLesson(cur, profile);
    const feedback = isTest
      ? nextAction(metrics, {
        layout, rule: settings.speedGate ? rule : { ...rule, minSpm: 0 }, passed,
        streak: ex.lesson ? outcome.record.streak : 1, needed: ex.lesson ? settings.streak : 1,
        next: next && next.id !== ex.id ? next : null,
      })
      : null;
    renderResults(metrics, { isTest, passed, outcome, feedback, verdict, next, reward });
  }

  function rewardHtml(reward) {
    if (!reward || (!reward.xp && !reward.achievements.length)) return '';
    const up = reward.after.index > reward.before.index;
    const parts = reward.parts.map((p) => `${esc(p.label)} +${p.xp}`).join(' · ');
    const badges = reward.achievements.map((a) => `<li><strong>🏅 ${esc(a.title)}</strong> — ${esc(a.about)}</li>`).join('');
    return `<div class="reward" id="res-reward">
      ${reward.xp ? `<p><strong class="xp">+${reward.xp} XP</strong> <span class="muted">${parts}</span></p>` : ''}
      ${up ? `<p class="grade-up">Нове звання: «${esc(reward.after.grade.name)}»! ${esc(reward.after.grade.about)}</p>` : reward.after.next ? `<p class="muted">Звання «${esc(reward.after.grade.name)}». До звання «${esc(reward.after.next.name)}» — ${reward.after.toNext} XP.</p>` : ''}
      ${badges ? `<p>Нові досягнення:</p><ul class="plain">${badges}</ul>` : ''}
    </div>`;
  }

  function renderResults(m, { isTest, passed, outcome, feedback, verdict, next, reward }) {
    const effectiveMinSpm = settings.speedGate ? rule.minSpm : 0;
    let status;
    if (!isTest) status = '<p class="result-status">Розучування завершено. Результат не зараховується — це була підготовка.</p>';
    else if (passed) status = '<p class="result-status is-pass">✓ Спробу зараховано</p>';
    else {
      const why = m.accuracy < rule.minAcc
        ? `точність ${m.accuracy}% нижча за потрібні ${rule.minAcc}%`
        : `темп ${m.spm} SPM нижчий за потрібні ${effectiveMinSpm} SPM`;
      status = `<p class="result-status is-fail">✗ Спробу не зараховано: ${why}</p>`;
    }

    let compare = '';
    if (isTest && outcome) {
      const prev = outcome.previousBest;
      if (!prev) compare = 'Перша залікова спроба — це твій орієнтир.';
      else if (!prev.spm) compare = `Попередня найкраща точність: ${prev.acc}%.`;
      else {
        const diff = Math.round((m.spm - prev.spm) * 10) / 10;
        compare = `Особистий рекорд до цієї спроби: ${prev.spm} SPM. Зараз: ${diff >= 0 ? '+' : ''}${diff} SPM${passed && diff > 0 ? ' — новий рекорд!' : ''}`;
      }
    }

    const errs = Object.entries(m.errorsByChar).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([ch, n]) => `<li><kbd>${esc(showChar(ch))}</kbd> × ${n}</li>`).join('');
    const slow = Object.entries(m.bigrams)
      .filter(([pair, v]) => !pair.includes(' ') && v.timed)
      .map(([pair, v]) => [pair, Math.round(v.ms / v.timed)])
      .sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([pair, ms]) => `<li><kbd>${esc(pair)}</kbd> ${ms} мс</li>`).join('');

    // Одна конкретна наступна дія та кнопка до неї.
    let primary;
    if (!isTest) primary = { label: 'Перейти до заліку', run: () => { phase = 'test'; start(); } };
    else if (verdict?.primary) primary = verdict.primary;
    else if (feedback.action.type === 'drill') {
      const what = [...feedback.action.bigrams, ...feedback.action.chars].map(showChar).join(', ');
      primary = { label: `Повторити «${what}»`, run: () => app.startDrill(feedback.action, location.hash) };
    } else if (opts.onContinue && (passed || !ex.lesson)) primary = opts.onContinue;
    else if (feedback.action.type === 'next' && next) primary = { label: `Далі: ${next.title}`, run: () => app.go(`#/lesson/${next.id}`) };
    else primary = { label: 'Ще одна спроба', run: start };

    const adviceText = verdict?.text || feedback?.text || 'Тепер спробуй без підказок: у заліку клавіатуру приховано.';
    const secondary = [];
    if (primary.run !== start) secondary.push('<button type="button" class="btn" id="res-retry">Повторити вправу</button>');
    if (opts.onContinue && primary !== opts.onContinue && isTest) secondary.push(`<button type="button" class="btn" id="res-continue">${esc(opts.onContinue.label)}</button>`);
    secondary.push('<a class="btn btn-ghost" href="#/">До навчального шляху</a>');

    $('#tr-body', root).innerHTML = `
      <div class="results" role="region" aria-label="Результат спроби">
        ${status}
        <dl class="metrics">
          <div><dt>Швидкість</dt><dd>${m.spm}<small> SPM</small></dd></div>
          <div><dt>Точність</dt><dd>${m.accuracy}<small>%</small></dd></div>
          <div><dt>Помилки</dt><dd>${m.errors}</dd></div>
          <div><dt>Час</dt><dd>${formatTime(m.elapsedMs)}</dd></div>
        </dl>
        <p class="muted">SPM — правильно набрані символи за хвилину. WPM = SPM / 5 = ${m.wpm}.
          Точність рахується за всіма ${m.keystrokes} натисканнями, включно з виправленими помилками.
          ${m.rhythm !== null ? `Нерівномірність ритму: ${m.rhythm}% (що менше, то рівніше).` : ''}
          ${m.level ? `Рівень спроби: «${esc(m.level.name)}» — ${esc(m.level.goal)}.` : 'Рівень спроби не визначено: точність нижча за 95%.'}</p>
        ${compare ? `<p>${esc(compare)}</p>` : ''}
        ${rewardHtml(reward)}
        <div class="result-cols">
          <div><h2>Помилки за символами</h2>${errs ? `<ul class="chips">${errs}</ul>` : '<p class="muted">Без помилок.</p>'}</div>
          <div><h2>Найповільніші переходи</h2>${slow ? `<ul class="chips">${slow}</ul>` : '<p class="muted">Замало даних.</p>'}</div>
        </div>
        <div class="advice"><h2>Наступна дія</h2><p id="res-advice">${esc(adviceText)}</p>
          <button type="button" class="btn btn-primary" id="res-primary">${esc(primary.label)}</button>
        </div>
      </div>`;
    const actions = root.querySelector('.tr-actions');
    actions.innerHTML = secondary.join('');
    $('#res-primary', root).addEventListener('click', primary.run);
    $('#res-retry', root)?.addEventListener('click', start);
    $('#res-continue', root)?.addEventListener('click', opts.onContinue?.run);
    root.querySelectorAll('[data-phase]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.phase === phase)));
    $('#res-primary', root).focus();
    announce(`${isTest ? (passed ? 'Спробу зараховано.' : 'Спробу не зараховано.') : 'Розучування завершено.'} Швидкість ${m.spm} символів за хвилину, точність ${m.accuracy} відсотків, помилок ${m.errors}. ${adviceText}`);
  }

  start();
  return () => { disposed = true; stopTimers(); };
}
