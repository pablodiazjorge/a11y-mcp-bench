import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import {
  chromium,
  errors,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type LaunchOptions,
  type Page,
  type Request,
} from 'playwright-core';
import type {
  BrowserPort,
  LoadedPage,
  RefusedRequest,
  Visit,
  VisitFailure,
} from '../../core/browser.ts';
import type { Log } from '../../core/log.ts';
import {
  allowedPort,
  checkRequest,
  checkUrl,
  checkWebSocket,
  isLocalAddress,
  type UrlRejection,
} from '../../core/url-policy.ts';
import { createKeyboardDriver, type IsolatedWorld } from './keyboard.ts';
import { watchRedirects } from './redirects.ts';

/**
 * The part of the second layer of the URL policy (ADR 0005) that lives in Chromium itself.
 *
 * - The resolver rule makes every name and address fail to resolve except `localhost` and
 *   `127.0.0.1`, also on the hops of a redirect, which Playwright's interception does not see.
 *   `^NOTFOUND` is Chromium's token for a failed lookup, so no DNS query goes out.
 * - Without a proxy: Chromium would otherwise use the system's proxy, which resolves names for it,
 *   and a proxy on the local machine passes the resolver rule and would fetch any host for it.
 * - WebRTC sends no UDP outside a proxy, and there is none. It reaches an address written in the
 *   page without the resolver, and neither the interception nor layer 3 sees it.
 */
export const CHROMIUM_ARGS: readonly string[] = [
  '--host-resolver-rules=MAP * ^NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',
  '--no-proxy-server',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
];

export interface PlaywrightBrowserOptions {
  readonly log: Log;
  /** How long Chromium may take to start. 30 seconds by default. */
  readonly launchTimeoutMs?: number;
  /** How long the page may take to fire `load`. 30 seconds by default, Playwright's own default. */
  readonly loadTimeoutMs?: number;
  /** How long a whole visit may take, the caller's work on the page included. 2 minutes by default. */
  readonly visitTimeoutMs?: number;
  /**
   * How long to wait, after `load`, for the page to stop changing. 10 seconds by default, and never
   * more than half of what is left of the visit.
   */
  readonly settleTimeoutMs?: number;
  /** Whether Chromium runs in its sandbox (ADR 0008). True by default. */
  readonly sandbox?: boolean;
  /** Starts Chromium. Tests pass their own, to keep a handle on the browser. */
  readonly launch?: (options: LaunchOptions) => Promise<Browser>;
}

// What Chromium writes when it cannot start in its sandbox: on Linux, when the system does not
// allow the user namespaces that it needs, and when it runs as root. Playwright keeps that line in
// the call log of its error, and puts a line of its own, the second pattern, in the browser logs
// (read in `playwright-core` 1.65.1).
const CHROMIUM_NO_SANDBOX = /No usable sandbox|as root without --no-sandbox/i;
const PLAYWRIGHT_NO_SANDBOX = /Chromium sandboxing failed/i;

/**
 * The browser adapter. Chromium starts on the first visit, so a server that never opens a page
 * never starts it, and starts again on the next visit if it crashes. Each visit gets a context of
 * its own, with service workers blocked, and the URL policy on every request of the page.
 */
