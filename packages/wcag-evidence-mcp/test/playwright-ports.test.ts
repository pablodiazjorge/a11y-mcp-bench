// The port rule of ADR 0009 in a real Chromium: a page may read from any allowed port, but write
// only to its own. Two local servers, the page's and another on the same host, record each method
// that reaches them. Needs Chromium: `npm run browser:install`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import type { BrowserPort, RefusedRequest } from '../src/core/browser.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test; each one takes about two seconds here.
const TIMEOUT_MS = 30_000;

let site: LocalSite;
// Another local service, as an API or a database console on another port of the same host.
let api: LocalSite;
let browser: BrowserPort;
// Each request that reached a server, as `METHOD /path`.
const reached: { site: string[]; api: string[] } = { site: [], api: [] };

/** Records the request and answers it, with the headers that let any page read it. */
function recorder(into: string[]) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    into.push(`${request.method ?? ''} ${new URL(request.url ?? '/', 'http://site').pathname}`);
    response.writeHead(200, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': '*',
      'access-control-allow-headers': '*',
      'content-type': 'text/plain',
    });
    response.end('ok');
  };
}

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  api = await startSite('127.0.0.1');
  browser = createPlaywrightBrowser({ log: () => undefined });
}, TIMEOUT_MS);

afterAll(async () => {
  await browser.close();
  await site.close();
  await api.close();
}, TIMEOUT_MS);

interface Seen {
  readonly value: unknown;
  readonly refused: readonly RefusedRequest[];
}

/**
 * Opens `path` on the page's server and runs `script`. Then it waits until the visit has refused
 * `refusals` requests, since the page does not wait for its beacon or its form, and keeps what the
 * visit reported.
 */
