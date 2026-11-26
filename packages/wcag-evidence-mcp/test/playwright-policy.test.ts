// The URL policy in the browser adapter (ADR 0005), against local test sites: what reaches a site
// and what the adapter reports. Layers 2 and 3 overlap, so each test that guards one of them uses
// a request that only that part stops. Needs Chromium: `npm run browser:install`.

import { createSocket } from 'node:dgram';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import type { BrowserPort, RefusedRequest, Visit } from '../src/core/browser.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test; each one takes well under a second here.
const TIMEOUT_MS = 30_000;
const BACKSLASH = String.fromCharCode(0x5c);

let site: LocalSite;
// Another host, which the policy refuses. Chromium could reach it: the whole of 127.0.0.0/8 is the
// local machine on Linux and Windows.
let other: LocalSite;
let browser: BrowserPort;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  other = await startSite('127.0.0.2');
  browser = createPlaywrightBrowser({ log: () => undefined });
}, TIMEOUT_MS);

afterAll(async () => {
  await browser.close();
  await site.close();
  await other.close();
}, TIMEOUT_MS);

interface Seen {
  readonly url: string;
  readonly status: number;
  readonly value: unknown;
  readonly refused: readonly RefusedRequest[];
}

/** Opens `url`, runs `script` in the page and keeps what the visit reported. */
function look(url: string, script = 'document.title'): Promise<Visit<Seen>> {
  return browser.visit(url, async (page) => ({
    url: page.url,
    status: page.status,
    value: await page.evaluate(script),
    refused: page.refusedRequests(),
  }));
}

function seen(visit: Visit<Seen>): Seen {
  if (!visit.ok) throw new Error(`the visit failed: ${JSON.stringify(visit.failure)}`);
  return visit.value;
}

/** A page script that opens a WebSocket and keeps how it ended up in `window.socket`. */
function socketPage(url: string): string {
  return `<script>
    window.socket = new Promise((resolve) => {
      const socket = new WebSocket(${JSON.stringify(url)});
      socket.onopen = () => resolve('open');
      socket.onerror = () => resolve('error');
      socket.onclose = (event) => resolve('closed ' + event.code);
    });
  </script>`;
}

describe('a visit', { timeout: TIMEOUT_MS }, () => {
  it('opens an allowed page and reads it', async () => {
    site.page('/hello', '<title>hello</title>');

    const page = seen(await look(`${site.origin}/hello`));

    expect(page).toStrictEqual({
      url: `${site.origin}/hello`,
      status: 200,
      value: 'hello',
      refused: [],
    });
  });

  it('opens the URL as the parser writes it, and reports the status of the document', async () => {
    const page = seen(await look(`http://127.0.0.1:${String(site.port)}`));

    expect(page.url).toBe(`${site.origin}/`);
    expect(page.status).toBe(404);
  });

  it('gives each visit a context of its own, with no cookie or storage from another', async () => {
    site.page('/store', '<title>store</title>');
    const store = "document.cookie = 'kept=yes'; localStorage.setItem('kept', 'yes'); 'stored'";
    const read = "[document.cookie, localStorage.getItem('kept')]";

    const [first, second] = await Promise.all([
      look(`${site.origin}/store`, store),
      look(`${site.origin}/store`, read),
    ]);
    const third = await look(`${site.origin}/store`, read);

    expect(seen(first).value).toBe('stored');
    expect(seen(second).value).toStrictEqual(['', null]);
    expect(seen(third).value).toStrictEqual(['', null]);
  });

  it('refuses a URL that fails checkUrl, and nothing reaches the site', async () => {
    const visit = await look(`http://127.1:${String(site.port)}/short`);

    expect(visit).toStrictEqual({
      ok: false,
      failure: {
        reason: 'url-policy',
        url: `http://127.1:${String(site.port)}/short`,
        rejection: 'not-as-written',
      },
    });
    expect(site.hits('/short')).toBe(0);
  });
});

