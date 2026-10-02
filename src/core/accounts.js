// Особисті кабінети: ім'я + пароль, без пошти й телефону, без сервера.
// Усе зберігається в цьому браузері. Пароль не зберігається — лише його хеш (PBKDF2-SHA-256 із сіллю).
// Це захист від випадкового входу іншої людини за тим самим комп'ютером, а не шифрування даних.

import { emptyState, validateState, STORAGE_KEY as LEGACY_KEY } from './storage.js';

export const ACCOUNTS_KEY = 'solo-accounts-v1';
export const ROOT_VERSION = 1;
export const PBKDF2_ITERATIONS = 100000;
export const NAME_MIN = 2;
export const NAME_MAX = 24;
export const PASSWORD_MIN = 4;

export function emptyRoot() {
  return { version: ROOT_VERSION, current: null, users: {}, legacy: null };
}

export const normalizeName = (name) => String(name).normalize('NFC').trim().replace(/\s+/g, ' ');
/** Ключ користувача: без урахування регістру; префікс захищає від службових імен на кшталт __proto__. */
export const userId = (name) => `u:${normalizeName(name).toLowerCase()}`;

/** Повертає текст помилки або null. */
export function checkCredentials(name, password) {
  const n = Array.from(normalizeName(name)).length;
  if (n < NAME_MIN || n > NAME_MAX) return `Ім’я має містити від ${NAME_MIN} до ${NAME_MAX} символів.`;
  if (String(password).length < PASSWORD_MIN) return `Пароль має містити щонайменше ${PASSWORD_MIN} символи.`;
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

/** Створює кабінет і входить у нього. Прогрес, збережений до появи кабінетів, переходить до першого кабінету. */
export async function createAccount(root, name, password, now, { iterations = PBKDF2_ITERATIONS } = {}) {
  const problem = checkCredentials(name, password);
  if (problem) throw new Error(problem);
  const id = userId(name);
  if (root.users[id]) throw new Error('Кабінет із таким іменем уже є на цьому пристрої. Увійди в нього або обери інше ім’я.');
  const salt = newSalt();
  root.users[id] = {
    name: normalizeName(name), salt, iterations,
    hash: await hashPassword(password, salt, iterations),
    createdAt: now,
    data: root.legacy || emptyState(),
  };
  root.legacy = null;
  root.current = id;
  return id;
}

export async function login(root, name, password) {
  const id = userId(name);
  const user = root.users[id];
  // Те саме повідомлення для невідомого імені й хибного пароля.
  const fail = new Error('Невірне ім’я або пароль.');
  if (!user) throw fail;
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
  if (!user || (await hashPassword(oldPassword, user.salt, user.iterations)) !== user.hash) throw new Error('Поточний пароль невірний.');
  if (String(newPassword).length < PASSWORD_MIN) throw new Error(`Пароль має містити щонайменше ${PASSWORD_MIN} символи.`);
  user.salt = newSalt();
  user.hash = await hashPassword(newPassword, user.salt, user.iterations);
}

export function deleteAccount(root, id) {
  delete root.users[id];
  if (root.current === id) root.current = null;
}

export const currentUser = (root) => (root.current ? root.users[root.current] || null : null);
export const listNames = (root) => Object.values(root.users).map((u) => u.name).sort((a, b) => a.localeCompare(b, 'uk'));

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Читає кабінети зі сховища; пошкоджені записи відкидає. Старий формат (без кабінетів) стає legacy. */
export function loadRoot(storage) {
  const root = emptyRoot();
  try {
    const raw = JSON.parse(storage.getItem(ACCOUNTS_KEY) || 'null');
    if (isObject(raw) && raw.version === ROOT_VERSION && isObject(raw.users)) {
      for (const [id, u] of Object.entries(raw.users)) {
        if (!id.startsWith('u:') || !isObject(u)) continue;
        if (typeof u.name !== 'string' || !/^[0-9a-f]{32}$/.test(u.salt) || !/^[0-9a-f]{64}$/.test(u.hash)) continue;
        let data;
        try { data = validateState(u.data); } catch { data = emptyState(); }
        root.users[id] = {
          name: u.name, salt: u.salt, hash: u.hash,
          iterations: Number.isInteger(u.iterations) && u.iterations > 0 ? u.iterations : PBKDF2_ITERATIONS,
          createdAt: typeof u.createdAt === 'number' ? u.createdAt : null,
          data,
        };
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
