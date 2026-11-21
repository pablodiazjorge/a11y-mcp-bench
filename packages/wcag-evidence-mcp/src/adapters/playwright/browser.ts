import {
  chromium,
  errors,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
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
import { checkUrl, isLocalAddress } from '../../core/url-policy.ts';

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
  /** Starts Chromium. Tests pass their own, to keep a handle on the browser. */
  readonly launch?: (options: LaunchOptions) => Promise<Browser>;
}

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
  let started: Promise<Browser> | undefined;
  let closed = false;

  function browser(): Promise<Browser> {
    if (started !== undefined) return started;
    const starting = launch({ args: [...CHROMIUM_ARGS], timeout: launchTimeoutMs }).then(
      (launched) => {
        log(`started Chromium ${launched.version()}`);
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

  async function open(context: BrowserContext, url: string): Promise<Visit<LoadedPage>> {
    const refused: RefusedRequest[] = [];
    let documentHop: RefusedRequest | undefined;
    const refuse = (entry: RefusedRequest): void => {
      refused.push(entry);
      log(`refused a ${entry.kind} to ${entry.url}: ${entry.reason}`);
    };

    // The requests of the page, of its frames and of its dedicated workers. Not the hops of a
    // redirect, nor the requests of a shared worker or of speculation rules: see "Limits against
    // ADR 0005" in docs/architecture.md.
    await context.route(
      () => true,
      (route) => {
        const target = route.request().url();
        const check = checkUrl(target);
        if (check.allowed) return route.continue();
        refuse({ url: target, reason: check.reason, kind: 'request' });
        return route.abort('blockedbyclient');
      },
    );
    // The WebSockets of the page and its frames. Playwright does not see those of a worker, so the
    // resolver rule is all that keeps them on the local machine.
    await context.routeWebSocket(
      () => true,
      (socket) => {
        const target = socket.url();
        const check = checkUrl(asHttp(target));
        if (check.allowed) {
          socket.connectToServer();
          return;
        }
        refuse({ url: target, reason: check.reason, kind: 'websocket' });
        return socket.close({ code: 1008, reason: 'refused by the URL policy' });
      },
    );
    const page = await context.newPage();
    // A hop of a redirect is only reported, after the browser has asked for it.
    context.on('request', (request: Request) => {
      if (request.redirectedFrom() === null) return;
      const check = checkUrl(request.url());
      if (check.allowed) return;
      const entry: RefusedRequest = { url: request.url(), reason: check.reason, kind: 'redirect' };
      refuse(entry);
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documentHop ??= entry;
      }
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
    return {
      ok: true,
      value: {
        url: response.url(),
        status: response.status(),
        evaluate: (script) => page.evaluate<unknown>(script),
        refusedRequests: () => [...refused],
      },
    };
  }

  return {
    async visit(url, use) {
      const asked = checkUrl(url);
      if (!asked.allowed) return failed({ reason: 'url-policy', url, rejection: asked.reason });
      if (closed) {
        return failed({ reason: 'browser-unavailable', message: 'the browser is closed' });
      }

      let running: Browser;
      let context: BrowserContext;
      try {
        running = await browser();
        context = await running.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      } catch (error) {
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
      const timer = setTimeout(() => {
        timedOut = true;
        expire();
        void context.close().catch(() => undefined);
      }, visitTimeoutMs);
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
        return within(Promise.race([answered, gone, expired.then(() => false)]), SETTLE_MS, false);
      };
      try {
        const page = await Promise.race([open(context, asked.url), expired]);
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
          SETTLE_MS,
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

// How long a context may take to answer or to close once a visit has its outcome. A visit never
// takes longer than its limit and this.
const SETTLE_MS = 1_000;

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

/**
 * The policy allows a WebSocket exactly where it allows `http`, so a `ws` URL is checked as the
 * `http` URL with the same host, port and path. Any other scheme, `wss` included, is refused.
 */
function asHttp(url: string): string {
  return url.startsWith('ws:') ? `http:${url.slice('ws:'.length)}` : url;
}

function closedDuringVisit(): Visit<never> {
  return failed({ reason: 'browser-unavailable', message: 'the browser closed during the visit' });
}

function refusedHop(hop: RefusedRequest): Visit<never> {
  return failed({ reason: 'url-policy', url: hop.url, rejection: hop.reason });
}

function failed(failure: VisitFailure): Visit<never> {
  return { ok: false, failure };
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0] ?? message;
}
