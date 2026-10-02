// Зріз швидкості та сторінка сертифіката.

import { CERT_TIERS, EXAM_MIN_CHARS, EXAM_MAX_SPM } from '../core/config.js';
import { examText, tierFor, missingFor, tierById, bestCertificate } from '../core/certificate.js';
import { currentUser } from '../core/accounts.js';
import { runExercise } from './trainer.js';
import { LANG_LABEL } from './views.js';
import { esc, $, formatTime } from './dom.js';

const LAYOUT_NAME = { uk: 'українська розкладка (ЙЦУКЕН)', en: 'англійська розкладка (QWERTY)' };

export function tiersTableHtml() {
  return `<div class="scroll"><table>
    <thead><tr><th>Сертифікат</th><th>Швидкість</th><th>Точність</th></tr></thead>
    <tbody>${CERT_TIERS.map((t) => `<tr><td><span class="medal medal-${t.id}" aria-hidden="true"></span> ${esc(t.name)}</td><td>від ${t.minSpm} SPM</td><td>від ${t.minAcc}%</td></tr>`).join('')}</tbody>
  </table></div>`;
}

export function certListHtml(app) {
  const certs = app.state.game.certs || [];
  if (!certs.length) return '<p class="muted">Сертифікатів поки немає.</p>';
  return `<ul class="plain">${certs.map((c, i) => ({ c, i })).reverse().map(({ c, i }) => {
    const t = tierById(c.tier);
    return `<li><span class="medal medal-${c.tier}" aria-hidden="true"></span> <a href="#/certificate/${i}">${esc(t?.name || c.tier)} сертифікат</a> — ${c.spm} SPM, ${c.acc}%, ${LANG_LABEL[c.lang]}, ${new Date(c.t).toLocaleDateString('uk-UA')}</li>`;
  }).join('')}</ul>`;
}

export function exam(app, root, arg) {
  const { cur } = app;
  if (arg !== 'start') {
    const best = bestCertificate(app.state.game.certs || []);
    root.innerHTML = `
      <h1>Зріз швидкості · ${LANG_LABEL[cur.lang]}</h1>
      <section class="card">
        <p>Один зв’язний текст на ${EXAM_MIN_CHARS}+ символів: великі літери, розділові знаки, без екранної клавіатури й підказок. Це приблизно дві-три хвилини набору.</p>
        <p>За результатом видається сертифікат. Умови мають бути виконані <strong>одночасно</strong>: швидкість без точності не зараховується.</p>
        ${tiersTableHtml()}
        <p class="muted">SPM — правильно набрані символи за хвилину. Точність рахується за всіма натисканнями, включно з виправленими помилками. Спроб скільки завгодно; у кабінеті зберігаються всі отримані сертифікати.</p>
        <p><a class="btn btn-primary" id="exam-start" href="#/exam/start">Почати зріз</a> <a class="btn" href="#/cabinet">До кабінету</a></p>
        ${best ? `<p>Твій найкращий сертифікат: <a href="#/certificate/${app.state.game.certs.indexOf(best)}">${esc(tierById(best.tier).name)}, ${best.spm} SPM</a>.</p>` : ''}
      </section>`;
    $('#exam-start', root).focus();
    return undefined;
  }
  return runExercise(root, app, {
    id: 'exam',
    exam: true,
    title: 'Зріз швидкості',
    badge: 'Сертифікація',
    rule: 'free',
    goal: `Набери текст до кінця без підказок. ${CERT_TIERS.map((t) => `${t.name}: від ${t.minSpm} SPM і ${t.minAcc}%`).reverse().join(' · ')}.`,
    make: (seed) => examText(cur, seed),
  }, {
    practice: false,
    verdict: (m, passed, extra) => {
      const tier = tierFor(m);
      if (m.spm > EXAM_MAX_SPM) {
        return {
          text: `Результат ${m.spm} SPM вищий за ${EXAM_MAX_SPM} — так швидко людина не друкує. Сертифікат видається лише за набір руками.`,
          primary: { label: 'Спробувати ще раз', run: () => app.render() },
        };
      }
      const miss = missingFor(m);
      const need = miss ? [
        miss.spm ? `додати ${miss.spm} SPM` : '',
        miss.acc ? `підняти точність на ${miss.acc} в. п.` : '',
      ].filter(Boolean).join(' і ') : '';
      if (tier) {
        return {
          text: `Вітаємо! Результат ${m.spm} SPM при точності ${m.accuracy}% — це ${tier.name.toLowerCase()} сертифікат.${miss ? ` До рівня «${miss.tier.name}» треба ${need}.` : ''}`,
          primary: { label: 'Відкрити сертифікат', run: () => app.go(`#/certificate/${extra.certIndex}`) },
        };
      }
      return {
        text: `Сертифікат поки не видано: ${m.spm} SPM при точності ${m.accuracy}%. Для рівня «${miss.tier.name}» треба ${need}. ${m.accuracy < miss.tier.minAcc ? 'Спершу точність — знизь темп.' : 'Точність достатня — тренуй темп у спринтах Академії.'}`,
        primary: { label: 'Спробувати ще раз', run: () => app.render() },
      };
    },
  });
}

