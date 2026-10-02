// Зріз швидкості та сертифікати: бронзовий, срібний, золотий.
// Сертифікат видається лише за зв'язний текст, набраний без підказок, і лише за достатньої точності.

import { CERT_TIERS, EXAM_MIN_CHARS, EXAM_MAX_SPM, CERT_LIMIT } from './config.js';
import { rng } from './curriculum.js';

/** Текст зрізу: абзац і речення, разом не менше EXAM_MIN_CHARS символів. */
export function examText(cur, seed = 0) {
  const r = rng(31337 + seed * 7919);
  const shuffled = (arr) => {
    const pool = [...arr];
    const out = [];
    while (pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  };
  const parts = [...shuffled(cur.content.paragraphs).slice(0, 1), ...shuffled(cur.content.sentences)];
  let text = '';
  for (const part of parts) {
    text = text ? `${text} ${part}` : part;
    if (text.length >= EXAM_MIN_CHARS) break;
  }
  return text;
}

/** Найвищий сертифікат, на який тягне спроба, або null. Швидкість без точності не зараховується. */
export function tierFor(metrics, tiers = CERT_TIERS) {
  if (!metrics.completed || metrics.length < EXAM_MIN_CHARS || metrics.spm > EXAM_MAX_SPM) return null;
  return tiers.find((t) => metrics.spm >= t.minSpm && metrics.accuracy >= t.minAcc) || null;
}

/** Чого бракує до найближчого сертифіката — для підказки після зрізу. */
export function missingFor(metrics, tiers = CERT_TIERS) {
  const bronze = tiers[tiers.length - 1];
  const current = tierFor(metrics, tiers);
  const target = current ? tiers[tiers.indexOf(current) - 1] : bronze;
  if (!target) return null;
  return {
    tier: target,
    spm: Math.max(0, Math.ceil(target.minSpm - metrics.spm)),
    acc: Math.max(0, Math.round((target.minAcc - metrics.accuracy) * 10) / 10),
  };
}

/** Записує сертифікат у кабінет. Повертає його номер у списку. */
export function addCertificate(state, { tier, lang, metrics, now }) {
  const certs = (state.game.certs ??= []);
  certs.push({
    t: now, lang, tier: tier.id,
    spm: metrics.spm, acc: metrics.accuracy, errors: metrics.errors, ms: metrics.elapsedMs, chars: metrics.length,
  });
  if (certs.length > CERT_LIMIT) certs.splice(0, certs.length - CERT_LIMIT);
  return certs.length - 1;
}

export const tierById = (id) => CERT_TIERS.find((t) => t.id === id) || null;

/** Найкращий сертифікат кабінету (за рівнем, далі за швидкістю) або null. */
export function bestCertificate(certs) {
  const rank = (c) => CERT_TIERS.length - CERT_TIERS.findIndex((t) => t.id === c.tier);
  return [...certs].sort((a, b) => rank(b) - rank(a) || b.spm - a.spm)[0] || null;
}
