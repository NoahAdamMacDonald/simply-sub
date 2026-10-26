import { Routes } from '@angular/router';

// Pages only development builds have. The production build replaces this file with dev-routes.prod.ts, which has
// none, so they never reach sub.simplely.ca (angular.json's fileReplacements).
export const devRoutes: Routes = [
  {
    path: 'dev/components',
    title: 'Components · Simply Sub',
    loadComponent: () => import('./features/dev/components-page').then((m) => m.ComponentsPage),
  },
];
