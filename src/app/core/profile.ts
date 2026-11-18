import { Tables } from './database.types';

export type Profile = Tables<'profiles'>;

const isFilled = (value: string | null): boolean => !!value?.trim();

/** A profile is complete once both first and last name are filled in. */
export function isProfileComplete(profile: Profile): boolean {
  return isFilled(profile.first_name) && isFilled(profile.last_name);
}

export function fullName(profile: Profile): string {
  return [profile.first_name, profile.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}
