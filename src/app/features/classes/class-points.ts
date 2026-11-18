import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SetView } from '../../core/class-structure';
import { PointsService } from '../../core/services/points.service';
import { SessionService } from '../../core/services/session.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';

/**
 * Lets a student record the points they got in class (the lecturer notes them on paper).
 * Any subtask of the class can be chosen, also one that was not assigned to the student
 * (e.g. they volunteered at the board). An entry is +1 and cannot be undone by the student.
 */
@Component({
  selector: 'app-class-points',
  imports: [MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './class-points.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassPoints implements OnInit {
  readonly classId = input.required<string>();
  readonly groupId = input.required<string>();
  readonly sets = input.required<SetView[]>();

  private readonly session = inject(SessionService);
  private readonly points = inject(PointsService);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly chipBase =
    'rounded-full border px-3.5 py-1.5 text-sm font-medium tabular-nums transition-colors ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-slate-900 disabled:cursor-default disabled:opacity-60';
  protected readonly chipAdded = 'border-emerald-300 bg-emerald-50 text-emerald-900';
  protected readonly chipIdle = 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);

  /** Points the user already has for this class, summed per subtask. */
  private readonly totals = signal<ReadonlyMap<string, number>>(new Map());
  /** Subtasks with a save in flight. */
  private readonly pending = signal<ReadonlySet<string>>(new Set());

  protected readonly total = computed(() => {
    let sum = 0;
    for (const value of this.totals().values()) {
      sum += value;
    }
    return sum;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    const user = this.session.user();
    if (!user) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.loadFailed.set(false);

    try {
      this.totals.set(await this.points.forClass(this.classId(), user.id));
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** A subtask counts as done once its entries add up to a positive number. */
  protected isAdded(subtaskId: string): boolean {
    return (this.totals().get(subtaskId) ?? 0) > 0;
  }

  protected isPending(subtaskId: string): boolean {
    return this.pending().has(subtaskId);
  }

  protected async addPoint(taskNo: number, subtaskNo: number, subtaskId: string): Promise<void> {
    const user = this.session.user();
    if (!user || this.isAdded(subtaskId) || this.isPending(subtaskId)) {
      return;
    }

    const confirmed = await this.confirmService.confirm({
      title: `Dodać plus za podpunkt ${taskNo}.${subtaskNo}?`,
      message: 'Plus trafi do Twojego wyniku. Wpisu nie możesz cofnąć, a pomyłkę poprawi administrator.',
      confirmLabel: 'Dodaj plus',
    });
    if (!confirmed) {
      return;
    }

    this.pending.update((previous) => new Set(previous).add(subtaskId));
    try {
      await this.points.add({
        groupId: this.groupId(),
        userId: user.id,
        value: 1,
        classId: this.classId(),
        subtaskId,
      });
      this.totals.update((previous) => new Map(previous).set(subtaskId, (previous.get(subtaskId) ?? 0) + 1));
      this.snackBar.open(`Dodano plus za podpunkt ${taskNo}.${subtaskNo}.`, 'OK', { duration: 4000 });
    } catch {
      this.snackBar.open('Nie udało się dodać plusa. Spróbuj ponownie.', 'OK', { duration: 5000 });
    } finally {
      this.pending.update((previous) => {
        const next = new Set(previous);
        next.delete(subtaskId);
        return next;
      });
    }
  }
}
