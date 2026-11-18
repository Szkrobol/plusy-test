import { ValidatorFn } from '@angular/forms';

/** Rejects empty and whitespace-only text (`Validators.required` accepts "   "). */
export const notBlankValidator: ValidatorFn = (control) =>
  String(control.value ?? '').trim() ? null : { blank: true };
