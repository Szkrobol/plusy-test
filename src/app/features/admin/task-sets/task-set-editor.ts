import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { plural } from '../../../core/plural';
import { Subtask, TaskSetDetail, TaskSetService } from '../../../core/services/task-set.service';
import { notBlankValidator } from '../../../core/validators/not-blank.validator';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';

const MAX_NAME_LENGTH = 120;
const MAX_TASK_NO = 99;
const MAX_SUBTASK_NO = 99;
/** Most subtasks that can be added in one go. */
const MAX_RANGE = 30;
const NOT_FOUND_CODE = 'PGRST116'; // `.single()` matched no row (missing id or hidden by RLS)
const INTEGER = /^\d+$/;

interface TaskGroup {
  taskNo: number;
  subtasks: Subtask[];
}

/** The "to" field must not be lower than "from" and the range must not be too long. */
const validRange: ValidatorFn = (control) => {
  if (!control.parent) {
    return null;
  }
  const from = Number(control.parent.get('from')?.value);
  const to = Number(control.value);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  if (to < from) {
    return { beforeFrom: true };
  }
  return to - from + 1 > MAX_RANGE ? { tooMany: true } : null;
};

/**
 * Editor for one task set. Structure changes are written to the database immediately
 * and the set is reloaded afterwards, so the screen always mirrors what is stored.
 *
 * Task and subtask numbers are entered by hand and may have gaps or start anywhere
 * (sets are often finished in later classes, e.g. task 3 continuing from subtask 4).
 */
