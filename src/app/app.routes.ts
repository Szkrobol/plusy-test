import { Routes } from '@angular/router';
import { adminGuard, authGuard, groupGuard, guestGuard } from './core/guards/auth.guards';
import { MainLayout } from './layout/main-layout/main-layout';

export const routes: Routes = [
  // Public screens (signed-out users only)
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
  },

  // Signed in, but no profile or group required yet
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage),
  },
  {
    path: 'join-group',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/groups/join-group/join-group').then((m) => m.JoinGroup),
  },

  // Everything that needs a group lives inside the layout (header + content)
  {
    path: '',
    component: MainLayout,
    canActivate: [groupGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'classes/:id',
        loadComponent: () =>
          import('./features/classes/class-detail').then((m) => m.ClassDetail),
      },
      // Admin-only screens: one guard for the whole `admin` branch
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          {
            path: 'task-sets',
            loadComponent: () =>
              import('./features/admin/task-sets/task-set-list').then((m) => m.TaskSetList),
          },
          {
            path: 'task-sets/:id',
            loadComponent: () =>
              import('./features/admin/task-sets/task-set-editor').then((m) => m.TaskSetEditor),
          },
          {
            path: 'classes',
            loadComponent: () =>
              import('./features/admin/classes/class-list').then((m) => m.ClassList),
          },
          {
            path: 'classes/:id',
            loadComponent: () =>
              import('./features/admin/classes/class-editor').then((m) => m.ClassEditor),
          },
          {
            path: 'points',
            loadComponent: () =>
              import('./features/admin/points/points-admin').then((m) => m.PointsAdmin),
          },
        ],
      },
    ],
  },

  { path: '**', redirectTo: '' },
];