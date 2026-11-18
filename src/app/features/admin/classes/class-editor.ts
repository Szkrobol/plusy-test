import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CLASS_STATUS_CHIP,
  CLASS_STATUS_EFFECTS,
  CLASS_STATUS_LABELS,
  CLASS_STATUSES,
  ClassStatus,
} from '../../../core/class-status';
import { buildSets, SetView } from '../../../core/class-structure';
import { formatDay, fromDatetimeLocal, toDatetimeLocal } from '../../../core/date-utils';
import { plural } from '../../../core/plural';
import {
  AssignmentRow,
  AssignmentService,
  AssignResult,
} from '../../../core/services/assignment.service';
import { ClassRow, ClassService, ClassTaskSet } from '../../../core/services/class.service';
import { DeclarationService } from '../../../core/services/declaration.service';
import { GroupService } from '../../../core/services/group.service';
import { SessionService } from '../../../core/services/session.service';
import { TaskSetService, TaskSetSummary } from '../../../core/services/task-set.service';
import { UserFacingError } from '../../../core/user-facing-error';
import { AssignmentsView } from '../../../shared/assignments-view/assignments-view';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';

const NOT_FOUND_CODE = 'PGRST116'; // `.single()` matched no row (missing id or hidden by RLS)

type Attempt<T> = { ok: true; value: T } | { ok: false };

/**
 * Editor for one class: date, deadline, task sets and the course of the class
 * (opening round 1, running the assignments, finishing).
 *
 * Status changes after a round are made by the `assign` Edge Function, not by this screen:
 * it only calls the function and reloads. Everything else is written immediately.
 */
