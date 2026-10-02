// node scripts/e2e.mjs — наскрізна перевірка у справжньому браузері (Chromium/Edge через DevTools Protocol).
// Повторює сценарій демонстрації журі. Браузер: змінна BROWSER або стандартний шлях Edge/Chrome.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './serve.mjs';

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.error('Браузер не знайдено. Вкажи шлях у змінній BROWSER.');
  process.exit(2);
}

const PORT = 8123;
const DEBUG_PORT = 9333;
const shots = process.env.SHOTS_DIR || null;
if (shots) mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(PORT);
const profileDir = mkdtempSync(join(tmpdir(), 'solo-e2e-'));
const browser = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,900',
  ...(process.env.CI ? ['--no-sandbox', '--disable-gpu'] : []), 'about:blank',
], { stdio: 'ignore' });

let ws;
const errors = [];
let failed = false;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* браузер ще стартує */ }
  }
  assert.ok(target, 'браузер не відповів');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, what = expression) => {
    for (let i = 0; i < 100; i++) {
      if (await js(expression)) return;
      await sleep(50);
    }
    throw new Error(`Не дочекалися: ${what}`);
  };
  const key = async (ch) => {
    const special = { Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) }, Tab: { code: 'Tab', windowsVirtualKeyCode: 9 } }[ch];
    const extra = special || (ch.length > 1 ? {} : { text: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, ...extra });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, ...(special ? { code: special.code, windowsVirtualKeyCode: special.windowsVirtualKeyCode } : {}) });
  };
  const typeText = async (text, { errorAt = -1, delay = 0 } = {}) => {
    let i = 0;
    for (const ch of text) {
      if (i === errorAt) await key(ch === '~' ? '#' : '~');
      await key(ch);
      if (delay) await sleep(delay);
      i++;
    }
  };
  const exerciseText = () => js("[...document.querySelectorAll('#typebox .c')].map(e => e.textContent).join('')");
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const goto = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(150); };
  const text = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const shot = async (name) => {
    if (!shots) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const step = (name) => console.log(`✔ ${name}`);

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await waitFor("document.querySelector('[data-lang]')", 'екран вибору мови');
  await shot('01-onboarding');

  // 1. Новий профіль і вибір української.
  await click('[data-lang="uk"]');
  await waitFor("document.querySelector('[data-start=\"zero\"]')");
  await click('[data-start="zero"]');
  await waitFor("document.querySelector('#go-next')", 'навчальний шлях');
  assert.match(await text('h1'), /Навчальний шлях · Українська/);
  assert.equal(await js("document.querySelectorAll('.lesson.is-locked').length > 20"), true, 'решта вправ закрита');
  await shot('02-path');
  step('новий профіль, українська, шлях із закритими вправами');

  // 2. Гама: розучування з підказкою, залік без підказки.
  await click('#go-next');
  await waitFor("document.querySelector('#typebox')");
  assert.equal(await js("document.activeElement.id"), 'typebox', 'фокус у полі набору');
  assert.equal(await js("!!document.querySelector('.kb') && !!document.querySelector('.kb-next')"), true, 'розучування: клавіатура й підказка');
  assert.match(await text('#tr-hint'), /«а» — лівий вказівний/);
  await shot('03-practice');
  await typeText(await exerciseText());
  await waitFor("document.querySelector('#res-primary')", 'підсумок розучування');
  assert.match(await text('#res-primary'), /Перейти до заліку/);
  assert.equal(await js("Object.keys(soloApp.profile.lessons).length"), 0, 'розучування не зараховується');
  await key('Enter');
  await waitFor("document.querySelector('#typebox') && !document.querySelector('.results')");
  assert.equal(await js("!document.querySelector('.kb') && !document.querySelector('.kb-next') && !document.querySelector('#tr-hint')"), true, 'залік: жодної підказки');
  await shot('04-test-no-hints');
  step('розучування з підказкою, залік без екранної клавіатури');

  // 3. Навмисна помилка: чужа розкладка не рахується, справжня помилка рахується і не зникає.
  let target1 = await exerciseText();
  await key('f');
  assert.match(await text('#tr-notice'), /іншу розкладку/);
  assert.equal(await js("soloApp && document.querySelector('#tr-errors').textContent"), 'Помилок: 0');
  await key('Alt'); await key('Dead');
  await typeText(target1, { errorAt: 4, delay: 2 });
  await waitFor("document.querySelector('.results')", 'підсумок заліку');
  const resultHtml = await text('.results');
  assert.match(resultHtml, /Спробу зараховано/);
  assert.match(await text('.metrics'), /Помилки1/);
  assert.equal(await js("soloApp.profile.lessons['s1-fj'].streak"), 1);
  assert.equal(await js("soloApp.profile.history[0].errors"), 1, 'виправлена помилка у статистиці');
  assert.match(await text('#res-advice'), /Ще 2 успішні спроби поспіль/);
  await shot('05-result');
  step('помилка врахована, чужа розкладка/Alt/dead key не ламають спробу, є наступна дія');

  // Дві чисті спроби → вправу закріплено, відкрито наступну.
  for (let n = 0; n < 2; n++) {
    await key('Enter');
    await waitFor("document.querySelector('#typebox') && !document.querySelector('.results')");
    await typeText(await exerciseText(), { delay: 2 });
    await waitFor("document.querySelector('.results')");
  }
  assert.equal(await js("soloApp.profile.lessons['s1-fj'].done"), true);
  assert.match(await text('#res-primary'), /Далі: Нові клавіші: В Л/);
  step('три успішні спроби поспіль закріплюють вправу');

  // 4. Перезавантаження: прогрес зберігається.
  await send('Page.reload');
  await waitFor("window.soloApp && soloApp.profile && document.querySelector('#typebox')", 'сторінка після перезавантаження');
  await goto('#/');
  await waitFor("document.querySelector('#go-next')", 'навчальний шлях після перезавантаження');
  assert.equal(await js("soloApp.profile.lessons['s1-fj'].done && soloApp.profile.lessons['s1-fj'].bestSpm > 0"), true);
  assert.equal(await js("document.querySelectorAll('.lesson.is-done').length"), 1);
  assert.match(await text('.next-title'), /Нові клавіші: В Л/);
  step('прогрес і особистий результат збережено після перезавантаження');

  // 5. Невдала спроба: швидкість без точності не зараховується, порада конкретна.
  await click('#go-next');
  await waitFor("document.querySelector('[data-phase=\"test\"]')");
  await click('[data-phase="test"]');
  await waitFor("document.querySelector('#typebox')");
  const t2 = await exerciseText();
  let i = 0;
  for (const ch of t2) {
    if (ch === 'л' && i % 2 === 0) await key('д');
    await key(ch);
    i++;
  }
  await waitFor("document.querySelector('.results')");
  assert.match(await text('.result-status'), /не зараховано: точність/);
  assert.match(await text('#res-advice'), /Повтори (перехід|клавішу)/);
  assert.equal(await js("soloApp.profile.lessons['s1-dk'].streak"), 0);
  await shot('06-failed');
  await key('Enter');
  await waitFor("location.hash === '#/drill' && document.querySelector('#typebox')", 'точкове повторення');
  assert.match(await text('h1'), /Точкове повторення/);
  step('неточна спроба не зарахована, запропоновано точкове повторення');

  // 6. Вибір рівня → слова лише з відкритих клавіш → Академія.
  await js('soloApp.profile.placed = true; soloApp.save()');
  await goto('#/lesson/s2-home');
  await waitFor("document.querySelector('[data-phase=\"test\"]')");
  await click('[data-phase="test"]');
  await waitFor("document.querySelector('#typebox')");
  const words = await exerciseText();
  assert.match(words, /^[фіваолдж ]+$/, 'слова лише з домашнього ряду');
  await shot('07-words');
  await typeText(words, { delay: 2 });
  await waitFor("document.querySelector('.results')");
  step(`етап 2: «${words.slice(0, 40)}…» — лише відкриті клавіші`);

  await goto('#/academy');
  await waitFor("document.querySelector('.module')");
  assert.equal(await js("document.querySelectorAll('.module').length"), 10);
  await shot('08-academy');
  await goto('#/lesson/a-bigrams-1');
  await waitFor("document.querySelector('[data-phase=\"test\"]')");
  await click('[data-phase="test"]');
  await waitFor("document.querySelector('#typebox')");
  await typeText(await exerciseText(), { delay: 2 });
  await waitFor("document.querySelector('.results')");
  assert.equal(await js("soloApp.profile.lessons['a-bigrams-1'].attempts"), 1);
  step('етап 3: вправа Академії на частотні біграми');

  // 7. Інші сторінки.
  await goto('#/stats');
  await waitFor("document.querySelector('.chart, .kb')");
  await shot('09-stats');
  await goto('#/sources');
  await waitFor("document.querySelectorAll('table tbody tr').length >= 4", 'таблиця джерел');
  assert.match(await text('#app'), /GPL-3\.0/);
  await shot('10-sources');
  await goto('#/daily');
  await waitFor("document.querySelector('.stepper') && document.querySelector('#typebox')");
  await goto('#/custom');
  await waitFor("document.querySelector('#cu-text')");
  await js("document.querySelector('#cu-text').value = 'коротко'; document.querySelector('#cu-start').click()");
  assert.match(await text('#cu-msg'), /замало тексту/);
  await js("document.querySelector('#cu-text').value = 'Власний текст для набору: перевіримо, що він працює.'; document.querySelector('#cu-start').click()");
  await waitFor("document.querySelector('#typebox')");
  await goto('#/settings');
  await waitFor("document.querySelector('#set-streak')");
  step('статистика, джерела й ліцензії, заняття дня, власний текст, налаштування');

  // 8. Англійська: окремий профіль і QWERTY.
  await js("const s = document.querySelector('#set-lang'); s.value = 'en'; s.dispatchEvent(new Event('change'))");
  await sleep(200);
  await goto('#/');
  await waitFor("document.querySelector('[data-start=\"zero\"]')", 'новий англійський профіль');
  await click('[data-start="zero"]');
  await waitFor("document.querySelector('#go-next')");
  await click('#go-next');
  await waitFor("document.querySelector('#typebox')");
  assert.match(await text('#tr-hint'), /«f» — лівий вказівний/);
  await key('а');
  assert.match(await text('#tr-notice'), /іншу розкладку/);
  await typeText(await exerciseText());
  await waitFor("document.querySelector('#res-primary')");
  assert.equal(await js("soloApp.state.profiles.uk.lessons['s1-fj'].done"), true, 'український прогрес не зачеплено');
  step('англійська розкладка працює, профілі мов незалежні');

  // 9. Вузький екран і керування з клавіатури.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await goto('#/');
  await waitFor("document.querySelector('#go-next')");
  await sleep(200);
  assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true, 'немає горизонтального прокручування');
  await shot('11-mobile');
  await send('Emulation.clearDeviceMetricsOverride');
  await js("document.querySelector('.skip').focus()");
  await key('Tab');
  assert.equal(await js("document.activeElement.classList.contains('brand')"), true, 'Tab переходить по елементах');
  step('вузький екран без горизонтального прокручування, навігація клавішею Tab');

  await sleep(300);
  assert.deepEqual(errors, [], 'у консолі браузера немає помилок');
  step('консоль браузера без помилок');
  console.log('\nНаскрізну перевірку пройдено.');
} catch (err) {
  failed = true;
  console.error('\n✖ Наскрізна перевірка не пройдена:', err.message);
  if (errors.length) console.error('Помилки консолі:', errors);
} finally {
  try { ws?.close(); } catch { /* вже закрито */ }
  browser.kill();
  server.close();
  await sleep(500);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* тимчасові файли приберуть пізніше */ }
  process.exit(failed ? 1 : 0);
}
