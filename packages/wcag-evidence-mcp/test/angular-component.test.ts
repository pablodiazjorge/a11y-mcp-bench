// The Angular component of each finding, read from the page, on the DOM that Angular draws for the
// fourteen cases of the test that chose the technique (fixtures/angular-cases.html). Needs
// Chromium: `npm run browser:install`.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAxeRuleEngine } from '../src/adapters/axe/rule-engine.ts';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import { auditRoute, type AuditOutput, type AuditPorts } from '../src/core/audit.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test; an audit takes about a second here.
const TIMEOUT_MS = 60_000;
const CASES = readFileSync(new URL('fixtures/angular-cases.html', import.meta.url), 'utf8');
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const IMAGE = `<img src="${GIF}">`;
/** An Angular page whose root component, with styles, holds `body`. */
const page = (body: string): string =>
  `<!doctype html><html lang="en"><title>Page</title><app-root ng-version="22.2.6" _nghost-ng-c900=""><app-frame _ngcontent-ng-c900="">${body}</app-frame></app-root></html>`;

let site: LocalSite;
let ports: AuditPorts;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  site.page('/cases', CASES);
  ports = {
    browser: createPlaywrightBrowser({ log: () => undefined }),
    engine: createAxeRuleEngine(),
  };
}, TIMEOUT_MS);

afterAll(async () => {
  await ports.browser.close();
  await site.close();
}, TIMEOUT_MS);

async function audit(path: string): Promise<AuditOutput> {
  const result = await auditRoute(ports, { url: `${site.origin}${path}` });
  if (!result.ok) throw new Error(`the audit failed: ${JSON.stringify(result.failure)}`);
  return result.output;
}

/** Each finding as its rule, its selector and its component, written on one line. */
function components(output: AuditOutput): string[] {
  return output.findings.map(({ rule, location: { selector, component } }) => {
    const named =
      component === null
        ? 'none'
        : `${component.tag} ${component.usedIn ?? '-'} ${component.method}`;
    return `${rule} | ${selector} | ${named}`;
  });
}

const CARD = 'app-card:nth-child';
const CARD_BUTTON = '> .card-action[_ngcontent-ng-c101=""]';