async function look(path: string, script: string, refusals = 0): Promise<Seen> {
  const visit = await browser.visit(`${site.origin}${path}`, async (page) => {
    const value = await page.evaluate(script);
    const until = Date.now() + 10_000;
    while (page.refusedRequests().length < refusals && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { value, refused: page.refusedRequests() };
  });
  if (!visit.ok) throw new Error(`the visit failed: ${JSON.stringify(visit.failure)}`);
  return visit.value;
}

/** The refusals as `kind reason URL`, sorted, since requests that run together end in any order. */
function listed(refused: readonly RefusedRequest[]): string[] {
  return refused.map(({ kind, reason, url }) => `${kind} ${reason} ${url}`).sort();
}

describe('a page', { timeout: TIMEOUT_MS }, () => {
  it('reads from another local port, but every way it has to write there is cut', async () => {
    const paths = [
      '/fetch',
      '/keepalive',
      '/beacon',
      '/put',
      '/patch',
      '/delete',
      '/form',
      '/from-frame',
      '/from-worker',
      '/read',
      '/head',
      '/options',
    ];
    for (const path of paths) api.handle(path, recorder(reached.api));
    site.handle('/own', recorder(reached.site));
    const post = (path: string, extra = '') =>
      `fetch(${JSON.stringify(`${api.origin}${path}`)}, { method: 'POST', body: 'x'${extra} })`;
    site.page('/frame', `<script>${post('/from-frame')}.catch(() => undefined);</script>`);
    const worker = `${post('/from-worker')}.then(() => postMessage('sent'), () => postMessage('cut'))`;
    site.page(
      '/writer',
      [
        '<iframe name="sink"></iframe>',
        `<iframe src="${site.origin}/frame"></iframe>`,
        `<form id="form" method="post" action="${api.origin}/form" target="sink"><input name="a" value="1"></form>`,
        '<script>',
        `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));`,
        'const fromWorker = new Promise((resolve) => { worker.onmessage = (event) => resolve(event.data); });',
        `navigator.sendBeacon(${JSON.stringify(`${api.origin}/beacon`)}, 'x');`,
        "document.getElementById('form').submit();",
        'const outcome = (request) => request.then((response) => response.status, () => "cut");',
        'window.done = Promise.all([',
        `  outcome(${post('/fetch')}),`,
        `  outcome(${post('/keepalive', ', keepalive: true')}),`,
        `  outcome(fetch(${JSON.stringify(`${api.origin}/put`)}, { method: 'PUT', body: 'x' })),`,
        `  outcome(fetch(${JSON.stringify(`${api.origin}/patch`)}, { method: 'patch', body: 'x' })),`,
        `  outcome(fetch(${JSON.stringify(`${api.origin}/delete`)}, { method: 'DELETE' })),`,
        `  outcome(fetch(${JSON.stringify(`${api.origin}/read`)})),`,
        `  outcome(fetch(${JSON.stringify(`${api.origin}/head`)}, { method: 'HEAD' })),`,
        `  outcome(fetch(${JSON.stringify(`${api.origin}/options`)}, { method: 'OPTIONS' })),`,
        `  outcome(fetch(${JSON.stringify(`${site.origin}/own`)}, { method: 'POST', body: 'x' })),`,
        '  fromWorker,',
        ']);',
        '</script>',
      ].join(''),
    );

    const page = await look('/writer', 'window.done', 9);

    expect(page.value).toStrictEqual([
      'cut',
      'cut',
      'cut',
      'cut',
      'cut',
      200,
      200,
      200,
      200,
      'cut',
    ]);
    // Only the reads of the page reached the other port. While it intercepts, Playwright answers
    // the browser's preflights of the PUT, the PATCH and the DELETE itself, and allows them.
    expect([...reached.api].sort()).toStrictEqual(['GET /read', 'HEAD /head', 'OPTIONS /options']);
    expect(reached.site).toStrictEqual(['POST /own']);
    expect(listed(page.refused)).toStrictEqual(
      [
        '/beacon',
        '/delete',
        '/fetch',
        '/form',
        '/from-frame',
        '/from-worker',
        '/keepalive',
        '/patch',
        '/put',
      ].map((path) => `request other-port ${api.origin}${path}`),
    );
  });

  it('opens a WebSocket to its own port only', async () => {
    const socket = (origin: string) => `new Promise((resolve) => {
      const socket = new WebSocket(${JSON.stringify(`${origin.replace('http:', 'ws:')}/socket`)});
      socket.onopen = () => resolve('open');
      socket.onclose = (event) => resolve('closed ' + String(event.code));
    })`;
    site.page('/sockets', '<title>sockets</title>');

    const page = await look(
      '/sockets',
      `Promise.all([${socket(site.origin)}, ${socket(api.origin)}])`,
    );

    expect(page.value).toStrictEqual(['open', 'closed 1008']);
    expect(site.hits('/socket')).toBe(1);
    expect(api.hits('/socket')).toBe(0);
    expect(listed(page.refused)).toStrictEqual([
      `websocket other-port ${api.origin.replace('http:', 'ws:')}/socket`,
    ]);
  });

  it('keeps its own port when it goes to a document on another port, which cannot write there', async () => {
    const moved: string[] = [];
    for (const path of ['/x', '/after']) api.handle(path, recorder(moved));
    // The new document writes to its own origin, then reads, once the write has settled.
    api.page(
      '/nav-target',
      `<script>fetch(location.origin + '/x', { method: 'POST', body: 'x' }).catch(() => undefined).finally(() => fetch(location.origin + '/after'));</script>`,
    );
    site.page('/mover', '<title>mover</title>');
    const target = JSON.stringify(`${api.origin}/nav-target`);

    // The page goes to the other port while the caller works, so the visit is still open when the
    // new document writes; a navigation before that fails the visit as `navigated`.
    const visit = await browser.visit(`${site.origin}/mover`, async (page) => {
      await page.evaluate(`setTimeout(() => { location.href = ${target}; }, 0); 'going'`);
      const until = Date.now() + 10_000;
      while (!moved.includes('GET /after') && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return page.refusedRequests();
    });

    expect(api.hits('/nav-target')).toBe(1);
    expect(moved).toStrictEqual(['GET /after']);
    expect(visit.ok && listed(visit.value)).toStrictEqual([`request other-port ${api.origin}/x`]);
  });

  it('can still write to another port through a redirect of its own server, which is only seen', async () => {
    const bounced: string[] = [];
    api.handle('/bounced', recorder(bounced));
    site.handle('/bounce', (_request, response) => {
      response.writeHead(307, { location: `${api.origin}/bounced` });
      response.end();
    });
    site.page('/bouncer', '<title>bouncer</title>');
    const send = `fetch(${JSON.stringify(`${site.origin}/bounce`)}, { method: 'POST', body: 'x' }).then((response) => response.status, () => 'cut')`;

    const page = await look('/bouncer', send);

    // Playwright's interception does not see the hops of a redirect (ADR 0005), and a 307 keeps
    // the method: the POST reaches the other port, and the visit reports it.
    expect(page.value).toBe(200);
    expect(bounced).toStrictEqual(['POST /bounced']);
    expect(listed(page.refused)).toStrictEqual([`redirect other-port ${api.origin}/bounced`]);
  });
});
