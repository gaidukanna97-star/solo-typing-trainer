// ТЗ п. 8.4, 8.5: одна клавіша — один палець; і, ї, є, ґ не підміняються.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, KEY_BY_CODE, FINGERS, HOME_CODES, LAYOUTS, keyForChar, fingerForChar,
  normalizeTyped, normalizeText, shiftFingerFor, looksLikeWrongLayout, transitionInfo, describeWord,
} from '../src/core/layouts.js';

test('кожна підтримувана клавіша має рівно одне призначення пальця', () => {
  const codes = KEYS.map((k) => k.code);
  assert.equal(new Set(codes).size, codes.length, 'коди клавіш не повторюються');
  for (const k of KEYS) assert.ok(FINGERS[k.finger], `${k.code}: відомий палець`);
  assert.equal(Object.keys(KEY_BY_CODE).length, KEYS.length);
});

test('кожен символ розкладки веде рівно до однієї клавіші й одного пальця', () => {
  for (const layout of Object.values(LAYOUTS)) {
    for (const k of KEYS) {
      const { base, shift } = layout.byCode[k.code];
      assert.equal(keyForChar(layout, base).code, k.code, `${layout.id}: ${base}`);
      if (shift !== base) assert.equal(keyForChar(layout, shift).code, k.code, `${layout.id}: ${shift}`);
    }
    for (const [ch, key] of layout.charMap) assert.equal(fingerForChar(layout, ch), KEY_BY_CODE[key.code].finger);
  }
});

const fingersOf = (layout, chars) => [...new Set(Array.from(chars).map((c) => fingerForChar(layout, c)))];

test('QWERTY: таблиця пальців із ТЗ 2.1', () => {
  const en = LAYOUTS.en;
  assert.deepEqual(fingersOf(en, 'qaz'), ['lp']);
  assert.deepEqual(fingersOf(en, 'wsx'), ['lr']);
  assert.deepEqual(fingersOf(en, 'edc'), ['lm']);
  assert.deepEqual(fingersOf(en, 'rfvtgb'), ['li']);
  assert.deepEqual(fingersOf(en, 'yhnujm'), ['ri']);
  assert.deepEqual(fingersOf(en, 'ik,'), ['rm']);
  assert.deepEqual(fingersOf(en, 'ol.'), ['rr']);
  assert.deepEqual(fingersOf(en, "p[];'/"), ['rp']);
  assert.deepEqual(fingersOf(en, ' '), ['th']);
});

test('ЙЦУКЕН: таблиця пальців із ТЗ 2.2', () => {
  const uk = LAYOUTS.uk;
  assert.deepEqual(fingersOf(uk, 'йфя'), ['lp']);
  assert.deepEqual(fingersOf(uk, 'цічЦІЧ'), ['lr']);
  assert.deepEqual(fingersOf(uk, 'увс'), ['lm']);
  assert.deepEqual(fingersOf(uk, 'кеапми'), ['li']);
  assert.deepEqual(fingersOf(uk, 'нгроть'), ['ri']);
  assert.deepEqual(fingersOf(uk, 'шлб'), ['rm']);
  assert.deepEqual(fingersOf(uk, 'щдю'), ['rr']);
  assert.deepEqual(fingersOf(uk, 'зхїжє.'), ['rp']);
});

test('домашня позиція: ASDF JKL; та ФІВА ОЛДЖ', () => {
  assert.equal(HOME_CODES.map((c) => LAYOUTS.en.byCode[c].base).join(''), 'asdfjkl;');
  assert.equal(HOME_CODES.map((c) => LAYOUTS.uk.byCode[c].base).join(''), 'фіваолдж');
});

test('Shift — мізинцем протилежної руки', () => {
  assert.equal(shiftFingerFor('KeyA'), 'rp');
  assert.equal(shiftFingerFor('KeyJ'), 'lp');
});

test('українські і, ї, є, ґ — окремі символи з власними клавішами', () => {
  const uk = LAYOUTS.uk;
  const codes = ['і', 'ї', 'є', 'ґ', 'и', 'е', 'г'].map((c) => `${keyForChar(uk, c).code}${keyForChar(uk, c).altgr ? '+AltGr' : ''}`);
  assert.equal(new Set(codes).size, 7, 'сім різних натискань');
  for (const ch of 'іїєґІЇЄҐ') {
    assert.equal(normalizeTyped(ch), ch);
    assert.equal(normalizeText(`слово ${ch} слово`), `слово ${ch} слово`);
  }
});

test('нормалізація: апострофи, лапки, тире, пробіли — за задокументованим правилом', () => {
  for (const a of ['’', 'ʼ', '‘', '′']) assert.equal(normalizeTyped(a), "'");
  assert.equal(normalizeText('п’ять  «слів» — тут…\n'), 'п\'ять "слів" - тут...');
  // NFC: «й» та «ї» з комбінованими знаками збираються в одну літеру, а не губляться.
  assert.equal(normalizeText('й ї'), 'й ї');
});

test('визначення чужої розкладки', () => {
  assert.equal(looksLikeWrongLayout(LAYOUTS.uk, 'f'), true);
  assert.equal(looksLikeWrongLayout(LAYOUTS.uk, 'ы'), true, 'російська розкладка');
  assert.equal(looksLikeWrongLayout(LAYOUTS.uk, 'і'), false);
  assert.equal(looksLikeWrongLayout(LAYOUTS.en, 'а'), true);
  assert.equal(looksLikeWrongLayout(LAYOUTS.en, ';'), false);
});

test('аналіз переходів і схема слова з ТЗ 5.3', () => {
  const en = LAYOUTS.en;
  assert.equal(transitionInfo(en, 'e', 'd').sameFinger, true);
  assert.equal(transitionInfo(en, 'l', 'l').sameKey, true);
  assert.equal(transitionInfo(en, 'a', 'j').alternate, true);
  assert.equal(transitionInfo(en, 'a', 's').roll, true);
  const w = describeWord(LAYOUTS.uk, 'навчання', 'uk', 12345, 'frequencywords-2018-uk');
  assert.deepEqual(w.characters, ['н', 'а', 'в', 'ч', 'а', 'н', 'н', 'я']);
  assert.deepEqual(w.bigrams, ['на', 'ав', 'вч', 'ча', 'ан', 'нн', 'ня']);
  assert.equal(w.difficulty.length, 8);
});