describe('the requests of a page', { timeout: TIMEOUT_MS }, () => {
  it('are cut when checkUrl refuses them, even when the host resolves', async () => {
    const refusedUrl = `${site.origin}/cut?q=${BACKSLASH}x`;
    site.page(
      '/cut-page',
      `<img src="${refusedUrl}"><img src="${site.origin}/kept"><img src="${other.origin}/away">`,
    );

    const page = seen(await look(`${site.origin}/cut-page`));

    expect(site.hits('/cut')).toBe(0);
    expect(site.hits('/kept')).toBe(1);
    expect(other.hits('/away')).toBe(0);
    expect(page.refused).toStrictEqual([
      { url: refusedUrl, reason: 'unusual-character', kind: 'request' },
      { url: `${other.origin}/away`, reason: 'host', kind: 'request' },
    ]);
  });

  it('are checked in frames and workers that have no network address of their own', async () => {
    const workerUrl = `${site.origin}/from-worker?q=${BACKSLASH}x`;
    const worker = `fetch(${JSON.stringify(workerUrl)}).then(() => postMessage('fetched'), () => postMessage('failed'))`;
    site.page(
      '/frames',
      [
        '<img id="data" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
        '<iframe src="about:blank"></iframe>',
        `<iframe srcdoc="<img src='${site.origin}/from-srcdoc'><img src='${other.origin}/srcdoc-away'>"></iframe>`,
        '<script>',
        `const html = new Blob(["<img src=${site.origin}/from-blob>"], { type: 'text/html' });`,
        "const frame = document.createElement('iframe');",
        'frame.src = URL.createObjectURL(html);',
        'document.body.append(frame);',
        `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));`,
        'window.worker = new Promise((resolve) => { worker.onmessage = (event) => resolve(event.data); });',
        '</script>',
      ].join(''),
    );
    const read = "Promise.all([window.worker, document.getElementById('data').naturalWidth])";

    const page = seen(await look(`${site.origin}/frames`, read));

    expect(page.value).toStrictEqual(['failed', 1]);
    expect(site.hits('/from-srcdoc')).toBe(1);
    expect(site.hits('/from-blob')).toBe(1);
    expect(site.hits('/from-worker')).toBe(0);
    expect(other.hits('/srcdoc-away')).toBe(0);
    // The frame and the worker load at the same time, so the order of their refusals varies.
    expect(page.refused.map(({ url, kind }) => `${kind} ${url}`).sort()).toStrictEqual([
      `request ${site.origin}/from-worker?q=${BACKSLASH}x`,
      `request ${other.origin}/srcdoc-away`,
    ]);
  });

  it('are checked in a popup too, which opens in the same context', async () => {
    const refusedUrl = `${site.origin}/popup-cut?q=${BACKSLASH}x`;
    site.page(
      '/popup-page',
      `<script>window.open(${JSON.stringify(refusedUrl)}); window.open(${JSON.stringify(`${other.origin}/popup-away`)});</script>`,
    );

    // Long enough for both popups to ask for their pages.
    const page = seen(
      await look(
        `${site.origin}/popup-page`,
        "new Promise((resolve) => setTimeout(() => resolve('waited'), 1000))",
      ),
    );

    expect(site.hits('/popup-cut')).toBe(0);
    expect(other.hits('/popup-away')).toBe(0);
    expect([...page.refused].sort((a, b) => a.url.localeCompare(b.url))).toStrictEqual([
      { url: refusedUrl, reason: 'unusual-character', kind: 'request' },
      { url: `${other.origin}/popup-away`, reason: 'host', kind: 'request' },
    ]);
  });

  it('cannot register a service worker', async () => {
    site.handle('/sw.js', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end('');
    });
    site.page('/service-worker', '<title>service worker</title>');
    const register = `Promise.race([
      navigator.serviceWorker.register('/sw.js').then(() => 'settled', () => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 1000)),
    ])`;

    await look(`${site.origin}/service-worker`, register);

    expect(site.hits('/sw.js')).toBe(0);
  });
});

describe('a redirect', { timeout: TIMEOUT_MS }, () => {
  it('is followed when every hop passes checkUrl', async () => {
    site.page('/landing', '<title>landing</title>');
    site.redirect('/moved', `${site.origin}/landing`);

    const page = seen(await look(`${site.origin}/moved`));

    expect(page.url).toBe(`${site.origin}/landing`);
    expect(page.value).toBe('landing');
  });

  it('to another host is stopped by the resolver, which Playwright cannot see', async () => {
    site.redirect('/leave', `${other.origin}/elsewhere`);

    const visit = await look(`${site.origin}/leave`);

    expect(visit).toStrictEqual({
      ok: false,
      failure: { reason: 'url-policy', url: `${other.origin}/elsewhere`, rejection: 'host' },
    });
    expect(other.hits('/elsewhere')).toBe(0);
  });

  it('of a subresource to another host is stopped too, and reported', async () => {
    site.redirect('/image-moved', `${other.origin}/image`);
    site.page('/with-image', '<img src="/image-moved">');

    const page = seen(await look(`${site.origin}/with-image`));

    expect(other.hits('/image')).toBe(0);
    expect(page.refused).toStrictEqual([
      { url: `${other.origin}/image`, reason: 'host', kind: 'redirect' },
    ]);
  });

  it('that stays local but fails checkUrl is seen, not stopped, and the visit fails', async () => {
    const target = `${site.origin}/local-target?q=${BACKSLASH}x`;
    site.redirect('/local-hop', target);
    site.page('/local-target', '<title>reached</title>');

    const visit = await look(`${site.origin}/local-hop`);

    expect(visit).toStrictEqual({
      ok: false,
      failure: { reason: 'url-policy', url: target, rejection: 'unusual-character' },
    });
    expect(site.hits('/local-target')).toBe(1);
  });

  it('of a frame that fails checkUrl is listed, and the page still opens', async () => {
    const target = `${site.origin}/frame-target?q=${BACKSLASH}x`;
    site.redirect('/frame-hop', target);
    site.page('/with-frame', '<title>with frame</title><iframe src="/frame-hop"></iframe>');

    const page = seen(await look(`${site.origin}/with-frame`));

    expect(page.value).toBe('with frame');
    expect(page.refused).toStrictEqual([
      { url: target, reason: 'unusual-character', kind: 'redirect' },
    ]);
    expect(site.hits('/frame-target')).toBe(1);
  });
});

