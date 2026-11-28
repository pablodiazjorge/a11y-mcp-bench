// The catalog that the mock API serves: a believable shop, with a picture of each product on the
// app's own server and a text alternative for it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES } from './product';
import { PRODUCTS } from './products';

// The app's tests run from its folder, through `ng test`.
const PUBLIC = join(process.cwd(), 'public');

describe('the catalog', () => {
  it('has 12 to 20 products, with distinct ids written as slugs', () => {
    const ids = PRODUCTS.map(({ id }) => id);

    expect(PRODUCTS.length).toBeGreaterThanOrEqual(12);
    expect(PRODUCTS.length).toBeLessThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('has products in every category, each with a price, sizes and a description', () => {
    expect(new Set(PRODUCTS.map(({ category }) => category))).toEqual(new Set(CATEGORIES));
    for (const product of PRODUCTS) {
      expect(Number.isInteger(product.priceCents) && product.priceCents > 0).toBe(true);
      expect(product.sizes.length).toBeGreaterThan(0);
      expect(product.description.trim()).not.toBe('');
    }
  });

  it('pictures each product with a file of the app and a text alternative', () => {
    for (const { images } of PRODUCTS) {
      expect(images.length).toBeGreaterThan(0);
      for (const { src, alt } of images) {
        expect(src).toMatch(/^\/images\/products\/[a-z-]+\.svg$/);
        expect(existsSync(join(PUBLIC, ...src.split('/')))).toBe(true);
        expect(alt.trim().length).toBeGreaterThan(10);
      }
    }
  });
});
