// audit_route with Chromium and axe-core on a page with known failures: the output must equal the
// reference in fixtures/reference-output.json, which was checked by hand against the page. Needs
// Chromium: `npm run browser:install`.

import { readFileSync } from 'node:fs';
import axe from 'axe-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { createAxeRuleEngine } from '../src/adapters/axe/rule-engine.ts';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import {
  auditOutputSchema,
  auditRoute,
  CRITERION_IDS,
  OUTPUT_CAP,
  type AuditOutput,
  type AuditPorts,
} from '../src/core/audit.ts';
import { startSite, type LocalSite } from './local-site.ts';
import { MODERN_VERSION, openSession, type Session } from './session.ts';

// Generous, so a slow CI machine does not fail a test; an audit takes about a second here.
const TIMEOUT_MS = 60_000;
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const PAGE = fixture('reference-page.html');
const REFERENCE = auditOutputSchema.parse(JSON.parse(fixture('reference-output.json')));
// The page again, with other numbers in Angular's style attributes and in the dialog's id, as
// another build of the app or another visit would give.
const RENUMBERED = PAGE.replaceAll('1111111111', '3333333333')
  .replaceAll('2222222222', '4444444444')
  .replace('cdk-dialog-0', 'cdk-dialog-5');
const IMAGE =
  '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width: 30px; height: 30px">';

let site: LocalSite;
let ports: AuditPorts;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  site.page('/reference', PAGE);
  site.page('/renumbered/reference', RENUMBERED);
  site.page(
    '/many',
    `<!doctype html><html lang="en"><title>Many</title>${IMAGE.repeat(120)}</html>`,
  );
  ports = {
    browser: createPlaywrightBrowser({ log: () => undefined }),
    engine: createAxeRuleEngine(),
  };
}, TIMEOUT_MS);

afterAll(async () => {
  await ports.browser.close();
  await site.close();
}, TIMEOUT_MS);

async function audit(path: string, criteria?: readonly string[]): Promise<AuditOutput> {
  const result = await auditRoute(ports, { url: `${site.origin}${path}`, criteria });
  if (!result.ok) throw new Error(`the audit failed: ${JSON.stringify(result.failure)}`);
  return result.output;
}

describe('audit_route on the reference page', { timeout: TIMEOUT_MS }, () => {
  it('gives the reference output, twice in a row', async () => {
    expect(await audit('/reference')).toStrictEqual(REFERENCE);
    expect(await audit('/reference')).toStrictEqual(REFERENCE);
  });

  it('reports no result to review and no criterion outside the twelve', () => {
    for (const { criteria } of REFERENCE.findings) {
      for (const id of criteria) expect(CRITERION_IDS).toContain(id);
    }
    // The text over a gradient, which axe-core can only ask a person to review.
    expect(REFERENCE.findings.map(({ location }) => location.rect.x)).not.toContain(230);
    expect(
      REFERENCE.findings.find(({ rule }) => rule === 'scrollable-region-focusable')?.criteria,
    ).toStrictEqual(['2.1.1']);
  });

  it('keeps the identifiers when Angular and the CDK number their attributes and ids otherwise', async () => {
    const renumbered = await audit('/renumbered/reference');
    const ids = (output: AuditOutput): string[] => output.findings.map(({ id }) => id);
    const original = await audit('/reference');

    // Another route gives other identifiers; the same route with other numbers gives the same.
    expect(ids(renumbered)).not.toStrictEqual(ids(original));
    site.page('/reference', RENUMBERED);
    try {
      expect(ids(await audit('/reference'))).toStrictEqual(ids(REFERENCE));
    } finally {
      site.page('/reference', PAGE);
    }
  });

  it('gives only the findings of the criteria asked for, with the same identifiers', async () => {
    const filtered = await audit('/reference', ['1.4.3', '2.5.8']);

    expect(filtered.findings).toStrictEqual(
      REFERENCE.findings.filter(
        ({ criteria }) => criteria.includes('1.4.3') || criteria.includes('2.5.8'),
      ),
    );
    expect(filtered.definitions.map(({ criterion }) => criterion)).toStrictEqual([
      '1.4.3',
      '2.5.8',
    ]);
    expect(filtered.notChecked).toStrictEqual([]);
  });

  it('cuts a long output at the cap and counts what it left out', async () => {
    const output = await audit('/many');

    expect(JSON.stringify(output).length).toBeLessThanOrEqual(OUTPUT_CAP);
    expect(output.truncated).toBe(true);
    expect(output.findings.length).toBeGreaterThan(50);
    expect(output.leftOut).toStrictEqual([
      { rule: 'image-alt', criteria: ['1.1.1'], findings: 120 - output.findings.length },
    ]);
  });
});

