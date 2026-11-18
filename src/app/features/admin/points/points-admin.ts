import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { buildSets } from '../../../core/class-structure';
import { formatDateTime, formatDay } from '../../../core/date-utils';
import { ClassService, ClassSummary } from '../../../core/services/class.service';
import { GroupService } from '../../../core/services/group.service';
import { PointEntry, PointsService } from '../../../core/services/points.service';
import { SessionService } from '../../../core/services/session.service';

const PAGE_SIZE = 50;
const MAX_ABS_VALUE = 10;
const MAX_NOTE_LENGTH = 200;

/** A whole number other than 0, at most MAX_ABS_VALUE away from it. */
const validPointValue: ValidatorFn = (control) => {
  const value = control.value;
  const ok = Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_ABS_VALUE;
  return ok ? null : { pointValue: true };
};

interface MemberOption {
  id: string;
  name: string;
}

interface SubtaskOption {
  id: string;
  label: string;
}

/**
 * Admin view of the points ledger: add an entry for anyone (also corrections with a negative
 * value) and browse the history. Entries cannot be edited or deleted, only corrected.
 */
@Component({
  selector: 'app-points-admin',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './points-admin.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PointsAdmin {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly groups = inject(GroupService);
  private readonly classes = inject(ClassService);
  private readonly points = inject(PointsService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly formatDay = formatDay;
  protected readonly formatDateTime = formatDateTime;
  protected readonly maxAbsValue = MAX_ABS_VALUE;
  protected readonly maxNoteLength = MAX_NOTE_LENGTH;

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly submitting = signal(false);

  protected readonly members = signal<MemberOption[]>([]);
  private readonly names = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly classOptions = signal<ClassSummary[]>([]);
  protected readonly subtaskOptions = signal<SubtaskOption[]>([]);

  protected readonly entries = signal<PointEntry[]>([]);
  protected readonly historyLoading = signal(false);
  protected readonly historyFailed = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);

  protected readonly filterUser = this.fb.control<string | null>(null);

  protected readonly form = this.fb.group({
    userId: this.fb.control<string | null>(null, [Validators.required]),
    value: this.fb.nonNullable.control(1, [validPointValue]),
    classId: this.fb.control<string | null>(null),
    subtaskId: this.fb.control<string | null>({ value: null, disabled: true }),
    note: this.fb.nonNullable.control('', [Validators.maxLength(MAX_NOTE_LENGTH)]),
  });

  constructor() {
    // A subtask can only be chosen once a class is chosen.
    this.form.controls.classId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((classId) => void this.onClassChange(classId));

    this.filterUser.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.loadHistory(true));

    void this.loadInitial();
  }

  // ----- Loading -----

  protected async loadInitial(): Promise<void> {
    const group = this.session.activeGroup();
    if (!group) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.loadFailed.set(false);

    try {
      const [names, classes] = await Promise.all([
        this.groups.members(group.groupId),
        this.classes.list(group.groupId),
      ]);

      this.names.set(names);
      this.members.set(
        [...names]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pl')),
      );
      this.classOptions.set(classes);
    } catch {
      this.loadFailed.set(true);
      return;
    } finally {
      this.loading.set(false);
    }

    await this.loadHistory(true);
  }

  /** Loads the first page (`reset`) or the next one of the history. */
  protected async loadHistory(reset: boolean): Promise<void> {
    const group = this.session.activeGroup();
    if (!group) {
      return;
    }

    const offset = reset ? 0 : this.entries().length;
    if (reset) {
      this.historyLoading.set(true);
    } else {
      this.loadingMore.set(true);
    }
    this.historyFailed.set(false);

    try {
      const rows = await this.points.history(group.groupId, {
        userId: this.filterUser.value,
        offset,
        limit: PAGE_SIZE,
      });
      this.entries.set(reset ? rows : [...this.entries(), ...rows]);
      this.hasMore.set(rows.length === PAGE_SIZE);
    } catch {
      this.historyFailed.set(true);
    } finally {
      this.historyLoading.set(false);
      this.loadingMore.set(false);
    }
  }

  private async onClassChange(classId: string | null): Promise<void> {
    const subtaskControl = this.form.controls.subtaskId;
    subtaskControl.setValue(null);
    this.subtaskOptions.set([]);

    if (!classId) {
      subtaskControl.disable();
      return;
    }
    subtaskControl.enable();

    try {
      const detail = await this.classes.getWithTasks(classId);
      // The user may have picked another class while this one was loading.
      if (this.form.controls.classId.value !== classId) {
        return;
      }

      const options: SubtaskOption[] = [];
      for (const set of buildSets(detail.taskSets)) {
        for (const task of set.tasks) {
          for (const subtask of task.subtasks) {
            options.push({ id: subtask.id, label: `${set.name} · ${task.taskNo}.${subtask.subtaskNo}` });
          }
        }
      }
      this.subtaskOptions.set(options);
    } catch {
      this.snackBar.open('Nie udało się pobrać podpunktów tych zajęć.', 'OK', { duration: 5000 });
    }
  }

  // ----- Adding -----

  protected async submit(): Promise<void> {
    const group = this.session.activeGroup();
    if (!group || this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { userId, value, classId, subtaskId, note } = this.form.getRawValue();
    if (!userId) {
      return;
    }

    this.submitting.set(true);
    try {
      await this.points.add({
        groupId: group.groupId,
        userId,
        value,
        classId,
        subtaskId,
        note: note.trim() || null,
      });

      this.snackBar.open('Wpis dodany.', 'OK', { duration: 4000 });
      // Keep the class: several people are usually entered for the same class in a row.
      this.form.patchValue({ userId: null, value: 1, subtaskId: null, note: '' });
      this.form.markAsPristine();
      this.form.markAsUntouched();
      await this.loadHistory(true);
    } catch {
      this.snackBar.open('Nie udało się dodać wpisu.', 'OK', { duration: 5000 });
    } finally {
      this.submitting.set(false);
    }
  }

  // ----- Template helpers -----

  protected nameOf(userId: string): string {
    return this.names().get(userId) ?? 'Inna osoba';
  }

  protected addedBy(entry: PointEntry): string {
    return entry.createdBy === entry.userId ? 'wpisał(a) sam(a)' : `dodał(a): ${this.nameOf(entry.createdBy)}`;
  }

  protected valueLabel(value: number): string {
    return value > 0 ? `+${value}` : String(value);
  }
}