export function createPlaywrightBrowser(options: PlaywrightBrowserOptions): BrowserPort {
  const { log } = options;
  const launch = options.launch ?? ((launchOptions) => chromium.launch(launchOptions));
  const launchTimeoutMs = options.launchTimeoutMs ?? 30_000;
  const loadTimeoutMs = options.loadTimeoutMs ?? 30_000;
  const visitTimeoutMs = options.visitTimeoutMs ?? 120_000;
  const settleTimeoutMs = options.settleTimeoutMs ?? 10_000;
  const sandbox = options.sandbox ?? true;
  let started: Promise<Browser> | undefined;
  let closed = false;

  function browser(): Promise<Browser> {
    if (started !== undefined) return started;
    // Playwright passes --no-sandbox unless it is asked for the sandbox.
    const launching = {
      args: [...CHROMIUM_ARGS],
      timeout: launchTimeoutMs,
      chromiumSandbox: sandbox,
    };
    const starting = launch(launching).then(
      (launched) => {
        log(
          `started Chromium ${launched.version()} ${sandbox ? 'in its sandbox' : 'without its sandbox'}`,
        );
        launched.on('disconnected', () => {
          if (started === starting) started = undefined;
        });
        return launched;
      },
      (error: unknown) => {
        if (started === starting) started = undefined;
        throw error;
      },
    );
    started = starting;
    return starting;
  }

  async function open(
    context: BrowserContext,
    url: string,
    deadline: number,
  ): Promise<Visit<LoadedPage>> {
    const refused: RefusedRequest[] = [];
    let documentHop: { readonly url: string; readonly reason: UrlRejection } | undefined;
    const refuse = (entry: RefusedRequest): void => {
      refused.push(entry);
      log(`refused a ${entry.kind} to ${entry.url}: ${entry.reason}`);
    };
    // The interception below applies to this page as to every page of the context.
    const page = await context.newPage();
    // The page's own port (ADR 0009): that of the first document that its main frame commits,
    // reached through the redirects that the policy allowed. It never moves: a later document, as
    // after `location.href = …` to another port, fails the visit as `navigated`, and until then
    // must not write to the port that it came from. Before the first document, the page only reads.
    let own: string | undefined;
    page.on('framenavigated', (frame) => {
      if (own === undefined && frame === page.mainFrame()) own = allowedPort(frame.url());
    });
    const ownPort = (): string | undefined => own;

    // The requests of the page, of its frames, of its popups and of its dedicated workers. Not the
    // hops of a redirect, nor the requests of a shared worker or of speculation rules: see "Limits
    // against ADR 0005" in docs/architecture.md.
    await context.route(
      () => true,
      (route) => {
        const request = route.request();
        const check = checkRequest(request.url(), request.method(), ownPort());
        if (check.allowed) return route.continue();
        refuse({ url: request.url(), reason: check.reason, kind: 'request' });
        return route.abort('blockedbyclient');
      },
    );
    // The WebSockets of the page and its frames. Playwright does not see those of a worker, so the
    // resolver rule is all that keeps them on the local machine, on any port.
    await context.routeWebSocket(
      () => true,
      (socket) => {
        const target = socket.url();
        const check = checkWebSocket(target, ownPort());
        if (check.allowed) {
          socket.connectToServer();
          return;
        }
        refuse({ url: target, reason: check.reason, kind: 'websocket' });
        return socket.close({ code: 1008, reason: 'refused by the URL policy' });
      },
    );
    const network = watchNetwork(context);
    const documents = await watchDocuments(context, page);
    // A hop of a redirect is only reported, after the browser has asked for it. A 307 or a 308
    // keeps the method, so a hop can carry a write to another port. Each hop is listed once, but
    // either source may mark it as the main document's (see redirects.ts).
    await watchRedirects(context, page, documents.session, ({ url, method, toDocument }, isNew) => {
      const check = checkRequest(url, method, ownPort());
      if (check.allowed) return;
      if (isNew) refuse({ url, reason: check.reason, kind: 'redirect' });
      if (toDocument && check.reason !== 'other-port')
        documentHop ??= { url, reason: check.reason };
    });

    let response;
    try {
      response = await page.goto(url, { timeout: loadTimeoutMs });
    } catch (error) {
      // A refused hop explains a failed load better than the network error it caused.
      if (documentHop !== undefined) return refusedHop(documentHop);
      if (error instanceof errors.TimeoutError) return failed({ reason: 'timeout' });
      return failed({ reason: 'load-failed', message: firstLine(error) });
    }
    if (documentHop !== undefined) return refusedHop(documentHop);
    if (response === null) return failed({ reason: 'load-failed', message: 'no response' });

    // The third layer: the address that the browser connected to for the page's document.
    const address = await response.serverAddr();
    if (address === null || !isLocalAddress(address.ipAddress)) {
      return failed({ reason: 'not-local', address: address?.ipAddress ?? 'none' });
    }
    // A page that went to another document after it loaded is not the page asked for: its new
    // document has passed neither layer 3 nor the check of its status. It is not followed.
    if (documents.changed()) return failed({ reason: 'navigated' });
    const isolated = await isolatedWorld(documents);
    const settling = await settle(
      isolated.evaluate,
      network,
      documents,
      Math.min(settleTimeoutMs, (deadline - Date.now()) / 2),
    );
    if (settling === 'navigated') return failed({ reason: 'navigated' });
    return {
      ok: true,
      value: {
        url: response.url(),
        status: response.status(),
        settled: settling === 'settled',
        evaluate: (script) => page.evaluate<unknown>(script),
        evaluateIsolated: isolated.evaluate,
        refusedRequests: () => [...refused],
        keyboard: createKeyboardDriver(page, documents.session, isolated),
      },
    };
  }

  return {
    async visit(url, use, since) {
      const asked = checkUrl(url);
      if (!asked.allowed) return failed({ reason: 'url-policy', url, rejection: asked.reason });
      if (closed) {
        return failed({ reason: 'browser-unavailable', message: 'the browser is closed' });
      }

      let running: Browser;
      let context: BrowserContext;
      let deadline: number;
      try {
        running = await browser();
        deadline = (since ?? Date.now()) + visitTimeoutMs;
        context = await running.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      } catch (error) {
        // Chromium's own line says why the sandbox failed, and Playwright's says only that it did;
        // the first line of the error says neither.
        const lines = String(error).split('\n');
        const why =
          lines.find((line) => CHROMIUM_NO_SANDBOX.test(line)) ??
          lines.find((line) => PLAYWRIGHT_NO_SANDBOX.test(line));
        if (sandbox && why !== undefined) {
          // Playwright dims its call log with terminal codes, and starts each of its lines with a dash.
          const message = stripVTControlCharacters(why).trim().replace(/^- /, '');
          return failed({ reason: 'browser-unavailable', message, sandbox: true });
        }
        return failed({ reason: 'browser-unavailable', message: firstLine(error) });
      }
      // At the limit, the visit stops waiting for the page and the caller, and closing the context
      // ends whatever the page still waits for.
      let timedOut = false;
      let expire = (): void => undefined;
      const expired = new Promise<'expired'>((resolve) => {
        expire = () => {
          resolve('expired');
        };
      });
      const timer = setTimeout(
        () => {
          timedOut = true;
          expire();
          void context.close().catch(() => undefined);
        },
        Math.max(0, deadline - Date.now()),
      );
      // The context closes before the visit ends only when the browser closed or crashed, which is
      // not an error of the caller. Playwright's error can arrive before its events, so after a
      // failure the context is asked once more. A context that does not answer in time counts as
      // still there, and the failure keeps its own reason.
      let contextClosed = false;
      let markClosed = (): void => undefined;
      const contextGone = new Promise<void>((resolve) => {
        markClosed = () => {
          contextClosed = true;
          resolve();
        };
      });
      context.once('close', markClosed);
      running.once('disconnected', markClosed);
      const browserGone = async (): Promise<boolean> => {
        if (contextClosed) return true;
        const answered = context.cookies().then(
          () => false,
          () => true,
        );
        const gone = contextGone.then(() => true);
        return within(
          Promise.race([answered, gone, expired.then(() => false)]),
          CONTEXT_MARGIN_MS,
          false,
        );
      };
      try {
        const page = await Promise.race([open(context, asked.url, deadline), expired]);
        if (page === 'expired' || timedOut) return failed({ reason: 'timeout' });
        if (!page.ok) {
          const gone = await browserGone();
          if (timedOut) return failed({ reason: 'timeout' });
          return gone ? closedDuringVisit() : page;
        }
        const outcome = await Promise.race([use(page.value).then((value) => ({ value })), expired]);
        if (outcome === 'expired') return failed({ reason: 'timeout' });
        return { ok: true, value: outcome.value };
      } catch (error) {
        if (timedOut) return failed({ reason: 'timeout' });
        if (error instanceof PageNavigated) return failed({ reason: 'navigated' });
        const gone = await browserGone();
        if (timedOut) return failed({ reason: 'timeout' });
        if (gone) return closedDuringVisit();
        throw error;
      } finally {
        clearTimeout(timer);
        running.off('disconnected', markClosed);
        // A browser that closed, crashed or stopped answering may never close the context.
        await within(
          Promise.race([context.close().catch(() => undefined), contextGone]),
          CONTEXT_MARGIN_MS,
          undefined,
        );
      }
    },

    async close() {
      closed = true;
      const pending = started;
      started = undefined;
      if (pending === undefined) return;
      const launched = await pending.catch(() => undefined);
      await launched?.close();
      log('closed Chromium');
    },
  };
}

