// The catalog that the mock API serves (ADR 0010). Invented products, with no real brand, and a
// picture of each on the app's own server, so that no request leaves it.

import type { Product } from './product';

const TOP_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const WAIST_SIZES = ['28', '30', '32', '34', '36'];
const SHOE_SIZES = ['38', '39', '40', '41', '42', '43', '44', '45'];
const ONE_SIZE = ['One size'];

/**
 * A product's one picture, at `/images/products/<id>.svg`. Its text alternative says what the
 * drawing shows, its color and view, never what it does not show, such as the material. Where the
 * picture sits inside the link to the product, the catalog gives it `alt=""`, or the name of the
 * link would repeat the product's name.
 */
const image = (id: string, alt: string) => [{ src: `/images/products/${id}.svg`, alt }];

export const PRODUCTS: readonly Product[] = [
  {
    id: 'linen-shirt',
    name: 'Linen shirt',
    category: 'tops',
    priceCents: 3900,
    sizes: TOP_SIZES,
    description: 'A loose shirt in washed linen, with a button-down collar.',
    images: image('linen-shirt', 'Sand-colored shirt, laid flat'),
  },
  {
    id: 'oxford-shirt',
    name: 'Oxford shirt',
    category: 'tops',
    priceCents: 4500,
    sizes: TOP_SIZES,
    description: 'A cotton Oxford shirt with a chest pocket, cut for every day.',
    images: image('oxford-shirt', 'Light blue shirt, laid flat'),
  },
  {
    id: 'striped-tee',
    name: 'Striped T-shirt',
    category: 'tops',
    priceCents: 1900,
    sizes: TOP_SIZES,
    description: 'A heavy cotton T-shirt with narrow navy stripes.',
    images: image('striped-tee', 'White T-shirt with navy stripes, laid flat'),
  },
  {
    id: 'merino-sweater',
    name: 'Merino sweater',
    category: 'tops',
    priceCents: 6900,
    sizes: TOP_SIZES,
    description: 'A fine-knit crew-neck sweater in merino wool.',
    images: image('merino-sweater', 'Olive green sweater, laid flat'),
  },
  {
    id: 'chino-trousers',
    name: 'Chino trousers',
    category: 'bottoms',
    priceCents: 5500,
    sizes: WAIST_SIZES,
    description: 'Straight-leg trousers in brushed cotton twill.',
    images: image('chino-trousers', 'Khaki trousers, laid flat'),
  },
  {
    id: 'wide-leg-jeans',
    name: 'Wide-leg jeans',
    category: 'bottoms',
    priceCents: 6500,
    sizes: WAIST_SIZES,
    description: 'High-rise jeans with a wide leg, in rigid indigo denim.',
    images: image('wide-leg-jeans', 'Indigo jeans, laid flat'),
  },
  {
    id: 'drawstring-shorts',
    name: 'Drawstring shorts',
    category: 'bottoms',
    priceCents: 2900,
    sizes: TOP_SIZES,
    description: 'Light cotton shorts with an elastic drawstring waist.',
    images: image('drawstring-shorts', 'Slate gray shorts, laid flat'),
  },
  {
    id: 'corduroy-trousers',
    name: 'Corduroy trousers',
    category: 'bottoms',
    priceCents: 5900,
    sizes: WAIST_SIZES,
    description: 'Relaxed trousers in soft wide-wale corduroy.',
    images: image('corduroy-trousers', 'Brown trousers, laid flat'),
  },
  {
    id: 'canvas-sneakers',
    name: 'Canvas sneakers',
    category: 'shoes',
    priceCents: 4900,
    sizes: SHOE_SIZES,
    description: 'Low-top canvas sneakers on a natural rubber sole.',
    images: image('canvas-sneakers', 'Off-white sneaker, side view'),
  },
  {
    id: 'leather-boots',
    name: 'Leather boots',
    category: 'shoes',
    priceCents: 12900,
    sizes: SHOE_SIZES,
    description: 'Lace-up ankle boots in oiled leather, with a stitched sole.',
    images: image('leather-boots', 'Dark brown ankle boot, side view'),
  },
  {
    id: 'running-shoes',
    name: 'Running shoes',
    category: 'shoes',
    priceCents: 8900,
    sizes: SHOE_SIZES,
    description: 'Light running shoes with a cushioned foam sole.',
    images: image('running-shoes', 'Red sneaker, side view'),
  },
  {
    id: 'suede-loafers',
    name: 'Suede loafers',
    category: 'shoes',
    priceCents: 9900,
    sizes: SHOE_SIZES,
    description: 'Unlined loafers in soft suede, to wear without socks.',
    images: image('suede-loafers', 'Tan loafer, side view'),
  },
  {
    id: 'wool-scarf',
    name: 'Wool scarf',
    category: 'accessories',
    priceCents: 2500,
    sizes: ONE_SIZE,
    description: 'A long scarf in lambswool, with fringed ends.',
    images: image('wool-scarf', 'Burgundy scarf, folded'),
  },
  {
    id: 'canvas-tote',
    name: 'Canvas tote bag',
    category: 'accessories',
    priceCents: 2200,
    sizes: ONE_SIZE,
    description: 'A sturdy tote bag in undyed canvas, with long handles.',
    images: image('canvas-tote', 'Natural-colored tote bag with handles, front view'),
  },
  {
    id: 'knit-beanie',
    name: 'Knit beanie',
    category: 'accessories',
    priceCents: 1800,
    sizes: ONE_SIZE,
    description: 'A ribbed beanie in a wool and cotton blend.',
    images: image('knit-beanie', 'Dark teal beanie, front view'),
  },
  {
    id: 'leather-belt',
    name: 'Leather belt',
    category: 'accessories',
    priceCents: 3500,
    sizes: ['S', 'M', 'L'],
    description: 'A plain belt in vegetable-tanned leather, with a brass buckle.',
    images: image('leather-belt', 'Brown belt with a brass buckle, laid out straight'),
  },
];
