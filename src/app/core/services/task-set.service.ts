import { inject, Service } from '@angular/core';
import { Tables } from '../database.types';
import { SupabaseService } from './supabase.service';

export type Subtask = Tables<'subtasks'>;

export interface TaskSetSummary {
  id: string;
  name: string;
  subtaskCount: number;
  /** In how many classes the set is used. */
  classCount: number;
}

export interface TaskSetDetail {
  id: string;
  name: string;
  /** Sorted by task number, then subtask number. */
  subtasks: Subtask[];
  classCount: number;
}

/**
 * Task sets and their subtasks (admin screens). Every method throws if the query fails.
 * RLS only lets group admins write; the UI hides these screens from students anyway.
 */
@Service()
export class TaskSetService {
  private readonly supabase = inject(SupabaseService);

  async list(groupId: string): Promise<TaskSetSummary[]> {
    const { data, error } = await this.supabase.client
      .from('task_sets')
      .select('id, name, subtasks(count), class_task_sets(count)')
      .eq('group_id', groupId);

    if (error) {
      throw error;
    }

    return data
      .map((row) => ({
        id: row.id,
        name: row.name,
        subtaskCount: row.subtasks[0]?.count ?? 0,
        classCount: row.class_task_sets[0]?.count ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));
  }

  async get(id: string): Promise<TaskSetDetail> {
    const { data, error } = await this.supabase.client
      .from('task_sets')
      .select('id, name, subtasks(*), class_task_sets(count)')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      subtasks: [...data.subtasks].sort(
        (a, b) => a.task_no - b.task_no || a.subtask_no - b.subtask_no,
      ),
      classCount: data.class_task_sets[0]?.count ?? 0,
    };
  }

  /** Creates an empty set and returns its id. */
  async create(groupId: string, name: string): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('task_sets')
      .insert({ group_id: groupId, name })
      .select('id')
      .single();

    if (error) {
      throw error;
    }
    return data.id;
  }

  async rename(id: string, name: string): Promise<void> {
    const { error } = await this.supabase.client.from('task_sets').update({ name }).eq('id', id);
    if (error) {
      throw error;
    }
  }

  /** Deletes the set. Its subtasks, class assignments, declarations and assignments cascade. */
  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('task_sets').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  /**
   * Adds subtasks `from..to` (inclusive) to a task. The task is created implicitly
   * if it has no subtasks yet. Numbers may start anywhere, e.g. 4..6 when the first
   * subtasks were done in an earlier class. Fails if one of the numbers already exists.
   */
  async addSubtasks(taskSetId: string, taskNo: number, from: number, to: number): Promise<void> {
    const rows = Array.from({ length: to - from + 1 }, (_, index) => ({
      task_set_id: taskSetId,
      task_no: taskNo,
      subtask_no: from + index,
      probability: 1,
    }));

    const { error } = await this.supabase.client.from('subtasks').insert(rows);
    if (error) {
      throw error;
    }
  }

  /** Removes a task together with all its subtasks. */
  async removeTask(taskSetId: string, taskNo: number): Promise<void> {
    const { error } = await this.supabase.client
      .from('subtasks')
      .delete()
      .eq('task_set_id', taskSetId)
      .eq('task_no', taskNo);

    if (error) {
      throw error;
    }
  }

  async removeSubtask(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('subtasks').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }
}