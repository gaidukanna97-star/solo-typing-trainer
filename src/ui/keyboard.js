// Екранна клавіатура: схема пальців і (лише під час розучування) підказка наступної клавіші.

import { KEYS, KEY_BY_CODE, FINGERS, FINGER_ORDER, HOME_CODES, keyForChar, shiftFingerFor } from '../core/layouts.js';
import { esc } from './dom.js';

const ROW_OFFSET = [0, 1.5, 1.8, 2.3];

function keyLabel(layout, code) {
  const { base } = layout.byCode[code];
  return layout.letters.test(base) ? base.toUpperCase() : base;
}

/** HTML клавіатури. heat: необов'язкова карта code → { label, level 0..4 } для сторінки статистики. */
export function keyboardHtml(layout, { heat = null } = {}) {
  const rows = [0, 1, 2, 3].map((row) => {
    const keys = KEYS.filter((k) => k.row === row).map((k) => {
      const home = HOME_CODES.includes(k.code) ? ' kb-home' : '';
      const bump = k.code === 'KeyF' || k.code === 'KeyJ' ? '<span class="kb-bump" aria-hidden="true"></span>' : '';
      const h = heat?.[k.code];
      const heatCls = h ? ` kb-heat-${h.level}` : '';
      const extra = h?.label ? `<span class="kb-sub">${esc(h.label)}</span>` : '';
      return `<span class="kb-key f-${k.finger}${home}${heatCls}" data-code="${k.code}">${esc(keyLabel(layout, k.code))}${bump}${extra}</span>`;
    }).join('');
    const left = row === 3 ? '<span class="kb-key kb-wide f-lp" data-code="ShiftLeft">Shift</span>' : `<span class="kb-gap" style="--w:${ROW_OFFSET[row]}"></span>`;
    const right = row === 3 ? '<span class="kb-key kb-wide f-rp" data-code="ShiftRight">Shift</span>' : '';
    return `<div class="kb-row">${left}${keys}${right}</div>`;
  }).join('');
  const space = '<div class="kb-row kb-row-space"><span class="kb-key kb-space f-th" data-code="Space">пробіл</span><span class="kb-key kb-wide f-th" data-code="AltRight">Alt</span></div>';
  return `<div class="kb" aria-hidden="true">${rows}${space}</div>`;
}

export function legendHtml() {
  const items = [...FINGER_ORDER, 'th'].map((f) =>
    `<li><span class="kb-swatch f-${f}"></span>${esc(FINGERS[f].name)}</li>`).join('');
  return `<ul class="kb-legend" aria-label="Кольори пальців">${items}</ul>`;
}

/** Підсвічує клавішу (і Shift / правий Alt) для символу. Повертає текстову підказку. */
export function highlightNext(root, layout, ch) {
  root.querySelectorAll('.kb-next').forEach((el) => el.classList.remove('kb-next'));
  if (ch === undefined) return '';
  const key = keyForChar(layout, ch);
  if (!key) return '';
  const mark = (code) => root.querySelector(`[data-code="${code}"]`)?.classList.add('kb-next');
  mark(key.code);
  const finger = KEY_BY_CODE[key.code].finger;
  let hint = `${ch === ' ' ? 'пробіл' : `«${ch}»`} — ${FINGERS[finger].name}`;
  if (key.altgr) {
    mark('AltRight');
    hint += ' + правий Alt (великий палець правої руки)';
  }
  if (key.shift) {
    const sf = shiftFingerFor(key.code);
    mark(sf === 'lp' ? 'ShiftLeft' : 'ShiftRight');
    hint += ` + Shift (${FINGERS[sf].name})`;
  }
  return hint;
}
