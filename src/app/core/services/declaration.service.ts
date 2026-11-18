import { inject, Service } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface DeclaredRow {
  subtaskId: string;
  round: number;
}

/**
 * A student's declarations ("I want this subtask") for a class.
 * RLS decides whether a round is open, so writes fail once it closes. Methods throw on failure.
 */
@Service()
export class DeclarationService {
  private readonly supabase = inject(SupabaseService);

  /** The user's declarations for the class, with the round each one was made in. */
  async mine(classId: string, userId: string): Promise<DeclaredRow[]> {
    const { data, error } = await this.supabase.client
      .from('declarations')
      .select('subtask_id, round')
      .eq('class_id', classId)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }
    return data.map((row) => ({ subtaskId: row.subtask_id, round: row.round }));
  }

  /**
   * Number of declarations and of distinct students for a round (admin sees everyone's rows).
   * Only a preview for the admin, so it ignores the server's row limit.
   */
  async summary(classId: string, round: 1 | 2): Promise<{ declarations: number; students: number }> {
    const { data, error } = await this.supabase.client
      .from('declarations')
      .select('user_id')
      .eq('class_id', classId)
      .eq('round', round);

    if (error) {
      throw error;
    }
    return { declarations: data.length, students: new Set(data.map((row) => row.user_id)).size };
  }

  /** Declares subtasks. Callers pass only ids that are not declared yet (duplicates would fail). */
  async add(classId: string, userId: string, subtaskIds: string[], round: 1 | 2 = 1): Promise<void> {
    const rows = subtaskIds.map((subtaskId) => ({
      class_id: classId,
      user_id: userId,
      subtask_id: subtaskId,
      round,
    }));

    const { error } = await this.supabase.client.from('declarations').insert(rows);
    if (error) {
      throw error;
    }
  }

  /**
   * Withdraws declarations. A row the policy does not allow to delete (round already closed)
   * is silently skipped by Postgres, so the deleted rows are counted and a shortfall is an error.
   */
  async remove(classId: string, userId: string, subtaskIds: string[]): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('declarations')
      .delete()
      .eq('class_id', classId)
      .eq('user_id', userId)
      .in('subtask_id', subtaskIds)
      .select('subtask_id');

    if (error) {
      throw error;
    }
    if (data.length !== subtaskIds.length) {
      throw new Error('Not all declarations were withdrawn (round closed?)');
    }
  }
}