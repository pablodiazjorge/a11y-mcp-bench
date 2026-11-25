// The keyboard walk of ADR 0007 without a browser: a simulated page whose focus moves as a script
// says, and whose captures change around an element only when it has an indicator.

import { describe, expect, it } from 'vitest';
import type {
  Box,
  ClickTarget,
  FocusStop,
  Frame,
  KeyboardDriver,
  WalkKey,
} from '../src/core/browser.ts';
import { walkKeyboard } from '../src/core/keyboard.ts';
import type { ElementLocation, RuleEngine } from '../src/core/rule-engine.ts';
import { pageDouble } from './browser-double.ts';

const SIZE = 200;
const ALL = ['2.1.1', '2.1.2', '2.4.3', '2.4.7'];

interface Element {
  readonly box: Box;
  /** Whether focus changes its pixels. */
  readonly indicator: boolean;
  /** How far the page is scrolled while the element has focus. */
  readonly scrollY?: number;
}

interface Script {
  readonly elements: Record<number, Element>;
  /** The element that `key` moves focus to, from the focused one (null for the body). */
  next(from: number | null, key: WalkKey): number | null;
  readonly targets?: readonly ClickTarget[];
}

/** A keyboard over the script, and what it was asked to press. */
function simulated(script: Script): KeyboardDriver & { readonly pressed: WalkKey[] } {
  let focused: number | null = null;
  let scrollY = 0;
  const pressed: WalkKey[] = [];
  const frame = (): Frame => {
    const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
    const element = focused === null ? undefined : script.elements[focused];
    if (element?.indicator === true) {
      const { x, y, width, height } = element.box;
      for (let row = y - scrollY; row < y - scrollY + height; row++) {
        for (let column = x; column < x + width; column++) {
          if (row >= 0 && row < SIZE) data[(row * SIZE + column) * 4] = 0;
        }
      }
    }
    return { width: SIZE, height: SIZE, data };
  };
  const inViewport = (key: number): Box => {
    const { box } = script.elements[key] ?? { box: { x: 0, y: 0, width: 0, height: 0 } };
    return { ...box, y: box.y - scrollY };
  };
  return {
    pressed,
    tabbables: () =>
      Promise.resolve(
        Object.entries(script.elements).map(([key, element]) => ({
          key: Number(key),
          box: element.box,
        })),
      ),
    press: (key) => {
      pressed.push(key);
      focused = script.next(focused, key);
      scrollY = focused === null ? scrollY : (script.elements[focused]?.scrollY ?? 0);
      return Promise.resolve();
    },
    focused: (): Promise<FocusStop> =>
      Promise.resolve({
        key: focused,
        box: focused === null ? null : inViewport(focused),
        scrollX: 0,
        scrollY,
        focusVisible: focused !== null,
        inFrame: false,
      }),
    where: (key) => Promise.resolve({ box: inViewport(key), scrollX: 0, scrollY }),
    capture: () => Promise.resolve(frame()),
    styles: () => Promise.resolve({}),
    clickTargets: () => Promise.resolve(script.targets ?? []),
  };
}

const engine: RuleEngine = {
  name: 'double',
  run: () => Promise.resolve([]),
  locate: (_page, keys) =>
    Promise.resolve(
      keys.map((key): ElementLocation => ({
        selector: `#e${String(key)}`,
        rect: { x: 0, y: key * 10, width: 10, height: 10 },
        documentIndex: key,
        component: null,
        element: { tag: 'button', attributes: [], attributeCount: 0 },
      })),
    ),
};

/** Tab goes through `order` and then the body, and Shift+Tab the other way. */
function inOrder(order: readonly number[]): Script['next'] {
  return (from, key) => {
    const cycle = [...order, null];
    const at = cycle.indexOf(from);
    const step = key === 'Shift+Tab' ? cycle.length - 1 : 1;
    return key === 'Escape' ? from : (cycle[(at + step) % cycle.length] ?? null);
  };
}

const box = (y: number): Box => ({ x: 20, y, width: 40, height: 20 });

async function walked(script: Script, criteria = ALL) {
  const keyboard = simulated(script);
  const result = await walkKeyboard(pageDouble(null, undefined, keyboard), engine, criteria);
  return { ...result, pressed: keyboard.pressed };
}

