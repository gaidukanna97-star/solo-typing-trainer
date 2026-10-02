// Кабінети в браузері.
//
// Два види записів:
//   серверний — { name, remote: { token, updatedAt, dirty }, data }: копія кабінету із сервера,
//               щоб тренажер працював без мережі; пароль у браузері не зберігається взагалі;
//   локальний — { name, salt, hash, question, aSalt, aHash, data }: запасний режим, коли сервер недоступний.
//               Пароль і відповідь на секретне питання зберігаються лише як хеші (PBKDF2-SHA-256 із сіллю).

import { emptyState, validateState, STORAGE_KEY as LEGACY_KEY } from './storage.js';

export const ACCOUNTS_KEY = 'solo-accounts-v1';
export const ROOT_VERSION = 1;
export const PBKDF2_ITERATIONS = 100000;
export const NAME_MIN = 2;
export const NAME_MAX = 24;
export const PASSWORD_MIN = 4;
export const QUESTION_MIN = 5;
export const QUESTION_MAX = 120;
export const ANSWER_MIN = 2;

export const QUESTION_EXAMPLES = [
  'Кличка першої домашньої тварини?',
  'Улюблена книжка дитинства?',
  'Місто, де народилася мама?',
  'Ім’я першого вчителя?',
  'Назва вулиці, на якій минуло дитинство?',
];

export function emptyRoot() {
  return { version: ROOT_VERSION, current: null, users: {}, legacy: null };
}

export const normalizeName = (name) => String(name).normalize('NFC').trim().replace(/\s+/g, ' ');
/** Ключ користувача: без урахування регістру; префікс захищає від службових імен на кшталт __proto__. */
export const userId = (name) => `u:${normalizeName(name).toLowerCase()}`;
/** Відповідь на секретне питання порівнюється без урахування регістру й зайвих пробілів. */
export const normalizeAnswer = (answer) => String(answer).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Повертає текст помилки або null. */
export function checkCredentials(name, password) {
  const n = Array.from(normalizeName(name)).length;
  if (n < NAME_MIN || n > NAME_MAX) return `Ім’я має містити від ${NAME_MIN} до ${NAME_MAX} символів.`;
  if (String(password).length < PASSWORD_MIN) return `Пароль має містити щонайменше ${PASSWORD_MIN} символи.`;
  return null;
}

export function checkRecovery(question, answer) {
  const q = String(question).trim().length;
  if (q < QUESTION_MIN || q > QUESTION_MAX) return `Секретне питання має містити від ${QUESTION_MIN} до ${QUESTION_MAX} символів.`;
  if (normalizeAnswer(answer).length < ANSWER_MIN) return `Відповідь має містити щонайменше ${ANSWER_MIN} символи.`;
  return null;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Браузер не дає доступу до криптографії. Відкрий сайт через https або localhost.');
  return s;
}

