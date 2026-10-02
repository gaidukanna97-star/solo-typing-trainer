// Перевірка й підготовка власного тексту користувача (вставленого або з файлу .txt/.md).

import { normalizeText, unsupportedChars } from './layouts.js';

export const MAX_FILE = 200 * 1024;
export const MAX_TEXT = 800;

/** Перевіряє та готує власний текст. Повертає { text, removed, cut } або кидає помилку з поясненням. */
export function prepareCustomText(layout, raw, filename = '') {
  if (filename && !/\.(txt|md)$/i.test(filename)) throw new Error('Підтримуються лише файли .txt і .md.');
  if (raw.includes('�') || /[\u0000-\u0008\u000E-\u001F]/.test(raw)) throw new Error('Файл не схожий на текст у кодуванні UTF-8.');
  let text = raw;
  if (/\.md$/i.test(filename)) {
    text = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/[*_`~|]/g, '');
  }
  text = normalizeText(text);
  const removed = unsupportedChars(layout, text);
  if (removed.length) {
    const drop = new Set(removed);
    text = normalizeText(Array.from(text).filter((c) => !drop.has(c)).join(''));
  }
  if (Array.from(text).length < 20) throw new Error(`Після перевірки лишилося замало тексту для розкладки «${layout.name}» (потрібно щонайменше 20 символів).`);
  let cut = false;
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT);
    text = text.slice(0, text.lastIndexOf(' ')).trim();
    cut = true;
  }
  return { text, removed, cut };
}