describe('the component of a finding', { timeout: TIMEOUT_MS }, () => {
  it('is the one that declares the element, in each of the fourteen cases', async () => {
    expect(components(await audit('/cases'))).toStrictEqual([
      // 1, 6, 13 and 14: the root template, inside @defer, an inline template and a template file.
      'image-alt | .root-image | app-root - style-attribute',
      'image-alt | .deferred-image | app-root - style-attribute',
      'image-alt | .inline-image | app-inline - style-attribute',
      'image-alt | .file-image | app-file - style-attribute',
      // Beyond the fourteen: a component with emulated styles inside one with shadow DOM.
      'image-alt | app-shadow >>> .shadow-image | app-inner - style-attribute',
      // 11: a role that app-chip sets on its own element; app-root declares the element.
      'role-img-alt | app-chip | app-root - style-attribute',
      // 4 and 9: inside @if, and in an overlay that code creates with its own component.
      'color-contrast | p | app-root - style-attribute',
      'color-contrast | .tooltip-text | app-tooltip - style-attribute',
      // 3: content that app-root projects into app-panel.
      'link-name | a | app-root - style-attribute',
      // 2: a child component used three times, whose buttons are also too small.
      `target-size | ${CARD}(3) ${CARD_BUTTON} | app-card - style-attribute`,
      `target-size | ${CARD}(4) ${CARD_BUTTON} | app-card - style-attribute`,
      `target-size | ${CARD}(5) ${CARD_BUTTON} | app-card - style-attribute`,
      // 10: a role that a directive sets; app-root declares the element.
      'aria-command-name | .directive-target | app-root - style-attribute',
      `button-name | ${CARD}(3) ${CARD_BUTTON} | app-card - style-attribute`,
      `button-name | ${CARD}(4) ${CARD_BUTTON} | app-card - style-attribute`,
      `button-name | ${CARD}(5) ${CARD_BUTTON} | app-card - style-attribute`,
      // 7: a component without styles, loaded later: the closest custom element, a guess.
      'button-name | .deferred-button | app-deferred app-root nearest-custom-element',
      // 8: an overlay that app-toolbar declares in its template, hung from <body>.
      'button-name | .menu-item | app-toolbar - style-attribute',
      // 5: inside @for, in app-list.
      'label | .for-input | app-list - style-attribute',
      // 12: a Material component, whose styles add no attribute: a guess, used in app-root.
      'label | #mat-mdc-checkbox-1-input | mat-checkbox app-root nearest-custom-element',
    ]);
  });

  it('keeps the identifiers when Angular gives its components other keys', async () => {
    const renumbered = CASES.replaceAll(/ng-c1(\d\d)/g, 'ng-c9$1');
    site.page('/renumbered', CASES);
    const before = (await audit('/renumbered')).findings.map(({ id }) => id);
    site.page('/renumbered', renumbered);
    const after = (await audit('/renumbered')).findings.map(({ id }) => id);

    expect(renumbered).not.toBe(CASES);
    expect(after).toStrictEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });

  it('is none on a page that is not an Angular app, custom elements and all', async () => {
    site.page(
      '/not-angular',
      `<!doctype html><html lang="en"><title>Not Angular</title><my-widget><span>${IMAGE}</span></my-widget></html>`,
    );

    expect(components(await audit('/not-angular'))).toStrictEqual(['image-alt | img | none']);
  });

  it('is none for an element outside every component of an Angular app', async () => {
    site.page(
      '/outside',
      `<!doctype html><html lang="en"><title>Outside</title>${IMAGE}<app-root ng-version="22.2.6"></app-root></html>`,
    );

    expect(components(await audit('/outside'))).toStrictEqual(['image-alt | img | none']);
  });

  it('is none when the tag of the component is not a plain custom element name', async () => {
    site.page(
      '/odd-tag',
      `<!doctype html><html lang="en"><title>Odd tag</title><app-root ng-version="22.2.6"><app-odd.tag _nghost-ng-c900=""><img _ngcontent-ng-c900="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></app-odd.tag></app-root></html>`,
    );

    expect(components(await audit('/odd-tag'))).toStrictEqual(['image-alt | img | none']);
  });
  it('is none for a component without a selector, which Angular names ng-component', async () => {
    site.page(
      '/no-selector',
      page(
        `<ng-component _nghost-ng-c901=""><img _ngcontent-ng-c901="" src="${GIF}"></ng-component>`,
      ),
    );

    expect(components(await audit('/no-selector'))).toStrictEqual(['image-alt | img | none']);
  });

  it('is read with an app id that holds an underscore', async () => {
    site.page(
      '/underscore',
      page(
        `<app-gallery _nghost-shop_app-c2506416247=""><img _ngcontent-shop_app-c2506416247="" src="${GIF}"></app-gallery>`,
      ),
    );

    expect(components(await audit('/underscore'))).toStrictEqual([
      'image-alt | img | app-gallery - style-attribute',
    ]);
  });

  it('is guessed in an app whose components have no styles, which ng-version marks as Angular', async () => {
    site.page(
      '/unstyled',
      `<!doctype html><html lang="en"><title>Unstyled</title><app-root ng-version="22.2.6"><app-plain><img src="${GIF}"></app-plain></app-root></html>`,
    );

    expect(components(await audit('/unstyled'))).toStrictEqual([
      'image-alt | img | app-plain - nearest-custom-element',
    ]);
  });

  it('is guessed when the key of the attribute is not a key, rather than searched as a selector', async () => {
    // `[_nghost-a],*,[b]` would find the first element of the document.
    site.page('/odd-key', page(`<app-box><img _ngcontent-a],*,[b="" src="${GIF}"></app-box>`));

    expect(components(await audit('/odd-key'))).toStrictEqual([
      'image-alt | img | app-box - nearest-custom-element',
    ]);
  });

  it('is none when the page only has some other attribute that starts with _ng', async () => {
    site.page(
      '/not-a-host',
      `<!doctype html><html lang="en"><title>Not a host</title><my-widget _ngcontent-x="" _ngfoo=""><img src="${GIF}"></my-widget></html>`,
    );

    expect(components(await audit('/not-a-host'))).toStrictEqual(['image-alt | img | none']);
  });
});

describe('the identifier of a finding with a component', { timeout: TIMEOUT_MS }, () => {
  // Each pair is the same page before and after a component gains its first style rule, as when a
  // fix adds one for a contrast: the guess becomes a reading, or the app's component changes.
  it.each([
    [
      'a component without styles that gains one',
      page(`<app-empty _ngcontent-ng-c900=""><img src="${GIF}"></app-empty>`),
      page(
        `<app-empty _ngcontent-ng-c900="" _nghost-ng-c902=""><img _ngcontent-ng-c902="" src="${GIF}"></app-empty>`,
      ),
    ],
    [
      'the component that uses a library component, when it gains one',
      `<!doctype html><html lang="en"><title>Shell</title><app-root ng-version="22.2.6"><app-shell><mat-box><img src="${GIF}"></mat-box></app-shell></app-root></html>`,
      `<!doctype html><html lang="en"><title>Shell</title><app-root ng-version="22.2.6"><app-shell _nghost-ng-c903=""><mat-box _ngcontent-ng-c903=""><img src="${GIF}"></mat-box></app-shell></app-root></html>`,
    ],
  ])('stays the same for %s', async (_case, before, after) => {
    site.page('/styling', before);
    const first = await audit('/styling');
    site.page('/styling', after);
    const second = await audit('/styling');

    expect(second.findings.map(({ id }) => id)).toStrictEqual(first.findings.map(({ id }) => id));
    expect(first.findings.map(({ location }) => location.component)).not.toStrictEqual(
      second.findings.map(({ location }) => location.component),
    );
  });
});