describe('audit_route on a page that is still changing after load', { timeout: TIMEOUT_MS }, () => {
  it('waits for content that a timer and a request add after load, and says the page settled', async () => {
    // The request answers well after the DOM has been quiet for the settle window, so only waiting
    // for the network shows the button that its answer adds.
    site.handle('/late-data', (_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
      }, 1_200);
    });
    site.page(
      '/late',
      `<!doctype html><html lang="en"><title>Late</title><body><script>
        addEventListener('load', () => {
          setTimeout(() => {
            document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(IMAGE.replace('<img', '<img class="late-image"'))});
          }, 300);
          fetch('/late-data').then((response) => response.text()).then(() => {
            document.body.insertAdjacentHTML('beforeend', '<button class="late-button"></button>');
          });
        });
      </script></body></html>`,
    );

    const output = await audit('/late');

    expect(output.page).toStrictEqual({ status: 200, refusedRequests: 0, settled: true });
    expect(
      output.findings.map(({ rule, location }) => `${rule} ${location.selector}`),
    ).toStrictEqual(['image-alt img', 'button-name button']);
  });

  it('audits a page that never stops changing at the end of the wait, and says it did not settle', async () => {
    const restless = (script: string): string =>
      `<!doctype html><html lang="en"><title>Restless</title><body>${IMAGE}<script>
        ${script}
        setInterval(() => { document.body.dataset.tick = String(performance.now()); }, 50);
      </script></body></html>`;
    site.page('/restless', restless(''));
    // A page that replaces MutationObserver in its own world cannot fake a settled page.
    site.page(
      '/restless/faking',
      restless(
        'window.MutationObserver = function () { return { observe() {}, disconnect() {} }; };',
      ),
    );
    const browser = createPlaywrightBrowser({ log: () => undefined, settleTimeoutMs: 1_000 });
    try {
      for (const path of ['/restless', '/restless/faking']) {
        const result = await auditRoute(
          { browser, engine: ports.engine },
          { url: `${site.origin}${path}` },
        );

        if (!result.ok) throw new Error(`the audit failed: ${JSON.stringify(result.failure)}`);
        expect(result.output.page.settled, path).toBe(false);
        expect(result.output.findings.map(({ rule }) => rule)).toStrictEqual(['image-alt']);
      }
    } finally {
      await browser.close();
    }
  });

  it('reports a page not found, and a stylesheet that the URL policy refused, without its URL', async () => {
    site.handle('/not-found', (_request, response) => {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html lang="en"><title>Not found</title><link rel="stylesheet" href="http://127.0.0.2:9/style.css"><p>Gone</p></html>',
      );
    });

    const output = await audit('/not-found');

    expect(output.page).toStrictEqual({ status: 404, refusedRequests: 1, settled: true });
    expect(JSON.stringify(output)).not.toContain('style.css');
  });
});

