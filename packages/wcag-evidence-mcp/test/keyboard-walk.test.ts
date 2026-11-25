// The keyboard walk of ADR 0007 in Chromium, through audit_route, on the pages of fixtures/keyboard:
// a good and a bad case of each criterion, Angular Material's markup, shadow roots and a frame, and
// a page that replaces the APIs that the walk reads. Needs Chromium: `npm run browser:install`.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAxeRuleEngine } from '../src/adapters/axe/rule-engine.ts';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import { auditRoute, type AuditOutput, type AuditPorts } from '../src/core/audit.ts';
import type { BrowserPort } from '../src/core/browser.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test; a walk takes a few seconds here.
const TIMEOUT_MS = 120_000;
const KEYBOARD = ['2.1.1', '2.1.2', '2.4.3', '2.4.7'];

const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/keyboard/${name}`, import.meta.url), 'utf8');

let site: LocalSite;
let ports: AuditPorts;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  for (const name of [
    'focus-visible.html',
    'traps.html',
    'order.html',
    'clicks.html',
    'material.html',
    'frames.html',
  ]) {
    site.page(`/${name}`, fixture(name));
  }
  ports = {
    browser: createPlaywrightBrowser({ log: () => undefined }),
    engine: createAxeRuleEngine(),
  };
}, TIMEOUT_MS);

afterAll(async () => {
  await ports.browser.close();
  await site.close();
}, TIMEOUT_MS);

async function audited(
  path: string,
  criteria: readonly string[] = KEYBOARD,
  browser: BrowserPort = ports.browser,
): Promise<AuditOutput> {
  const result = await auditRoute(
    { browser, engine: ports.engine },
    { url: `${site.origin}${path}`, criteria },
  );
  if (!result.ok) throw new Error(`the audit failed: ${JSON.stringify(result.failure)}`);
  return result.output;
}

/** The selectors of the findings of `rule`. */
function selectors(output: AuditOutput, rule: string): string[] {
  return output.findings
    .filter((finding) => finding.rule === rule)
    .map(({ location }) => location.fromPage.selector);
}

describe('2.4.7 Focus Visible', { timeout: TIMEOUT_MS }, () => {
  it('reports the elements whose pixels do not change, and none that show focus', async () => {
    const output = await audited('/focus-visible.html', ['2.4.7']);

    expect(output.notChecked).toStrictEqual([]);
    expect(
      output.findings.map(({ location, measurement }) => [
        location.fromPage.selector,
        measurement.kind === 'focus-visible' ? measurement.reference : null,
        measurement.kind === 'focus-visible' ? measurement.changedProperties : null,
      ]),
    ).toStrictEqual([
      ['#none', 'load', []],
      ['#invisible', 'load', ['outline']],
      // Only the text cursor shows focus in this field, and the capture hides it.
      ['#caret', 'load', []],
      ['#below-none', 'leave', []],
    ]);
  });

  it('reports the elements below the fold that sit close to the next one, whose ring is left out', async () => {
    const buttons = Array.from(
      { length: 30 },
      (_, index) =>
        `<button class="${index % 2 === 0 ? '' : 'none'}">Button ${String(index)}</button>`,
    ).join('');
    site.page(
      '/close',
      `<!doctype html><html lang="en"><title>Close</title><style>button { display: block; margin: 6px; height: 40px } .none:focus { outline: none }</style>${buttons}</html>`,
    );

    const output = await audited('/close', ['2.4.7']);

    expect(output.findings).toHaveLength(15);
    expect(
      output.findings.some(
        ({ measurement }) =>
          measurement.kind === 'focus-visible' && measurement.reference === 'leave',
      ),
    ).toBe(true);
  });

  it('is not fooled by a page that turns on a ring when the text cursor is hidden', async () => {
    // Fields with no indicator, and a page that draws a ring on the focused field while it sees the
    // cursor hidden on it, as when a capture hides it field by field.
    const fields = Array.from(
      { length: 4 },
      (_, index) => `<input id="i${String(index)}" style="outline: none; margin: 6px">`,
    ).join('');
    site.page(
      '/caret-faker',
      `<!doctype html><html lang="en"><title>Fields</title><style>input:focus { outline: none !important }</style>${fields}<script>new MutationObserver((list) => { for (const m of list) { const t = m.target; if (t.localName !== 'input') continue; const on = t.style.getPropertyValue('caret-color') === 'transparent'; const a = document.activeElement; if (a && a.localName === 'input') a.style.boxShadow = on ? '0 0 0 4px red' : ''; } }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });</script></html>`,
    );

    const output = await audited('/caret-faker', ['2.4.7']);

    expect(selectors(output, 'focus-visible')).toStrictEqual(['#i0', '#i1', '#i2', '#i3']);
  });

  it('cannot compare a field that the page focuses again at once, and says so', async () => {
    // Focused at load, the field has only the page once focus leaves it to compare with, and the
    // page gives focus back to it as soon as it leaves.
    site.page(
      '/thief',
      `<!doctype html><html lang="en"><title>Thief</title><button>One</button><button>Two</button><input id="thief" aria-label="Thief" style="outline: none"><script>const thief = document.getElementById('thief'); thief.focus(); thief.addEventListener('blur', () => setTimeout(() => thief.focus(), 0));</script></html>`,
    );

    const output = await audited('/thief', ['2.4.7']);

    expect(output.notChecked).toStrictEqual(['2.4.7']);
    expect(selectors(output, 'focus-visible')).not.toContain('#thief');
  });

  it('takes the selector once the element has lost focus, or without the focus classes of the CDK', async () => {
    // Each button gets the classes of the CDK while it has focus; the second is removed on blur.
    site.page(
      '/cdk',
      `<!doctype html><html lang="en"><title>CDK</title><style>button { display: block; margin: 40px } button:focus { outline: none }</style>
      <div><button class="save">Save</button></div><div><button class="item">Item</button></div><div><button class="last">Last</button></div>
      <script>
        for (const button of document.querySelectorAll('button')) {
          button.addEventListener('focus', () => button.classList.add('cdk-focused', 'cdk-keyboard-focused'));
          button.addEventListener('blur', () => button.classList.remove('cdk-focused', 'cdk-keyboard-focused'));
        }
        const item = document.querySelector('.item');
        item.addEventListener('blur', () => setTimeout(() => item.remove(), 0));
      </script></html>`,
    );

    const output = await audited('/cdk', ['2.4.7']);

    expect(selectors(output, 'focus-visible')).toStrictEqual(['.save', '.item', '.last']);
  });

  it('compares an element that has focus at load with the page once focus leaves it', async () => {
    site.page(
      '/autofocus',
      `<!doctype html><html lang="en"><title>Autofocus</title><style>button { display: block; margin: 60px } #auto:focus { outline: none }</style>
      <button id="before">Before</button> <button id="auto" autofocus>Auto</button> <button id="after">After</button></html>`,
    );

    const output = await audited('/autofocus', ['2.4.7']);

    expect(
      output.findings.map(({ location, measurement }) => [
        location.fromPage.selector,
        measurement.kind === 'focus-visible' ? measurement.reference : null,
      ]),
    ).toStrictEqual([['#auto', 'leave']]);
  });

  it('gives the same findings on a page that replaces what the walk would read in its own world', async () => {
    const hostile = fixture('focus-visible.html').replace(
      '<head>',
      `<head><script>
        Document.prototype.getAnimations = () => [{ playState: 'running', finished: new Promise(() => {}), effect: { getComputedTiming: () => ({ endTime: 10 }) } }];
        Element.prototype.matches = () => false;
        Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
        Object.defineProperty(Document.prototype, 'activeElement', { get: () => null });
        window.getComputedStyle = () => ({ getPropertyValue: () => 'planted' });
        window.MutationObserver = class { constructor() { throw new Error('no observer'); } };
      </script>`,
    );
    site.page('/hostile-focus', hostile);

    const clean = await audited('/focus-visible.html', ['2.4.7']);
    const fought = await audited('/hostile-focus', ['2.4.7']);

    // The identifiers differ with the route; the rest is the same.
    const view = (output: AuditOutput) =>
      output.findings.map(({ location, measurement }) => [location.fromPage.selector, measurement]);
    expect(view(fought)).toStrictEqual(view(clean));
    expect(fought.notChecked).toStrictEqual([]);
  });

  it('gives the same findings to two calls at once, each in its own context', async () => {
    const [one, two] = await Promise.all([
      audited('/focus-visible.html', ['2.4.7']),
      audited('/focus-visible.html', ['2.4.7']),
    ]);

    expect(two.findings).toStrictEqual(one.findings);
    expect(one.findings).toHaveLength(4);
  });
});

describe('2.1.2 No Keyboard Trap', { timeout: TIMEOUT_MS }, () => {
  it.each([
    ['keydown', 1],
    ['loop', 2],
    ['timer', 1],
  ])('reports the trap of the case %s, in both directions', async (kind, stops) => {
    const output = await audited(`/traps.html?case=${kind}`, ['2.1.2']);

    expect(
      output.findings.map(({ location, measurement }) => [location.fromPage.selector, measurement]),
    ).toStrictEqual([
      [
        '#in1',
        {
          kind: 'keyboard-trap',
          directions: ['forward', 'backward'],
          stops,
          keys: ['Tab', 'Escape', 'Tab', 'Shift+Tab', 'Escape', 'Shift+Tab'],
        },
      ],
    ]);
  });

  it.each(['escape', 'held', 'dialog', 'none'])('reports no trap in the case %s', async (kind) => {
    const output = await audited(`/traps.html?case=${kind}`, ['2.1.2']);

    expect(output.findings).toStrictEqual([]);
    expect(output.notChecked).toStrictEqual([]);
  });
});

describe('cycles that Escape breaks', { timeout: TIMEOUT_MS }, () => {
  // Two regions where Tab and Shift+Tab go round; Escape releases those of the list `breakable`.
  const regions = (breakable: readonly string[]) => {
    const region = (id: string) =>
      `<div id="${id}"><button id="${id}a">${id} a</button><button id="${id}b">${id} b</button></div>`;
    const script = (id: string) => `(() => {
      const a = document.getElementById('${id}a'), b = document.getElementById('${id}b'); let on = true;
      b.addEventListener('keydown', (e) => { if (on && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); a.focus(); } });
      a.addEventListener('keydown', (e) => { if (on && e.key === 'Tab' && e.shiftKey) { e.preventDefault(); b.focus(); } });
      ${breakable.includes(id) ? `document.getElementById('${id}').addEventListener('keydown', (e) => { if (e.key === 'Escape') on = false; });` : ''}
    })();`;
    return `<!doctype html><html lang="en"><title>Cycles</title><button id="x">x</button>${region('t1')}<button id="mid">mid</button>${region('t2')}<button id="y">y</button><script>${script('t1')}${script('t2')}</script></html>`;
  };

  it('tries Escape in each cycle: two that it breaks give no trap', async () => {
    site.page('/two-cycles', regions(['t1', 't2']));

    const output = await audited('/two-cycles', ['2.1.2', '2.4.3']);

    expect(output.findings).toStrictEqual([]);
    expect(output.notChecked).toStrictEqual([]);
  });

  it('reports the cycle that Escape does not break after one that it breaks', async () => {
    site.page('/then-stuck', regions(['t1']));

    const output = await audited('/then-stuck', ['2.1.2']);

    expect(selectors(output, 'keyboard-trap')).toStrictEqual(['#t2a']);
  });
});

describe('a walk that ends in a trap', { timeout: TIMEOUT_MS }, () => {
  it('cannot check the other keyboard criteria, since it never reaches the elements after it', async () => {
    const alone = await audited('/traps.html?case=loop', ['2.4.7']);
    const all = await audited('/traps.html?case=loop');

    expect(alone.notChecked).toStrictEqual(['2.4.7']);
    expect(all.notChecked).toStrictEqual(['2.1.1', '2.4.3', '2.4.7']);
    expect(selectors(all, 'keyboard-trap')).toStrictEqual(['#in1']);
    // Tab from the last element of the cycle back to its first, in reading order, is no jump of 2.4.3.
    expect(selectors(all, 'focus-order')).toStrictEqual([]);
  });
});

describe('2.4.3 Focus Order', { timeout: TIMEOUT_MS }, () => {
  it('gives the inversions of the page against the reading order with each jump, as data', async () => {
    const output = await audited('/order.html?case=tabindex', ['2.4.3']);

    // Tab goes b4, b2, b1, b3, b5, b6: four pairs of the fifteen are out of the reading order.
    expect(
      output.findings.map(({ measurement }) =>
        measurement.kind === 'focus-order' ? [measurement.inversions, measurement.pairs] : null,
      ),
    ).toStrictEqual([
      [4, 15],
      [4, 15],
    ]);
  });

  it.each([
    ['column', []],
    ['columns', []],
    ['grid', []],
    ['order', ['#g2', '#g6']],
    ['reverse', ['#r2', '#r3', '#r4']],
    ['tabindex', ['#b1', '#b2']],
  ])('in the case %s, reports a jump back at %j', async (kind, jumps) => {
    const output = await audited(`/order.html?case=${kind}`, ['2.4.3']);

    expect(selectors(output, 'focus-order')).toStrictEqual(jumps);
  });
});

describe('2.1.1 Keyboard', { timeout: TIMEOUT_MS }, () => {
  it('reports the elements that respond to a click and that Tab reaches neither on them nor around them', async () => {
    const output = await audited('/clicks.html', ['2.1.1']);

    expect(selectors(output, 'click-not-reachable')).toStrictEqual([
      '#mouse-attribute',
      '#mouse-listener',
      '#mouse-property',
      '#mouse-down',
      '#mouse-delegate',
      // A link without href: its tabIndex is 0, yet Tab does not reach it.
      '#mouse-link',
      // Tabs of a group with no member that Tab reaches.
      '#mouse-tab-one',
      '#mouse-tab-two',
    ]);
  });

  it("leaves out Material's unselected tabs and the label of its toggle, not the arrows of its tab header", async () => {
    const output = await audited('/material.html', ['2.1.1']);

    expect(selectors(output, 'click-not-reachable')).toStrictEqual([
      '.mat-mdc-tab-header-pagination-before',
      '.mat-mdc-tab-header-pagination-after',
    ]);
  });
});

describe('the walk', { timeout: TIMEOUT_MS }, () => {
  it('goes through shadow roots and a frame, and reports nothing in the frame', async () => {
    const output = await audited('/frames.html');

    expect(output.notChecked).toStrictEqual([]);
    expect(output.findings.filter(({ rule }) => rule !== 'region')).toStrictEqual([]);
  });

  it('opens the page a second time only when a keyboard criterion is asked for', async () => {
    const visited: string[] = [];
    const counting: BrowserPort = {
      visit: (url, use) => {
        visited.push(url);
        return ports.browser.visit(url, use);
      },
      close: () => Promise.resolve(),
    };

    await audited('/clicks.html', ['1.1.1', '4.1.2'], counting);
    expect(visited).toHaveLength(1);
    await audited('/clicks.html', ['1.1.1', '2.4.7'], counting);
    expect(visited).toHaveLength(3);
  });

  it('captures the viewport as its pixels are drawn', async () => {
    site.page(
      '/colors',
      `<!doctype html><html lang="en"><title>Colors</title><body style="margin: 0; background: rgb(10, 20, 30)">
      <div style="width: 40px; height: 30px; background: rgb(200, 100, 50)"></div></body></html>`,
    );

    const visit = await ports.browser.visit(`${site.origin}/colors`, (page) =>
      page.keyboard.capture(),
    );
    if (!visit.ok) throw new Error('the visit failed');
    const { width, height, data } = visit.value;
    const pixel = (x: number, y: number) => [
      ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
    ];

    expect([width, height]).toStrictEqual([1280, 720]);
    expect(pixel(5, 5)).toStrictEqual([200, 100, 50, 255]);
    expect(pixel(39, 29)).toStrictEqual([200, 100, 50, 255]);
    expect(pixel(40, 30)).toStrictEqual([10, 20, 30, 255]);
    expect(pixel(1279, 719)).toStrictEqual([10, 20, 30, 255]);
  });
});
