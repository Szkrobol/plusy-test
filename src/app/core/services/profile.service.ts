import { inject, Service } from '@angular/core';
import { SessionService } from './session.service';
import { SupabaseService } from './supabase.service';

export type SaveProfileResult = { ok: true } | { ok: false; message: string };

@Service()
export class ProfileService {
  private readonly supabase = inject(SupabaseService);
  private readonly session = inject(SessionService);

  /** Saves the signed-in user's name (RLS allows updating only the own profile row). */
  async save(firstName: string, lastName: string): Promise<SaveProfileResult> {
    const userId = this.session.user()?.id;
    if (!userId) {
      return { ok: false, message: 'Twoja sesja wygasła. Zaloguj się ponownie.' };
    }

    const { data, error } = await this.supabase.client
      .from('profiles')
      .update({
        first_name: this.clean(firstName),
        last_name: this.clean(lastName),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return { ok: false, message: 'Nie udało się zapisać danych. Spróbuj ponownie.' };
    }

    this.session.setProfile(data);
    return { ok: true };
  }

  /** Trims and collapses repeated whitespace ("Anna   Maria " -> "Anna Maria"). */
  private clean(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }
}
