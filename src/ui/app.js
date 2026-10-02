// Точка входу: кабінети, стан, маршрутизація, завантаження даних.

import { emptyProfile } from '../core/storage.js';
import { loadRoot, saveRoot, currentUser, logout } from '../core/accounts.js';
import { gradeFor } from '../core/gamification.js';
import { DEFAULT_SETTINGS } from '../core/config.js';
import { buildCurriculum } from '../core/curriculum.js';
import * as pages from './views.js';
import { auth, cabinet } from './account-views.js';
import { exam, certificate } from './exam-views.js';

const views = { ...pages, auth, cabinet, exam, certificate };
import { $, $$, esc, announce } from './dom.js';

const main = document.getElementById('app');
const curricula = {};
let cleanup = null;

const app = {
  root: loadRoot(localStorage),
  state: null, // дані поточного кабінету: налаштування, профілі мов, гейміфікація
  cur: null,
  profile: null,
  daily: null,
  pendingDrill: null,

  /** Після входу, виходу чи заміни даних: прив'язати стан до поточного кабінету. */
  bind() {
    const user = currentUser(this.root);
    this.state = user ? user.data : null;
    this.daily = null;
    this.pendingDrill = null;
    this.applySettings();
    this.updateUser();
  },

  save() {
    if (!saveRoot(localStorage, this.root)) {
      announce('Не вдалося зберегти прогрес: сховище браузера недоступне.');
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

  signedIn(hash = '#/') {
    this.bind();
    this.save();
    this.go(hash);
  },

  signOut() {
    logout(this.root);
    this.bind();
    this.save();
    this.go('#/');
    announce('Ти вийшов із кабінету.');
  },

  applySettings() {
    const s = this.state?.settings || DEFAULT_SETTINGS;
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    root.dataset.motion = s.animations ? 'on' : 'off';
  },

  /** Ім'я, звання й кнопка виходу в шапці. */
  updateUser() {
    const box = $('#user-box');
    const user = currentUser(this.root);
    box.hidden = !user;
    if (!user) return;
    const g = gradeFor(user.data.game.xp);
    $('#user-link').textContent = `${user.name} · ${g.grade.name}`;
    $('#user-link').setAttribute('aria-label', `Кабінет: ${user.name}, звання «${g.grade.name}», ${user.data.game.xp} XP`);
  },

  async render() {
    cleanup?.();
    cleanup = null;
    const [, route = '', arg = ''] = location.hash.split('/');
    const lang = this.state?.settings.lang || null;
    updateNav(route, lang, Boolean(this.state));

    if (route === 'sources') return void (await views.sources(this, main));
    if (!this.state) return void views.auth(this, main);
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
app.bind();
app.render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим недоступний — не критично */ });
}

window.soloApp = app; // для наскрізних перевірок і налагодження
