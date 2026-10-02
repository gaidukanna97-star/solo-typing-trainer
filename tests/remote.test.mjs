// Клієнт сервера кабінетів, копія серверного кабінету в браузері та секретне питання локального кабінету.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemote, defaultUrls, RemoteError, NetworkError, REMOTE_API } from '../src/core/remote.js';
import {
  emptyRoot, createAccount, login, logout, adoptRemote, isRemote, currentUser, listNames, loadRoot, saveRoot,
  localQuestion, resetLocalPassword, setLocalRecovery, verifyLocalPassword, checkRecovery, userId,
} from '../src/core/accounts.js';
import { createService, memoryStore } from '../server/account-service.js';
import { emptyState } from '../src/core/storage.js';

const FAST = { iterations: 1000 };

/** fetch, який замість мережі викликає серверну логіку напряму. */
function fakeNetwork() {
  const service = createService({ store: memoryStore(), secret: 'test-secret-0123456789abcdef', cost: 1024 });
  const state = { online: true, calls: [] };
  const fetchImpl = async (url, init) => {
    state.calls.push(url);
    if (!state.online) throw new TypeError('Failed to fetch');
    if (!url.endsWith('/api/account')) return { status: 404, json: async () => { throw new Error('html'); } };
    const result = await service.handle(JSON.parse(init.body));
    return { status: result.status, json: async () => result.body };
  };
  return { state, fetchImpl };
}

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

test('адреси сервера: той самий сайт, GitHub Pages і файл із диска', () => {
  assert.deepEqual(defaultUrls(new URL('https://solo-typing-trainer.vercel.app/')), [REMOTE_API]);
  assert.deepEqual(defaultUrls(new URL('https://gaidukanna97-star.github.io/solo-typing-trainer/')), [REMOTE_API]);
  assert.deepEqual(defaultUrls(new URL('http://localhost:8080/')), ['http://localhost:8080/api/account', REMOTE_API]);
  assert.deepEqual(defaultUrls(new URL('file:///C:/solo/index.html')), []);
});

test('клієнт знаходить сервер, передає помилки сервера й відрізняє їх від відсутності зв’язку', async () => {
  const net = fakeNetwork();
  const remote = createRemote({ urls: ['https://static.example/nothing', 'https://x.example/api/account'], fetchImpl: net.fetchImpl });
  assert.equal(remote.available, false);
  await assert.rejects(remote.call('ping'), NetworkError);
  assert.equal(await remote.detect(), true, 'перша адреса не відповіла як сервер — узято другу');
  assert.equal(remote.url, 'https://x.example/api/account');

  const session = await remote.call('register', { name: 'Оля', password: 'таємно', question: 'Кличка кота?', answer: 'Мурчик' });
  assert.ok(session.token);
  await assert.rejects(remote.call('login', { name: 'Оля', password: 'ні' }), (err) => err instanceof RemoteError && err.status === 401 && err.code === 'bad_login');
  const conflict = await remote.call('save', { token: session.token, data: emptyState(), base: 1 }).catch((e) => e);
  assert.equal(conflict.code, 'conflict');
  assert.equal(conflict.body.updatedAt, session.updatedAt, 'тіло відповіді доступне для розв’язання конфлікту');

  net.state.online = false;
  await assert.rejects(remote.call('load', { token: session.token }), NetworkError);
  assert.equal(await remote.detect(), false);
  assert.equal(remote.available, false);
});

