import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { CLASS_STATUS_CHIP, CLASS_STATUS_LABELS, isRoundOpen } from '../../../core/class-status';
import { formatDateTime, formatDay, toIsoDate } from '../../../core/date-utils';
import { plural } from '../../../core/plural';
import { ClassService, ClassSummary } from '../../../core/services/class.service';
import { SessionService } from '../../../core/services/session.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';

interface ClassSection {
  title: string;
  items: ClassSummary[];
  /** Shown instead of the list when the section is empty. */
  emptyText: string;
}

@Component({
  selector: 'app-class-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './class-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassList {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly classes = inject(ClassService);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly statusLabels = CLASS_STATUS_LABELS;
  protected readonly statusChip = CLASS_STATUS_CHIP;
  protected readonly isRoundOpen = isRoundOpen;
  protected readonly formatDay = formatDay;
  protected readonly formatDateTime = formatDateTime;
  protected readonly plural = plural;

  private readonly today = toIsoDate(new Date());

  protected readonly createForm = this.fb.nonNullable.group({
    date: [this.today, [Validators.required]],
  });

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly creating = signal(false);
  protected readonly items = signal<ClassSummary[]>([]);

  /** From today onwards, soonest first. */
  protected readonly upcoming = computed(() =>
    this.items()
      .filter((item) => item.date >= this.today)
      .sort((a, b) => a.date.localeCompare(b.date)),
  );

  /** Earlier classes, newest first (the list is loaded in that order). */
  protected readonly past = computed(() => this.items().filter((item) => item.date < this.today));

  /** Sections rendered one after another; "Minione" only appears when there is something in it. */
  protected readonly sections = computed<ClassSection[]>(() => {
    const sections: ClassSection[] = [
      { title: 'Nadchodzące', items: this.upcoming(), emptyText: 'Brak nadchodzących zajęć.' },
    ];
    const past = this.past();
    if (past.length > 0) {
      sections.push({ title: 'Minione', items: past, emptyText: '' });
    }
    return sections;
  });

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
      this.items.set(await this.classes.list(group.groupId));
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
      const id = await this.classes.create(group.groupId, this.createForm.controls.date.value);
      // A new class is an empty draft, so continue straight to choosing its task sets.
      await this.router.navigate(['/admin/classes', id]);
    } catch {
      this.snackBar.open('Nie udało się dodać zajęć.', 'OK', { duration: 5000 });
    } finally {
      this.creating.set(false);
    }
  }

  protected async remove(item: ClassSummary): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Usunąć zajęcia?',
      message:
        `Zajęcia z dnia ${formatDay(item.date)} zostaną usunięte razem ze zgłoszeniami i przydziałami. ` +
        'Przyznane plusy zostaną zachowane, ale stracą powiązanie z tymi zajęciami.',
      confirmLabel: 'Usuń',
    });
    if (!confirmed) {
      return;
    }

    try {
      await this.classes.remove(item.id);
      this.items.update((list) => list.filter((entry) => entry.id !== item.id));
    } catch {
      this.snackBar.open('Nie udało się usunąć zajęć.', 'OK', { duration: 5000 });
    }
  }
}