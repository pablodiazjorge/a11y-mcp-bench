// The life of the browser adapter against a local test site: when Chromium starts and stops,
// what it is started with, and the time limits of a visit. Needs Chromium:
// `npm run browser:install`.

import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type LaunchOptions,
} from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import type { BrowserPort, Visit } from '../src/core/browser.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test.
const TIMEOUT_MS = 30_000;

let site: LocalSite;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  site.page('/', '<title>home</title>');
  // Never answers, so the page never loads.
  site.handle('/hang', () => undefined);
}, TIMEOUT_MS);

afterAll(() => site.close(), TIMEOUT_MS);

/** Starts Chromium as the adapter would, and keeps what it was asked and what it started. */
function recordingLaunch() {
  const launches: LaunchOptions[] = [];
  const browsers: Browser[] = [];
  const launch = async (options: LaunchOptions): Promise<Browser> => {
    launches.push(options);
    const started = await chromium.launch(options);
    browsers.push(started);
    return started;
  };
  return { launches, browsers, launch };
}

function title(browser: BrowserPort, path = '/'): Promise<Visit<unknown>> {
  return browser.visit(`${site.origin}${path}`, (page) => page.evaluate('document.title'));
}

describe('Chromium', { timeout: TIMEOUT_MS }, () => {
  it('starts on the first visit only, with the resolver rule and no proxy, and closes', async () => {
    const recorded = recordingLaunch();
    const logs: string[] = [];
    const browser = createPlaywrightBrowser({
      log: (line) => logs.push(line),
      launch: recorded.launch,
    });

    expect(recorded.launches).toHaveLength(0);
    expect(await title(browser)).toStrictEqual({ ok: true, value: 'home' });
    expect(await title(browser)).toStrictEqual({ ok: true, value: 'home' });
    // Written out, so that a change to the arguments in the adapter shows here.
    expect(recorded.launches).toStrictEqual([
      {
        args: [
          '--host-resolver-rules=MAP * ^NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',
          '--no-proxy-server',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ],
        timeout: 30_000,
      },
    ]);
    expect(recorded.browsers[0]?.contexts()).toStrictEqual([]);

    await browser.close();

    expect(recorded.browsers[0]?.isConnected()).toBe(false);
    expect(logs[0]).toMatch(/^started Chromium \d+\./);
    expect(logs.at(-1)).toBe('closed Chromium');
  });

  it('starts again on the next visit after it crashed', async () => {
    const recorded = recordingLaunch();
    const browser = createPlaywrightBrowser({ log: () => undefined, launch: recorded.launch });
    try {
      await title(browser);
      await recorded.browsers[0]?.close();

      expect(await title(browser)).toStrictEqual({ ok: true, value: 'home' });
      expect(recorded.launches).toHaveLength(2);
    } finally {
      await browser.close();
    }
  });

  it('is not started again once closed, and closing twice is harmless', async () => {
    const recorded = recordingLaunch();
    const browser = createPlaywrightBrowser({ log: () => undefined, launch: recorded.launch });

    await browser.close();
    const visit = await title(browser);
    await browser.close();

    expect(visit).toStrictEqual({
      ok: false,
      failure: { reason: 'browser-unavailable', message: 'the browser is closed' },
    });
    expect(recorded.launches).toHaveLength(0);
  });

  it('that cannot start fails the visit with its first line, and is tried again', async () => {
    let attempts = 0;
    const browser = createPlaywrightBrowser({
      log: () => undefined,
      launch: () => {
        attempts += 1;
        return Promise.reject(new Error('Executable does not exist\nRun the install command'));
      },
    });

    const first = await title(browser);
    await title(browser);

    expect(first).toStrictEqual({
      ok: false,
      failure: { reason: 'browser-unavailable', message: 'Executable does not exist' },
    });
    expect(attempts).toBe(2);
  });
});

