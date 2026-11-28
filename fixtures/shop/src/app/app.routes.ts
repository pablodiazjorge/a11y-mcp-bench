import { Routes } from '@angular/router';

// Each page loads in a chunk of its own when its route is entered (ADR 0010).
export const routes: Routes = [
  {
    path: '',
    title: 'Shop',
    loadComponent: () => import('./start/start-page').then((module) => module.StartPage),
  },
  // An unknown URL goes to the start page, until the shop has a page of its own for it.
  { path: '**', redirectTo: '' },
];
