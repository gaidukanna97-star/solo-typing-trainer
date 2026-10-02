// Клієнт сервера кабінетів. Єдина зовнішня адреса, до якої звертається застосунок.
// Якщо сервер недоступний, тренажер працює далі на збереженій у браузері копії.

export const REMOTE_API = 'https://solo-typing-trainer.vercel.app/api/account';

export class RemoteError extends Error {
  constructor(status, code, message, body = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
/** Немає зв'язку із сервером (на відміну від відмови сервера). */
export class NetworkError extends Error {}

/** Адреси для перевірки: спершу той самий сайт, потім основний сервер. */
export function defaultUrls(loc) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return [];
  if (loc.hostname.endsWith('github.io')) return [REMOTE_API];
  const same = new URL('api/account', loc.href).href;
  return same === REMOTE_API ? [same] : [same, REMOTE_API];
}

export function createRemote({ urls, fetchImpl = (...a) => fetch(...a), timeoutMs = 10000 }) {
  let url = null;

  async function post(target, body, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetchImpl(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      let json = null;
      try { json = await res.json(); } catch { /* не JSON — це не наш сервер */ }
      return { status: res.status, json };
    } catch {
      throw new NetworkError('Немає зв’язку із сервером.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get available() { return url !== null; },
    get url() { return url; },

    /** Шукає робочий сервер. Повертає true, якщо знайдено. */
    async detect() {
      for (const candidate of urls) {
        try {
          const { status, json } = await post(candidate, { action: 'ping' }, 4000);
          if (status === 200 && json?.ok === true) {
            url = candidate;
            return true;
          }
        } catch { /* пробуємо наступну адресу */ }
      }
      url = null;
      return false;
    },

    async call(action, payload = {}) {
      if (!url) throw new NetworkError('Немає зв’язку із сервером.');
      const { status, json } = await post(url, { action, ...payload }, timeoutMs);
      if (status === 200 && json) return json;
      if (!json || typeof json.error !== 'string') throw new NetworkError('Сервер не відповів як слід.');
      throw new RemoteError(status, json.code, json.error, json);
    },
  };
}