const WORLD_NAME = 'wcag-evidence-mcp';

/**
 * A world of its own in the page's main frame, through the DevTools Protocol. It shares the DOM,
 * which is all that axe-core and the wait need, but none of the page's JavaScript: a page that
 * replaces `window.axe`, `Array.prototype.map` or `MutationObserver` changes only its own world.
 */
async function isolatedWorld(documents: DocumentWatch): Promise<IsolatedWorld> {
  const { session } = documents;
  const { frameTree } = await session.send('Page.getFrameTree');
  const created = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: WORLD_NAME,
  });
  const evaluate = async (script: string): Promise<unknown> => {
    let evaluated;
    try {
      evaluated = await session.send('Runtime.evaluate', {
        expression: script,
        contextId: created.executionContextId,
        awaitPromise: true,
        returnByValue: true,
      });
    } catch (error) {
      // A new document ends the world, and the world is not made again for it.
      if (documents.changed()) throw new PageNavigated();
      throw error;
    }
    if (evaluated.exceptionDetails !== undefined) {
      throw new Error('the script failed in the isolated world');
    }
    const value: unknown = evaluated.result.value;
    return value;
  };
  return { evaluate, contextId: created.executionContextId };
}

/** The page's main frame went to another document after the one asked for had loaded. */
class PageNavigated extends Error {
  constructor() {
    super('the page went to another document after it loaded');
  }
}

