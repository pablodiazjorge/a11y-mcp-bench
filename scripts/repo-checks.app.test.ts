import { describe, expect, it } from 'vitest';
import { checkComponentStyles } from './repo-checks.app.ts';
import { formatProblem, type Problem } from './repo-checks.ts';

// The check that every component of the Angular app has styles of its own that are not empty, so
// that its elements carry the attribute that names it in a finding (ADR 0010).

const report = (problems: readonly Problem[]): string[] => problems.map(formatProblem);
const APP = 'fixtures/shop/src/app';
const component = (metadata: string): string =>
  [
    "import { Component } from '@angular/core';",
    '',
    '@Component({',
    "  selector: 'app-card',",
    `  ${metadata}`,
    '})',
    'export class Card {}',
  ].join('\n');
const HOST = ':host {\n  display: block;\n}\n';

describe('checkComponentStyles', () => {
  it('accepts a stylesheet, several, and inline styles, in a string or a template literal', () => {
    const texts = new Map([
      [`${APP}/card.ts`, component("styleUrl: './card.css',")],
      [`${APP}/card.css`, HOST],
      [`${APP}/list/list.ts`, component("styleUrls: ['./list.css', '../shared.css'],")],
      [`${APP}/list/list.css`, '/* a list */\n@media (width > 40em) {\n  ul { gap: 1rem; }\n}\n'],
      [`${APP}/shared.css`, 'a { color: inherit; }'],
      [`${APP}/inline.ts`, component("styles: ':host { display: block; }',")],
      [`${APP}/template.ts`, component('styles: `:host { display: block; }`,')],
    ]);

    expect(checkComponentStyles(texts)).toEqual([]);
  });

  it.each([
    ['an empty file', ''],
    ['white space only', '\n  \n'],
    ['a comment only', '/* nothing yet */\n'],
    ['an empty rule', ':host {}\n'],
  ])('reports a stylesheet with %s', (_case, css) => {
    const texts = new Map([
      [`${APP}/card.ts`, component("styleUrl: './card.css',")],
      [`${APP}/card.css`, css],
    ]);

    expect(report(checkComponentStyles(texts))).toEqual([
      `${APP}/card.ts:3: names ./card.css, which is empty`,
    ]);
  });

  it('reports a component with no styles, empty inline styles and a missing stylesheet', () => {
    const texts = new Map([
      [`${APP}/bare.ts`, component("templateUrl: './bare.html',")],
      [`${APP}/inline.ts`, component("styles: '',")],
      [`${APP}/gone.ts`, component("styleUrl: './gone.css',")],
    ]);

    expect(report(checkComponentStyles(texts))).toEqual([
      `${APP}/bare.ts:3: declares a component with no styles of its own`,
      `${APP}/inline.ts:3: declares styles that are empty`,
      `${APP}/gone.ts:3: names ./gone.css, which is not a published file`,
    ]);
  });

  it('reports styles in a form that it does not read, rather than skip them', () => {
    const texts = new Map([
      [`${APP}/shared.ts`, component('styleUrl: SHARED,')],
      [`${APP}/computed.ts`, component('styles: [`:host { color: ${COLOR}; }`],')],
    ]);

    expect(report(checkComponentStyles(texts))).toEqual([
      `${APP}/shared.ts:3: gives styleUrl in a form that this check does not read`,
      `${APP}/computed.ts:3: gives styles in a form that this check does not read`,
    ]);
  });

  it('reports an empty list of stylesheets or of styles', () => {
    const texts = new Map([
      [`${APP}/urls.ts`, component('styleUrls: [],')],
      [`${APP}/styles.ts`, component('styles: [],')],
    ]);

    expect(report(checkComponentStyles(texts))).toEqual([
      `${APP}/urls.ts:3: gives styleUrls an empty list`,
      `${APP}/styles.ts:3: gives styles an empty list`,
    ]);
  });

  it.each([
    ['None', 'ViewEncapsulation.None'],
    ['ShadowDom', 'ViewEncapsulation.ShadowDom'],
    ['Emulated, written out', 'ViewEncapsulation.Emulated'],
  ])('reports any encapsulation, %s included, since the default applies', (_case, value) => {
    const texts = new Map([
      [`${APP}/card.ts`, component(`styleUrl: './card.css', encapsulation: ${value},`)],
      [`${APP}/card.css`, HOST],
    ]);

    expect(report(checkComponentStyles(texts))).toEqual([
      `${APP}/card.ts:3: sets encapsulation, which ADR 0010 leaves at the emulated default`,
    ]);
  });

  it('reports Component imported under another name or through a namespace, which it cannot see', () => {
    const alias = [
      "import { Component as C } from '@angular/core';",
      "@C({ selector: 'app-a' })",
      'export class A {}',
    ].join('\n');
    const namespace = [
      "import * as ng from '@angular/core';",
      "@ng.Component({ selector: 'app-b' })",
      'export class B {}',
    ].join('\n');
    const texts = new Map([
      [`${APP}/alias.ts`, alias],
      [`${APP}/namespace.ts`, namespace],
    ]);

    expect(report(checkComponentStyles(texts))).toEqual([
      `${APP}/alias.ts:1: imports Component under another name, which this check does not read`,
      `${APP}/namespace.ts:1: imports @angular/core as a namespace, which this check does not read`,
    ]);
  });

  it('reads only the components of the app, not its tests, directives or other parts', () => {
    const bare = component("templateUrl: './bare.html',");
    const directive = [
      "import { Directive } from '@angular/core';",
      "@Directive({ selector: '[appFocus]' })",
      'export class Focus {}',
    ].join('\n');
    const texts = new Map([
      [`${APP}/card.spec.ts`, bare],
      [`${APP}/focus.ts`, directive],
      ['packages/wcag-evidence-mcp/src/card.ts', bare],
      ['fixtures/defects/card.ts', bare],
    ]);

    expect(checkComponentStyles(texts)).toEqual([]);
  });
});
