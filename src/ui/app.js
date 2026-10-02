// Точка входу: кабінети, синхронізація із сервером, стан, маршрутизація, завантаження даних.

import { emptyProfile, validateState } from '../core/storage.js';
import { loadRoot, saveRoot, currentUser, logout, adoptRemote, deleteAccount, isRemote } from '../core/accounts.js';
import { createRemote, defaultUrls, RemoteError } from '../core/remote.js';
import { gradeFor } from '../core/gamification.js';
import { DEFAULT_SETTINGS } from '../core/config.js';
import { buildCurriculum } from '../core/curriculum.js';
import * as pages from './views.js';
import { auth, cabinet } from './account-views.js';
import { exam, certificate } from './exam-views.js';
import { $, $$, esc, announce } from './dom.js';

const views = { ...pages, auth, cabinet, exam, certificate };

const main = document.getElementById('app');
const curricula = {};
let cleanup = null;
let pushTimer = null;
let pushing = false;
let pendingServer = null; // свіжа копія із сервера, яку не можна застосувати посеред вправи

const app = {
  root: loadRoot(localStorage),
  remote: createRemote({ urls: defaultUrls(location) }),
  ready: null, // Promise<boolean>: чи знайдено сервер кабінетів
  state: null, // дані поточного кабінету: налаштування, профілі мов, гейміфікація
  cur: null,
  profile: null,
  daily: null,
  pendingDrill: null,
  authMessage: '',
  sync: 'local', // local | saved | saving | offline

  /** Після входу, виходу чи заміни даних: прив'язати стан до поточного кабінету. */
  bind() {
    const user = currentUser(this.root);
    this.state = user ? user.data : null;
    this.daily = null;
    this.pendingDrill = null;
    this.sync = isRemote(user) ? (user.remote.dirty ? 'offline' : 'saved') : 'local';
    this.applySettings();
    this.updateUser();
  },

  /** Зберегти в браузері; серверний кабінет додатково відправити на сервер. */
  save() {
    const user = currentUser(this.root);
    if (isRemote(user)) user.remote.dirty = true;
    this.persist();
    if (isRemote(user)) {
      this.setSync('saving'); // позначка «збережено» не має висіти, поки зміни ще не на сервері
      this.schedulePush();
    }
  },

  persist() {
    if (!saveRoot(localStorage, this.root)) {
      announce('Не вдалося зберегти прогрес: сховище браузера недоступне.');
    }
  },

  setSync(state) {
    this.sync = state;
    this.updateUser();
  },

  schedulePush(delay = 1200) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => this.push(), delay);
  },

  /** Відправити прогрес на сервер. Повертає true, якщо сервер має актуальну копію. */
  async push() {
    clearTimeout(pushTimer);
    const user = currentUser(this.root);
    if (!isRemote(user) || !user.remote.dirty) return true;
    if (pushing) { this.schedulePush(800); return false; }
    pushing = true;
    this.setSync('saving');
    try {
      if (!this.remote.available && !(await this.remote.detect())) throw new Error('offline');
      const snapshot = JSON.stringify(user.data);
      const res = await this.remote.call('save', { token: user.remote.token, data: JSON.parse(snapshot), base: user.remote.updatedAt });
      user.remote.updatedAt = res.updatedAt;
      // Якщо під час відправлення прогрес змінився, він лишається «незбереженим» до наступного разу.
      user.remote.dirty = JSON.stringify(user.data) !== snapshot;
      this.persist();
      if (currentUser(this.root) === user) {
        this.setSync(user.remote.dirty ? 'saving' : 'saved');
        if (user.remote.dirty) this.schedulePush();
      }
      return !user.remote.dirty;
    } catch (err) {
      if (err instanceof RemoteError && err.code === 'conflict') {
        this.takeServer(user, err.body.data, err.body.updatedAt, 'Прогрес оновлено з іншого пристрою.');
        return true;
      }
      if (err instanceof RemoteError && err.status === 401) {
        this.sessionExpired(user);
        return false;
      }
      if (currentUser(this.root) === user) {
        this.setSync('offline');
        this.schedulePush(20000);
      }
      return false;
    } finally {
      pushing = false;
    }
  },

  /** Прийняти копію із сервера. Посеред вправи — відкласти до наступної сторінки. */
  takeServer(user, data, updatedAt, message) {
    if (document.getElementById('typebox') && currentUser(this.root) === user) {
      pendingServer = { user, data, updatedAt, message };
      return;
    }
    try { user.data = data ? validateState(data) : user.data; } catch { /* лишаємо локальну копію */ }
    user.remote.updatedAt = updatedAt;
    user.remote.dirty = false;
    this.persist();
    if (currentUser(this.root) === user) {
      this.bind();
      this.render();
      if (message) announce(message);
    }
  },

  sessionExpired(user) {
    deleteAccount(this.root, Object.keys(this.root.users).find((id) => this.root.users[id] === user));
    this.persist();
    this.bind();
    this.authMessage = 'Сеанс завершено — можливо, пароль змінено на іншому пристрої. Увійди ще раз.';
    this.go('#/');
  },

  /** Під час запуску: звірити збережену копію із сервером. */
  async syncOnStart() {
    const user = currentUser(this.root);
    const online = await this.ready;
    if (!isRemote(user)) return;
    if (!online) { this.setSync('offline'); this.schedulePush(20000); return; }
    if (user.remote.dirty) { await this.push(); return; }
    try {
      const res = await this.remote.call('load', { token: user.remote.token });
      if (res.updatedAt !== user.remote.updatedAt) this.takeServer(user, res.data, res.updatedAt, 'Прогрес оновлено з іншого пристрою.');
      else this.setSync('saved');
    } catch (err) {
      if (err instanceof RemoteError && err.status === 401) this.sessionExpired(user);
      else this.setSync('offline');
    }
  },

  go(hash) {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  },

  setLang(lang, hash = '#/') {
    this.state.settings.lang = lang;
    this.daily = null;
    this.save();
    this.go(hash);
  },

  startDrill(action, returnTo) {
    this.pendingDrill = { ...action, returnTo };
    this.go('#/drill');
  },

  /** Замінити дані поточного кабінету (імпорт, скидання). */
  replaceState(next) {
    currentUser(this.root).data = next;
    this.bind();
    this.save();
    this.go('#/');
  },

  /** Вхід у серверний кабінет: відповідь сервера стає копією в браузері. */
  remoteSignedIn(session) {
    adoptRemote(this.root, session, Date.now());
    this.root.legacy = null;
    this.signedIn('#/');
  },

  signedIn(hash = '#/') {
    this.bind();
    this.persist();
    this.go(hash);
  },

  /** Вихід. Копія серверного кабінету прибирається з браузера — на спільному комп'ютері не лишається слідів. */
  async signOut() {
    const user = currentUser(this.root);
    if (isRemote(user)) {
      if (user.remote.dirty && !(await this.push())
        && !confirm('Останній прогрес ще не збережено на сервері (немає зв’язку). Якщо вийти зараз, він буде втрачений. Вийти?')) return;
      deleteAccount(this.root, this.root.current);
    } else {
      logout(this.root);
    }
    clearTimeout(pushTimer);
    this.bind();
    this.persist();
    this.go('#/');
    announce('Ти вийшов із кабінету.');
  },

  applySettings() {
    const s = this.state?.settings || DEFAULT_SETTINGS;
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    root.dataset.motion = s.animations ? 'on' : 'off';
  },

  /** Ім'я, звання, стан синхронізації та кнопка виходу в шапці. */
  updateUser() {
    const box = $('#user-box');
    const user = currentUser(this.root);
    box.hidden = !user;
    if (!user) return;
    const g = gradeFor(user.data.game.xp);
    $('#user-link').textContent = `${user.name} · ${g.grade.name}`;
    $('#user-link').setAttribute('aria-label', `Кабінет: ${user.name}, звання «${g.grade.name}», ${user.data.game.xp} XP`);
    const label = {
      local: ['локальний', 'Локальний кабінет: прогрес зберігається лише в цьому браузері'],
      saved: ['збережено', 'Прогрес збережено на сервері'],
      saving: ['зберігаю…', 'Прогрес відправляється на сервер'],
      offline: ['офлайн', 'Немає зв’язку із сервером: прогрес збережено в браузері й буде відправлено пізніше'],
    }[this.sync];
    const el = $('#sync-state');
    el.textContent = label[0];
    el.title = label[1];
    el.dataset.sync = this.sync;
  },

  async render() {
    cleanup?.();
    cleanup = null;
    if (pendingServer) {
      const p = pendingServer;
      pendingServer = null;
      this.takeServer(p.user, p.data, p.updatedAt, p.message);
      return;
    }
    const [, route = '', arg = ''] = location.hash.split('/');
    const lang = this.state?.settings.lang || null;
    updateNav(route, lang, Boolean(this.state));

    if (route === 'sources') return void (await views.sources(this, main));
    if (!this.state) return void (await views.auth(this, main));
    if (!lang) return void views.onboarding(this, main);

    try {
      this.cur = await loadCurriculum(lang);
    } catch (err) {
      main.innerHTML = `<section class="card narrow"><h1>Не вдалося завантажити дані</h1>
        <p role="alert">Словники для цієї мови недоступні. Перевір з’єднання й онови сторінку. Якщо відкриваєш файл напряму з диска, запусти локальний сервер: <code>npm start</code>.</p>
        <p class="muted">${esc(err.message)}</p></section>`;
      return;
    }
    this.profile = this.state.profiles[lang] ??= emptyProfile();

    if (route === 'settings') return void views.settings(this, main);
    if (route === 'diagnostic') { cleanup = views.diagnostic(this, main); return; }
    if (!this.profile.createdAt) return void views.onboarding(this, main);

    switch (route) {
      case '': views.home(this, main); break;
      case 'lesson': cleanup = views.lesson(this, main, decodeURIComponent(arg)); break;
      case 'academy': views.academy(this, main); break;
      case 'daily': cleanup = views.daily(this, main); break;
      case 'review': cleanup = views.review(this, main); break;
      case 'drill': cleanup = views.drill(this, main); break;
      case 'cabinet': case 'stats': views.cabinet(this, main); break;
      case 'exam': cleanup = views.exam(this, main, arg); break;
      case 'certificate': views.certificate(this, main, arg); break;
      case 'custom': cleanup = views.custom(this, main); break;
      default: views.notFound(main);
    }
    if (typeof cleanup !== 'function') cleanup = null;
    window.scrollTo(0, 0);
  },
};

