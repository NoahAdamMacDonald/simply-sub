import { Routes } from '@angular/router';

// The routes in BLUEPRINT §8.2. Every page is lazy-loaded.
export const routes: Routes = [
  {
    path: '',
    title: 'Home · Simply Sub',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'lists',
    children: [
      {
        path: '',
        title: 'Lists · Simply Sub',
        loadComponent: () =>
          import('./features/lists/lists-overview-page').then((m) => m.ListsOverviewPage),
      },
      // Before ':listId', so "new" isn't taken for a list id.
      {
        path: 'new',
        title: 'New list · Simply Sub',
        loadComponent: () => import('./features/lists/list-edit-page').then((m) => m.ListEditPage),
      },
      {
        path: ':listId',
        title: 'List · Simply Sub',
        loadComponent: () => import('./features/lists/list-view-page').then((m) => m.ListViewPage),
      },
      {
        path: ':listId/edit',
        title: 'Edit list · Simply Sub',
        loadComponent: () => import('./features/lists/list-edit-page').then((m) => m.ListEditPage),
      },
      {
        path: ':listId/optimize',
        title: 'Optimizations · Simply Sub',
        loadComponent: () =>
          import('./features/lists/optimizations-page').then((m) => m.OptimizationsPage),
      },
    ],
  },
  {
    path: 'search',
    title: 'Search · Simply Sub',
    loadComponent: () => import('./features/search/search-page').then((m) => m.SearchPage),
  },
  {
    path: 'features',
    title: 'Features · Simply Sub',
    loadComponent: () =>
      import('./features/features-ranking/features-ranking-page').then(
        (m) => m.FeaturesRankingPage,
      ),
  },
  {
    path: 'calendar',
    title: 'Calendar · Simply Sub',
    loadComponent: () => import('./features/calendar/calendar-page').then((m) => m.CalendarPage),
  },
  {
    path: 'payment',
    title: 'Payment · Simply Sub',
    loadComponent: () => import('./features/payment/payment-page').then((m) => m.PaymentPage),
  },
  {
    path: 'custom',
    title: 'Custom subscriptions · Simply Sub',
    loadComponent: () =>
      import('./features/custom-subs/custom-subs-page').then((m) => m.CustomSubsPage),
  },
  {
    path: 'settings',
    title: 'Settings · Simply Sub',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: '**',
    title: 'Page not found · Simply Sub',
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