export function newSalt() {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const key = await subtle().importKey('raw', new TextEncoder().encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

// --- Локальні кабінети (запасний режим без сервера) ---------------------------------------

/**
 * Створює локальний кабінет і входить у нього.
 * Прогрес, збережений до появи кабінетів, переходить до першого кабінету.
 */
export async function createAccount(root, name, password, now, { iterations = PBKDF2_ITERATIONS, question = null, answer = null } = {}) {
  const problem = checkCredentials(name, password) || (question !== null ? checkRecovery(question, answer) : null);
  if (problem) throw new Error(problem);
  const id = userId(name);
  if (root.users[id]) throw new Error('Кабінет із таким іменем уже є на цьому пристрої. Увійди в нього або обери інше ім’я.');
  const salt = newSalt();
  const user = {
    name: normalizeName(name), salt, iterations,
    hash: await hashPassword(password, salt, iterations),
    createdAt: now,
    data: carriedData(root) || emptyState(),
  };
  if (question !== null) {
    user.question = String(question).trim();
    user.aSalt = newSalt();
    user.aHash = await hashPassword(normalizeAnswer(answer), user.aSalt, iterations);
  }
  root.users[id] = user;
  dropGuest(root);
  root.current = id;
  return id;
}

export async function login(root, name, password) {
  const id = userId(name);
  const user = root.users[id];
  // Те саме повідомлення для невідомого імені й хибного пароля.
  const fail = new Error('Невірне ім’я або пароль.');
  if (!user || !user.hash) throw fail;
  const hash = await hashPassword(password, user.salt, user.iterations);
  if (hash !== user.hash) throw fail;
  root.current = id;
  return id;
}

export function logout(root) {
  root.current = null;
}

export async function changePassword(root, id, oldPassword, newPassword) {
  const user = root.users[id];
  if (!user || !user.hash || (await hashPassword(oldPassword, user.salt, user.iterations)) !== user.hash) throw new Error('Поточний пароль невірний.');
  if (String(newPassword).length < PASSWORD_MIN) throw new Error(`Пароль має містити щонайменше ${PASSWORD_MIN} символи.`);
  user.salt = newSalt();
  user.hash = await hashPassword(newPassword, user.salt, user.iterations);
}

/** Секретне питання локального кабінету або null. */
export function localQuestion(root, name) {
  const user = root.users[userId(name)];
  return user && user.hash && user.question ? user.question : null;
}

/** Новий пароль за відповіддю на секретне питання. Входить у кабінет. */
export async function resetLocalPassword(root, name, answer, newPassword) {
  const id = userId(name);
  const user = root.users[id];
  if (!user || !user.aHash) throw new Error('Для цього кабінету секретне питання не задано.');
  if (String(newPassword).length < PASSWORD_MIN) throw new Error(`Пароль має містити щонайменше ${PASSWORD_MIN} символи.`);
  if ((await hashPassword(normalizeAnswer(answer), user.aSalt, user.iterations)) !== user.aHash) throw new Error('Відповідь на секретне питання невірна.');
  user.salt = newSalt();
  user.hash = await hashPassword(newPassword, user.salt, user.iterations);
  root.current = id;
  return id;
}

export async function setLocalRecovery(root, id, password, question, answer) {
  const user = root.users[id];
  if (!user || !user.hash || (await hashPassword(password, user.salt, user.iterations)) !== user.hash) throw new Error('Пароль невірний.');
  const problem = checkRecovery(question, answer);
  if (problem) throw new Error(problem);
  user.question = String(question).trim();
  user.aSalt = newSalt();
  user.aHash = await hashPassword(normalizeAnswer(answer), user.aSalt, user.iterations);
}

export async function verifyLocalPassword(root, id, password) {
  const user = root.users[id];
  return Boolean(user?.hash) && (await hashPassword(password, user.salt, user.iterations)) === user.hash;
}

export function deleteAccount(root, id) {
  delete root.users[id];
  if (root.current === id) root.current = null;
}

// --- Гість: без кабінету й пароля ---------------------------------------------------------

export const GUEST_ID = 'guest';
export const GUEST_NAME = 'Гість';

/** Вхід без кабінету. Прогрес гостя лежить лише в цьому браузері й зберігається між відвідинами. */
export function enterGuest(root, now) {
  root.users[GUEST_ID] ??= { name: GUEST_NAME, guest: true, createdAt: now, data: root.legacy || emptyState() };
  root.legacy = null;
  root.current = GUEST_ID;
  return GUEST_ID;
}

export const isGuest = (user) => user?.guest === true;
export const guestOf = (root) => root.users[GUEST_ID] || null;

/** Прогрес, який перейде до нового кабінету: гостьовий або збережений до появи кабінетів. */
export const carriedData = (root) => guestOf(root)?.data || root.legacy || null;

/** Після створення кабінету гостьовий профіль більше не потрібен. */
export function dropGuest(root) {
  delete root.users[GUEST_ID];
  root.legacy = null;
}

// --- Серверні кабінети: копія в браузері --------------------------------------------------

/** Зберігає сеанс серверного кабінету в браузері й входить у нього. */
export function adoptRemote(root, { name, token, data, updatedAt }, now) {
  const id = userId(name);
  let state;
  try { state = data ? validateState(data) : emptyState(); } catch { state = emptyState(); }
  root.users[id] = {
    name: normalizeName(name),
    remote: { token, updatedAt: updatedAt ?? null, dirty: false },
    createdAt: root.users[id]?.createdAt ?? now,
    data: state,
  };
  root.current = id;
  return id;
}

export const isRemote = (user) => Boolean(user?.remote);
export const currentUser = (root) => (root.current ? root.users[root.current] || null : null);
/** Імена локальних кабінетів цього пристрою. */
export const listNames = (root) => Object.values(root.users).filter((u) => !u.remote && !u.guest).map((u) => u.name).sort((a, b) => a.localeCompare(b, 'uk'));

// --- Сховище браузера --------------------------------------------------------------------------

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Читає кабінети зі сховища; пошкоджені записи відкидає. Старий формат (без кабінетів) стає legacy. */
export function loadRoot(storage) {
  const root = emptyRoot();
  try {
    const raw = JSON.parse(storage.getItem(ACCOUNTS_KEY) || 'null');
    if (isObject(raw) && raw.version === ROOT_VERSION && isObject(raw.users)) {
      for (const [id, u] of Object.entries(raw.users)) {
        if (id === GUEST_ID && isObject(u) && u.guest === true) {
          let data;
          try { data = validateState(u.data); } catch { data = emptyState(); }
          root.users[GUEST_ID] = { name: GUEST_NAME, guest: true, createdAt: typeof u.createdAt === 'number' ? u.createdAt : null, data };
          continue;
        }
        if (!id.startsWith('u:') || !isObject(u) || typeof u.name !== 'string') continue;
        const remote = isObject(u.remote) && typeof u.remote.token === 'string' && u.remote.token
          ? { token: u.remote.token, updatedAt: Number.isFinite(u.remote.updatedAt) ? u.remote.updatedAt : null, dirty: u.remote.dirty === true }
          : null;
        if (!remote && (!HEX32.test(u.salt) || !HEX64.test(u.hash))) continue;
        let data;
        try { data = validateState(u.data); } catch { data = emptyState(); }
        const user = { name: u.name, createdAt: typeof u.createdAt === 'number' ? u.createdAt : null, data };
        if (remote) {
          user.remote = remote;
        } else {
          user.salt = u.salt;
          user.hash = u.hash;
          user.iterations = Number.isInteger(u.iterations) && u.iterations > 0 ? u.iterations : PBKDF2_ITERATIONS;
          if (typeof u.question === 'string' && HEX32.test(u.aSalt) && HEX64.test(u.aHash)) {
            user.question = u.question;
            user.aSalt = u.aSalt;
            user.aHash = u.aHash;
          }
        }
        root.users[id] = user;
      }
      if (typeof raw.current === 'string' && root.users[raw.current]) root.current = raw.current;
      if (isObject(raw.legacy)) {
        try { root.legacy = validateState(raw.legacy); } catch { /* непридатні дані */ }
      }
    }
  } catch { /* порожнє або пошкоджене сховище */ }
  try {
    const old = storage.getItem(LEGACY_KEY);
    if (old && !root.legacy && !Object.keys(root.users).length) {
      const state = validateState(JSON.parse(old));
      if (Object.values(state.profiles).some((p) => p.createdAt)) root.legacy = state;
    }
  } catch { /* старих даних немає */ }
  return root;
}

export function saveRoot(storage, root) {
  try {
    storage.setItem(ACCOUNTS_KEY, JSON.stringify(root));
    if (!root.legacy && Object.keys(root.users).length) storage.removeItem?.(LEGACY_KEY);
    return true;
  } catch {
    return false;
  }
}
