import { inject, Service } from '@angular/core';
import { SessionService } from './session.service';
import { SupabaseService } from './supabase.service';

/** One entry of the points ledger, with the related class and subtask resolved for display. */
export interface PointEntry {
  id: number;
  userId: string;
  /** +1 for a point, negative for a correction. */
  value: number;
  note: string | null;
  /** Who wrote the entry: the student themselves or an admin. */
  createdBy: string;
  createdAt: string;
  /** `YYYY-MM-DD` of the class, if the entry is linked to one. */
  classDate: string | null;
  /** "2.3", if the entry is linked to a subtask. */
  subtaskLabel: string | null;
}

export interface NewPoint {
  groupId: string;
  userId: string;
  value: number;
  classId?: string | null;
  subtaskId?: string | null;
  note?: string | null;
}

/**
 * Points ledger. It is append-only: entries cannot be edited or deleted, a mistake is fixed with
 * a correcting entry (negative value). Every method throws if the query fails.
 */
@Service()
export class PointsService {
  private readonly supabase = inject(SupabaseService);
  private readonly session = inject(SessionService);

  /** Sum of a user's points in a group (0 when there are no entries). */
  async myTotal(groupId: string, userId: string): Promise<number> {
    const { data, error } = await this.supabase.client
      .from('points_totals')
      .select('points')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data?.points ?? 0;
  }

  /** Points of a user for one class, summed per subtask (entries without a subtask are ignored). */
  async forClass(classId: string, userId: string): Promise<Map<string, number>> {
    const { data, error } = await this.supabase.client
      .from('points')
      .select('subtask_id, value')
      .eq('class_id', classId)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    const totals = new Map<string, number>();
    for (const row of data) {
      if (row.subtask_id) {
        totals.set(row.subtask_id, (totals.get(row.subtask_id) ?? 0) + row.value);
      }
    }
    return totals;
  }

  /**
   * Adds an entry. RLS decides who may write what: a student only +1 for themselves,
   * an admin any entry for anyone in the group.
   */
  async add(point: NewPoint): Promise<void> {
    const createdBy = this.session.user()?.id;
    if (!createdBy) {
      throw new Error('Not signed in');
    }

    const { error } = await this.supabase.client.from('points').insert({
      group_id: point.groupId,
      user_id: point.userId,
      value: point.value,
      class_id: point.classId ?? null,
      subtask_id: point.subtaskId ?? null,
      note: point.note ?? null,
      created_by: createdBy,
    });

    if (error) {
      throw error;
    }
  }

  /**
   * Writes `count` separate +1 entries for the signed-in user in one request (all or none).
   * A student may only write +1 entries, so a larger number cannot be a single entry.
   */
  async addStartingPoints(groupId: string, userId: string, count: number, note: string): Promise<void> {
    const createdBy = this.session.user()?.id;
    if (!createdBy) {
      throw new Error('Not signed in');
    }

    const rows = Array.from({ length: count }, () => ({
      group_id: groupId,
      user_id: userId,
      value: 1,
      note,
      created_by: createdBy,
    }));

    const { error } = await this.supabase.client.from('points').insert(rows);
    if (error) {
      throw error;
    }
  }

  /** Entries of a group, newest first. `userId` narrows it to one person. */
  async history(
    groupId: string,
    options: { userId?: string | null; offset: number; limit: number },
  ): Promise<PointEntry[]> {
    let query = this.supabase.client
      .from('points')
      .select('id, user_id, value, note, created_by, created_at, classes(date), subtasks(task_no, subtask_no)')
      .eq('group_id', groupId);

    if (options.userId) {
      query = query.eq('user_id', options.userId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(options.offset, options.offset + options.limit - 1);

    if (error) {
      throw error;
    }

    return data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      value: row.value,
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at,
      classDate: row.classes?.date ?? null,
      subtaskLabel: row.subtasks ? `${row.subtasks.task_no}.${row.subtasks.subtask_no}` : null,
    }));
  }
}