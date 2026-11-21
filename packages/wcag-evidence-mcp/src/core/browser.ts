// The browser port (ADR 0004): what the core needs from a browser to look at one local page. The
// adapter behind it applies the URL policy of ADR 0005 to the page and to every request it makes.

import type { UrlRejection } from './url-policy.ts';

/** A request of the page that the URL policy refused. */
export interface RefusedRequest {
  /** The URL as the browser wrote it. */
  readonly url: string;
  readonly reason: UrlRejection;
  /**
   * `request` and `websocket` were stopped before they left the browser. A `redirect` hop cannot be
   * stopped, only seen: Chromium's resolver stops it when its host is not local, and a local hop
   * that fails `checkUrl` reaches its destination.
   */
  readonly kind: 'request' | 'redirect' | 'websocket';
}

/** A page that loaded from an allowed URL, served from a local address. */
export interface LoadedPage {
  /** The URL of the page's document after any redirect, as the browser writes it. */
  readonly url: string;
  /** The HTTP status of the page's document. */
  readonly status: number;
  /**
   * Whether, after `load`, the page went a short while with no change to its DOM and no request in
   * flight before the browser's wait ran out. Content that arrives later, such as on a timer, can
   * still be missing.
   */
  readonly settled: boolean;
  /** Runs `script` in the page and returns its result, which must be serializable as JSON. */
  evaluate(script: string): Promise<unknown>;
  /**
   * Runs `script` in a world of its own: it shares the page's DOM, but none of the page's
   * JavaScript, so a script of the page cannot replace or change what this one uses. The result
   * must be serializable as JSON.
   */
  evaluateIsolated(script: string): Promise<unknown>;
  /** The requests that the URL policy refused so far, in the order the page made them. */
  refusedRequests(): readonly RefusedRequest[];
}

/** Why a page was not opened. Each `reason` is stable, so a message or a test can rely on it. */
export type VisitFailure =
  /** The URL asked for, or a redirect hop of the page's document, fails `checkUrl`. */
  | { readonly reason: 'url-policy'; readonly url: string; readonly rejection: UrlRejection }
  /** The document came from an address other than `127.0.0.1` or `::1`, or from none. */
  | { readonly reason: 'not-local'; readonly address: string }
  /**
   * The page went to another document after the one asked for had loaded, as through a redirect
   * in a script. The new document is not audited: it passed neither layer 3 nor the status check.
   */
  | { readonly reason: 'navigated' }
  /** The browser could not load the page, as when nothing listens on the port. */
  | { readonly reason: 'load-failed'; readonly message: string }
  /** The page did not load in time, or the whole visit took too long. */
  | { readonly reason: 'timeout' }
  /** The browser could not be started, was closed, or closed or crashed during the visit. */
  | { readonly reason: 'browser-unavailable'; readonly message: string };

export type Visit<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: VisitFailure };

/** One browser, shared by every call of the server. */
export interface BrowserPort {
  /**
   * Opens `url` in a context of its own (no cookies or storage shared with another visit), passes
   * the loaded page to `use`, and closes the context when `use` settles.
   */
  visit<T>(url: string, use: (page: LoadedPage) => Promise<T>): Promise<Visit<T>>;
  /** Closes the browser. A visit after this fails with `browser-unavailable`. */
  close(): Promise<void>;
}
