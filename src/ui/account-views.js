// Екран входу (вхід, новий кабінет, відновлення пароля) та сторінка особистого кабінету.

import {
  createAccount, login, deleteAccount, changePassword, listNames, currentUser, userId, isRemote,
  localQuestion, resetLocalPassword, setLocalRecovery, verifyLocalPassword, checkCredentials, checkRecovery,
  NAME_MAX, PASSWORD_MIN, QUESTION_MAX, QUESTION_EXAMPLES,
} from '../core/accounts.js';
import { RemoteError, NetworkError } from '../core/remote.js';
import { GRADES, ACHIEVEMENTS, XP, gradeFor, dayStreak } from '../core/gamification.js';
import { statsHtml, LANG_LABEL } from './views.js';
import { certListHtml, tiersTableHtml } from './exam-views.js';
import { esc, $, $$, announce } from './dom.js';

const NO_LINK = 'Немає зв’язку із сервером. Перевір інтернет і спробуй ще раз.';
const errorText = (err) => (err instanceof NetworkError ? NO_LINK : err.message);

export async function auth(app, root) {
  root.innerHTML = '<section class="card narrow"><h1>Соло</h1><p class="muted" role="status">Перевіряємо зв’язок із сервером кабінетів…</p></section>';
  let online = await app.ready;
  if (app.state) return; // поки чекали, вхід уже відбувся
  const localNames = listNames(app.root);
  let mode = 'login'; // login | create | forgot
  let found = null; // { name, question, local } — крок 2 відновлення пароля
  const initial = app.authMessage;
  app.authMessage = '';

  const draw = (message = '', keep = {}) => {
    const title = { login: 'Вхід до кабінету', create: 'Новий кабінет', forgot: 'Відновлення пароля' }[mode];
    const banner = online
      ? '<p class="notice">Кабінет зберігається на сервері: увійти можна з будь-якого комп’ютера, прогрес підтягнеться сам.</p>'
      : `<p class="notice notice-warn">Сервер кабінетів зараз недоступний. Можна створити локальний кабінет — він працюватиме лише в цьому браузері.
          <button type="button" class="btn btn-small" id="auth-retry">Перевірити зв’язок ще раз</button></p>`;
    const legacy = mode === 'create' && app.root.legacy
      ? '<p class="notice">У цьому браузері знайдено прогрес, збережений раніше. Він перейде до кабінету, який ти зараз створиш.</p>' : '';
    const nameField = `<p><label for="auth-name">Ім’я</label><br>
      <input type="text" id="auth-name" maxlength="${NAME_MAX}" autocomplete="username" value="${esc(keep.name || '')}"></p>`;

    let fields;
    let submit;
    if (mode === 'login') {
      submit = 'Увійти';
      fields = `${nameField}
        <p><label for="auth-pass">Пароль</label><br><input type="password" id="auth-pass" autocomplete="current-password"></p>`;
    } else if (mode === 'create') {
      submit = 'Створити кабінет';
      fields = `${nameField}
        <p><label for="auth-pass">Пароль</label><br><input type="password" id="auth-pass" autocomplete="new-password"></p>
        <p><label for="auth-pass2">Пароль ще раз</label><br><input type="password" id="auth-pass2" autocomplete="new-password"></p>
        <p><label for="auth-question">Секретне питання</label><br>
          <input type="text" id="auth-question" maxlength="${QUESTION_MAX}" list="auth-questions" value="${esc(keep.question || '')}" autocomplete="off">
          <datalist id="auth-questions">${QUESTION_EXAMPLES.map((q) => `<option value="${esc(q)}">`).join('')}</datalist></p>
        <p><label for="auth-answer">Відповідь</label><br><input type="text" id="auth-answer" autocomplete="off"></p>
        <p class="muted">Пароль — щонайменше ${PASSWORD_MIN} символи. Секретне питання потрібне, щоб відновити пароль, якщо забудеш:
          обери таке, відповідь на яке знаєш лише ти. Пошта й телефон не потрібні.</p>`;
    } else if (!found) {
      submit = 'Показати секретне питання';
      fields = `<p>Введи ім’я кабінету — покажемо секретне питання, яке ти задав(-ла) під час створення.</p>${nameField}`;
    } else {
      submit = 'Задати новий пароль';
      fields = `<p>Кабінет: <strong>${esc(found.name)}</strong></p>
        <p class="notice"><strong>Секретне питання:</strong> <span id="auth-shown-question">${esc(found.question)}</span></p>
        <p><label for="auth-answer">Відповідь</label><br><input type="text" id="auth-answer" autocomplete="off"></p>
        <p><label for="auth-pass">Новий пароль</label><br><input type="password" id="auth-pass" autocomplete="new-password"></p>
        <p class="muted">Регістр і зайві пробіли у відповіді не мають значення. Після п’яти невдалих спроб — пауза на 10 хвилин.</p>`;
    }

    root.innerHTML = `
      <section class="card narrow" aria-labelledby="auth-h">
        <h1 id="auth-h">${title}</h1>
        <p>Соло — тренажер сенсорного набору. Кабінет зберігає твій прогрес, звання, досягнення й сертифікати.</p>
        ${banner}${legacy}
        <div class="phase-tabs" role="group" aria-label="Вхід, новий кабінет або відновлення пароля">
          <button type="button" data-mode="login" aria-pressed="${mode === 'login'}">Увійти</button>
          <button type="button" data-mode="create" aria-pressed="${mode === 'create'}">Створити кабінет</button>
          <button type="button" data-mode="forgot" aria-pressed="${mode === 'forgot'}">Забув пароль</button>
        </div>
        <form id="auth-form" class="form" novalidate>
          ${fields}
          <p class="notice notice-error" id="auth-msg" role="alert"${message ? '' : ' hidden'}>${esc(message)}</p>
          <p><button type="submit" class="btn btn-primary" id="auth-submit">${submit}</button></p>
        </form>
        ${!online && localNames.length ? `<p class="muted">Локальні кабінети на цьому пристрої: ${localNames.map(esc).join(', ')}.</p>` : ''}
      </section>`;

    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      found = null;
      draw('', { name: $('#auth-name', root)?.value || keep.name || '' });
    }));
    $('#auth-retry', root)?.addEventListener('click', async () => {
      online = await app.remote.detect();
      draw(online ? '' : 'Сервер досі недоступний.', { name: $('#auth-name', root)?.value || '' });
    });
    $('#auth-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm();
    });
    (found ? $('#auth-answer', root) : $('#auth-name', root)).focus();
  };

  const value = (id) => $(`#${id}`, root)?.value ?? '';

  async function submitForm() {
    const name = found ? found.name : value('auth-name');
    const pass = value('auth-pass');
    const keep = { name, question: value('auth-question') };
    $('#auth-submit', root).disabled = true;
    try {
      if (mode === 'login') {
        if (online) {
          try {
            app.remoteSignedIn(await app.remote.call('login', { name, password: pass }));
          } catch (err) {
            // Кабінет, створений без сервера, лишається доступним на цьому пристрої.
            const local = app.root.users[userId(name)];
            if (!(err instanceof RemoteError && err.code === 'bad_login' && local && !isRemote(local))) throw err;
            await login(app.root, name, pass);
            app.signedIn('#/');
          }
        } else {
          await login(app.root, name, pass);
          app.signedIn('#/');
        }
        announce('Вхід виконано.');
      } else if (mode === 'create') {
        const question = value('auth-question');
        const answer = value('auth-answer');
        if (pass !== value('auth-pass2')) throw new Error('Паролі не збігаються.');
        const problem = checkCredentials(name, pass) || checkRecovery(question, answer);
        if (problem) throw new Error(problem);
        if (online) {
          app.remoteSignedIn(await app.remote.call('register', { name, password: pass, question, answer, data: app.root.legacy }));
        } else {
          await createAccount(app.root, name, pass, Date.now(), { question, answer });
          app.signedIn('#/');
        }
        announce('Кабінет створено.');
      } else if (!found) {
        if (online) {
          try {
            const res = await app.remote.call('question', { name });
            found = { name: res.name, question: res.question, local: false };
          } catch (err) {
            const q = localQuestion(app.root, name);
            if (!(err instanceof RemoteError) || !q) throw err;
            found = { name: app.root.users[userId(name)].name, question: q, local: true };
          }
        } else {
          const q = localQuestion(app.root, name);
          if (!q) throw new Error('Локального кабінету з таким іменем і секретним питанням на цьому пристрої немає.');
          found = { name: app.root.users[userId(name)].name, question: q, local: true };
        }
        draw();
      } else {
        const answer = value('auth-answer');
        if (found.local) {
          await resetLocalPassword(app.root, found.name, answer, pass);
          app.signedIn('#/');
        } else {
          app.remoteSignedIn(await app.remote.call('reset', { name: found.name, answer, password: pass }));
        }
        announce('Пароль змінено, вхід виконано.');
      }
    } catch (err) {
      draw(errorText(err), keep);
    }
  }

  draw(initial);
}

