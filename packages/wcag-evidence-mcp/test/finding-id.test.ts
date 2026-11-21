// The identifier of a finding (ADR 0004): stable while the element keeps its component and its
// selector, apart from the parts of the selector that change on their own.

import { describe, expect, it } from 'vitest';
import { findingHash, findingIds, routeOf, stableSelector } from '../src/core/finding-id.ts';

describe('stableSelector', () => {
  it.each([
    ['an Angular style attribute', 'span[_ngcontent-ng-c1111111111=""]', 'span'],
    ['an Angular host attribute', 'app-card[_nghost-ng-c22]', 'app-card'],
    ['the older Angular attribute', 'p[_ngcontent-abc-c12=""] > a', 'p > a'],
    [
      'an attribute with an app id that holds _',
      'span[_ngcontent-shop_app-c2506416247=""]',
      'span',
    ],
    ['a numbered id', '#cdk-dialog-0 > button', '#cdk-dialog- > button'],
    ['a numbered id at the end', '#mat-input-3', '#mat-input-'],
  ])('drops %s', (_case, selector, stable) => {
    expect(stableSelector(selector)).toBe(stable);
  });

  it.each([
    ['an id without a number', '#low'],
    ['a number that the app wrote into an id', '#step2'],
    ['a number glued to the id', '#item12.active'],
    ['a class with a number', '.col-12 > span'],
    ['a position', '.x:nth-child(2)'],
    ['an attribute that Angular does not add', 'button[aria-label="a"]'],
  ])('keeps %s', (_case, selector) => {
    expect(stableSelector(selector)).toBe(selector);
  });
});

describe('routeOf', () => {
  it.each([
    ['the path', 'http://localhost:4200/catalog', '/catalog'],
    ['the path without the query', 'http://localhost:4200/catalog?page=2', '/catalog'],
    [
      'the path without a fragment that only scrolls',
      'http://localhost:4200/catalog#reviews',
      '/catalog',
    ],
    ['the path with a fragment that routes', 'http://localhost:4200/#/cart', '/#/cart'],
  ])('is %s', (_case, url, route) => {
    expect(routeOf(url)).toBe(route);
  });
});

describe('findingHash', () => {
  it('is eight hex digits, the same on every run', () => {
    expect(findingHash('/catalog', 'image-alt', 'app-card', 'img.logo')).toBe(
      findingHash('/catalog', 'image-alt', 'app-card', 'img.logo'),
    );
    expect(findingHash('/catalog', 'image-alt', '', 'img.logo')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is FNV-1a over the route, the rule, the component and the stable selector, one per line', () => {
    expect(reference('')).toBe('811c9dc5');
    expect(reference('a')).toBe('e40c292c');
    expect(reference('foobar')).toBe('bf9cf968');

    expect(findingHash('/catalog', 'image-alt', 'app-card', 'img[_nghost-ng-c3]')).toBe(
      reference('/catalog\nimage-alt\napp-card\nimg'),
    );
  });

  it('stays the same when Angular renumbers its style attributes or a library its ids', () => {
    expect(
      findingHash('/', 'color-contrast', 'app-card', 'span[_ngcontent-ng-c1111111111=""]'),
    ).toBe(findingHash('/', 'color-contrast', 'app-card', 'span[_ngcontent-ng-c2222222222=""]'));
    expect(findingHash('/', 'button-name', '', '#cdk-dialog-0 > button')).toBe(
      findingHash('/', 'button-name', '', '#cdk-dialog-7 > button'),
    );
  });

  it('differs for another route, rule, component or element', () => {
    const base = findingHash('/catalog', 'image-alt', 'app-card', 'img.logo');

    expect(findingHash('/cart', 'image-alt', 'app-card', 'img.logo')).not.toBe(base);
    expect(findingHash('/catalog', 'role-img-alt', 'app-card', 'img.logo')).not.toBe(base);
    expect(findingHash('/catalog', 'image-alt', 'app-banner', 'img.logo')).not.toBe(base);
    expect(findingHash('/catalog', 'image-alt', 'app-card', 'img.banner')).not.toBe(base);
  });
});

describe('findingIds', () => {
  it('keeps apart, by their components, two elements whose selectors are the same without the style attribute', () => {
    const ids = findingIds('/', [
      {
        rule: 'color-contrast',
        component: 'app-price',
        selector: 'span[_ngcontent-ng-c1=""]',
        documentIndex: 4,
      },
      {
        rule: 'color-contrast',
        component: 'app-badge',
        selector: 'span[_ngcontent-ng-c2=""]',
        documentIndex: 12,
      },
    ]);

    expect(ids).toStrictEqual([
      findingHash('/', 'color-contrast', 'app-price', 'span'),
      findingHash('/', 'color-contrast', 'app-badge', 'span'),
    ]);
  });

  it('adds the position in the document to the findings whose hashes still collide', () => {
    const ids = findingIds('/', [
      {
        rule: 'color-contrast',
        component: 'app-card',
        selector: 'span[_ngcontent-ng-c1=""]',
        documentIndex: 4,
      },
      { rule: 'color-contrast', component: 'app-card', selector: 'p.price', documentIndex: 9 },
      {
        rule: 'color-contrast',
        component: 'app-card',
        selector: 'span[_ngcontent-ng-c1=""]',
        documentIndex: 12,
      },
    ]);
    const span = findingHash('/', 'color-contrast', 'app-card', 'span');

    expect(ids).toStrictEqual([
      `${span}-4`,
      findingHash('/', 'color-contrast', 'app-card', 'p.price'),
      `${span}-12`,
    ]);
  });

  it('gives each finding its hash alone when none collide', () => {
    expect(
      findingIds('/', [
        { rule: 'image-alt', component: '', selector: 'img', documentIndex: 1 },
        { rule: 'button-name', component: '', selector: 'img', documentIndex: 1 },
      ]),
    ).toStrictEqual([
      findingHash('/', 'image-alt', '', 'img'),
      findingHash('/', 'button-name', '', 'img'),
    ]);
  });
});

/** FNV-1a, 32 bits, written another way: with BigInt instead of `Math.imul`. */
function reference(text: string): string {
  let hash = 0x811c9dc5n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x01000193n) % 0x1_0000_0000n;
  }
  return hash.toString(16).padStart(8, '0');
}
