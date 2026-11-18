// Przygotowanie danych jednej tury z wierszy bazy i uruchomienie algorytmu.
// Czysta funkcja (bez bazy), żeby dało się ją testować w Node; Edge Function tylko czyta i zapisuje.

import { assign, HOT_THRESHOLD, probability, type Assignment, type Student, type Subtask } from "./assignment.ts";

export interface SubtaskRow {
  id: string;
  subtask_no: number;
  probability: number | null;
}
export interface DeclarationRow {
  user_id: string;
  subtask_id: string;
}
export interface AssignmentRow {
  subtask_id: string;
  user_id: string | null;
}
export interface PointsRow {
  user_id: string;
  points: number;
}
/** Przydział z poprzednich zajęć grupy (user_id null = podpunkt wolny; wiersze takie też wyznaczają, że zajęcia były). */
export interface HistoryRow {
  class_id: string;
  class_date: string; // ISO yyyy-mm-dd
  user_id: string | null;
  subtask_no: number;
  probability: number | null;
}

export interface RoundPlan {
  assignments: Assignment[];
  /** Zostaje dla zgodności z frontem; przydział nie ma już limitu podpunktów na osobę. */
  limitPerPerson: null;
}

/** Dla każdej osoby: ile poprzednich zajęć minęło od jej ostatniego gorącego (brak wpisu = nigdy). */
export function hotWaits(history: HistoryRow[]): Map<string, number> {
  const dates = [...new Set(history.map((r) => r.class_date))].sort();
  const lastHot = new Map<string, string>();
  for (const r of history) {
    if (r.user_id === null) continue;
    if (probability({ id: "", subtaskNo: r.subtask_no, probability: r.probability }) < HOT_THRESHOLD) continue;
    if ((lastHot.get(r.user_id) ?? "") < r.class_date) lastHot.set(r.user_id, r.class_date);
  }
  return new Map([...lastHot].map(([user, date]) => [user, dates.filter((d) => d > date).length]));
}

export function planRound(
  round: 1 | 2,
  subtaskRows: SubtaskRow[],
  declarationRows: DeclarationRow[],
  round1Rows: AssignmentRow[],
  pointsRows: PointsRow[],
  historyRows: HistoryRow[],
  random: () => number = Math.random,
): RoundPlan {
  const taken = new Set(round1Rows.filter((a) => a.user_id !== null).map((a) => a.subtask_id));
  // Tura 2: tylko podpunkty wolne po turze 1; deklaracje z obu tur się liczą.
  const subtasks: Subtask[] = subtaskRows
    .filter((s) => round === 1 || !taken.has(s.id))
    .map((s) => ({ id: s.id, subtaskNo: s.subtask_no, probability: s.probability }));
  const available = new Set(subtasks.map((s) => s.id));

  const chanceOf = new Map(subtaskRows.map((s) => [s.id, probability({ id: s.id, subtaskNo: s.subtask_no, probability: s.probability })]));
  const heldBy = new Map<string, number>();
  const heldBudgetBy = new Map<string, number>();
  const heldHot = new Set<string>();
  for (const a of round1Rows) {
    if (a.user_id === null) continue;
    const chance = chanceOf.get(a.subtask_id) ?? 0;
    heldBy.set(a.user_id, (heldBy.get(a.user_id) ?? 0) + 1);
    heldBudgetBy.set(a.user_id, (heldBudgetBy.get(a.user_id) ?? 0) + chance);
    if (chance >= HOT_THRESHOLD) heldHot.add(a.user_id);
  }
  const waits = hotWaits(historyRows);
  const pointsOf = new Map(pointsRows.map((p) => [p.user_id, p.points]));
  const byStudent = new Map<string, string[]>();
  for (const d of declarationRows) {
    if (!available.has(d.subtask_id)) continue;
    byStudent.set(d.user_id, [...(byStudent.get(d.user_id) ?? []), d.subtask_id]);
  }
  const students: Student[] = [...byStudent].map(([id, declarations]) => ({
    id,
    points: pointsOf.get(id) ?? 0,
    declarations,
    // kto ma gorący z tury 1, w turze 2 jest „świeżo po gorącym”; inaczej liczy się historia
    hotWait: heldHot.has(id) ? 0 : waits.get(id),
    heldBudget: heldBudgetBy.get(id) ?? 0,
    held: heldBy.get(id) ?? 0,
  }));

  return { assignments: assign(subtasks, students, round, random), limitPerPerson: null };
}
