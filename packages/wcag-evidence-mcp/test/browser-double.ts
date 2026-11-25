// Stand-ins for the browser port and the rule engine port, for tests that need no Chromium.

import type { BrowserPort, KeyboardDriver, LoadedPage, Visit } from '../src/core/browser.ts';
import type { EngineFinding, RuleEngine } from '../src/core/rule-engine.ts';
import { checkUrl } from '../src/core/url-policy.ts';

export interface BrowserDouble extends BrowserPort {
  /** How many times `close` was called. */
  readonly closeCalls: number;
  /** The URLs of the visits, in order. */
  readonly visited: readonly string[];
}

/**
 * A keyboard on a page with nothing that Tab reaches: the focus stays on the body, so the walk
 * ends at its cap with nothing to report, and sees the whole page.
 */
export function emptyKeyboard(): KeyboardDriver {
  return {
    tabbables: () => Promise.resolve([]),
    press: () => Promise.resolve(),
    focused: () =>
      Promise.resolve({
        key: null,
        box: null,
        scrollX: 0,
        scrollY: 0,
        focusVisible: false,
        inFrame: false,
      }),
    where: () => Promise.resolve(null),
    capture: () => Promise.resolve({ width: 1, height: 1, data: new Uint8Array(4) }),
    styles: () => Promise.resolve({}),
    clickTargets: () => Promise.resolve([]),
  };
}

/** A page that answers `evaluate` with `result`, whatever the script. */
export function pageDouble(
  result: unknown = null,
  url = 'http://localhost:4200/',
  keyboard: KeyboardDriver = emptyKeyboard(),
): LoadedPage {
  return {
    url,
    status: 200,
    settled: true,
    evaluate: () => Promise.resolve(result),
    evaluateIsolated: () => Promise.resolve(result),
    refusedRequests: () => [],
    keyboard,
  };
}

/**
 * A browser that applies the first layer of the URL policy and then opens `page`. With no page, a
 * visit that passes the policy throws, for the tests where no page should be opened.
 */
export function createBrowserDouble(page?: LoadedPage): BrowserDouble {
  let closeCalls = 0;
  const visited: string[] = [];
  return {
    get closeCalls() {
      return closeCalls;
    },
    visited,
    async visit<T>(url: string, use: (opened: LoadedPage) => Promise<T>): Promise<Visit<T>> {
      visited.push(url);
      const check = checkUrl(url);
      if (!check.allowed) {
        return { ok: false, failure: { reason: 'url-policy', url, rejection: check.reason } };
      }
      if (page === undefined) throw new Error('this double opens no page');
      return { ok: true, value: await use(page) };
    },
    close: () => {
      closeCalls += 1;
      return Promise.resolve();
    },
  };
}

export interface RuleEngineDouble extends RuleEngine {
  /** The rules of each run, in order. */
  readonly runs: readonly (readonly string[])[];
}

/** An engine that reports, of `findings`, those of the rules it is asked to run. */
export function createRuleEngineDouble(findings: readonly EngineFinding[] = []): RuleEngineDouble {
  const runs: (readonly string[])[] = [];
  return {
    name: 'double 1.0.0',
    runs,
    run: (_page, rules) => {
      runs.push(rules);
      return Promise.resolve(findings.filter(({ rule }) => rules.includes(rule)));
    },
    locate: (_page, keys) => Promise.resolve(keys.map(() => null)),
  };
}
