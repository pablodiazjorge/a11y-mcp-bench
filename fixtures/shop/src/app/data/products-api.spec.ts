import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MOCK_MODE, mockApiInterceptor } from './mock-api';
import {
  filterProducts,
  formatPrice,
  productListResource,
  productResource,
  productsUrl,
  productUrl,
  readFilter,
} from './products-api';
import { PRODUCTS } from './products';

const ids = (products: readonly { id: string }[] | undefined) => products?.map(({ id }) => id);

describe('the URLs of the API', () => {
  it('give the list, with each field of the filter as a parameter', () => {
    expect(productsUrl()).toBe('/api/products');
    expect(
      productsUrl({ category: 'tops', size: 'M', maxPriceCents: 5000, query: ' linen  ' }),
    ).toBe('/api/products?category=tops&size=M&maxPrice=5000&q=linen');
    expect(productsUrl({ query: '   ' })).toBe('/api/products');
  });

  it('give one product, with its id escaped', () => {
    expect(productUrl('linen-shirt')).toBe('/api/products/linen-shirt');
    expect(productUrl('a/b')).toBe('/api/products/a%2Fb');
  });

  it('read back the filter that they wrote, and leave out what they cannot read', () => {
    const filter = {
      category: 'shoes',
      size: '42',
      maxPriceCents: 9900,
      query: 'leather',
    } as const;

    expect(readFilter(new URLSearchParams(productsUrl(filter).split('?')[1]))).toEqual(filter);
    expect(readFilter(new URLSearchParams('category=hats&maxPrice=9.5&size=&q=%20'))).toEqual({});
  });
});

describe('filterProducts', () => {
  it('keeps every product with no filter', () => {
    expect(filterProducts(PRODUCTS, {})).toEqual(PRODUCTS);
  });

  it('keeps the products that match every field', () => {
    expect(ids(filterProducts(PRODUCTS, { category: 'bottoms', size: '36' }))).toEqual([
      'chino-trousers',
      'wide-leg-jeans',
      'corduroy-trousers',
    ]);
    expect(ids(filterProducts(PRODUCTS, { maxPriceCents: 1900 }))).toEqual([
      'striped-tee',
      'knit-beanie',
    ]);
  });

  it('finds every word of the query in the name or the description, in any case', () => {
    expect(ids(filterProducts(PRODUCTS, { query: 'LEATHER boots' }))).toEqual(['leather-boots']);
    expect(ids(filterProducts(PRODUCTS, { query: 'velvet' }))).toEqual([]);
  });
});

describe('formatPrice', () => {
  it('shows cents in euros, with two decimals', () => {
    expect(formatPrice(3900)).toBe('€39.00');
    expect(formatPrice(12950)).toBe('€129.50');
  });
});

describe('the resources', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([mockApiInterceptor])),
        { provide: MOCK_MODE, useValue: 'data' },
      ],
    });
  });

  it('give the products of the filter', async () => {
    const products = TestBed.runInInjectionContext(() =>
      productListResource(() => ({ category: 'accessories' })),
    );
    await TestBed.inject(ApplicationRef).whenStable();

    expect(ids(products.value())).toEqual([
      'wool-scarf',
      'canvas-tote',
      'knit-beanie',
      'leather-belt',
    ]);
  });

  it('give one product, and an error with status 404 for an unknown id', async () => {
    const known = TestBed.runInInjectionContext(() => productResource(() => 'canvas-tote'));
    const unknown = TestBed.runInInjectionContext(() => productResource(() => 'nothing'));
    await TestBed.inject(ApplicationRef).whenStable();

    expect(known.value()?.name).toBe('Canvas tote bag');
    expect(unknown.error()).toMatchObject({ status: 404 });
  });
});