export function certificate(app, root, arg) {
  const certs = app.state.game.certs || [];
  const c = certs[Number(arg)];
  const tier = c && tierById(c.tier);
  if (!c || !tier) {
    root.innerHTML = '<section class="card narrow"><h1>Сертифікат не знайдено</h1><p><a class="btn btn-primary" href="#/exam">До зрізу швидкості</a></p></section>';
    return;
  }
  const user = currentUser(app.root);
  const date = new Date(c.t).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  root.innerHTML = `
    <div class="no-print row cert-actions">
      <button type="button" class="btn btn-primary" id="cert-print">Надрукувати або зберегти як PDF</button>
      <a class="btn" href="#/exam">Пройти зріз ще раз</a>
      <a class="btn btn-ghost" href="#/cabinet">До кабінету</a>
    </div>
    <article class="cert cert-${tier.id}" aria-labelledby="cert-h">
      <img class="cert-logo" src="assets/ametrin-logo.svg" alt="Аметрін ФК" width="174" height="40">
      <p class="cert-kicker">Соло · тренажер сенсорного набору</p>
      <h1 id="cert-h">${esc(tier.name)} сертифікат</h1>
      <div class="cert-medal medal-${tier.id}" aria-hidden="true"></div>
      <p class="cert-line">Цим підтверджується, що</p>
      <p class="cert-name">${esc(user.name)}</p>
      <p class="cert-line">пройшов(-ла) зріз швидкості сенсорного набору<br>${LAYOUT_NAME[c.lang]}</p>
      <dl class="cert-metrics">
        <div><dt>Швидкість</dt><dd>${c.spm} <small>SPM</small></dd></div>
        <div><dt>Точність</dt><dd>${c.acc}<small>%</small></dd></div>
        <div><dt>Обсяг</dt><dd>${c.chars} <small>симв.</small></dd></div>
        <div><dt>Час</dt><dd>${formatTime(c.ms)}</dd></div>
      </dl>
      <p class="cert-date">${date}</p>
      ${user.guest ? '<p class="no-print notice notice-warn">Сертифікат виписано на ім’я «Гість». Щоб у ньому було твоє ім’я, створи кабінет (прогрес перейде в нього) і пройди зріз ще раз.</p>' : ''}
      <p class="cert-note">Вимоги рівня: від ${tier.minSpm} символів за хвилину при точності від ${tier.minAcc}%. Текст набрано без екранної клавіатури й підказок.
        Сертифікат сформовано автоматично за результатом зрізу в тренажері «Соло».</p>
    </article>`;
  $('#cert-print', root).addEventListener('click', () => window.print());
  $('#cert-print', root).focus();
}
