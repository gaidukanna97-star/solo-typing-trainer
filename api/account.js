// Vercel Function: POST /api/account. Кабінети зберігаються у приватному сховищі Vercel Blob.
import { get, put, del } from '@vercel/blob';
import { createService } from '../server/account-service.js';

const ALLOWED_ORIGINS = [
  'https://gaidukanna97-star.github.io',
];

const store = {
  async get(key) {
    const result = await get(key, { access: 'private', useCache: false });
    if (!result || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text());
  },
  async put(key, value) {
    await put(key, JSON.stringify(value), {
      access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
    });
  },
  async del(key) {
    await del(key);
  },
};

let service = null;

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Лише POST.', code: 'method' });

  if (!process.env.SOLO_SECRET || !process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Сервер кабінетів не налаштовано.', code: 'not_configured' });
  }
  service ??= createService({ store, secret: process.env.SOLO_SECRET });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const result = await service.handle(body);
  return res.status(result.status).json(result.body);
}