test('вхід з іншого пристрою: копія серверного кабінету в браузері', async () => {
  const net = fakeNetwork();
  const remote = createRemote({ urls: ['https://x.example/api/account'], fetchImpl: net.fetchImpl });
  await remote.detect();

  // Перший комп'ютер.
  const pc1 = emptyRoot();
  adoptRemote(pc1, await remote.call('register', { name: 'Оля', password: 'таємно', question: 'Кличка кота?', answer: 'Мурчик' }), 1);
  const user1 = currentUser(pc1);
  assert.equal(isRemote(user1), true);
  assert.deepEqual(user1.data, emptyState(), 'новий кабінет порожній');
  user1.data.settings.lang = 'uk';
  user1.data.game.xp = 240;
  const saved = await remote.call('save', { token: user1.remote.token, data: user1.data, base: user1.remote.updatedAt });

  // Другий комп'ютер: порожній браузер, лише ім'я та пароль.
  const pc2 = emptyRoot();
  adoptRemote(pc2, await remote.call('login', { name: 'оля', password: 'таємно' }), 2);
  assert.equal(currentUser(pc2).data.game.xp, 240);
  assert.equal(currentUser(pc2).remote.updatedAt, saved.updatedAt);
  assert.equal(currentUser(pc2).remote.dirty, false);

  // У браузері немає ні пароля, ні його хеша; після перезавантаження сеанс зберігається.
  const storage = fakeStorage();
  saveRoot(storage, pc2);
  const text = storage.getItem('solo-accounts-v1');
  assert.ok(!text.includes('таємно') && !/"hash"|"salt"/.test(text));
  const again = loadRoot(storage);
  assert.equal(currentUser(again).name, 'Оля');
  assert.equal(currentUser(again).remote.token, currentUser(pc2).remote.token);
  assert.deepEqual(listNames(again), [], 'серверний кабінет не вважається локальним');
  await assert.rejects(login(again, 'Оля', 'таємно'), /Невірне ім’я або пароль/, 'без сервера в серверний кабінет не ввійти');

  // Пошкоджений прогрес із сервера не ламає застосунок.
  const pc3 = emptyRoot();
  adoptRemote(pc3, { name: 'Оля', token: 't', data: { зіпсовано: true }, updatedAt: 5 }, 3);
  assert.deepEqual(currentUser(pc3).data, emptyState());
});

test('локальний кабінет: відновлення пароля за секретним питанням', async () => {
  assert.equal(checkRecovery('Кличка кота?', 'Мурчик'), null);
  assert.match(checkRecovery('Що?', 'Мурчик'), /Секретне питання/);
  assert.match(checkRecovery('Кличка кота?', ' '), /Відповідь/);

  const root = emptyRoot();
  await assert.rejects(createAccount(root, 'Оля', 'таємно', 1, { ...FAST, question: 'Що?', answer: 'Мурчик' }), /Секретне питання/);
  await createAccount(root, 'Оля', 'таємно', 1, { ...FAST, question: 'Кличка кота?', answer: 'Мурчик' });
  currentUser(root).data.game.xp = 77;
  const stored = JSON.stringify(root);
  assert.ok(!stored.includes('таємно') && !stored.toLowerCase().includes('мурчик'), 'пароль і відповідь — лише хеші');
  logout(root);

  assert.equal(localQuestion(root, 'ОЛЯ'), 'Кличка кота?');
  assert.equal(localQuestion(root, 'Хтось'), null);
  await assert.rejects(resetLocalPassword(root, 'Оля', 'Барсик', 'новий1'), /невірна/);
  await assert.rejects(resetLocalPassword(root, 'Оля', 'Мурчик', '1'), /щонайменше/);
  assert.equal(root.current, null);
  await resetLocalPassword(root, 'Оля', '  МУРЧИК ', 'новий1');
  assert.equal(currentUser(root).data.game.xp, 77, 'прогрес збережено');
  logout(root);
  await assert.rejects(login(root, 'Оля', 'таємно'));
  await login(root, 'Оля', 'новий1');

  const id = userId('Оля');
  assert.equal(await verifyLocalPassword(root, id, 'новий1'), true);
  assert.equal(await verifyLocalPassword(root, id, 'ні'), false);
  await assert.rejects(setLocalRecovery(root, id, 'ні', 'Улюблене місто?', 'Львів'), /Пароль невірний/);
  await setLocalRecovery(root, id, 'новий1', 'Улюблене місто?', 'Львів');
  assert.equal(localQuestion(root, 'Оля'), 'Улюблене місто?');

  // Секретне питання переживає збереження та читання.
  const storage = fakeStorage();
  saveRoot(storage, root);
  assert.equal(localQuestion(loadRoot(storage), 'Оля'), 'Улюблене місто?');
});
