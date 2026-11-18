import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { CLASS_STATUS_CHIP, CLASS_STATUS_LABELS, isRoundOpen } from '../../core/class-status';
import { parseIsoDate } from '../../core/date-utils';
import { ClassRow, ClassService } from '../../core/services/class.service';
import { PointsService } from '../../core/services/points.service';
import { SessionService } from '../../core/services/session.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly session = inject(SessionService);
  private readonly classes = inject(ClassService);
  private readonly points = inject(PointsService);

  protected readonly statusLabels = CLASS_STATUS_LABELS;
  protected readonly statusChip = CLASS_STATUS_CHIP;
  protected readonly isRoundOpen = isRoundOpen;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly upcoming = signal<ClassRow[]>([]);
  protected readonly myPoints = signal(0);

  private readonly dayFormat = new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  private readonly deadlineFormat = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  constructor() {
    void this.load();
  }

  /** Students open the class page; drafts exist only for admins, who edit them. */
  protected classLink(item: ClassRow): string[] {
    return item.status === 'draft' ? ['/admin/classes', item.id] : ['/classes', item.id];
  }

  protected formatDay(iso: string): string {
    return this.dayFormat.format(parseIsoDate(iso));
  }

  protected formatDeadline(timestamp: string): string {
    return this.deadlineFormat.format(new Date(timestamp));
  }

  protected async load(): Promise<void> {
    const group = this.session.activeGroup();
    const user = this.session.user();
    if (!group || !user) {
      // Cannot happen behind groupGuard, but keeps the template out of a loading state.
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const [upcoming, total] = await Promise.all([
        this.classes.upcoming(group.groupId, this.session.isAdmin()),
        this.points.myTotal(group.groupId, user.id),
      ]);
      this.upcoming.set(upcoming);
      this.myPoints.set(total);
    } catch {
      this.error.set('Nie udało się pobrać danych. Spróbuj ponownie.');
    } finally {
      this.loading.set(false);
    }
  }
}