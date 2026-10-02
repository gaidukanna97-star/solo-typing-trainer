// Екран входу та сторінка особистого кабінету (звання, досягнення, статистика).

import {
  createAccount, login, deleteAccount, changePassword, listNames, currentUser, userId, NAME_MAX, PASSWORD_MIN,
} from '../core/accounts.js';
import { GRADES, ACHIEVEMENTS, XP, gradeFor, dayStreak } from '../core/gamification.js';
import { statsHtml, LANG_LABEL } from './views.js';
import { esc, $, $$, announce } from './dom.js';

export function auth(app, root) {
  const names = listNames(app.root);
  let mode = names.length ? 'login' : 'create';

  const draw = (message = '', keepName = '') => {
    const create = mode === 'create';
    const legacy = create && app.root.legacy
      ? '<p class="notice">У цьому браузері знайдено прогрес, збережений раніше. Він перейде до кабінету, який ти зараз створиш.</p>'
      : '';
    const known = !create && names.length ? `
        <p class="muted">Кабінети на цьому пристрої: ${names.map(esc).join(', ')}.</p>
        <details><summary>Забув пароль?</summary>
          <p>Пароль не зберігається й не відновлюється. Можна лише видалити кабінет разом із прогресом: введи його ім’я вище й натисни кнопку.</p>
          <p><button type="button" class="btn btn-danger" id="auth-delete">Видалити кабінет із цим іменем</button></p>
        </details>` : '';
    root.innerHTML = `
      <section class="card narrow" aria-labelledby="auth-h">
        <h1 id="auth-h">${create ? 'Новий кабінет' : 'Вхід до кабінету'}</h1>
        <p>Соло — тренажер сенсорного набору. Кабінет зберігає твій прогрес, звання й досягнення. Потрібні лише ім’я та пароль — без пошти й телефону.</p>
        ${legacy}
        <div class="phase-tabs" role="group" aria-label="Вхід або новий кабінет">
          <button type="button" data-mode="login" aria-pressed="${!create}">Увійти</button>
          <button type="button" data-mode="create" aria-pressed="${create}">Створити кабінет</button>
        </div>
        <form id="auth-form" class="form" novalidate>
          <p><label for="auth-name">Ім’я</label><br>
            <input type="text" id="auth-name" maxlength="${NAME_MAX}" autocomplete="username" value="${esc(keepName)}"></p>
          <p><label for="auth-pass">Пароль</label><br>
            <input type="password" id="auth-pass" autocomplete="${create ? 'new-password' : 'current-password'}"></p>
          ${create ? `<p><label for="auth-pass2">Пароль ще раз</label><br>
            <input type="password" id="auth-pass2" autocomplete="new-password"></p>
          <p class="muted">Щонайменше ${PASSWORD_MIN} символи. Пароль не можна відновити — запам’ятай його.</p>` : ''}
          <p class="notice notice-error" id="auth-msg" role="alert"${message ? '' : ' hidden'}>${esc(message)}</p>
          <p><button type="submit" class="btn btn-primary" id="auth-submit">${create ? 'Створити кабінет' : 'Увійти'}</button></p>
        </form>
        ${known}
        <p class="muted">Кабінет існує лише в цьому браузері: даних немає на сервері, тож з іншого пристрою в нього не ввійти.
          Пароль захищає від випадкового входу іншої людини за цим комп’ютером, але не шифрує дані.
          Перенести прогрес на інший пристрій можна файлом у «Налаштуваннях».</p>
      </section>`;

    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      draw('', $('#auth-name', root).value);
    }));
    $('#auth-form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#auth-name', root).value;
      const pass = $('#auth-pass', root).value;
      $('#auth-submit', root).disabled = true;
      try {
        if (create) {
          if (pass !== $('#auth-pass2', root).value) throw new Error('Паролі не збігаються.');
          await createAccount(app.root, name, pass, Date.now());
        } else {
          await login(app.root, name, pass);
        }
        app.signedIn('#/');
        announce(create ? 'Кабінет створено.' : 'Вхід виконано.');
      } catch (err) {
        draw(err.message, name);
        $('#auth-pass', root).focus();
      }
    });
    $('#auth-delete', root)?.addEventListener('click', () => {
      const name = $('#auth-name', root).value;
      const user = app.root.users[userId(name)];
      if (!user) return draw('Кабінету з таким іменем на цьому пристрої немає.', name);
      if (!confirm(`Видалити кабінет «${user.name}» разом з усім прогресом? Цю дію не можна скасувати.`)) return;
      deleteAccount(app.root, userId(name));
      app.save();
      app.render();
    });
    $('#auth-name', root).focus();
  };
  draw();
}