// Each limit is far below the other one and below the limit of a test, so a limit that does not
// work makes its test run out of time instead of passing on the other limit.
describe('a visit', { timeout: TIMEOUT_MS }, () => {
  const recorded = recordingLaunch();
  const browser = createPlaywrightBrowser({ log: () => undefined, launch: recorded.launch });
  const quickVisit = createPlaywrightBrowser({ log: () => undefined, visitTimeoutMs: 4_000 });
  const quickLoad = createPlaywrightBrowser({
    log: () => undefined,
    loadTimeoutMs: 1_000,
    visitTimeoutMs: 120_000,
  });

  afterAll(async () => {
    await browser.close();
    await quickVisit.close();
    await quickLoad.close();
  }, TIMEOUT_MS);

  it('gives up on a page that does not load in time', async () => {
    expect(await title(quickLoad, '/hang')).toStrictEqual({
      ok: false,
      failure: { reason: 'timeout' },
    });
    expect(site.hits('/hang')).toBeGreaterThan(0);
  });

  it('ends when the whole visit takes longer than its limit while the page loads', async () => {
    expect(await title(quickVisit, '/hang')).toStrictEqual({
      ok: false,
      failure: { reason: 'timeout' },
    });
  });

  it('ends when the caller takes longer than the limit of the whole visit', async () => {
    const visit = await quickVisit.visit(`${site.origin}/`, (page) =>
      page.evaluate('new Promise(() => {})'),
    );

    expect(visit).toStrictEqual({ ok: false, failure: { reason: 'timeout' } });
  });

  it('ends when the caller takes longer than its limit, even without using the page', async () => {
    const visit = await quickVisit.visit(
      `${site.origin}/`,
      () => new Promise<never>(() => undefined),
    );

    expect(visit).toStrictEqual({ ok: false, failure: { reason: 'timeout' } });
  });

  it('reports a browser that closes during the visit, which is not the caller failing', async () => {
    const visit = await browser.visit(`${site.origin}/`, (page) =>
      Promise.all([page.evaluate('new Promise(() => {})'), recorded.browsers.at(-1)?.close()]),
    );

    expect(visit).toStrictEqual({
      ok: false,
      failure: { reason: 'browser-unavailable', message: 'the browser closed during the visit' },
    });
    // The next visit starts a new browser once this one has finished closing.
    await recorded.browsers.at(-1)?.close();
  });

  it('reports a browser that closes while the page loads, not a failed load', async () => {
    site.handle('/close-browser', () => {
      void recorded.browsers.at(-1)?.close();
    });

    const visit = await title(browser, '/close-browser');

    expect(visit).toStrictEqual({
      ok: false,
      failure: { reason: 'browser-unavailable', message: 'the browser closed during the visit' },
    });
    await recorded.browsers.at(-1)?.close();
  });

  it('reports a page that cannot be loaded', async () => {
    const gone = await startSite('127.0.0.1');
    await gone.close();

    const visit = await browser.visit(`${gone.origin}/`, () => Promise.resolve('loaded'));

    expect(visit).toMatchObject({ ok: false, failure: { reason: 'load-failed' } });
    expect(JSON.stringify(visit)).toContain('ERR_CONNECTION_REFUSED');
  });

  it('passes an error of the caller through, and closes its context all the same', async () => {
    const visit = browser.visit(`${site.origin}/`, () =>
      Promise.reject(new Error('caller failed')),
    );

    await expect(visit).rejects.toThrow('caller failed');
    expect(recorded.browsers.at(-1)?.contexts()).toStrictEqual([]);
  });
});

/** Returns `target` with some members replaced, and its own methods bound to it. */
function override<T extends object>(target: T, members: Partial<T>): T {
  return new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(members, key)) return members[key as keyof T];
      const value: unknown = Reflect.get(object, key, object);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(object)
        : value;
    },
  });
}

describe('what the adapter asks of Playwright', { timeout: TIMEOUT_MS }, () => {
  // A Chromium whose responses have no server address, as Playwright reports when it has none,
  // and which keeps the options of each context.
  const contexts: (BrowserContextOptions | undefined)[] = [];
  const browser = createPlaywrightBrowser({
    log: () => undefined,
    launch: async (options) => {
      const real = await chromium.launch(options);
      return override(real, {
        newContext: async (contextOptions?: BrowserContextOptions) => {
          contexts.push(contextOptions);
          const context = await real.newContext(contextOptions);
          return override(context, {
            newPage: async () => {
              const page = await context.newPage();
              return override(page, {
                goto: async (...args: Parameters<typeof page.goto>) => {
                  const response = await page.goto(...args);
                  return (
                    response && override(response, { serverAddr: () => Promise.resolve(null) })
                  );
                },
              });
            },
          });
        },
      });
    },
  });

  afterAll(() => browser.close(), TIMEOUT_MS);

  it('blocks service workers and refuses downloads in every context, and fails without an address', async () => {
    const visit = await title(browser);

    expect(contexts).toStrictEqual([{ serviceWorkers: 'block', acceptDownloads: false }]);
    expect(visit).toStrictEqual({ ok: false, failure: { reason: 'not-local', address: 'none' } });
  });
});

// Each of these visits has a limit of 2 seconds and ends within it and the margin of 1 second for
// the context. Without that margin it would wait for the double forever, or for the page's own limit
// of 30 seconds, and run out of the time of its test.
describe('a browser that stops answering without closing', { timeout: 10_000 }, () => {
  const never = (): Promise<never> => new Promise<never>(() => undefined);
  const browser = createPlaywrightBrowser({
    log: () => undefined,
    visitTimeoutMs: 2_000,
    launch: async (options) => {
      const real = await chromium.launch(options);
      return override(real, {
        newContext: async (contextOptions?: BrowserContextOptions) =>
          override(await real.newContext(contextOptions), { cookies: never, close: never }),
      });
    },
  });

  afterAll(() => browser.close(), TIMEOUT_MS);

  it('still reports a page that cannot be loaded', async () => {
    const gone = await startSite('127.0.0.1');
    await gone.close();

    const visit = await browser.visit(`${gone.origin}/`, () => Promise.resolve('loaded'));

    expect(visit).toMatchObject({ ok: false, failure: { reason: 'load-failed' } });
  });

  it('still passes an error of the caller through', async () => {
    const visit = browser.visit(`${site.origin}/`, () =>
      Promise.reject(new Error('caller failed')),
    );

    await expect(visit).rejects.toThrow('caller failed');
  });

  it('ends at the limit when the caller never finishes', async () => {
    const visit = await browser.visit(`${site.origin}/`, never);

    expect(visit).toStrictEqual({ ok: false, failure: { reason: 'timeout' } });
  });

  it('ends at the limit when the page never loads', async () => {
    expect(await title(browser, '/hang')).toStrictEqual({
      ok: false,
      failure: { reason: 'timeout' },
    });
  });
});
