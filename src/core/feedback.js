// Зворотний зв'язок: після спроби — одна конкретна наступна дія (ТЗ 4.4).
// Правила детерміновані й не залежать від AI.

import { FINGERS, fingerForChar } from './layouts.js';
import { show, describeGram } from './curriculum.js';

const round10 = (x) => Math.max(60, Math.round(x / 10) * 10);

function topEntry(obj, score) {
  let best = null;
  for (const [key, v] of Object.entries(obj)) {
    const s = score(key, v);
    if (s > 0 && (!best || s > best.score)) best = { key, v, score: s };
  }
  return best;
}

/**
 * ctx: { layout, rule, passed, streak, needed, speedGate, next }
 *   next — наступна вправа програми (або null).
 * Повертає { text, action }, де action — що запропонувати кнопкою:
 *   { type: 'drill', chars, bigrams } | { type: 'retry' } | { type: 'next' }.
 */
export function nextAction(metrics, ctx) {
  const { layout, rule, passed, streak, needed } = ctx;

  if (!metrics.completed) {
    return { text: 'Спробу перервано. Пройди вправу до кінця — зараховуються лише завершені спроби.', action: { type: 'retry' } };
  }

  if (metrics.accuracy < rule.minAcc) {
    // 1. Найчастіша помилка на переході між двома клавішами.
    const pair = topEntry(metrics.bigrams, (key, v) => (key.includes(' ') ? 0 : v.err >= 2 ? v.err : 0));
    if (pair) {
      return {
        text: `Повтори перехід «${pair.key}»: ${describeGram(layout, pair.key)} Помилок на ньому: ${pair.v.err}.`,
        action: { type: 'drill', chars: [], bigrams: [pair.key] },
      };
    }
    // 2. Найчастіша помилка на окремій клавіші.
    const ch = topEntry(metrics.errorsByChar, (key, n) => (n >= 2 ? n : 0));
    if (ch && fingerForChar(layout, ch.key)) {
      const finger = FINGERS[fingerForChar(layout, ch.key)];
      return {
        text: `Повтори клавішу ${show(ch.key)} — її натискає ${finger.name}. Помилок на ній: ${ch.v}. Після натискання повертай палець на домашній ряд.`,
        action: { type: 'drill', chars: [ch.key], bigrams: [] },
      };
    }
    // 3. Помилки розсіяні — причина в темпі.
    const slower = round10(metrics.spm * 0.8);
    return {
      text: `Знизь темп до ${slower} SPM, доки точність не буде ${rule.minAcc}%. Зараз ${metrics.accuracy}% — швидкість без точності не зараховується.`,
      action: { type: 'retry' },
    };
  }

  if (!passed) {
    // Точність є, бракує швидкості: шукаємо найповільніший перехід.
    const slow = topEntry(metrics.bigrams, (key, v) => (key.includes(' ') || !v.timed ? 0 : v.ms / v.timed));
    if (slow) {
      return {
        text: `Точність достатня, бракує темпу (${metrics.spm} із ${rule.minSpm} SPM). Найповільніший перехід — «${slow.key}»: ${describeGram(layout, slow.key)} Повтори його окремо.`,
        action: { type: 'drill', chars: [], bigrams: [slow.key] },
      };
    }
    return { text: `Точність достатня, бракує темпу: ${metrics.spm} із ${rule.minSpm} SPM. Повтори вправу трохи швидше, але рівно.`, action: { type: 'retry' } };
  }

  if (streak < needed) {
    const left = needed - streak;
    const tail = metrics.rhythm !== null && metrics.rhythm > 60
      ? ' Ритм нерівний — спробуй друкувати трохи повільніше, але без зупинок.'
      : '';
    return {
      text: `Зараховано. Ще ${left} ${left === 1 ? 'успішна спроба' : 'успішні спроби'} поспіль — і вправу буде закріплено.${tail}`,
      action: { type: 'retry' },
    };
  }

  if (ctx.next) {
    return { text: `Вправу закріплено. Наступний крок: «${ctx.next.title}».`, action: { type: 'next' } };
  }
  return { text: 'Вправу закріплено. Програму пройдено — підтримуй форму на власних текстах.', action: { type: 'retry' } };
}

/** Текст вправи для точкового повторення клавіш або переходів (чиста механіка + слова). */
export function drillText(layout, wordList, open, { chars = [], bigrams = [] }) {
  const parts = [];
  const usable = wordList.filter((w) => Array.from(w).every((c) => open.has(c)));
  for (const g of [...bigrams, ...chars]) {
    parts.push(g, g, g, g);
    parts.push(...usable.filter((w) => w.includes(g)).slice(0, 5));
    parts.push(g, g);
  }
  return parts.join(' ');
}
