import { Routes } from '@angular/router';

// Each page loads in a chunk of its own when its route is entered (ADR 0010). Each title is the
// page's name; ShopTitleStrategy adds the shop's.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'catalog' },
  {
    path: 'catalog',
    title: 'Catalog',
    loadComponent: () => import('./pages/catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'product/:id',
    title: 'Product',
    loadComponent: () => import('./pages/product/product-page').then((m) => m.ProductPage),
  },
  {
    path: 'cart',
    title: 'Cart',
    loadComponent: () => import('./pages/cart/cart-page').then((m) => m.CartPage),
  },
  {
    path: 'checkout',
    title: 'Checkout',
    loadComponent: () => import('./pages/checkout/checkout-page').then((m) => m.CheckoutPage),
  },
  {
    path: '**',
    title: 'Page not found',
    loadComponent: () => import('./pages/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
