import { inject, Service } from '@angular/core';
import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export type JoinGroupResult =
  | { ok: true; groupId: string }
  | { ok: false; message: string };

@Service()
export class GroupService {
  private readonly supabase = inject(SupabaseService);

  /**
   * Joins a group by invite code (always as a student) via the `join_group` RPC.
   * Joining a group the user already belongs to is a no-op and still succeeds.
   */
  async joinGroup(code: string): Promise<JoinGroupResult> {
    const { data, error } = await this.supabase.client.rpc('join_group', {
      code: code.trim(),
    });

    if (error) {
      return { ok: false, message: this.joinMessage(error) };
    }
    return { ok: true, groupId: data };
  }

  /** Display names of a group's members, keyed by user id. Throws if the query fails. */
  async members(groupId: string): Promise<Map<string, string>> {
    const { data, error } = await this.supabase.client
      .from('group_members')
      .select('user_id, profiles(first_name, last_name, email)')
      .eq('group_id', groupId);

    if (error) {
      throw error;
    }

    return new Map(
      data.map((row) => {
        const profile = row.profiles;
        const name = [profile?.first_name, profile?.last_name]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' ');
        return [row.user_id, name || profile?.email || 'Nieznana osoba'];
      }),
    );
  }

  /** Maps Postgres errors raised by `join_group` to messages shown to the user. */
  private joinMessage(error: PostgrestError): string {
    switch (error.code) {
      case 'P0001':
        // `raise exception 'Nieznany kod grupy'` in the function.
        return 'Nie znaleziono grupy o takim kodzie. Sprawdź kod i spróbuj ponownie.';
      case '42501': // no EXECUTE privilege: request went out as `anon`
      case '23502': // auth.uid() was null
        return 'Twoja sesja wygasła. Zaloguj się ponownie.';
      default:
        return 'Nie udało się dołączyć do grupy. Spróbuj ponownie.';
    }
  }
}