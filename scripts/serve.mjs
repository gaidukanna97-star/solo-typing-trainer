// node scripts/serve.mjs [порт] — локальний сервер без залежностей: статичні файли + API кабінетів.
// Кабінети локального запуску лежать у .local-data/ (не потрапляє в git).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, normalize, extname, sep } from 'node:path';
import { ROOT } from './sources.mjs';
import { createService, memoryStore } from '../server/account-service.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

/** Сховище у файлі — щоб кабінети локального запуску переживали перезапуск сервера. */
function fileStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'accounts.json');
  const map = new Map(existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8'))) : []);
  const flush = () => writeFileSync(file, JSON.stringify(Object.fromEntries(map)));
  const mem = memoryStore(map);
  return {
    get: mem.get,
    async put(key, value) { await mem.put(key, value); flush(); },
    async del(key) { await mem.del(key); flush(); },
  };
}

function localSecret(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'));
  return readFileSync(file, 'utf8').trim();
}

/**
 * options.api: 'file' (типово) — кабінети у .local-data/; 'memory' — лише в пам'яті (тести);
 * false — без API (тренажер переходить у локальний режим).
 */
export function startServer(port = 8080, { api = 'file' } = {}) {
  let service = null;
  if (api === 'memory') service = createService({ store: memoryStore(), secret: randomBytes(32).toString('hex'), cost: 1024 });
  if (api === 'file') {
    const dir = join(ROOT, '.local-data');
    service = createService({ store: fileStore(dir), secret: localSecret(dir) });
  }

  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path === '/api/account') {
        if (!service || req.method !== 'POST') {
          res.writeHead(service ? 405 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Не знайдено');
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* непридатний запит */ }
        const result = await service.handle(body);
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(result.body));
      }
      let file = normalize(join(ROOT, path));
      if (file !== ROOT && !file.startsWith(ROOT + sep)) throw new Error('forbidden');
      if (/(^|[\\/])\.(env|local-data|vercel|git)/.test(file.slice(ROOT.length))) throw new Error('forbidden');
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не знайдено');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const port = Number(process.argv[2]) || 8080;
  await startServer(port);
  console.log(`Соло працює: http://localhost:${port}/  (Ctrl+C — зупинити)`);
}