export function cabinet(app, root) {
  const user = currentUser(app.root);
  const remote = isRemote(user);
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
  const where = remote
    ? 'Кабінет зберігається на сервері: увійти можна з будь-якого комп’ютера за іменем і паролем. У цьому браузері лежить копія, тож тренажер працює й без мережі, а прогрес відправляється, щойно з’явиться зв’язок.'
    : 'Це локальний кабінет: він зберігається лише в цьому браузері, бо під час створення сервер був недоступний.';

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
    <section class="card" aria-labelledby="cert-list-h"><h2 id="cert-list-h">Сертифікати</h2>
      <p>Пройди зріз швидкості — зв’язний текст без підказок — і отримай бронзовий, срібний або золотий сертифікат.</p>
      ${tiersTableHtml()}
      ${certListHtml(app)}
      <p><a class="btn btn-primary" href="#/exam">Пройти зріз швидкості</a></p>
    </section>
    <section class="card"><h2>Як заробляється досвід</h2>
      <ul>
        <li>Зарахована залікова спроба — ${XP.pass} XP; вільна вправа — ${XP.free} XP.</li>
        <li>Точність від 99% — ще ${XP.accurate} XP, без жодної помилки — ще ${XP.flawless} XP.</li>
        <li>Закріплена вправа — ${XP.lessonDone} XP, завершений модуль Академії — ${XP.moduleDone} XP, повне заняття дня — ${XP.daily} XP, сертифікат — ${XP.cert} XP.</li>
        <li>Незарахована спроба досвіду не дає: швидкість без точності не винагороджується.</li>
      </ul>
    </section>
    <section class="card"><h2>Курси</h2><ul class="plain">${langs}</ul></section>
    ${statsHtml(app)}
    <section class="card"><h2>Керування кабінетом</h2>
      <p class="muted" id="cab-where">${where} Звання й досягнення — особисті: рейтингу між користувачами немає.</p>
      <p class="notice" id="cab-msg" role="alert" hidden></p>
      <form id="cab-pass" class="form" novalidate>
        <h3>Змінити пароль</h3>
        <p><label for="cab-old">Поточний пароль</label><br><input type="password" id="cab-old" autocomplete="current-password"></p>
        <p><label for="cab-new">Новий пароль</label><br><input type="password" id="cab-new" autocomplete="new-password"></p>
        <p><button type="submit" class="btn">Змінити пароль</button></p>
      </form>
      <form id="cab-recovery" class="form" novalidate>
        <h3>Змінити секретне питання</h3>
        <p><label for="cab-q">Нове секретне питання</label><br><input type="text" id="cab-q" maxlength="${QUESTION_MAX}" list="cab-questions" autocomplete="off">
          <datalist id="cab-questions">${QUESTION_EXAMPLES.map((q) => `<option value="${esc(q)}">`).join('')}</datalist></p>
        <p><label for="cab-a">Відповідь</label><br><input type="text" id="cab-a" autocomplete="off"></p>
        <p><label for="cab-q-pass">Пароль для підтвердження</label><br><input type="password" id="cab-q-pass" autocomplete="current-password"></p>
        <p><button type="submit" class="btn">Зберегти питання</button></p>
      </form>
      <form id="cab-delete-form" class="form" novalidate>
        <h3>Вихід і видалення</h3>
        <p><button type="button" class="btn" id="cab-logout">Вийти з кабінету</button></p>
        <p><label for="cab-del-pass">Щоб видалити кабінет разом з усім прогресом${remote ? ' із сервера' : ''}, введи пароль</label><br>
          <input type="password" id="cab-del-pass" autocomplete="current-password"></p>
        <p><button type="submit" class="btn btn-danger" id="cab-delete">Видалити кабінет</button></p>
      </form>
    </section>`;

  const msg = (text, kind = '') => {
    const el = $('#cab-msg', root);
    el.hidden = false;
    el.className = `notice ${kind}`;
    el.textContent = text;
    el.scrollIntoView({ block: 'nearest' });
  };
  const val = (id) => $(`#${id}`, root).value;
  const clear = (...ids) => ids.forEach((id) => { $(`#${id}`, root).value = ''; });

  $('#cab-pass', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (remote) {
        const res = await app.remote.call('password', { token: user.remote.token, oldPassword: val('cab-old'), password: val('cab-new') });
        user.remote.token = res.token;
      } else {
        await changePassword(app.root, app.root.current, val('cab-old'), val('cab-new'));
      }
      app.persist();
      clear('cab-old', 'cab-new');
      msg(remote ? 'Пароль змінено. На інших пристроях доведеться ввійти ще раз.' : 'Пароль змінено.');
    } catch (err) {
      msg(errorText(err), 'notice-error');
    }
  });

  $('#cab-recovery', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const problem = checkRecovery(val('cab-q'), val('cab-a'));
      if (problem) throw new Error(problem);
      if (remote) await app.remote.call('recovery', { token: user.remote.token, password: val('cab-q-pass'), question: val('cab-q'), answer: val('cab-a') });
      else await setLocalRecovery(app.root, app.root.current, val('cab-q-pass'), val('cab-q'), val('cab-a'));
      app.persist();
      clear('cab-q', 'cab-a', 'cab-q-pass');
      msg('Секретне питання збережено.');
    } catch (err) {
      msg(errorText(err), 'notice-error');
    }
  });

  $('#cab-logout', root).addEventListener('click', () => app.signOut());
  $('#cab-delete-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const password = val('cab-del-pass');
      if (!remote && !(await verifyLocalPassword(app.root, app.root.current, password))) throw new Error('Пароль невірний.');
      if (!confirm(`Видалити кабінет «${user.name}» разом з усім прогресом? Цю дію не можна скасувати.`)) return;
      if (remote) await app.remote.call('delete', { token: user.remote.token, password });
      deleteAccount(app.root, app.root.current);
      app.signedIn('#/');
      announce('Кабінет видалено.');
    } catch (err) {
      msg(errorText(err), 'notice-error');
    }
  });
}
