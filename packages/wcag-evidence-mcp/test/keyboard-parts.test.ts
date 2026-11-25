// The parts of the keyboard walk of ADR 0007 that decide from what it read: the cycles of 2.1.2,
// the jumps back of 2.4.3, the styles and pixels of 2.4.7, and the selectors without focus classes.

import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import type { Box, Frame } from '../src/core/browser.ts';
import { changedPixels } from '../src/core/focus-pixels.ts';
import {
  backJump,
  changedProperties,
  confirmedCycle,
  inversions,
  KEYBOARD_RULES,
  withoutFocusClasses,
} from '../src/core/keyboard.ts';
import type { ElementLocation } from '../src/core/rule-engine.ts';

const box = (y: number): Box => ({ x: 20, y, width: 40, height: 20 });

describe('KEYBOARD_RULES', () => {
  it('names no rule of the installed axe-core, since the identifier sums up the rule', () => {
    const ids = new Set(axe.getRules().map(({ ruleId }) => ruleId));

    for (const rule of Object.keys(KEYBOARD_RULES)) expect(ids.has(rule), rule).toBe(false);
  });
});

describe('confirmedCycle', () => {
  it.each<[string, (number | null)[], number[] | null]>([
    ['one stop that Tab does not leave, twice over', [1, 1, 1], [1]],
    ['two stops, twice over', [1, 2, 3, 2, 3, 2], [2, 3]],
    ['a cycle seen once', [1, 2, 3, 2], null],
    ['a repeat with the body between', [1, 2, null, 1, 2, null, 1], null],
    ['a repeat that does not go round the same way', [1, 2, 3, 2, 4, 2], null],
  ])('finds %s', (_case, stops, cycle) => {
    expect(confirmedCycle(stops, 0)).toStrictEqual(cycle);
  });

  it('looks only after `from`', () => {
    expect(confirmedCycle([2, 3, 2, 3, 2], 2)).toBeNull();
  });
});

describe('inversions', () => {
  it('counts the pairs that Tab visits out of the reading order, by rows and then left to right', () => {
    // A column of six, which Tab visits b4, b2, b1, b3, b5, b6.
    const at = (row: number): Box => ({ x: 16, y: 16 + row * 40, width: 140, height: 32 });
    const visited = [at(3), at(1), at(0), at(2), at(4), at(5)];

    expect(inversions(visited)).toStrictEqual({ inversions: 4, pairs: 15 });
    expect(inversions([at(0), at(1)])).toStrictEqual({ inversions: 0, pairs: 1 });
    // In one row, from right to left.
    const row = [100, 50, 0].map((x): Box => ({ x, y: 0, width: 40, height: 20 }));
    expect(inversions(row)).toStrictEqual({ inversions: 3, pairs: 3 });
  });
});

describe('backJump', () => {
  it.each<[string, Box, Box, boolean]>([
    ['down the same column', box(10), box(50), false],
    ['up the same column', box(50), box(10), true],
    ['left in the same row', { x: 100, y: 10, width: 40, height: 20 }, box(10), true],
    ['right in the same row', box(10), { x: 100, y: 10, width: 40, height: 20 }, false],
    [
      'up and to the right, to the top of the next column',
      box(90),
      { x: 100, y: 10, width: 40, height: 20 },
      false,
    ],
  ])('%s', (_case, from, to, back) => {
    expect(backJump(from, to) !== null).toBe(back);
  });
});

describe('changedProperties', () => {
  it('names the properties that changed, apart from the element that has focus at the stop after', () => {
    const before = { '1|outline': 'none', '2|box-shadow': 'none', '3::after|background': 'none' };
    const after = { '1|outline': 'auto', '2|box-shadow': '0 0 3px', '3::after|background': 'blue' };

    expect(changedProperties(before, after, 2)).toStrictEqual(['outline', 'background']);
  });
});

describe('withoutFocusClasses', () => {
  const location = (selector: string): ElementLocation => ({
    selector,
    rect: { x: 0, y: 0, width: 1, height: 1 },
    documentIndex: 1,
    component: null,
    element: { tag: 'button', attributes: [], attributeCount: 0 },
  });

  it.each([
    ['.save.cdk-focused.cdk-keyboard-focused', '.save'],
    ['.cdk-focused', 'button'],
    ['mat-form-field.mat-focused > input', 'mat-form-field > input'],
    ['div > .mdc-text-field--focused', 'div > button'],
    ['.cdk-focused-not', '.cdk-focused-not'],
  ])('turns %s into %s', (selector, expected) => {
    expect(withoutFocusClasses(location(selector)).selector).toBe(expected);
  });
});

describe('changedPixels', () => {
  const blank = (): Frame => ({
    width: 50,
    height: 50,
    data: new Uint8Array(50 * 50 * 4).fill(200),
  });

  it('counts the pixels of the area that differ by more than 10 in a channel, aligned on the element', () => {
    const focused = blank();
    const reference = blank();
    focused.data[(10 * 50 + 10) * 4] = 189;
    focused.data[(11 * 50 + 10) * 4 + 2] = 211;
    focused.data[(12 * 50 + 10) * 4 + 1] = 190;

    expect(
      changedPixels(focused, { x: 10, y: 10, width: 5, height: 5 }, reference, {
        x: 10,
        y: 10,
        width: 5,
        height: 5,
      }),
    ).toBe(2);
    expect(
      changedPixels(focused, { x: 10, y: 10, width: 5, height: 5 }, focused, {
        x: 10,
        y: 10,
        width: 5,
        height: 5,
      }),
    ).toBe(0);
  });

  it('leaves out the area of the element that has focus in the reference, and its margin', () => {
    const focused = blank();
    const reference = blank();
    // The next element, focused in the reference, draws its own ring below the element.
    for (let x = 10; x < 15; x++) reference.data[(17 * 50 + x) * 4] = 0;
    const area = { x: 10, y: 10, width: 5, height: 5 };

    expect(changedPixels(focused, area, reference, area)).toBe(5);
    expect(
      changedPixels(focused, area, reference, area, { x: 10, y: 20, width: 5, height: 5 }),
    ).toBe(0);
  });

  it('gives null when the area falls outside a capture', () => {
    expect(
      changedPixels(blank(), { x: 10, y: 10, width: 5, height: 5 }, blank(), {
        x: 10,
        y: 400,
        width: 5,
        height: 5,
      }),
    ).toBeNull();
  });
});
