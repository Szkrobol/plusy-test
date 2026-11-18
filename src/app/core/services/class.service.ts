import { inject, Service } from '@angular/core';
import { ClassStatus } from '../class-status';
import { Tables } from '../database.types';
import { toIsoDate } from '../date-utils';
import { SupabaseService } from './supabase.service';

export type ClassRow = Tables<'classes'>;

export interface ClassSummary {
  id: string;
  date: string;
  status: ClassStatus;
  declarationsDeadline: string | null;
  taskSetCount: number;
}

export interface ClassDetail {
  row: ClassRow;
  taskSetIds: string[];
}

export interface ClassTaskSet {
  id: string;
  name: string;
  subtasks: { id: string; task_no: number; subtask_no: number }[];
}

export interface ClassWithTasks {
  row: ClassRow;
  taskSets: ClassTaskSet[];
}

/** Classes of a group. Every method throws if the query fails. */
@Service()
export class ClassService {
  private readonly supabase = inject(SupabaseService);

  /**
   * Classes from today onwards, soonest first (home page).
   * Drafts are only meant for admins; RLS lets every member read them, so students filter them out here.
   */
  async upcoming(groupId: string, includeDrafts: boolean, limit = 10): Promise<ClassRow[]> {
    let query = this.supabase.client
      .from('classes')
      .select('*')
      .eq('group_id', groupId)
      .gte('date', toIsoDate(new Date()));

    if (!includeDrafts) {
      query = query.neq('status', 'draft');
    }

    const { data, error } = await query.order('date', { ascending: true }).limit(limit);
    if (error) {
      throw error;
    }
    return data;
  }

  /** All classes of a group (admin list), newest first. */
  async list(groupId: string): Promise<ClassSummary[]> {
    const { data, error } = await this.supabase.client
      .from('classes')
      .select('id, date, status, declarations_deadline, class_task_sets(count)')
      .eq('group_id', groupId)
      .order('date', { ascending: false })
      .limit(200);

    if (error) {
      throw error;
    }

    return data.map((row) => ({
      id: row.id,
      date: row.date,
      status: row.status,
      declarationsDeadline: row.declarations_deadline,
      taskSetCount: row.class_task_sets[0]?.count ?? 0,
    }));
  }

  async get(id: string): Promise<ClassDetail> {
    const { data, error } = await this.supabase.client
      .from('classes')
      .select('*, class_task_sets(task_set_id)')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    const { class_task_sets, ...row } = data;
    return { row, taskSetIds: class_task_sets.map((link) => link.task_set_id) };
  }

  /** A class with the task sets assigned to it and their subtasks (student view). */
  async getWithTasks(id: string): Promise<ClassWithTasks> {
    const { data, error } = await this.supabase.client
      .from('classes')
      .select('*, class_task_sets(task_sets(id, name, subtasks(id, task_no, subtask_no)))')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    const { class_task_sets, ...row } = data;
    const taskSets = class_task_sets
      .flatMap((link) => (link.task_sets ? [link.task_sets] : []))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

    return { row, taskSets };
  }

  /** Creates a draft class and returns its id. */
  async create(groupId: string, date: string): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('classes')
      .insert({ group_id: groupId, date })
      .select('id')
      .single();

    if (error) {
      throw error;
    }
    return data.id;
  }

  async update(
    id: string,
    changes: { date: string; declarationsDeadline: string | null },
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('classes')
      .update({ date: changes.date, declarations_deadline: changes.declarationsDeadline })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async setStatus(id: string, status: ClassStatus): Promise<void> {
    const { error } = await this.supabase.client.from('classes').update({ status }).eq('id', id);
    if (error) {
      throw error;
    }
  }

  /** Deletes the class. Its declarations and assignments cascade; points are kept without the class. */
  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('classes').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async addTaskSet(classId: string, taskSetId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('class_task_sets')
      .insert({ class_id: classId, task_set_id: taskSetId });

    if (error) {
      throw error;
    }
  }

  async removeTaskSet(classId: string, taskSetId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('class_task_sets')
      .delete()
      .eq('class_id', classId)
      .eq('task_set_id', taskSetId);

    if (error) {
      throw error;
    }
  }
}