export function cabinet(app, root) {
  const user = currentUser(app.root);
  const game = app.state.game;
  const g = gradeFor(game.xp);
  const pct = Math.round(g.progress * 100);
  const streak = dayStreak(game.days, Date.now());
  const ladder = GRADES.map((x, i) => `
      <li class="${i === g.index ? 'is-current' : i < g.index ? 'is-past' : ''}"${i === g.index ? ' aria-current="true"' : ''}>
        <strong>${esc(x.name)}</strong><small>від ${x.xp} XP</small></li>`).join('');
  const got = ACHIEVEMENTS.filter((a) => game.achievements[a.id]).length;
  const badges = ACHIEVEMENTS.map((a) => {
    const t = game.achievements[a.id];
    return `<li class="badge ${t ? 'is-got' : 'is-locked'}"><strong>${t ? '🏅' : '🔒'} ${esc(a.title)}</strong>
      <small>${esc(a.about)}</small><small>${t ? `отримано ${new Date(t).toLocaleDateString('uk-UA')}` : 'ще не отримано'}</small></li>`;
  }).join('');
  const langs = ['uk', 'en'].map((l) => {
    const p = app.state.profiles[l];
    const done = Object.values(p.lessons).filter((x) => x.done).length;
    return `<li><strong>${LANG_LABEL[l]}</strong>: ${p.createdAt ? `закріплено вправ — ${done}, залікових спроб — ${p.history.length}` : 'ще не розпочато'}</li>`;
  }).join('');

  root.innerHTML = `
    <h1>Кабінет · ${esc(user.name)}</h1>
    <section class="card grade-card" aria-labelledby="grade-h">
      <h2 id="grade-h">Звання: ${esc(g.grade.name)}</h2>
      <p>${esc(g.grade.about)}</p>
      <div class="bar bar-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Прогрес до наступного звання"><span style="width:${pct}%"></span></div>
      <p class="muted" id="grade-xp">${game.xp} XP. ${g.next ? `До звання «${esc(g.next.name)}» — ${g.toNext} XP.` : 'Це найвище звання.'}</p>
      <ol class="ladder" aria-label="Усі звання">${ladder}</ol>
    </section>
    <dl class="summary">
      <div><dt>Досвід</dt><dd>${game.xp}<small> XP</small></dd></div>
      <div><dt>Днів поспіль</dt><dd>${streak}</dd></div>
      <div><dt>Зараховано спроб</dt><dd>${game.passed}</dd></div>
      <div><dt>Досягнення</dt><dd>${got}<small> / ${ACHIEVEMENTS.length}</small></dd></div>
    </dl>
    <section class="card"><h2>Досягнення <span class="count">${got} / ${ACHIEVEMENTS.length}</span></h2><ul class="badges">${badges}</ul></section>
    <section class="card"><h2>Як заробляється досвід</h2>
      <ul>
        <li>Зарахована залікова спроба — ${XP.pass} XP; вільна вправа — ${XP.free} XP.</li>
        <li>Точність від 99% — ще ${XP.accurate} XP, без жодної помилки — ще ${XP.flawless} XP.</li>
        <li>Закріплена вправа — ${XP.lessonDone} XP, завершений модуль Академії — ${XP.moduleDone} XP, повне заняття дня — ${XP.daily} XP.</li>
        <li>Незарахована спроба досвіду не дає: швидкість без точності не винагороджується.</li>
      </ul>
    </section>
    <section class="card"><h2>Курси</h2><ul class="plain">${langs}</ul></section>
    ${statsHtml(app)}
    <section class="card"><h2>Керування кабінетом</h2>
      <p class="muted">Кабінет зберігається лише в цьому браузері. Звання й досягнення — особисті: рейтингу між користувачами немає.</p>
      <form id="cab-pass" class="form" novalidate>
        <h3>Змінити пароль</h3>
        <p><label for="cab-old">Поточний пароль</label><br><input type="password" id="cab-old" autocomplete="current-password"></p>
        <p><label for="cab-new">Новий пароль</label><br><input type="password" id="cab-new" autocomplete="new-password"></p>
        <p class="notice" id="cab-msg" role="alert" hidden></p>
        <p><button type="submit" class="btn">Змінити пароль</button></p>
      </form>
      <p><button type="button" class="btn" id="cab-logout">Вийти з кабінету</button>
        <button type="button" class="btn btn-danger" id="cab-delete">Видалити кабінет</button></p>
    </section>`;

  const msg = (text, kind = '') => {
    const el = $('#cab-msg', root);
    el.hidden = false;
    el.className = `notice ${kind}`;
    el.textContent = text;
  };
  $('#cab-pass', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await changePassword(app.root, app.root.current, $('#cab-old', root).value, $('#cab-new', root).value);
      app.save();
      $('#cab-old', root).value = '';
      $('#cab-new', root).value = '';
      msg('Пароль змінено.');
    } catch (err) {
      msg(err.message, 'notice-error');
    }
  });
  $('#cab-logout', root).addEventListener('click', () => app.signOut());
  $('#cab-delete', root).addEventListener('click', () => {
    if (!confirm(`Видалити кабінет «${user.name}» разом з усім прогресом? Цю дію не можна скасувати.`)) return;
    deleteAccount(app.root, app.root.current);
    app.signedIn('#/');
  });
}