describe('a WebSocket', { timeout: TIMEOUT_MS }, () => {
  it('opens when checkUrl allows its URL read as http, as for a development server', async () => {
    site.page('/socket-ok', socketPage(`ws://127.0.0.1:${String(site.port)}/live`));

    const page = seen(await look(`${site.origin}/socket-ok`, 'window.socket'));

    expect(page.value).toBe('open');
    expect(site.hits('/live')).toBe(1);
  });

  it('is closed before it leaves the browser when checkUrl refuses it', async () => {
    const refusedUrl = `ws://127.0.0.1:${String(site.port)}/socket?q=${BACKSLASH}x`;
    site.page('/socket-refused', socketPage(refusedUrl));

    const page = seen(await look(`${site.origin}/socket-refused`, 'window.socket'));

    expect(page.value).toBe('closed 1008');
    expect(site.hits('/socket')).toBe(0);
    expect(page.refused).toStrictEqual([
      { url: refusedUrl, reason: 'unusual-character', kind: 'websocket' },
    ]);
  });
});

describe('WebRTC', { timeout: TIMEOUT_MS }, () => {
  it('sends no UDP packet, which neither the interception nor the resolver rule would see', async () => {
    const receiver = createSocket('udp4');
    let packets = 0;
    receiver.on('message', () => {
      packets += 1;
    });
    await new Promise<void>((resolve) => {
      receiver.bind(0, '127.0.0.2', resolve);
    });
    try {
      const server = `127.0.0.2:${String(receiver.address().port)}`;
      site.page(
        '/webrtc',
        `<script>
          window.gathered = (async () => {
            const connection = new RTCPeerConnection({ iceServers: [
              { urls: 'stun:${server}' },
              { urls: 'turn:${server}?transport=udp', username: 'name', credential: 'secret' },
            ] });
            connection.createDataChannel('data');
            await connection.setLocalDescription(await connection.createOffer());
            await new Promise((resolve) => {
              connection.onicegatheringstatechange = () => {
                if (connection.iceGatheringState === 'complete') resolve();
              };
              setTimeout(resolve, 3000);
            });
            return 'gathered';
          })();
        </script>`,
      );

      const page = seen(await look(`${site.origin}/webrtc`, 'window.gathered'));

      expect(page.value).toBe('gathered');
      expect(packets).toBe(0);
    } finally {
      receiver.close();
    }
  });
});

describe('a page that goes to another document after it loaded', { timeout: TIMEOUT_MS }, () => {
  // A page with a defect that sends the browser elsewhere once it has loaded.
  const leaving = (go: string): string =>
    `<title>leaving</title><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><script>addEventListener('load', () => { ${go} });</script>`;

  it.each([
    [
      '/leaving-blank',
      'to about:blank, after a moment',
      "setTimeout(() => { location.href = 'about:blank'; }, 400);",
    ],
    [
      '/leaving-later',
      'to a clean local page, after a moment',
      "setTimeout(() => { location.href = '/clean'; }, 400);",
    ],
    ['/leaving-now', 'to a clean local page, at once', "location.href = '/clean';"],
  ])('fails with navigated when %s goes %s', async (path, _case, go) => {
    site.page('/clean', '<title>clean</title>');
    site.page(path, leaving(go));

    expect(await look(`${site.origin}${path}`)).toStrictEqual({
      ok: false,
      failure: { reason: 'navigated' },
    });
  });

  it('is audited when it only changes its URL within the same document, as a router does', async () => {
    site.page('/routing', leaving("history.pushState({}, '', '/routed');"));

    const visit = seen(await look(`${site.origin}/routing`, 'location.pathname'));

    expect(visit.value).toBe('/routed');
  });
});

describe('the address of the page', { timeout: TIMEOUT_MS }, () => {
  it('must be the local machine, even when a name resolves to another address', async () => {
    // Told to resolve `localhost` to 127.0.0.2, Chromium stands for a resolver that let a name
    // through to another host, as a DNS answer that changes after the check would.
    const misled = createPlaywrightBrowser({
      log: () => undefined,
      launch: (options) =>
        chromium.launch({ ...options, args: ['--host-resolver-rules=MAP localhost 127.0.0.2'] }),
    });
    try {
      other.page('/misled', '<title>misled</title>');

      const visit = await misled.visit(`http://localhost:${String(other.port)}/misled`, () =>
        Promise.resolve('read'),
      );

      expect(visit).toStrictEqual({
        ok: false,
        failure: { reason: 'not-local', address: '127.0.0.2' },
      });
      expect(other.hits('/misled')).toBe(1);
    } finally {
      await misled.close();
    }
  });

  it('may be ::1, where a development server can listen alone', async () => {
    const ipv6 = await startSite('::1');
    try {
      ipv6.page('/ipv6', '<title>ipv6</title>');

      const page = seen(await look(`http://localhost:${String(ipv6.port)}/ipv6`));

      expect(page.value).toBe('ipv6');
      expect(ipv6.hits('/ipv6')).toBe(1);
    } finally {
      await ipv6.close();
    }
  });
});
