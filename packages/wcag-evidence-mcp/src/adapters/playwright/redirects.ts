// The hops of the redirects that a visit's page makes, which the URL policy checks after the
// browser has asked for them (ADR 0009): Playwright's interception does not see them (ADR 0005).
//
// Playwright drives Chromium through the Chrome DevTools Protocol (CDP), the messages that
// Chrome's developer tools also use. Playwright's own report of a hop can go missing, so the
// hops come from two sources, and each hop counts once:
// - Playwright's `request` event, for the pages, frames, popups and workers of the context. It
//   misses a hop when two messages of CDP about it arrive in one order rather than the other:
//   when the pause of the interception (`Fetch.requestPaused`) comes before the notice of the
//   redirect (`Network.requestWillBeSent` with its `redirectResponse`). Chromium leaves
//   `redirectedRequestId` out of the pause, so Playwright takes it for a second pause of the
//   request that it has already continued, and sends no event for the hop. Observed with
//   playwright-core 1.65.1 in 1 of 150 and 1 of 300 hops, and in 7 of 400 with another listener
//   of CDP on the page, in a probe that made one hop per visit.
// - CDP's notice of the redirect itself, on the page's own session, which Chromium sends for every
//   hop of the page and of the frames in its process.
//
// The second source does not reach workers, popups or frames in another process: for their hops,
// Playwright's event is the only report, and its rare miss remains.

import type { BrowserContext, CDPSession, Page, Request } from 'playwright-core';

/** A hop of a redirect: where it came from, where it goes and with what method. */
export interface Hop {
  readonly from: string;
  readonly url: string;
  readonly method: string;
  /** Whether the hop loads the document of the page's main frame, which fails the visit. */
  readonly toDocument: boolean;
}

/**
 * The hops seen by the two sources, so that a hop that both see counts once. A step is a method
 * with both URLs, the one redirected from and the one redirected to. Each source counts the hops
 * of each step, and the hops listed are the larger of the two counts:
 * - hops of one step cannot be paired across the sources, which give them no common id;
 * - either source may miss a hop, and neither makes one up;
 * - adding the two counts would list twice every hop that both see;
 * - a single set of steps would list once a fetch that goes through the same redirect twice.
 */
export interface HopCounter {
  /**
   * Counts a hop from `from` to `url` with `method`, seen by `source`, and says whether it is
   * new: whether its source's count of the step now passes the hops already listed for it.
   */
  seen(source: 'playwright' | 'protocol', from: string, url: string, method: string): boolean;
}

export function countHops(): HopCounter {
  const counts = { playwright: new Map<string, number>(), protocol: new Map<string, number>() };
  const reported = new Map<string, number>();
  // The fragment, the part after `#`, is not sent, and only Playwright's URL keeps it.
  const withoutFragment = (url: string) => url.split('#', 1)[0] ?? url;
  return {
    seen(source, from, url, method) {
      const step = `${method} ${withoutFragment(from)} ${withoutFragment(url)}`;
      const count = (counts[source].get(step) ?? 0) + 1;
      counts[source].set(step, count);
      if (count <= (reported.get(step) ?? 0)) return false;
      reported.set(step, count);
      return true;
    },
  };
}

/**
 * Calls `onHop` for each hop of a redirect of the visit that either source sees, from the moment
 * it returns, which must be before the page loads anything. `isNew` is true once per hop, for the
 * list of refused requests. Each source still passes each hop that it sees, so that either one
 * can say that a hop belongs to the main frame's document, which fails the visit. `session` is a
 * CDP session on `page`, with the `Page` domain, CDP's group of page messages, enabled.
 */
export async function watchRedirects(
  context: BrowserContext,
  page: Page,
  session: CDPSession,
  onHop: (hop: Hop, isNew: boolean) => void,
): Promise<void> {
  const hops = countHops();
  const { frameTree } = await session.send('Page.getFrameTree');
  context.on('request', (request: Request) => {
    const from = request.redirectedFrom();
    if (from === null) return;
    const isNew = hops.seen('playwright', from.url(), request.url(), request.method());
    const hop = {
      from: from.url(),
      url: request.url(),
      method: request.method(),
      toDocument: request.isNavigationRequest() && request.frame() === page.mainFrame(),
    };
    onHop(hop, isNew);
  });
  session.on('Network.requestWillBeSent', (event) => {
    const { redirectResponse, request } = event;
    if (redirectResponse === undefined) return;
    const isNew = hops.seen('protocol', redirectResponse.url, request.url, request.method);
    const hop = {
      from: redirectResponse.url,
      url: request.url,
      method: request.method,
      toDocument: event.type === 'Document' && event.frameId === frameTree.frame.id,
    };
    onHop(hop, isNew);
  });
  await session.send('Network.enable');
}
