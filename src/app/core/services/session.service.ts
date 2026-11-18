import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '@supabase/supabase-js';
import { Enums } from '../database.types';
import { fullName, isProfileComplete, Profile } from '../profile';
import { SupabaseService } from './supabase.service';

export type MemberRole = Enums<'member_role'>;

export interface Membership {
  groupId: string;
  groupName: string;
  role: MemberRole;
}

/**
 * Single source of truth for "who is signed in, who they are and which group they belong to".
 *
 * - The Supabase session (access + refresh token) lives in localStorage and is refreshed
 *   by supabase-js itself. This service only mirrors it into signals.
 * - The profile and group memberships are loaded lazily and cached until the user changes.
 */
@Service()
export class SessionService {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  // ----- Session -----
  private readonly _session = signal<Session | null>(null);
  readonly session = this._session.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  readonly isAuthenticated = computed(() => this._session() !== null);

  /** Resolves after supabase-js has restored the stored session (the INITIAL_SESSION event). */
  private resolveReady!: () => void;
  private readonly ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

  // ----- Profile (null = not loaded yet) -----
  private readonly _profile = signal<Profile | null>(null);
  readonly profile = this._profile.asReadonly();

  /** "First Last" once the profile is complete, otherwise null. */
  readonly displayName = computed(() => {
    const profile = this._profile();
    return profile && isProfileComplete(profile) ? fullName(profile) : null;
  });

  private profileInFlight: Promise<Profile> | null = null;

  // ----- Group memberships (null = not loaded yet) -----
  private readonly _memberships = signal<Membership[] | null>(null);
  readonly memberships = this._memberships.asReadonly();

  /** The group the app currently works in. Users normally belong to one group. */
  readonly activeGroup = computed(() => this._memberships()?.[0] ?? null);
  readonly isAdmin = computed(() => this.activeGroup()?.role === 'admin');

  private membershipsInFlight: Promise<Membership[]> | null = null;

  constructor() {
    this.supabase.client.auth.onAuthStateChange((event, session) => {
      // Keep this callback synchronous: awaiting supabase-js calls in here can deadlock.
      this.applySession(session);

      if (event === 'INITIAL_SESSION') {
        this.resolveReady();
      } else if (event === 'SIGNED_OUT') {
        // Also covers a session that ended elsewhere (other tab, failed token refresh).
        void this.router.navigateByUrl('/login');
      }
    });
  }

  /** Guards await this so they never decide before the stored session is restored. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  // ----- Profile -----

  /** Returns the cached profile, loading it on first use. Throws if the query fails. */
  ensureProfile(): Promise<Profile> {
    const cached = this._profile();
    return cached ? Promise.resolve(cached) : this.refreshProfile();
  }

  /** Reloads the profile from the database. */
  refreshProfile(): Promise<Profile> {
    this.profileInFlight ??= this.fetchProfile().finally(() => {
      this.profileInFlight = null;
    });
    return this.profileInFlight;
  }

  /** Stores a profile that was just saved, so no extra query is needed. */
  setProfile(profile: Profile): void {
    this._profile.set(profile);
  }

  // ----- Memberships -----

  /** Returns cached memberships, loading them on first use. Throws if the query fails. */
  ensureMemberships(): Promise<Membership[]> {
    const cached = this._memberships();
    return cached ? Promise.resolve(cached) : this.refreshMemberships();
  }

  /** Reloads memberships from the database (e.g. right after joining a group). */
  refreshMemberships(): Promise<Membership[]> {
    this.membershipsInFlight ??= this.fetchMemberships().finally(() => {
      this.membershipsInFlight = null;
    });
    return this.membershipsInFlight;
  }

  private applySession(session: Session | null): void {
    const previousUserId = this._session()?.user.id;
    this._session.set(session);

    // TOKEN_REFRESHED and repeated SIGNED_IN events keep the same user: keep the caches.
    if (session?.user.id !== previousUserId) {
      this._profile.set(null);
      this.profileInFlight = null;
      this._memberships.set(null);
      this.membershipsInFlight = null;
    }
  }

  private async fetchProfile(): Promise<Profile> {
    const userId = this._session()?.user.id;
    if (!userId) {
      throw new Error('Not signed in');
    }

    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    // Ignore the result if the user changed while the request was running.
    if (this._session()?.user.id === userId) {
      this._profile.set(data);
    }
    return data;
  }

  private async fetchMemberships(): Promise<Membership[]> {
    const userId = this._session()?.user.id;
    if (!userId) {
      return [];
    }

    const { data, error } = await this.supabase.client
      .from('group_members')
      .select('role, groups(id, name)')
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    const memberships: Membership[] = (data ?? []).flatMap((row) =>
      row.groups
        ? [{ groupId: row.groups.id, groupName: row.groups.name, role: row.role }]
        : [],
    );

    // Ignore the result if the user changed while the request was running.
    if (this._session()?.user.id === userId) {
      this._memberships.set(memberships);
    }
    return memberships;
  }
}