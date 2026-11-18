import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { plural } from '../../../core/plural';
import { SessionService } from '../../../core/services/session.service';
import { TaskSetService, TaskSetSummary } from '../../../core/services/task-set.service';
import { notBlankValidator } from '../../../core/validators/not-blank.validator';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';

const MAX_NAME_LENGTH = 120;

@Component({
  selector: 'app-task-set-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './task-set-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskSetList {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly taskSets = inject(TaskSetService);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly maxNameLength = MAX_NAME_LENGTH;
  protected readonly plural = plural;

  protected readonly createForm = this.fb.nonNullable.group({
    name: ['', [notBlankValidator, Validators.maxLength(MAX_NAME_LENGTH)]],
  });

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly creating = signal(false);
  protected readonly items = signal<TaskSetSummary[]>([]);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    const group = this.session.activeGroup();
    if (!group) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.loadFailed.set(false);

    try {
      this.items.set(await this.taskSets.list(group.groupId));
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    const group = this.session.activeGroup();
    if (!group || this.creating()) {
      return;
    }
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    this.creating.set(true);
    try {
      const id = await this.taskSets.create(group.groupId, this.createForm.controls.name.value.trim());
      // A new set is empty, so continue straight to adding its tasks.
      await this.router.navigate(['/admin/task-sets', id]);
    } catch {
      this.snackBar.open('Nie udało się dodać zestawu.', 'OK', { duration: 5000 });
    } finally {
      this.creating.set(false);
    }
  }

  protected async remove(item: TaskSetSummary): Promise<void> {
    let message = `Zestaw „${item.name}” zostanie usunięty razem z podpunktami (${item.subtaskCount}).`;
    if (item.classCount > 0) {
      message +=
        ` Jest przypisany do zajęć (${item.classCount}): zniknie z nich, a razem z nim` +
        ' deklaracje i przydziały jego podpunktów.';
    }

    const confirmed = await this.confirmService.confirm({
      title: 'Usunąć zestaw?',
      message,
      confirmLabel: 'Usuń',
    });
    if (!confirmed) {
      return;
    }

    try {
      await this.taskSets.remove(item.id);
      this.items.update((list) => list.filter((entry) => entry.id !== item.id));
    } catch {
      this.snackBar.open('Nie udało się usunąć zestawu.', 'OK', { duration: 5000 });
    }
  }
}
