import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { isProfileComplete } from '../profile';
import { SessionService } from '../services/session.service';

/** Builds a redirect that remembers where the user wanted to go (omitted for the root). */
function redirectTo(router: Router, path: string, returnUrl: string): UrlTree {
  return router.createUrlTree([path], returnUrl === '/' ? {} : { queryParams: { returnUrl } });
}

/**
 * Shared check for routes that need a group: signed in, profile complete and a member of
 * at least one group. Plain function (not a guard) so other guards can reuse it with a narrow
 * return type.
 */
async function requireGroup(
  session: SessionService,
  router: Router,
  url: string,
): Promise<true | UrlTree> {
  await session.whenReady();
  if (!session.isAuthenticated()) {
    return redirectTo(router, '/login', url);
  }

  const [profile, memberships] = await Promise.all([
    session.ensureProfile(),
    session.ensureMemberships(),
  ]);

  if (!isProfileComplete(profile)) {
    return redirectTo(router, '/profile', url);
  }
  return memberships.length > 0 ? true : router.createUrlTree(['/join-group']);
}

/** Signed-in users only. Use on pages that need neither a profile nor a group (e.g. /profile). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  await session.whenReady();
  return session.isAuthenticated() ? true : redirectTo(router, '/login', state.url);
};

/** Signed-out users only (login, register). Signed-in users are sent to the app root. */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);

  await session.whenReady();
  return session.isAuthenticated() ? router.createUrlTree(['/']) : true;
};

/**
 * Signed-in users with a complete profile who belong to at least one group.
 * Implies `authGuard`, so use it on its own. Incomplete profile goes to /profile,
 * no group goes to /join-group.
 */
export const groupGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  return requireGroup(session, router, state.url);
};

/** Group admins only. Implies `groupGuard`. Students are sent to the app root. */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  const allowed = await requireGroup(session, router, state.url);
  if (allowed !== true) {
    return allowed;
  }
  return session.isAdmin() ? true : router.createUrlTree(['/']);
};