describe('walkKeyboard', () => {
  it('reports an element whose pixels do not change, compared with the page at load', async () => {
    const { findings, notChecked } = await walked({
      elements: {
        1: { box: box(10), indicator: true },
        2: { box: box(50), indicator: false },
        3: { box: box(90), indicator: true },
      },
      next: inOrder([1, 2, 3]),
    });

    expect(notChecked).toStrictEqual([]);
    expect(
      findings.map(({ rule, selector, measurement }) => [rule, selector, measurement]),
    ).toStrictEqual([
      [
        'focus-visible',
        '#e2',
        {
          kind: 'focus-visible',
          key: 'Tab',
          focusVisible: true,
          reference: 'load',
          margin: 12,
          changedPixels: 0,
          threshold: 10,
          changedProperties: [],
        },
      ],
    ]);
  });

  it('compares an element outside the viewport at load with the page once focus leaves it', async () => {
    const { findings, notChecked } = await walked({
      elements: {
        1: { box: box(10), indicator: true },
        2: { box: box(300), indicator: false, scrollY: 150 },
        3: { box: box(340), indicator: true, scrollY: 150 },
      },
      next: inOrder([1, 2, 3]),
    });

    expect(notChecked).toStrictEqual([]);
    expect(
      findings.map(({ selector, measurement }) => [
        selector,
        measurement.kind === 'focus-visible' && measurement.reference,
      ]),
    ).toStrictEqual([['#e2', 'leave']]);
  });

  it('says the walk did not see the page whole when an element cannot be compared', async () => {
    const { findings, notChecked } = await walked({
      elements: { 1: { box: box(10), indicator: true }, 2: { box: box(400), indicator: false } },
      next: inOrder([1, 2]),
    });

    expect(findings).toStrictEqual([]);
    expect(notChecked).toStrictEqual(['2.4.7']);
  });

  it('reports a trap that Escape does not break, once for both directions', async () => {
    const trapped: Script['next'] = (from, key) => {
      if (key === 'Escape') return from;
      if (from === 2) return 3;
      if (from === 3) return 2;
      return key === 'Tab' ? (from === null ? 1 : 2) : 3;
    };
    const { findings, notChecked, pressed } = await walked(
      {
        elements: {
          1: { box: box(10), indicator: true },
          2: { box: box(50), indicator: true },
          3: { box: box(90), indicator: true },
        },
        next: trapped,
      },
      ['2.1.2'],
    );

    expect(notChecked).toStrictEqual([]);
    expect(pressed.filter((key) => key === 'Escape')).toHaveLength(2);
    expect(
      findings.map(({ rule, selector, measurement }) => [rule, selector, measurement]),
    ).toStrictEqual([
      [
        'keyboard-trap',
        '#e2',
        {
          kind: 'keyboard-trap',
          directions: ['forward', 'backward'],
          stops: 2,
          keys: ['Tab', 'Escape', 'Tab', 'Shift+Tab', 'Escape', 'Shift+Tab'],
        },
      ],
    ]);
  });

  it('tries Escape once in each cycle, so two cycles that it breaks give no trap', async () => {
    const released = new Set<number>();
    const cycles: Script['next'] = (from, key) => {
      if (key === 'Escape') {
        if (from !== null) released.add(from <= 3 ? 2 : 5);
        return from;
      }
      if (key === 'Tab' && from === 3 && !released.has(2)) return 2;
      if (key === 'Tab' && from === 6 && !released.has(5)) return 5;
      if (key === 'Shift+Tab' && from === 2 && !released.has(2)) return 3;
      if (key === 'Shift+Tab' && from === 5 && !released.has(5)) return 6;
      return inOrder([1, 2, 3, 4, 5, 6, 7])(from, key);
    };
    const elements = Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((key) => [key, { box: box(key * 25), indicator: true }]),
    );

    const { findings, notChecked, pressed } = await walked({ elements, next: cycles }, ['2.1.2']);

    expect(findings).toStrictEqual([]);
    expect(notChecked).toStrictEqual([]);
    expect(pressed.filter((key) => key === 'Escape')).toHaveLength(2);
  });

  it('cannot check the other keyboard criteria past a cycle, since the walk never reaches it', async () => {
    const cycle: Script['next'] = (from, key) => (key === 'Escape' ? from : from === 1 ? 2 : 1);
    const elements = { 1: { box: box(10), indicator: true }, 2: { box: box(50), indicator: true } };

    expect((await walked({ elements, next: cycle })).notChecked).toStrictEqual([
      '2.1.1',
      '2.4.3',
      '2.4.7',
    ]);
    expect((await walked({ elements, next: cycle }, ['2.4.7'])).notChecked).toStrictEqual([
      '2.4.7',
    ]);
  });

  it('reports no trap when Escape lets the focus out, and goes on to the end', async () => {
    let released = false;
    const trapped: Script['next'] = (from, key) => {
      if (key === 'Escape') {
        released = true;
        return from;
      }
      if (!released && from === 3) return 2;
      return inOrder([1, 2, 3])(from, key);
    };
    const { findings, notChecked } = await walked(
      {
        elements: {
          1: { box: box(10), indicator: true },
          2: { box: box(50), indicator: true },
          3: { box: box(90), indicator: true },
        },
        next: trapped,
      },
      ['2.1.2'],
    );

    expect(findings).toStrictEqual([]);
    expect(notChecked).toStrictEqual([]);
  });

  it('stops at its cap, twice the elements plus 6, and says the page was not seen whole', async () => {
    let next = 1;
    const { notChecked, pressed } = await walked(
      {
        elements: { 1: { box: box(10), indicator: true }, 2: { box: box(50), indicator: true } },
        next: () => (next += 1),
      },
      ['2.1.2'],
    );

    expect(notChecked).toStrictEqual(['2.1.2']);
    expect(pressed.filter((key) => key === 'Tab')).toHaveLength(2 * 2 + 6);
  });

  it('sees a page that Tab does not enter as whole, after the cap', async () => {
    const { findings, notChecked } = await walked({ elements: {}, next: () => null });

    expect(findings).toStrictEqual([]);
    expect(notChecked).toStrictEqual([]);
  });

  it('reports a jump back, at the element it reaches', async () => {
    const { findings } = await walked(
      {
        elements: {
          1: { box: box(10), indicator: true },
          2: { box: box(90), indicator: true },
          3: { box: box(50), indicator: true },
        },
        next: inOrder([1, 2, 3]),
      },
      ['2.4.3'],
    );

    expect(
      findings.map(({ rule, selector, measurement }) => [rule, selector, measurement]),
    ).toStrictEqual([
      ['focus-order', '#e3', { kind: 'focus-order', upPx: 40, leftPx: 0, inversions: 1, pairs: 3 }],
    ]);
  });

  it('reports a jump back inside a cycle, but not the Tab that takes the cycle round', async () => {
    // Tab goes 1, then round 2, 4, 3: from 4 up to 3 is a jump; from 3 up to 2 closes the cycle.
    const after: Record<number, number> = { 1: 2, 2: 4, 4: 3, 3: 2 };
    const { findings, notChecked } = await walked(
      {
        elements: Object.fromEntries(
          [1, 2, 3, 4].map((key) => [key, { box: box(key * 40 - 30), indicator: true }]),
        ),
        next: (from, key) => (key === 'Tab' ? (from === null ? 1 : (after[from] ?? null)) : from),
      },
      ['2.4.3'],
    );

    expect(notChecked).toStrictEqual(['2.4.3']);
    expect(
      findings.map(({ rule, selector, measurement }) => [rule, selector, measurement]),
    ).toStrictEqual([
      ['focus-order', '#e3', { kind: 'focus-order', upPx: 40, leftPx: 0, inversions: 1, pairs: 6 }],
    ]);
  });

  it('reports a clicked element that Tab reaches neither on it nor around it', async () => {
    const target = (key: number, overrides: Partial<ClickTarget>): ClickTarget => ({
      key,
      events: ['click'],
      reached: false,
      ancestorReached: false,
      descendantReached: false,
      groupReached: false,
      labelOfReached: false,
      rendered: true,
      inFrame: false,
      ...overrides,
    });
    const { findings } = await walked(
      {
        elements: { 1: { box: box(10), indicator: true } },
        next: inOrder([1]),
        targets: [
          target(5, {}),
          target(6, { groupReached: true }),
          target(7, { labelOfReached: true }),
          target(8, { rendered: false }),
          target(9, { inFrame: true }),
          target(10, { descendantReached: true }),
          target(11, { events: ['mousedown', 'touchend'] }),
        ],
      },
      ['2.1.1'],
    );

    expect(findings.map(({ selector, measurement }) => [selector, measurement])).toStrictEqual([
      [
        '#e5',
        {
          kind: 'click-not-reachable',
          events: ['click'],
          reached: false,
          ancestorReached: false,
          descendantReached: false,
        },
      ],
      [
        '#e11',
        {
          kind: 'click-not-reachable',
          events: ['mousedown', 'touchend'],
          reached: false,
          ancestorReached: false,
          descendantReached: false,
        },
      ],
    ]);
  });

  it('walks only for the criteria asked for: no Shift+Tab without 2.1.2, no capture without 2.4.7', async () => {
    const script: Script = {
      elements: { 1: { box: box(10), indicator: false } },
      next: inOrder([1]),
    };
    const keyboard = simulated(script);
    let captures = 0;
    const counted: KeyboardDriver = {
      ...keyboard,
      capture: () => {
        captures += 1;
        return keyboard.capture();
      },
    };
    const { findings } = await walkKeyboard(pageDouble(null, undefined, counted), engine, [
      '2.4.3',
    ]);

    expect(findings).toStrictEqual([]);
    expect(captures).toBe(0);
    expect(keyboard.pressed).not.toContain('Shift+Tab');
  });
});
