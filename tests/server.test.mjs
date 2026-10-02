// Серверна частина кабінетів: вхід з будь-якого пристрою та відновлення пароля за секретним питанням.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, memoryStore, LIMITS } from '../server/account-service.js';
import { emptyState } from '../src/core/storage.js';

function setup() {
  let t = 1_000_000;
  const store = memoryStore();
  const service = createService({ store, secret: 'test-secret-0123456789abcdef', now: () => t, cost: 1024 });
  const call = (action, payload = {}) => service.handle({ action, ...payload });
  const tick = (ms) => { t += ms; };
  const reg = (name = 'Оля', extra = {}) => call('register', { name, password: 'таємно', question: 'Кличка першого кота?', answer: 'Мурчик', ...extra });
  return { store, call, tick, reg };
}

test('реєстрація: лише ім’я, пароль і секретне питання; секрети не зберігаються відкрито', async () => {
  const { store, reg, call } = setup();
  const r = await reg();
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Оля');
  assert.equal(r.body.data, null);
  assert.ok(r.body.token);
  const raw = [...store.map.values()].join('');
  assert.ok(!raw.includes('таємно') && !raw.toLowerCase().includes('мурчик'), 'пароль і відповідь — лише хеші');
  const rec = JSON.parse([...store.map.values()][0]);
  assert.deepEqual(Object.keys(rec).sort(), ['aHash', 'aSalt', 'createdAt', 'data', 'fails', 'hash', 'id', 'name', 'pv', 'question', 'salt', 'updatedAt', 'v'], 'жодних зайвих персональних даних');
  assert.ok(![...store.map.keys()][0].includes('оля'), 'ім’я не видно в назві файла');

  assert.equal((await reg('оля')).status, 409, 'ім’я без урахування регістру');
  assert.equal((await reg('Я')).body.code, 'bad_name');
  assert.equal((await reg('Іван', { password: '123' })).body.code, 'bad_password');
  assert.equal((await reg('Іван', { question: 'Що?' })).body.code, 'bad_question');
  assert.equal((await reg('Іван', { answer: ' ' })).body.code, 'bad_answer');
  assert.equal((await call('щось')).status, 400);
  assert.equal((await call('constructor')).status, 400);
});

test('вхід з іншого пристрою повертає збережений прогрес', async () => {
  const { reg, call } = setup();
  const { token } = (await reg()).body;
  const data = emptyState();
  data.settings.lang = 'uk';
  data.game.xp = 320;
  const saved = await call('save', { token, data });
  assert.equal(saved.status, 200);

  // «Інший комп'ютер»: відомі лише ім'я та пароль.
  const other = await call('login', { name: 'ОЛЯ', password: 'таємно' });
  assert.equal(other.status, 200);
  assert.equal(other.body.data.game.xp, 320);
  assert.equal(other.body.updatedAt, saved.body.updatedAt);
  assert.deepEqual((await call('load', { token: other.body.token })).body.data, data);

  assert.equal((await call('login', { name: 'Оля', password: 'не той' })).status, 401);
  const unknown = await call('login', { name: 'Хтось', password: 'таємно' });
  assert.equal(unknown.body.error, 'Невірне ім’я або пароль.', 'те саме повідомлення для невідомого імені');
});

test('конфлікт: прогрес, змінений на іншому пристрої, не перезаписується мовчки', async () => {
  const { reg, call, tick } = setup();
  const a = (await reg()).body;
  const b = (await call('login', { name: 'Оля', password: 'таємно' })).body;
  const d1 = emptyState(); d1.game.xp = 10;
  tick(1000);
  const first = await call('save', { token: a.token, data: d1, base: a.updatedAt });
  assert.equal(first.status, 200);
  const d2 = emptyState(); d2.game.xp = 99;
  const stale = await call('save', { token: b.token, data: d2, base: b.updatedAt });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.data.game.xp, 10, 'сервер повертає свіжу копію');
  const retry = await call('save', { token: b.token, data: d2, base: stale.body.updatedAt });
  assert.equal(retry.status, 200);
  assert.ok(retry.body.updatedAt > first.body.updatedAt);
});

