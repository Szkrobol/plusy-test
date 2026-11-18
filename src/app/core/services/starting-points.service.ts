import { inject, Service } from '@angular/core';
import { PointsService } from './points.service';
import { SessionService } from './session.service';

/** Highest number of starting points that can be entered. */
export const MAX_STARTING_POINTS = 30;

const NOTE = 'Punkty początkowe (wpisane przy rejestracji)';

/**
 * Points a student already had before using the app. They are entered at registration, but a point
 * belongs to a group, and the student joins one only afterwards. So the number is remembered in
 * this browser (per user) and written to the ledger right after the student joins a group.
 */
@Service()
export class StartingPointsService {
  private readonly points = inject(PointsService);
  private readonly session = inject(SessionService);

  /** Remembers the number to be written once the user joins a group. Zero clears it. */
  remember(userId: string, count: number): void {
    try {
      if (count > 0) {
        localStorage.setItem(this.key(userId), String(count));
      } else {
        localStorage.removeItem(this.key(userId));
      }
    } catch {
      // Storage can be unavailable (private mode); the student can ask an admin to add the points.
    }
  }

  /** The remembered number for the signed-in user (0 if there is none). */
  pending(): number {
    const userId = this.session.user()?.id;
    if (!userId) {
      return 0;
    }

    try {
      const count = Number(localStorage.getItem(this.key(userId)));
      return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_STARTING_POINTS) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Writes the remembered points to the ledger for the group just joined and forgets them.
   * Returns how many were written. Throws if the write fails (the number is forgotten anyway, so
   * the caller must tell the user, otherwise a retry could count the points twice).
   */
  async applyPending(groupId: string): Promise<number> {
    const userId = this.session.user()?.id;
    const count = this.pending();
    if (!userId || count === 0) {
      return 0;
    }

    this.remember(userId, 0);
    await this.points.addStartingPoints(groupId, userId, count, NOTE);
    return count;
  }

  private key(userId: string): string {
    return `plusy.startingPoints.${userId}`;
  }
}
