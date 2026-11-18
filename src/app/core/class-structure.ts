import { ClassTaskSet } from './services/class.service';

export interface SubtaskView {
  id: string;
  subtaskNo: number;
}

export interface TaskView {
  taskNo: number;
  subtasks: SubtaskView[];
}

export interface SetView {
  id: string;
  name: string;
  tasks: TaskView[];
}

/** Groups the flat subtasks of each task set into tasks, ordered by number. */
export function buildSets(taskSets: ClassTaskSet[]): SetView[] {
  return taskSets.map((set) => {
    const byTask = new Map<number, SubtaskView[]>();
    const ordered = [...set.subtasks].sort(
      (a, b) => a.task_no - b.task_no || a.subtask_no - b.subtask_no,
    );

    for (const subtask of ordered) {
      const view = { id: subtask.id, subtaskNo: subtask.subtask_no };
      const list = byTask.get(subtask.task_no);
      if (list) {
        list.push(view);
      } else {
        byTask.set(subtask.task_no, [view]);
      }
    }

    const tasks = [...byTask.entries()]
      .sort(([a], [b]) => a - b)
      .map(([taskNo, subtasks]) => ({ taskNo, subtasks }));

    return { id: set.id, name: set.name, tasks };
  });
}
