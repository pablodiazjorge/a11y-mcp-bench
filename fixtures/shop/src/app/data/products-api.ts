// The data layer of the shop: plain functions for the API's URLs, the filter and the prices, and
// the two resources that the pages read, built on `httpResource`.

import { httpResource, type HttpResourceRef } from '@angular/common/http';
import { CATEGORIES, CURRENCY, type Category, type Product, type ProductFilter } from './product';

/** The path of the API's list of products. */
export const PRODUCTS_PATH = '/api/products';

/** The URL of the list of products that match `filter`, with its fields as query parameters. */
export function productsUrl(filter: ProductFilter = {}): string {
  const params = new URLSearchParams();
  if (filter.category !== undefined) params.set('category', filter.category);
  if (filter.size !== undefined) params.set('size', filter.size);
  if (filter.maxPriceCents !== undefined) params.set('maxPrice', String(filter.maxPriceCents));
  if (filter.query !== undefined && filter.query.trim() !== '') {
    params.set('q', filter.query.trim());
  }
  const query = params.toString();
  return query === '' ? PRODUCTS_PATH : `${PRODUCTS_PATH}?${query}`;
}

/** The URL of one product. */
export function productUrl(id: string): string {
  return `${PRODUCTS_PATH}/${encodeURIComponent(id)}`;
}

const isCategory = (value: string | null): value is Category =>
  (CATEGORIES as readonly (string | null)[]).includes(value);

/**
 * Reads a filter from query parameters, as the API receives them. A parameter that it cannot
 * read, such as an unknown category or a price that is not a whole number, is left out.
 */
export function readFilter(params: URLSearchParams): ProductFilter {
  const category = params.get('category');
  const size = params.get('size');
  const maxPrice = params.get('maxPrice');
  const query = params.get('q');
  return {
    ...(isCategory(category) ? { category } : {}),
    ...(size !== null && size !== '' ? { size } : {}),
    ...(maxPrice !== null && /^\d+$/.test(maxPrice) ? { maxPriceCents: Number(maxPrice) } : {}),
    ...(query !== null && query.trim() !== '' ? { query: query.trim() } : {}),
  };
}

/** The products that match every field of `filter`, in their catalog order. */
export function filterProducts(
  products: readonly Product[],
  filter: ProductFilter,
): readonly Product[] {
  const words = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter(
    (product) =>
      (filter.category === undefined || product.category === filter.category) &&
      (filter.size === undefined || product.sizes.includes(filter.size)) &&
      (filter.maxPriceCents === undefined || product.priceCents <= filter.maxPriceCents) &&
      words.every((word) => `${product.name} ${product.description}`.toLowerCase().includes(word)),
  );
}

// English with the euro, as written in Ireland: €39.00, with the symbol first and a point for cents.
const PRICE = new Intl.NumberFormat('en-IE', { style: 'currency', currency: CURRENCY });

/** A price in cents, as the shop shows it, such as "€39.00". */
export function formatPrice(cents: number): string {
  return PRICE.format(cents / 100);
}

/**
 * The products that match the filter, fetched again whenever the filter changes. Call it in an
 * injection context, such as a component's field.
 */
export function productListResource(
  filter: () => ProductFilter,
): HttpResourceRef<readonly Product[] | undefined> {
  return httpResource<readonly Product[]>(() => productsUrl(filter()));
}

/** One product, fetched again whenever its id changes. Call it in an injection context. */
export function productResource(id: () => string): HttpResourceRef<Product | undefined> {
  return httpResource<Product>(() => productUrl(id()));
}
