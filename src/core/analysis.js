// Аналітика профілю: слабкі клавіші та повільні переходи.

/** Клавіші з найвищою часткою помилок. Повертає [{ ch, n, err, rate }] за спаданням rate. */
export function weakChars(profile, { minSamples = 10, minRate = 0.04, limit = 5 } = {}) {
  return Object.entries(profile.chars)
    .filter(([ch, v]) => ch !== ' ' && v.n >= minSamples && v.err / v.n >= minRate)
    .map(([ch, v]) => ({ ch, n: v.n, err: v.err, rate: v.err / v.n }))
    .sort((a, b) => b.rate - a.rate || b.err - a.err)
    .slice(0, limit);
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Середня затримка переходу, мс (або null, якщо замало даних). */
export function avgDelay(v) {
  const timed = v.timed ?? v.n;
  return timed > 0 ? v.ms / timed : null;
}

/**
 * Переходи, помітно повільніші за медіану користувача, а також переходи з помилками.
 * Повертає [{ pair, n, ms, ratio, err }].
 */
export function slowBigrams(stats, { minSamples = 3, minRatio = 1.3, limit = 5 } = {}) {
  const rows = Object.entries(stats)
    .filter(([pair, v]) => !pair.includes(' ') && (v.timed ?? v.n) >= minSamples)
    .map(([pair, v]) => ({ pair, n: v.n, ms: avgDelay(v), err: v.err }));
  const med = median(rows.map((r) => r.ms));
  if (!med) return [];
  return rows
    .map((r) => ({ ...r, ratio: r.ms / med }))
    .filter((r) => r.ratio >= minRatio)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);
}

/** Переходи, на яких найчастіше трапляються помилки. */
export function errorBigrams(stats, { minErrors = 2, limit = 5 } = {}) {
  return Object.entries(stats)
    .filter(([pair, v]) => !pair.includes(' ') && v.err >= minErrors)
    .map(([pair, v]) => ({ pair, err: v.err, n: v.n }))
    .sort((a, b) => b.err - a.err)
    .slice(0, limit);
}