@Component({
  selector: 'app-class-editor',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    AssignmentsView,
  ],
  templateUrl: './class-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassEditor {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly classes = inject(ClassService);
  private readonly taskSets = inject(TaskSetService);
  private readonly declarations = inject(DeclarationService);
  private readonly assignments = inject(AssignmentService);
  private readonly groups = inject(GroupService);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly classId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly statuses = CLASS_STATUSES;
  protected readonly statusLabels = CLASS_STATUS_LABELS;
  protected readonly statusChip = CLASS_STATUS_CHIP;
  protected readonly formatDay = formatDay;
  protected readonly plural = plural;

  protected readonly loading = signal(true);
  protected readonly loadError = signal<'not-found' | 'failed' | null>(null);
  /** True while a write is running; editing controls are disabled meanwhile. */
  protected readonly busy = signal(false);

  protected readonly row = signal<ClassRow | null>(null);
  protected readonly availableSets = signal<TaskSetSummary[]>([]);
  protected readonly selectedSetIds = signal<ReadonlySet<string>>(new Set());
  /** Structure (tasks and subtasks) of the sets assigned to this class. */
  protected readonly classSets = signal<SetView[]>([]);

  protected readonly assignmentRows = signal<AssignmentRow[]>([]);
  protected readonly names = signal<ReadonlyMap<string, string>>(new Map());
  /** Declarations in the currently open round (null when no round is open). */
  protected readonly declarationStats = signal<{ declarations: number; students: number } | null>(null);
  /** Message about the last assignment run in this session. */
  protected readonly resultNote = signal<string | null>(null);

  protected readonly currentUserId = computed(() => this.session.user()?.id ?? null);

  protected readonly totalSubtasks = computed(() => {
    const selected = this.selectedSetIds();
    return this.availableSets()
      .filter((set) => selected.has(set.id))
      .reduce((sum, set) => sum + set.subtaskCount, 0);
  });

  /** What the round 1 limit per person would be right now: ceil(subtasks / willing students). */
  protected readonly expectedLimit = computed(() => {
    const stats = this.declarationStats();
    if (!stats || stats.students === 0) {
      return null;
    }
    return Math.ceil(this.totalSubtasks() / stats.students);
  });

  /**
   * True when the deadline has passed. The database then rejects new declarations in the open
   * round, so students cannot sign up until the deadline is changed or cleared.
   */
  protected readonly deadlinePassed = computed(() => {
    const deadline = this.row()?.declarations_deadline;
    return !!deadline && Date.now() >= new Date(deadline).getTime();
  });

  protected readonly assignedCount = computed(
    () => this.assignmentRows().filter((entry) => entry.userId !== null).length,
  );
  protected readonly freeCount = computed(
    () => this.assignmentRows().filter((entry) => entry.userId === null).length,
  );

  protected readonly detailsForm = this.fb.nonNullable.group({
    date: ['', [Validators.required]],
    /** `datetime-local` value; empty means no deadline. */
    deadline: [''],
  });

  protected readonly statusControl = this.fb.nonNullable.control<ClassStatus>('draft');

  constructor() {
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
    this.loadError.set(null);

    try {
      const [detail, sets, names] = await Promise.all([
        this.classes.getWithTasks(this.classId),
        this.taskSets.list(group.groupId),
        this.groups.members(group.groupId),
      ]);

      this.availableSets.set(sets);
      this.names.set(names);
      this.applyClass(detail.row, detail.taskSets);
      this.detailsForm.reset({
        date: detail.row.date,
        deadline: toDatetimeLocal(detail.row.declarations_deadline),
      });
      await this.loadProgress();
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.loadError.set(code === NOT_FOUND_CODE ? 'not-found' : 'failed');
    } finally {
      this.loading.set(false);
    }
  }

  private applyClass(row: ClassRow, taskSets: ClassTaskSet[]): void {
    this.row.set(row);
    this.selectedSetIds.set(new Set(taskSets.map((set) => set.id)));
    this.classSets.set(buildSets(taskSets));
    this.statusControl.setValue(row.status);
  }

  /** Loads what depends on the status: declaration counts of the open round and the assignments. */
  private async loadProgress(): Promise<void> {
    const status = this.row()?.status;

    const round = status === 'round1_open' ? 1 : status === 'round2_open' ? 2 : null;
    this.declarationStats.set(round ? await this.declarations.summary(this.classId, round) : null);

    const hasAssignments = status === 'round2_open' || status === 'assigned' || status === 'finished';
    this.assignmentRows.set(hasAssignments ? await this.assignments.forClass(this.classId) : []);
  }

  /** Reloads the class and its progress after a change made on the server. */
  private async refresh(): Promise<void> {
    try {
      const detail = await this.classes.getWithTasks(this.classId);
      this.applyClass(detail.row, detail.taskSets);
      await this.loadProgress();
    } catch {
      this.snackBar.open('Nie udało się odświeżyć widoku. Odśwież stronę.', 'OK', { duration: 8000 });
    }
  }

  // ----- Date and deadline -----

  protected async saveDetails(): Promise<void> {
    if (this.detailsForm.invalid) {
      this.detailsForm.markAllAsTouched();
      return;
    }

    const { date, deadline } = this.detailsForm.getRawValue();
    const deadlineIso = fromDatetimeLocal(deadline);
    if (deadline && deadlineIso === null) {
      this.detailsForm.controls.deadline.setErrors({ invalid: true });
      return;
    }

    const saved = await this.run(
      () => this.classes.update(this.classId, { date, declarationsDeadline: deadlineIso }),
      'Nie udało się zapisać zmian.',
    );
    if (saved) {
      this.row.update((row) =>
        row ? { ...row, date, declarations_deadline: deadlineIso } : row,
      );
      this.detailsForm.reset({ date, deadline });
    }
  }

  // ----- Task sets -----

  protected isSelected(setId: string): boolean {
    return this.selectedSetIds().has(setId);
  }

  protected async toggleSet(set: TaskSetSummary, event: MatCheckboxChange): Promise<void> {
    const add = event.checked;

    // Students can already see a class that is not a draft, so ask before hiding a set.
    if (!add && this.row()?.status !== 'draft') {
      const confirmed = await this.confirmService.confirm({
        title: 'Usunąć zestaw z zajęć?',
        message:
          `Zajęcia są widoczne dla studentów. Podpunkty zestawu „${set.name}” znikną z tych zajęć, ` +
          'a istniejące zgłoszenia do nich zostaną w bazie.',
        confirmLabel: 'Usuń',
      });
      if (!confirmed) {
        event.source.checked = true;
        return;
      }
    }

    const saved = await this.run(
      () =>
        add
          ? this.classes.addTaskSet(this.classId, set.id)
          : this.classes.removeTaskSet(this.classId, set.id),
      'Nie udało się zmienić zestawów.',
    );

    if (!saved) {
      event.source.checked = !add; // put the checkbox back
      return;
    }
    await this.refresh();
  }

  // ----- Course of the class -----

  /** draft -> round 1 open. */
  protected async openRound1(): Promise<void> {
    if (this.selectedSetIds().size === 0) {
      this.snackBar.open('Najpierw wybierz co najmniej jeden zestaw zadań.', 'OK', {
        duration: 5000,
      });
      return;
    }

    const confirmed = await this.confirmService.confirm({
      title: 'Otworzyć zapisy (tura 1)?',
      message: CLASS_STATUS_EFFECTS.round1_open,
      confirmLabel: 'Otwórz zapisy',
    });
    if (!confirmed) {
      return;
    }

    const saved = await this.run(
      () => this.classes.setStatus(this.classId, 'round1_open'),
      'Nie udało się otworzyć zapisów.',
    );
    if (saved) {
      this.resultNote.set(null);
      await this.refresh();
    }
  }

  /** Runs the assignment of a round; the Edge Function moves the class to the next status. */
  protected async runAssignment(round: 1 | 2): Promise<void> {
    const limit = this.expectedLimit();
    const message =
      round === 1
        ? 'Zapisy w turze 1 zostaną zamknięte, a podpunkty rozdzielone między chętnych' +
          (limit !== null ? ` (limit: ${limit} na osobę)` : '') +
          '. Zajęcia przejdą do tury 2. W aplikacji nie da się tego cofnąć.'
        : 'Przydział w turze 2 zamknie zapisy, a zajęcia przejdą do statusu „Przydzielone”. ' +
          'W aplikacji nie da się tego cofnąć.';

    const confirmed = await this.confirmService.confirm({
      title: `Uruchomić przydział (tura ${round})?`,
      message,
      confirmLabel: 'Uruchom przydział',
    });
    if (!confirmed) {
      return;
    }

    const attempt = await this.attempt<AssignResult>(
      () => this.assignments.run(this.classId, round),
      'Nie udało się uruchomić przydziału.',
    );
    if (!attempt.ok) {
      return;
    }

    const result = attempt.value;
    const assigned = result.assignments.filter((entry) => entry.studentId !== null).length;
    let note = `Przydział zapisany: ${assigned} z ${result.assignments.length} podpunktów.`;
    if (result.limitPerPerson !== null) {
      note += ` Limit w turze 1: ${result.limitPerPerson} na osobę.`;
    }
    if (round === 1 && this.row()?.declarations_deadline) {
      note +=
        ' Termin zapisów z tury 1 mógł już minąć. Ustaw nowy albo wyczyść go w sekcji „Termin”,' +
        ' inaczej studenci nie dopiszą się w turze 2.';
    }
    this.resultNote.set(note);
    await this.refresh();
  }

  /** assigned -> finished. */
  protected async finish(): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Zakończyć zajęcia?',
      message: CLASS_STATUS_EFFECTS.finished,
      confirmLabel: 'Zakończ',
    });
    if (!confirmed) {
      return;
    }

    const saved = await this.run(
      () => this.classes.setStatus(this.classId, 'finished'),
      'Nie udało się zakończyć zajęć.',
    );
    if (saved) {
      this.resultNote.set(null);
      await this.refresh();
    }
  }

  // ----- Manual status change (corrections) -----

  protected async changeStatus(): Promise<void> {
    const current = this.row()?.status;
    const target = this.statusControl.value;
    if (!current || target === current) {
      return;
    }

    const confirmed = await this.confirmService.confirm({
      title: `Zmienić status na „${CLASS_STATUS_LABELS[target]}”?`,
      message:
        CLASS_STATUS_EFFECTS[target] +
        ' Ręczna zmiana nie uruchamia przydziału i nie czyści jego wyników.',
      confirmLabel: 'Zmień',
    });
    if (!confirmed) {
      return;
    }

    const saved = await this.run(
      () => this.classes.setStatus(this.classId, target),
      'Nie udało się zmienić statusu.',
    );
    if (saved) {
      this.resultNote.set(null);
      await this.refresh();
    }
  }

  // ----- Delete -----

  protected async remove(): Promise<void> {
    const row = this.row();
    if (!row) {
      return;
    }

    const confirmed = await this.confirmService.confirm({
      title: 'Usunąć zajęcia?',
      message:
        `Zajęcia z dnia ${formatDay(row.date)} zostaną usunięte razem ze zgłoszeniami i przydziałami. ` +
        'Przyznane plusy zostaną zachowane, ale stracą powiązanie z tymi zajęciami.',
      confirmLabel: 'Usuń',
    });
    if (!confirmed) {
      return;
    }

    const removed = await this.run(
      () => this.classes.remove(this.classId),
      'Nie udało się usunąć zajęć.',
    );
    if (removed) {
      await this.router.navigateByUrl('/admin/classes');
    }
  }

  // ----- Helpers -----

  /** Runs a write with the busy flag set. Returns false (and shows a message) on failure. */
  private async run(action: () => Promise<void>, errorMessage: string): Promise<boolean> {
    return (await this.attempt(action, errorMessage)).ok;
  }

  /**
   * Like `run`, but returns the action's result. A UserFacingError keeps its own message,
   * any other error shows `errorMessage`.
   */
  private async attempt<T>(action: () => Promise<T>, errorMessage: string): Promise<Attempt<T>> {
    if (this.busy()) {
      return { ok: false };
    }

    this.busy.set(true);
    try {
      return { ok: true, value: await action() };
    } catch (error) {
      const message = error instanceof UserFacingError ? error.message : errorMessage;
      this.snackBar.open(message, 'OK', { duration: 6000 });
      return { ok: false };
    } finally {
      this.busy.set(false);
    }
  }
}