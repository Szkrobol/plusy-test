import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import {
  MAX_STARTING_POINTS,
  StartingPointsService,
} from '../../../core/services/starting-points.service';
import { aghEmailValidator } from '../../../core/validators/agh-email.validator';

const MIN_PASSWORD_LENGTH = 8;

/** Confirmation field must equal the password field. */
const matchesPassword: ValidatorFn = (control) => {
  if (!control.parent) {
    return null;
  }
  return control.value === control.parent.get('password')?.value ? null : { mismatch: true };
};

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './register.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly startingPoints = inject(StartingPointsService);
  private readonly router = inject(Router);

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  protected readonly maxStartingPoints = MAX_STARTING_POINTS;

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, aghEmailValidator]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirmPassword: ['', [Validators.required, matchesPassword]],
    /** Points the student already has from earlier classes (optional). */
    startingPoints: [
      0,
      [Validators.min(0), Validators.max(MAX_STARTING_POINTS), Validators.pattern(/^\d+$/)],
    ],
  });

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly hidePassword = signal(true);

  constructor() {
    // Re-check the confirmation field whenever the password changes.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.confirmPassword.updateValueAndValidity());
  }

  protected togglePasswordVisibility(): void {
    this.hidePassword.update((hidden) => !hidden);
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

    const { email, password, startingPoints } = this.form.getRawValue();
    const result = await this.auth.signUp(email, password);

    this.submitting.set(false);

    if (!result.ok) {
      this.serverError.set(result.message);
      return;
    }

    // Email confirmation is disabled, so a session exists right away and the
    // user continues with the profile step. Without a session, fall back to login.
    if (result.session) {
      // Written to the ledger once the user joins a group. An empty field counts as 0.
      this.startingPoints.remember(result.session.user.id, Number(startingPoints) || 0);
    }
    await this.router.navigate(result.session ? ['/profile'] : ['/login']);
  }
}