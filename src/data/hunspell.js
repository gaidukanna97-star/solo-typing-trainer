// Мінімальне розгортання Hunspell (.dic + .aff): лише те, що потрібно для перевірки,
// чи є слово з частотного списку словниковою формою. Підтримуються однолітерні прапорці,
// правила SFX і PFX (з перехресним застосуванням), без складених слів.

export function parseAff(text) {
  const sfx = new Map();
  const pfx = new Map();
  let noSuggest = null;
  for (const raw of text.split(/\r?\n/)) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'NOSUGGEST') noSuggest = p[1];
    if ((p[0] !== 'SFX' && p[0] !== 'PFX') || p.length < 5) continue; // заголовок групи має 4 поля
    const isSfx = p[0] === 'SFX';
    const strip = p[2] === '0' ? '' : p[2];
    const add = (p[3] === '0' ? '' : p[3]).split('/')[0];
    const cond = p[4];
    const rule = { strip, add, any: cond === '.', plain: null, re: null };
    if (!rule.any) {
      if (/^[^\[\]^.]+$/.test(cond)) rule.plain = cond;
      else rule.re = new RegExp(isSfx ? `(?:${cond})$` : `^(?:${cond})`, 'u');
    }
    const map = isSfx ? sfx : pfx;
    if (!map.has(p[1])) map.set(p[1], []);
    map.get(p[1]).push(rule);
  }
  return { sfx, pfx, noSuggest };
}

function matches(rule, word, isSfx) {
  if (rule.strip && !(isSfx ? word.endsWith(rule.strip) : word.startsWith(rule.strip))) return false;
  if (rule.any) return true;
  if (rule.plain !== null) return isSfx ? word.endsWith(rule.plain) : word.startsWith(rule.plain);
  return rule.re.test(word);
}

/** Усі форми однієї основи. */
export function expandEntry(word, flags, aff) {
  const forms = [word];
  for (const f of flags) {
    const rules = aff.sfx.get(f);
    if (!rules) continue;
    for (const r of rules) {
      if (matches(r, word, true)) forms.push(word.slice(0, word.length - r.strip.length) + r.add);
    }
  }
  const base = forms.length;
  for (const f of flags) {
    const rules = aff.pfx.get(f);
    if (!rules) continue;
    for (const r of rules) {
      for (let i = 0; i < base; i++) {
        if (matches(r, forms[i], false)) forms.push(r.add + forms[i].slice(r.strip.length));
      }
    }
  }
  return forms;
}

/**
 * Повертає підмножину candidates, які є словниковими формами.
 * Основи з великої літери (власні назви) та з прапорцем NOSUGGEST (вульгаризми) пропускаються.
 */
export function validateCandidates(dicText, affText, candidates) {
  const aff = parseAff(affText);
  const valid = new Set();
  const lines = dicText.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].split(/[\t ]/)[0];
    if (!line) continue;
    const slash = line.indexOf('/');
    const word = (slash < 0 ? line : line.slice(0, slash)).replace(/[’ʼ]/g, "'");
    const flags = slash < 0 ? '' : line.slice(slash + 1);
    if (!word || word !== word.toLowerCase()) continue;
    if (aff.noSuggest && flags.includes(aff.noSuggest)) continue;
    if (!flags) {
      if (candidates.has(word)) valid.add(word);
      continue;
    }
    for (const form of expandEntry(word, flags, aff)) {
      if (candidates.has(form)) valid.add(form);
    }
  }
  return valid;
}