interface DocumentWatch {
  readonly session: CDPSession;
  /** Whether the main frame has gone to another document since the one asked for. */
  changed(): boolean;
}

/**
 * Counts the documents that the page's main frame commits. The DevTools Protocol reports a new
 * document (`Page.frameNavigated`) apart from a change of URL within one, which is how an Angular
 * router moves, so only a new document counts. The first is the document asked for.
 */
async function watchDocuments(context: BrowserContext, page: Page): Promise<DocumentWatch> {
  const session = await context.newCDPSession(page);
  let documents = 0;
  session.on('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId === undefined) documents += 1;
  });
  await session.send('Page.enable');
  return { session, changed: () => documents > 1 };
}

// A page counts as settled once its DOM has not changed, and none of its requests has been in
// flight, for this long: the quiet time that Playwright's `networkidle` wait uses.
const SETTLE_WINDOW_MS = 500;
const SETTLE_POLL_MS = 100;

interface Network {
  /** How long no request of the context has been in flight, or 0 while one is. */
  idleFor(): number;
}

function watchNetwork(context: BrowserContext): Network {
  const inflight = new Set<Request>();
  let lastActivity = Date.now();
  context.on('request', (request: Request) => {
    inflight.add(request);
    lastActivity = Date.now();
  });
  const ended = (request: Request): void => {
    inflight.delete(request);
    lastActivity = Date.now();
  };
  context.on('requestfinished', ended);
  context.on('requestfailed', ended);
  return { idleFor: () => (inflight.size > 0 ? 0 : Date.now() - lastActivity) };
}

/**
 * Waits, after `load`, until the page stops changing: an Angular app starts after `load` and
 * often fills a route with data that it asks for later. Gives false when `waitMs` runs out first,
 * so that the audit says it read a page that was still changing.
 */
async function settle(
  isolated: (script: string) => Promise<unknown>,
  network: Network,
  documents: DocumentWatch,
  waitMs: number,
): Promise<'settled' | 'unsettled' | 'navigated'> {
  // The observer lives in the isolated world, where no script of the page can reach it.
  const key = JSON.stringify(`__settle_${randomUUID()}`);
  const quietFor = `(() => {
    if (!Object.hasOwn(window, ${key})) {
      const state = { last: performance.now() };
      new MutationObserver(() => { state.last = performance.now(); }).observe(document, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
      Object.defineProperty(window, ${key}, { value: state });
    }
    return performance.now() - window[${key}].last;
  })()`;
  const until = Date.now() + waitMs;
  for (;;) {
    const domQuietFor = await isolated(quietFor).catch(() => 0);
    if (documents.changed()) return 'navigated';
    const quiet = typeof domQuietFor === 'number' && domQuietFor >= SETTLE_WINDOW_MS;
    if (quiet && network.idleFor() >= SETTLE_WINDOW_MS) return 'settled';
    const left = until - Date.now();
    if (left <= 0) return 'unsettled';
    await new Promise((resolve) => setTimeout(resolve, Math.min(SETTLE_POLL_MS, left)));
  }
}

// How long a context may take to answer or to close once a visit has its outcome. A visit never
// takes longer than its limit and this.
const CONTEXT_MARGIN_MS = 1_000;

/** Settles as `promise` does, or with `fallback` after `ms` milliseconds. */
async function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<F>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

function closedDuringVisit(): Visit<never> {
  return failed({ reason: 'browser-unavailable', message: 'the browser closed during the visit' });
}

function refusedHop(hop: { readonly url: string; readonly reason: UrlRejection }): Visit<never> {
  return failed({ reason: 'url-policy', url: hop.url, rejection: hop.reason });
}

function failed(failure: VisitFailure): Visit<never> {
  return { ok: false, failure };
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0] ?? message;
}
