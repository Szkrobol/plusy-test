import { ValidatorFn } from '@angular/forms';

const AGH_EMAIL_PATTERN = /^[^\s@]+@student\.agh\.edu\.pl$/i;

export const aghEmailValidator: ValidatorFn = (control) => {
  const value = String(control.value ?? '').trim();
  if (!value) {
    return null;
  }
  return AGH_EMAIL_PATTERN.test(value) ? null : { aghEmail: true };
};
