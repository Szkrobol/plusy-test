import { inject, Service } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { UserFacingError } from '../user-facing-error';
import { SupabaseService } from './supabase.service';

/** One row of the `assignments` table: who presents a subtask (null = free). */
export interface AssignmentRow {
  subtaskId: string;
  userId: string | null;
  /** Stand-in in case the assigned person is absent (null = none). */
  backupUserId: string | null;
  round: number;
}

/** Response of the `assign` Edge Function. */
export interface AssignResult {
  assignments: { subtaskId: string; studentId: string | null; backupStudentId: string | null }[];
  /** Round 1: ceil(subtasks / willing students). Round 2: null. */
  limitPerPerson: number | null;
}

@Service()
export class AssignmentService {
  private readonly supabase = inject(SupabaseService);

  /** Assignments of a class (readable by every member of the group). Throws if the query fails. */
  async forClass(classId: string): Promise<AssignmentRow[]> {
    const { data, error } = await this.supabase.client
      .from('assignments')
      .select('subtask_id, user_id, backup_user_id, round')
      .eq('class_id', classId);

    if (error) {
      throw error;
    }
    return data.map((row) => ({ subtaskId: row.subtask_id, userId: row.user_id, backupUserId: row.backup_user_id, round: row.round }));
  }

  /**
   * Runs the assignment for a round (admin only). The function saves the assignments and moves
   * the class to the next status. Throws a UserFacingError with a Polish message on failure.
   */
  async run(classId: string, round: 1 | 2): Promise<AssignResult> {
    const { data, error } = await this.supabase.client.functions.invoke<AssignResult>('assign', {
      body: { classId, round },
    });

    if (error) {
      throw new UserFacingError(this.messageFor(error));
    }
    if (!data) {
      throw new UserFacingError('Funkcja przydziału nie zwróciła wyniku.');
    }
    return data;
  }

  private messageFor(error: unknown): string {
    if (error instanceof FunctionsHttpError) {
      switch ((error.context as Response).status) {
        case 400:
          return 'Niepoprawne żądanie przydziału.';
        case 401:
          return 'Twoja sesja wygasła. Zaloguj się ponownie.';
        case 403:
          return 'Przydział może uruchomić tylko administrator grupy.';
        case 404:
          return 'Nie znaleziono zajęć albo funkcji przydziału.';
        case 409:
          return 'Status zajęć nie odpowiada tej turze. Odśwież stronę.';
      }
    }
    return 'Nie udało się uruchomić przydziału.';
  }
}