async function loadCurriculum(lang) {
  if (curricula[lang]) return curricula[lang];
  const get = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };
  const [words, ngrams, content] = await Promise.all([
    get(`data/derived/${lang}-words.json`),
    get(`data/derived/${lang}-ngrams.json`),
    get(`data/curriculum/content-${lang}.json`),
  ]);
  curricula[lang] = buildCurriculum(lang, { words: words.words, ngrams, content });
  return curricula[lang];
}

function updateNav(route, lang, signedIn) {
  $$('.nav a').forEach((a) => {
    const target = a.getAttribute('href').split('/')[1] || '';
    const current = target === route || (target === '' && route === 'lesson') || (target === 'cabinet' && ['stats', 'exam', 'certificate'].includes(route));
    if (current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const badge = $('#lang-badge');
  badge.textContent = lang ? (lang === 'uk' ? 'UK · ЙЦУКЕН' : 'EN · QWERTY') : '';
  badge.hidden = !lang || !signedIn;
}

$('#lang-badge').addEventListener('click', () => {
  if (!app.state) return;
  const lang = app.state.settings.lang === 'uk' ? 'en' : 'uk';
  app.setLang(lang, '#/');
  announce(`Мову набору змінено: ${lang === 'uk' ? 'українська' : 'англійська'}.`);
});
$('#logout').addEventListener('click', () => app.signOut());

window.addEventListener('hashchange', () => app.render());
window.addEventListener('online', () => { if (currentUser(app.root)?.remote?.dirty) app.push(); });
// Коли вкладку ховають або закривають — остання спроба відправити прогрес.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentUser(app.root)?.remote?.dirty) app.push();
});

app.ready = app.remote.detect();
app.bind();
app.render();
app.syncOnStart();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим недоступний — не критично */ });
}

window.soloApp = app; // для наскрізних перевірок і налагодження
