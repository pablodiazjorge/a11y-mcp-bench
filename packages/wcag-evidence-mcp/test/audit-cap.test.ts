// How many findings the cap of the output keeps on a page of an Angular app with 120 images without
// a text alternative, the figure that `docs/architecture.md` gives. The images are blocks of a fixed
// size, so their rectangles, and so the size of each finding, do not depend on the fonts of the
// machine. Needs Chromium: `npm run browser:install`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAxeRuleEngine } from '../src/adapters/axe/rule-engine.ts';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import { auditRoute, OUTPUT_CAP, type AuditOutput, type AuditPorts } from '../src/core/audit.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test; an audit takes about a second here.
const TIMEOUT_MS = 60_000;
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The DOM that Angular draws for a gallery component with 120 images, inside the root component. */
function gallery(tag: string): string {
  const image = `<img _ngcontent-ng-c2="" src="${GIF}">`;
  return [
    '<!doctype html><html lang="en"><title>Gallery</title>',
    // Where Angular puts the styles of a component: in the head, scoped by its attribute.
    '<style>img[_ngcontent-ng-c2] { display: block; width: 30px; height: 30px }</style>',
    '<body style="margin: 0">',
    '<app-root ng-version="22.2.6" _nghost-ng-c1="">',
    `<${tag} _ngcontent-ng-c1="" _nghost-ng-c2="">${image.repeat(120)}</${tag}>`,
    '</app-root></body></html>',
  ].join('');
}

let site: LocalSite;
let ports: AuditPorts;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  site.page('/gallery', gallery('app-gallery'));
  site.page('/long-tag', gallery(`app-${'g'.repeat(60)}`));
  ports = {
    browser: createPlaywrightBrowser({ log: () => undefined }),
    engine: createAxeRuleEngine(),
  };
}, TIMEOUT_MS);

afterAll(async () => {
  await ports.browser.close();
  await site.close();
}, TIMEOUT_MS);

async function audited(route: string): Promise<AuditOutput> {
  const result = await auditRoute(ports, { url: `${site.origin}${route}` });
  if (!result.ok) throw new Error(`the audit failed: ${JSON.stringify(result.failure)}`);
  return result.output;
}

/** The characters of the whole output, and the mean characters of a finding, rounded. */
function sizes(output: AuditOutput): { output: number; finding: number } {
  const each = output.findings.map((finding) => JSON.stringify(finding).length);
  return {
    output: JSON.stringify(output).length,
    finding: Math.round(each.reduce((sum, size) => sum + size, 0) / each.length),
  };
}

describe(
  'the cap of the output on a page of an Angular app with 120 images',
  { timeout: TIMEOUT_MS },
  () => {
    it('keeps the findings that fit, with a short component tag', async () => {
      const output = await audited('/gallery');

      expect(output.truncated).toBe(true);
      expect(output.leftOut).toStrictEqual([
        { rule: 'image-alt', criteria: ['1.1.1'], findings: 120 - output.findings.length },
      ]);
      expect([output.findings.length, sizes(output)]).toStrictEqual([
        43,
        { output: 19_808, finding: 449 },
      ]);
      expect(sizes(output).output).toBeLessThanOrEqual(OUTPUT_CAP);
    });

    it('keeps fewer with a component tag of 64 characters', async () => {
      const output = await audited('/long-tag');

      expect([output.findings.length, sizes(output)]).toStrictEqual([
        38,
        { output: 19_567, finding: 502 },
      ]);
      expect(sizes(output).output).toBeLessThanOrEqual(OUTPUT_CAP);
    });
  },
);
