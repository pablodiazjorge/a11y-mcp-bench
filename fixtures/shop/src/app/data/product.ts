// The shop's data model, as the mock API serves it.

/** The categories of the catalog, in the order that the catalog lists them. */
export const CATEGORIES = ['tops', 'bottoms', 'shoes', 'accessories'] as const;

export type Category = (typeof CATEGORIES)[number];

/** A picture of a product, with the text that stands for it. */
export interface ProductImage {
  /** A path on the app's own server, under `/images/`. */
  readonly src: string;
  readonly alt: string;
}

export interface Product {
  /** A short, stable slug, as in `/product/linen-shirt`. */
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  /** The price in cents of the shop's one currency, `CURRENCY`. */
  readonly priceCents: number;
  /** The sizes that the product comes in, smallest first; one entry for a single size. */
  readonly sizes: readonly string[];
  readonly description: string;
  readonly images: readonly ProductImage[];
}

/** What the catalog can narrow the list by; every field is optional. */
export interface ProductFilter {
  readonly category?: Category;
  readonly size?: string;
  /** The highest price to show, in cents. */
  readonly maxPriceCents?: number;
  /** Words to find in a product's name or description. */
  readonly query?: string;
}

/** The shop's one currency. */
export const CURRENCY = 'EUR';
