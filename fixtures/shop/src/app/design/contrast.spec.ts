// The contrast of the design tokens in src/styles.css, computed from the file itself, so that a
// change to a color that breaks WCAG AA fails here: 4.5:1 for text, 3:1 for the edge of a control
// and for the focus indicator (1.4.3 and 1.4.11).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The app's tests run from its folder, through `ng test`.
const STYLES = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
// Every declaration of a color token, whatever its value, so that one written in a form that this
// test does not read fails it rather than go unchecked.
const DECLARED = [...STYLES.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]*);/gi)].map(
  ([, name, value]) => [name ?? '', (value ?? '').trim()] as const,
);
const HEX = /^#[0-9a-f]{6}$/i;
const TOKENS = new Map(DECLARED.filter(([, value]) => HEX.test(value)));

/** The relative luminance of a color written `#rrggbb`, as WCAG defines it. */
function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function ratio(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT = 4.5;
const UI = 3;
// Each color of the tokens, on each background where the app puts it.
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['--color-text', '--color-background', TEXT],
  ['--color-text', '--color-surface', TEXT],
  ['--color-text-muted', '--color-background', TEXT],
  ['--color-text-muted', '--color-surface', TEXT],
  ['--color-link', '--color-background', TEXT],
  ['--color-link', '--color-surface', TEXT],
  ['--color-on-accent', '--color-accent', TEXT],
  ['--color-error', '--color-background', TEXT],
  ['--color-error', '--color-surface', TEXT],
  ['--color-border', '--color-background', UI],
  ['--color-border', '--color-surface', UI],
  ['--color-focus', '--color-background', UI],
  ['--color-focus', '--color-surface', UI],
];

describe('the design tokens', () => {
  it('are read from src/styles.css, each written as #rrggbb', () => {
    expect(TOKENS.size).toBeGreaterThan(0);
    expect(DECLARED.filter(([, value]) => !HEX.test(value))).toEqual([]);
  });

  it.each(PAIRS)('give %s on %s a contrast of at least %d:1', (foreground, background, minimum) => {
    const fore = TOKENS.get(foreground);
    const back = TOKENS.get(background);
    expect(fore).toBeDefined();
    expect(back).toBeDefined();

    expect(ratio(fore ?? '', back ?? '')).toBeGreaterThanOrEqual(minimum);
  });

  it('put every color in some pair, so that no color goes untested', () => {
    const tested = new Set(PAIRS.flatMap(([foreground, background]) => [foreground, background]));

    expect(DECLARED.map(([name]) => name).filter((name) => !tested.has(name))).toEqual([]);
  });

  it('compute the ratios of WCAG, as for black on white', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
