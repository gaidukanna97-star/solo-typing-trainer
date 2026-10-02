// Серверна логіка кабінетів: реєстрація, вхід, синхронізація прогресу, відновлення пароля
// за секретним питанням. Сховище передається ззовні (Vercel Blob у продакшені, пам'ять у тестах),
// тому модуль можна перевіряти без мережі.
//
// Що зберігається про користувача: ім'я, хеш пароля, секретне питання, хеш відповіді, прогрес.
// Пошта, телефон та інші персональні дані не збираються.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const LIMITS = {
  nameMin: 2, nameMax: 24, passwordMin: 4, passwordMax: 200,
  questionMin: 5, questionMax: 120, answerMin: 2, answerMax: 100,
  dataBytes: 600 * 1024,
  maxFails: 5, lockMs: 10 * 60 * 1000,
  tokenMs: 30 * 24 * 60 * 60 * 1000,
};

const normalizeName = (name) => String(name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const userId = (name) => normalizeName(name).toLowerCase();
/** Відповідь порівнюється без урахування регістру, зайвих пробілів і розділових знаків на краях. */
const normalizeAnswer = (a) => String(a ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const keyFor = (id) => `users/${createHash('sha256').update(id).digest('hex')}.json`;

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function hashSecret(value, salt, cost) {
  return scryptSync(String(value).normalize('NFC'), Buffer.from(salt, 'hex'), 32, { N: cost }).toString('hex');
}
function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

function checkData(data) {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || typeof data.profiles !== 'object') {
    throw new ApiError(400, 'bad_data', 'Непридатний формат прогресу.');
  }
  if (Buffer.byteLength(JSON.stringify(data)) > LIMITS.dataBytes) {
    throw new ApiError(413, 'too_large', 'Прогрес завеликий для збереження.');
  }
  return data;
}

/**
 * store: { get(key) → object|null, put(key, object), del(key) } — усі асинхронні.
 * secret: рядок для підпису токенів. cost: параметр N для scrypt.
 */
export function createService({ store, secret, now = () => Date.now(), cost = 16384 }) {
  if (!secret || String(secret).length < 16) throw new Error('Потрібен секрет для підпису токенів.');

  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  const makeToken = (rec) => {
    const payload = Buffer.from(JSON.stringify({ id: rec.id, pv: rec.pv, exp: now() + LIMITS.tokenMs })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  const session = (rec) => ({ token: makeToken(rec), name: rec.name, data: rec.data, updatedAt: rec.updatedAt });

  async function byToken(token) {
    const bad = new ApiError(401, 'bad_token', 'Сеанс завершено. Увійди ще раз.');
    const [payload, mac] = String(token ?? '').split('.');
    if (!payload || !mac) throw bad;
    const expected = sign(payload);
    if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw bad;
    let parsed;
    try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw bad; }
    if (!parsed || typeof parsed.id !== 'string' || parsed.exp < now()) throw bad;
    const rec = await store.get(keyFor(parsed.id));
    if (!rec || rec.pv !== parsed.pv) throw bad; // після зміни пароля старі сеанси недійсні
    return rec;
  }

  function validateName(name) {
    const n = Array.from(normalizeName(name)).length;
    if (n < LIMITS.nameMin || n > LIMITS.nameMax) throw new ApiError(400, 'bad_name', `Ім’я має містити від ${LIMITS.nameMin} до ${LIMITS.nameMax} символів.`);
  }
  function validatePassword(password) {
    const len = String(password ?? '').length;
    if (len < LIMITS.passwordMin || len > LIMITS.passwordMax) throw new ApiError(400, 'bad_password', `Пароль має містити щонайменше ${LIMITS.passwordMin} символи.`);
  }
  function validateRecovery(question, answer) {
    const q = String(question ?? '').trim();
    if (q.length < LIMITS.questionMin || q.length > LIMITS.questionMax) throw new ApiError(400, 'bad_question', `Секретне питання має містити від ${LIMITS.questionMin} до ${LIMITS.questionMax} символів.`);
    const a = normalizeAnswer(answer);
    if (a.length < LIMITS.answerMin || a.length > LIMITS.answerMax) throw new ApiError(400, 'bad_answer', `Відповідь має містити щонайменше ${LIMITS.answerMin} символи.`);
  }

  // Захист від підбору: після кількох невдач поспіль — пауза.
  function assertNotLocked(rec, kind) {
    const f = rec.fails?.[kind];
    if (f && f.until > now()) {
      const minutes = Math.ceil((f.until - now()) / 60000);
      throw new ApiError(429, 'locked', `Забагато невдалих спроб. Спробуй ще раз через ${minutes} хв.`);
    }
  }
  async function fail(rec, kind, error) {
    rec.fails ??= {};
    const f = rec.fails[kind] && rec.fails[kind].until <= now() && rec.fails[kind].n >= LIMITS.maxFails ? { n: 0, until: 0 } : (rec.fails[kind] || { n: 0, until: 0 });
    f.n++;
    if (f.n >= LIMITS.maxFails) f.until = now() + LIMITS.lockMs;
    rec.fails[kind] = f;
    await store.put(keyFor(rec.id), rec);
    throw error;
  }
  const clearFails = (rec, kind) => { if (rec.fails) delete rec.fails[kind]; };

  const actions = {
    async ping() {
      return { ok: true };
    },

    async register({ name, password, question, answer, data }) {
      validateName(name);
      validatePassword(password);
      validateRecovery(question, answer);
      const id = userId(name);
      if (await store.get(keyFor(id))) throw new ApiError(409, 'exists', 'Кабінет із таким іменем уже є. Увійди в нього або обери інше ім’я.');
      const salt = randomBytes(16).toString('hex');
      const aSalt = randomBytes(16).toString('hex');
      const t = now();
      const rec = {
        v: 1, id, name: normalizeName(name),
        salt, hash: hashSecret(password, salt, cost),
        question: String(question).trim(), aSalt, aHash: hashSecret(normalizeAnswer(answer), aSalt, cost),
        pv: 1, createdAt: t, updatedAt: t, data: checkData(data), fails: {},
      };
      await store.put(keyFor(id), rec);
      return session(rec);
    },

    async login({ name, password }) {
      const wrong = new ApiError(401, 'bad_login', 'Невірне ім’я або пароль.');
      const rec = await store.get(keyFor(userId(name)));
      if (!rec) throw wrong;
      assertNotLocked(rec, 'login');
      if (!sameHash(hashSecret(password, rec.salt, cost), rec.hash)) await fail(rec, 'login', wrong);
      if (rec.fails?.login) { clearFails(rec, 'login'); await store.put(keyFor(rec.id), rec); }
      return session(rec);
    },

    async question({ name }) {
      const rec = await store.get(keyFor(userId(name)));
      if (!rec) throw new ApiError(404, 'no_user', 'Кабінету з таким іменем немає.');
      return { name: rec.name, question: rec.question };
    },

    async reset({ name, answer, password }) {
      validatePassword(password);
      const rec = await store.get(keyFor(userId(name)));
      if (!rec) throw new ApiError(404, 'no_user', 'Кабінету з таким іменем немає.');
      assertNotLocked(rec, 'reset');
      if (!sameHash(hashSecret(normalizeAnswer(answer), rec.aSalt, cost), rec.aHash)) {
        await fail(rec, 'reset', new ApiError(401, 'bad_answer', 'Відповідь на секретне питання невірна.'));
      }
      rec.salt = randomBytes(16).toString('hex');
      rec.hash = hashSecret(password, rec.salt, cost);
      rec.pv++;
      rec.fails = {};
      await store.put(keyFor(rec.id), rec);
      return session(rec);
    },

    async load({ token }) {
      const rec = await byToken(token);
      return { name: rec.name, data: rec.data, updatedAt: rec.updatedAt };
    },

    async save({ token, data, base }) {
      const rec = await byToken(token);
      // Якщо прогрес уже змінено з іншого пристрою, повертаємо свіжу копію замість перезапису.
      if (base !== undefined && base !== null && base !== rec.updatedAt) {
        throw new ApiError(409, 'conflict', 'Прогрес змінено на іншому пристрої.', { data: rec.data, updatedAt: rec.updatedAt });
      }
      rec.data = checkData(data);
      rec.updatedAt = Math.max(now(), rec.updatedAt + 1);
      await store.put(keyFor(rec.id), rec);
      return { updatedAt: rec.updatedAt };
    },

    async password({ token, oldPassword, password }) {
      const rec = await byToken(token);
      validatePassword(password);
      assertNotLocked(rec, 'login');
      if (!sameHash(hashSecret(oldPassword, rec.salt, cost), rec.hash)) await fail(rec, 'login', new ApiError(401, 'bad_login', 'Поточний пароль невірний.'));
      rec.salt = randomBytes(16).toString('hex');
      rec.hash = hashSecret(password, rec.salt, cost);
      rec.pv++;
      clearFails(rec, 'login');
      await store.put(keyFor(rec.id), rec);
      return { token: makeToken(rec) };
    },

    async recovery({ token, password, question, answer }) {
      const rec = await byToken(token);
      validateRecovery(question, answer);
      assertNotLocked(rec, 'login');
      if (!sameHash(hashSecret(password, rec.salt, cost), rec.hash)) await fail(rec, 'login', new ApiError(401, 'bad_login', 'Пароль невірний.'));
      rec.question = String(question).trim();
      rec.aSalt = randomBytes(16).toString('hex');
      rec.aHash = hashSecret(normalizeAnswer(answer), rec.aSalt, cost);
      await store.put(keyFor(rec.id), rec);
      return { ok: true };
    },

    async delete({ token, password }) {
      const rec = await byToken(token);
      assertNotLocked(rec, 'login');
      if (!sameHash(hashSecret(password, rec.salt, cost), rec.hash)) await fail(rec, 'login', new ApiError(401, 'bad_login', 'Пароль невірний.'));
      await store.del(keyFor(rec.id));
      return { ok: true };
    },
  };

  /** Обробляє один запит. Повертає { status, body }. */
  async function handle(body) {
    try {
      if (!body || typeof body !== 'object' || typeof body.action !== 'string' || !Object.hasOwn(actions, body.action)) {
        throw new ApiError(400, 'bad_request', 'Невідомий запит.');
      }
      return { status: 200, body: await actions[body.action](body) };
    } catch (err) {
      if (err instanceof ApiError) return { status: err.status, body: { error: err.message, code: err.code, ...err.extra } };
      return { status: 500, body: { error: 'Помилка сервера. Спробуй пізніше.', code: 'server' } };
    }
  }

  return { handle };
}

/** Сховище в пам'яті — для тестів і локального запуску. */
export function memoryStore(map = new Map()) {
  return {
    async get(key) { return map.has(key) ? JSON.parse(map.get(key)) : null; },
    async put(key, value) { map.set(key, JSON.stringify(value)); },
    async del(key) { map.delete(key); },
    map,
  };
}
