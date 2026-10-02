// Точка входу: стан, маршрутизація, завантаження даних.

import { loadState, saveState, emptyProfile } from '../core/storage.js';
import { buildCurriculum } from '../core/curriculum.js';
import * as views from './views.js';
import { $, $$, esc, announce } from './dom.js';

const main = document.getElementById('app');
const curricula = {};
let cleanup = null;

const app = {
  state: loadState(localStorage),
  cur: null,
  profile: null,
  daily: null,
  pendingDrill: null,

  save() {
    if (!saveState(localStorage, this.state)) {
      announce('Не вдалося зберегти прогрес: сховище браузера недоступне.');
    }
  },

  go(hash) {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  },

  async setLang(lang, hash = '#/') {
    this.state.settings.lang = lang;
    this.daily = null;
    this.save();
    this.go(hash);
  },

  startDrill(action, returnTo) {
    this.pendingDrill = { ...action, returnTo };
    this.go('#/drill');
  },

  replaceState(next) {
    this.state = next;
    this.daily = null;
    this.save();
    this.applySettings();
    this.go('#/');
  },

  applySettings() {
    const s = this.state.settings;
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    root.dataset.motion = s.animations ? 'on' : 'off';
    root.lang = 'uk';
  },

  async render() {
    cleanup?.();
    cleanup = null;
    const lang = this.state.settings.lang;
    const [, route = '', arg = ''] = location.hash.split('/');
    updateNav(route, lang);

    if (route === 'sources') return void (await views.sources(this, main));
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
      case 'stats': views.stats(this, main); break;
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

function updateNav(route, lang) {
  $$('.nav a').forEach((a) => {
    const target = a.getAttribute('href').split('/')[1] || '';
    const current = target === route || (target === '' && route === 'lesson');
    if (current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const badge = $('#lang-badge');
  badge.textContent = lang ? (lang === 'uk' ? 'UK · ЙЦУКЕН' : 'EN · QWERTY') : '';
  badge.hidden = !lang;
}

$('#lang-badge').addEventListener('click', () => {
  const lang = app.state.settings.lang === 'uk' ? 'en' : 'uk';
  app.setLang(lang, '#/');
  announce(`Мову набору змінено: ${lang === 'uk' ? 'українська' : 'англійська'}.`);
});

window.addEventListener('hashchange', () => app.render());
app.applySettings();
app.render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим недоступний — не критично */ });
}

window.soloApp = app; // для наскрізних перевірок і налагодження