@Component({
  selector: 'app-task-set-editor',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './task-set-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskSetEditor {
  private readonly fb = inject(FormBuilder);
  private readonly taskSets = inject(TaskSetService);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly setId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly maxNameLength = MAX_NAME_LENGTH;
  protected readonly maxTaskNo = MAX_TASK_NO;
  protected readonly maxSubtaskNo = MAX_SUBTASK_NO;
  protected readonly maxRange = MAX_RANGE;
  protected readonly plural = plural;

  protected readonly loading = signal(true);
  protected readonly loadError = signal<'not-found' | 'failed' | null>(null);
  /** True while a write is running; all editing controls are disabled meanwhile. */
  protected readonly busy = signal(false);

  protected readonly name = signal('');
  protected readonly subtasks = signal<Subtask[]>([]);
  protected readonly classCount = signal(0);
  /** Set when the requested range overlaps subtasks that already exist. */
  protected readonly addConflict = signal<string | null>(null);

  protected readonly tasks = computed<TaskGroup[]>(() => {
    const byTask = new Map<number, Subtask[]>();
    for (const subtask of this.subtasks()) {
      const list = byTask.get(subtask.task_no);
      if (list) {
        list.push(subtask);
      } else {
        byTask.set(subtask.task_no, [subtask]);
      }
    }
    return [...byTask.entries()]
      .sort(([a], [b]) => a - b)
      .map(([taskNo, subtasks]) => ({ taskNo, subtasks }));
  });

  protected readonly nameForm = this.fb.nonNullable.group({
    name: ['', [notBlankValidator, Validators.maxLength(MAX_NAME_LENGTH)]],
  });

  protected readonly addForm = this.fb.nonNullable.group({
    taskNo: [1, [Validators.required, Validators.min(1), Validators.max(MAX_TASK_NO), Validators.pattern(INTEGER)]],
    from: [1, [Validators.required, Validators.min(1), Validators.max(MAX_SUBTASK_NO), Validators.pattern(INTEGER)]],
    to: [1, [Validators.required, Validators.min(1), Validators.max(MAX_SUBTASK_NO), Validators.pattern(INTEGER), validRange]],
  });

  constructor() {
    // Picking a task pre-fills the range with the next free subtask number of that task.
    this.addForm.controls.taskNo.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.suggestRange());

    // The "to" validator depends on "from".
    this.addForm.controls.from.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.addForm.controls.to.updateValueAndValidity());

    void this.loadInitial();
  }

  // ----- Loading -----

  protected async loadInitial(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const detail = await this.taskSets.get(this.setId);
      this.apply(detail);
      this.nameForm.reset({ name: detail.name });
      // Sets are usually continued where they stopped, so start with the last task.
      this.addForm.patchValue({ taskNo: this.lastTaskNo() });
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.loadError.set(code === NOT_FOUND_CODE ? 'not-found' : 'failed');
    } finally {
      this.loading.set(false);
    }
  }

  private async reload(): Promise<void> {
    this.apply(await this.taskSets.get(this.setId));
    this.suggestRange();
  }

  private apply(detail: TaskSetDetail): void {
    this.name.set(detail.name);
    this.subtasks.set(detail.subtasks);
    this.classCount.set(detail.classCount);
  }

  private lastTaskNo(): number {
    const numbers = this.tasks().map((task) => task.taskNo);
    return numbers.length > 0 ? Math.max(...numbers) : 1;
  }

  private nextSubtaskNo(taskNo: number): number {
    const numbers = this.subtasks()
      .filter((subtask) => subtask.task_no === taskNo)
      .map((subtask) => subtask.subtask_no);
    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  }

  private suggestRange(): void {
    const next = this.nextSubtaskNo(this.addForm.controls.taskNo.value);
    // `from` first: the validator of `to` reads it.
    this.addForm.patchValue({ from: next, to: next });
    this.addConflict.set(null);
  }

  // ----- Name -----

  protected async renameSet(): Promise<void> {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }

    const name = this.nameForm.controls.name.value.trim();
    const saved = await this.run(() => this.taskSets.rename(this.setId, name), 'Nie udało się zapisać nazwy.');
    if (saved) {
      this.name.set(name);
      this.nameForm.reset({ name });
    }
  }

  // ----- Tasks and subtasks -----

  /** Adds subtasks `from..to` to the chosen task (creating the task if it is new). */
  protected async addSubtasks(): Promise<void> {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }

    const { taskNo, from, to } = this.addForm.getRawValue();

    const existing = new Set(
      this.subtasks()
        .filter((subtask) => subtask.task_no === taskNo)
        .map((subtask) => subtask.subtask_no),
    );
    const conflicts: number[] = [];
    for (let number = from; number <= to; number++) {
      if (existing.has(number)) {
        conflicts.push(number);
      }
    }
    if (conflicts.length > 0) {
      const labels = conflicts.map((number) => `${taskNo}.${number}`).join(', ');
      this.addConflict.set(`Te podpunkty już istnieją: ${labels}.`);
      return;
    }

    this.addConflict.set(null);
    await this.run(async () => {
      await this.taskSets.addSubtasks(this.setId, taskNo, from, to);
      await this.reload();
    }, 'Nie udało się dodać podpunktów.');
  }

  /** Quick action on a task card: adds the subtask after the highest existing one. */
  protected async addNextSubtask(task: TaskGroup): Promise<void> {
    const next = this.nextSubtaskNo(task.taskNo);
    if (next > MAX_SUBTASK_NO) {
      this.snackBar.open(`Najwyższy numer podpunktu to ${MAX_SUBTASK_NO}.`, 'OK', { duration: 5000 });
      return;
    }

    await this.run(async () => {
      await this.taskSets.addSubtasks(this.setId, task.taskNo, next, next);
      await this.reload();
    }, 'Nie udało się dodać podpunktu.');
  }

  protected async removeTask(task: TaskGroup): Promise<void> {
    let message = `Zadanie ${task.taskNo} zostanie usunięte razem z podpunktami (${task.subtasks.length}).`;
    if (this.classCount() > 0) {
      message += ' Zestaw jest przypisany do zajęć, więc znikną też deklaracje i przydziały tych podpunktów.';
    }

    const confirmed = await this.confirmService.confirm({
      title: `Usunąć zadanie ${task.taskNo}?`,
      message,
      confirmLabel: 'Usuń',
    });
    if (!confirmed) {
      return;
    }

    await this.run(async () => {
      await this.taskSets.removeTask(this.setId, task.taskNo);
      await this.reload();
    }, 'Nie udało się usunąć zadania.');
  }

  protected async removeSubtask(subtask: Subtask): Promise<void> {
    // Removing a subtask also removes its declarations and assignments, so ask when it is in use.
    if (this.classCount() > 0) {
      const confirmed = await this.confirmService.confirm({
        title: `Usunąć podpunkt ${subtask.task_no}.${subtask.subtask_no}?`,
        message: 'Zestaw jest przypisany do zajęć, więc znikną też deklaracje i przydziały tego podpunktu.',
        confirmLabel: 'Usuń',
      });
      if (!confirmed) {
        return;
      }
    }

    await this.run(async () => {
      await this.taskSets.removeSubtask(subtask.id);
      await this.reload();
    }, 'Nie udało się usunąć podpunktu.');
  }

  // ----- Helpers -----

  /** Runs a write with the busy flag set. Returns false (and shows a message) on failure. */
  private async run(action: () => Promise<void>, errorMessage: string): Promise<boolean> {
    if (this.busy()) {
      return false;
    }

    this.busy.set(true);
    try {
      await action();
      return true;
    } catch {
      this.snackBar.open(errorMessage, 'OK', { duration: 5000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}