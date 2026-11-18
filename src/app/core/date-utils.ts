const dayFormat = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dateTimeFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

const pad = (value: number): string => String(value).padStart(2, '0');

/** Formats a Date as `YYYY-MM-DD` in the user's local time zone (matches Postgres `date` columns). */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a `YYYY-MM-DD` string as a local date (`new Date(str)` would treat it as UTC). */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "poniedziałek, 17 listopada 2026" for a `YYYY-MM-DD` string. */
export function formatDay(iso: string): string {
  return dayFormat.format(parseIsoDate(iso));
}

/** "17 lis 2026, 18:00" for a timestamp (shown in the user's time zone). */
export function formatDateTime(timestamp: string): string {
  return dateTimeFormat.format(new Date(timestamp));
}

/** Timestamp -> value of `<input type="datetime-local">` (local time, "YYYY-MM-DDTHH:mm"). */
export function toDatetimeLocal(timestamp: string | null): string {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  return `${toIsoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Value of `<input type="datetime-local">` -> ISO timestamp, or null when empty or invalid. */
export function fromDatetimeLocal(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value); // no offset in the string, so it is read as local time
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}