test('відновлення пароля за секретним питанням', async () => {
  const { reg, call } = setup();
  const { token } = (await reg()).body;
  const data = emptyState(); data.game.xp = 55;
  await call('save', { token, data });

  const q = await call('question', { name: 'оля' });
  assert.deepEqual(q.body, { name: 'Оля', question: 'Кличка першого кота?' });
  assert.equal((await call('question', { name: 'Хтось' })).status, 404);

  assert.equal((await call('reset', { name: 'Оля', answer: 'Барсик', password: 'новий1' })).body.code, 'bad_answer');
  const ok = await call('reset', { name: 'Оля', answer: '  МУРЧИК ', password: 'новий1' });
  assert.equal(ok.status, 200, 'відповідь без урахування регістру й пробілів');
  assert.equal(ok.body.data.game.xp, 55, 'прогрес збережено');

  assert.equal((await call('login', { name: 'Оля', password: 'таємно' })).status, 401, 'старий пароль більше не діє');
  assert.equal((await call('login', { name: 'Оля', password: 'новий1' })).status, 200);
  assert.equal((await call('load', { token })).status, 401, 'старі сеанси завершено');
  assert.equal((await call('reset', { name: 'Оля', answer: 'Мурчик', password: '1' })).body.code, 'bad_password');
});

test('захист від підбору пароля та відповіді', async () => {
  const { reg, call, tick } = setup();
  await reg();
  for (let i = 0; i < LIMITS.maxFails; i++) assert.equal((await call('reset', { name: 'Оля', answer: `спроба ${i}`, password: 'новий1' })).status, 401);
  const locked = await call('reset', { name: 'Оля', answer: 'Мурчик', password: 'новий1' });
  assert.equal(locked.status, 429, 'навіть правильна відповідь не приймається під час паузи');
  assert.match(locked.body.error, /через 10 хв/);
  assert.equal((await call('login', { name: 'Оля', password: 'таємно' })).status, 200, 'вхід за паролем не блокується');
  tick(LIMITS.lockMs + 1);
  assert.equal((await call('reset', { name: 'Оля', answer: 'Мурчик', password: 'новий1' })).status, 200);

  for (let i = 0; i < LIMITS.maxFails; i++) assert.equal((await call('login', { name: 'Оля', password: `x${i}xx` })).status, 401);
  assert.equal((await call('login', { name: 'Оля', password: 'новий1' })).status, 429);
  tick(LIMITS.lockMs + 1);
  assert.equal((await call('login', { name: 'Оля', password: 'новий1' })).status, 200);
});

test('токен: підробка, чужий секрет і завершений строк відхиляються', async () => {
  const { reg, call, tick, store } = setup();
  const { token } = (await reg()).body;
  const [payload, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 'оля', pv: 1, exp: 9e15 })).toString('base64url');
  for (const bad of ['', 'abc', `${forged}.${mac}`, `${payload}.${mac.slice(0, -2)}xx`, null]) {
    assert.equal((await call('load', { token: bad })).status, 401);
  }
  const other = createService({ store, secret: 'інший-секрет-0123456789abcdef', cost: 1024 });
  assert.equal((await other.handle({ action: 'load', token })).status, 401);
  tick(LIMITS.tokenMs + 1);
  assert.equal((await call('load', { token })).status, 401, 'строк дії вичерпано');
  assert.throws(() => createService({ store, secret: 'короткий' }));
});

test('зміна пароля, зміна секретного питання, видалення кабінету', async () => {
  const { reg, call, store } = setup();
  const { token } = (await reg()).body;
  assert.equal((await call('password', { token, oldPassword: 'не той', password: 'новий1' })).status, 401);
  const changed = await call('password', { token, oldPassword: 'таємно', password: 'новий1' });
  assert.equal(changed.status, 200);
  assert.equal((await call('load', { token })).status, 401);
  const t2 = changed.body.token;

  assert.equal((await call('recovery', { token: t2, password: 'новий1', question: 'Улюблене місто?', answer: 'Львів' })).status, 200);
  assert.equal((await call('question', { name: 'Оля' })).body.question, 'Улюблене місто?');
  assert.equal((await call('reset', { name: 'Оля', answer: 'Мурчик', password: 'ще один' })).status, 401);

  assert.equal((await call('delete', { token: t2, password: 'не той' })).status, 401);
  assert.equal((await call('delete', { token: t2, password: 'новий1' })).status, 200);
  assert.equal(store.map.size, 0, 'дані видалено із сервера');
  assert.equal((await call('login', { name: 'Оля', password: 'новий1' })).status, 401);
});

test('непридатний або завеликий прогрес відхиляється', async () => {
  const { reg, call } = setup();
  const { token } = (await reg()).body;
  assert.equal((await call('save', { token, data: { foo: 1 } })).body.code, 'bad_data');
  assert.equal((await call('save', { token, data: [] })).body.code, 'bad_data');
  const huge = emptyState();
  huge.junk = 'x'.repeat(LIMITS.dataBytes);
  assert.equal((await call('save', { token, data: huge })).status, 413);
  assert.equal((await reg('Іван', { data: 'рядок' })).body.code, 'bad_data');
});
