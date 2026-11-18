import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { isProfileComplete } from '../../core/profile';
import { safeReturnUrl } from '../../core/return-url';
import { ProfileService } from '../../core/services/profile.service';
import { SessionService } from '../../core/services/session.service';

// Letters (including Polish ones), spaces, hyphens, apostrophes and dots.
const NAME_PATTERN = /^\s*[\p{L}][\p{L}\s'’.-]*$/u;
const MAX_NAME_LENGTH = 50;

/**
 * First-time profile completion and later editing (same form).
 * Lives outside the main layout because a new user may not have joined a group yet.
 */
@Component({
  selector: 'app-profile-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './profile.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly fb = inject(FormBuilder);
  private readonly profiles = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly session = inject(SessionService);
  protected readonly maxNameLength = MAX_NAME_LENGTH;

  protected readonly form = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(MAX_NAME_LENGTH), Validators.pattern(NAME_PATTERN)]],
    lastName: ['', [Validators.required, Validators.maxLength(MAX_NAME_LENGTH), Validators.pattern(NAME_PATTERN)]],
  });

  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  /** True when the profile was already filled in, i.e. the user is editing it. */
  protected readonly isEditing = signal(false);

  constructor() {
    void this.prefill();
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    const { firstName, lastName } = this.form.getRawValue();
    const result = await this.profiles.save(firstName, lastName);

    this.submitting.set(false);

    if (!result.ok) {
      this.serverError.set(result.message);
      return;
    }

    await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
  }

  /** Fills the form with the saved values (empty for a new user). */
  private async prefill(): Promise<void> {
    try {
      const profile = await this.session.ensureProfile();
      this.form.patchValue({
        firstName: profile.first_name ?? '',
        lastName: profile.last_name ?? '',
      });
      this.isEditing.set(isProfileComplete(profile));
    } catch {
      this.serverError.set('Nie udało się pobrać profilu. Odśwież stronę i spróbuj ponownie.');
    } finally {
      this.loading.set(false);
    }
  }
}