describe('audit_route on a page that fights the audit', { timeout: TIMEOUT_MS }, () => {
  // Scripts that a page could run before the audit, to hide its defects or to fake a settled page.
  const HOSTILE = {
    'a fake window.axe': `Object.defineProperty(window, 'axe', {
      configurable: false,
      get: () => ({ version: '4.14.0', run: async () => ({ violations: [] }) }),
      set: () => {},
    });`,
    'a changed Array.prototype.map': 'Array.prototype.map = function () { return []; };',
    'a fake MutationObserver': `window.MutationObserver = function () {
      return { observe() {}, disconnect() {}, takeRecords() { return []; } };
    };`,
  };

  it.each(Object.entries(HOSTILE))(
    'gives the reference output despite %s',
    async (_case, script) => {
      site.page('/hostile/reference', PAGE.replace('<head>', `<head><script>${script}</script>`));

      const output = await audit('/hostile/reference');

      // Another route, so other identifiers; everything else is the reference.
      expect({
        ...output,
        findings: output.findings.map(({ id: _id, ...rest }) => rest),
      }).toStrictEqual({
        ...REFERENCE,
        findings: REFERENCE.findings.map(({ id: _id, ...rest }) => rest),
      });
    },
  );
});

describe('audit_route on what it does not audit or must place', { timeout: TIMEOUT_MS }, () => {
  it('audits the top document when a frame loads its own axe-core', async () => {
    // With `iframes: true`, the frame's axe-core would answer the top one with nodes that have no
    // element in the top document, and the audit would fail.
    site.handle('/axe.js', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(axe.source);
    });
    site.page(
      '/frame-with-axe',
      '<title>frame</title><script src="/axe.js"></script><button></button>',
    );
    site.page(
      '/with-axe-frame',
      '<!doctype html><html lang="en"><title>With a frame</title><button></button><iframe title="Frame" src="/frame-with-axe"></iframe></html>',
    );

    const output = await audit('/with-axe-frame');

    expect(output.findings.map(({ rule }) => rule)).toStrictEqual(['button-name']);
  });

  it('does not audit the content of a frame', async () => {
    site.page(
      '/framed',
      `<!doctype html><html lang="en"><title>Framed</title><iframe title="Embedded" srcdoc='${IMAGE}'></iframe></html>`,
    );

    const output = await audit('/framed');

    expect(output.findings).toStrictEqual([]);
  });

  it('places an element on the page, however far the page has scrolled', async () => {
    site.page(
      '/scrolled',
      `<!doctype html><html lang="en"><title>Scrolled</title><body style="margin: 0; height: 3000px">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="position: absolute; left: 0; top: 1000px; width: 30px; height: 30px">
        <script>addEventListener('load', () => window.scrollTo(0, 600));</script>
      </body></html>`,
    );

    const output = await audit('/scrolled');

    expect(output.findings.map(({ location }) => location.rect)).toStrictEqual([
      { x: 0, y: 1000, width: 30, height: 30 },
    ]);
  });
});

describe('audit_route over MCP, with Chromium and axe-core', { timeout: TIMEOUT_MS }, () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession('modern', MODERN_VERSION, {
      browser: ports.browser,
      ruleEngine: ports.engine,
    });
  }, TIMEOUT_MS);

  afterAll(() => session.close(), TIMEOUT_MS);

  it('returns the reference output as structured content that matches the listed schema', async () => {
    const listed = await session.request('tools/list');
    const tools = listed.result?.tools as { outputSchema: Record<string, unknown> }[];
    const called = await session.request('tools/call', {
      name: 'audit_route',
      arguments: { url: `${site.origin}/reference` },
    });
    const result = called.result as { structuredContent?: unknown; content?: { text?: string }[] };

    expect(result.structuredContent).toStrictEqual(REFERENCE);
    expect(
      z.fromJSONSchema(tools[0]?.outputSchema ?? {}).safeParse(result.structuredContent).success,
    ).toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? 'null')).toStrictEqual(REFERENCE);
  });

  it('refuses a URL that fails the URL policy, before the page is opened', async () => {
    const called = await session.request('tools/call', {
      name: 'audit_route',
      arguments: { url: `http://localhost:${String(site.port)}@example.com/` },
    });

    expect(called.result).toMatchObject({ isError: true });
    expect(site.hits('/')).toBe(0);
  });
});
