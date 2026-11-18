import { Enums } from './database.types';

export type ClassStatus = Enums<'class_status'>;

/** In the order a class normally goes through them. */
export const CLASS_STATUSES: ClassStatus[] = [
  'draft',
  'round1_open',
  'round2_open',
  'assigned',
  'finished',
];

export const CLASS_STATUS_LABELS: Record<ClassStatus, string> = {
  draft: 'Szkic',
  round1_open: 'Zapisy: tura 1',
  round2_open: 'Zapisy: tura 2',
  assigned: 'Przydzielone',
  finished: 'Zakończone',
};

/** What changing to a status means for students (shown in the confirmation dialog). */
export const CLASS_STATUS_EFFECTS: Record<ClassStatus, string> = {
  draft: 'Zajęcia znikną dla studentów i wrócą do przygotowania.',
  round1_open: 'Studenci będą mogli zgłaszać podpunkty, które chcą zrobić (tura 1).',
  round2_open: 'Studenci będą mogli dopisywać się do wolnych podpunktów (tura 2).',
  assigned: 'Zapisy zostaną zamknięte, a przydziały będą widoczne dla grupy.',
  finished: 'Zajęcia zostaną oznaczone jako zakończone.',
};

/** Tailwind classes for the status chip. Full class names so Tailwind can detect them. */
export const CLASS_STATUS_CHIP: Record<ClassStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  round1_open: 'bg-emerald-50 text-emerald-800',
  round2_open: 'bg-emerald-50 text-emerald-800',
  assigned: 'bg-sky-50 text-sky-800',
  finished: 'bg-slate-100 text-slate-500',
};

export function isRoundOpen(status: ClassStatus): boolean {
  return status === 'round1_open' || status === 'round2_open';
}