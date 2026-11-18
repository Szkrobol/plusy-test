// DTO: kontrakt między backendem (Supabase) a frontendem (Angular).
// Tabele front czyta przez supabase-js; pełne typy tabel wygeneruje
// `npx supabase gen types typescript --project-id riwydhzinltomflajxkl > src/app/database.types.ts`.
// Tu tylko to, czego generator nie da: wejście/wyjście funkcji i widoki złożone.

export type MemberRole = "student" | "admin";
export type ClassStatus = "draft" | "round1_open" | "round2_open" | "assigned" | "finished";

/** Zestaw zadań (gotowy PDF), wpisywany raz przez admina. */
export interface TaskSetDto {
  id: string;
  name: string;
  subtasks: SubtaskDto[];
}

/** Podpunkt „taskNo.subtaskNo”, np. 2.3. */
export interface SubtaskDto {
  id: string;
  taskNo: number;
  subtaskNo: number; // 1 = x.1
  probability: number | null; // 0..1; null = domyślna wg numeru (0.9 / 0.85 / 0.3)
}

/** Zajęcia z listą zestawów, które na nich będą. */
export interface ClassDto {
  id: string;
  date: string; // ISO yyyy-mm-dd
  status: ClassStatus;
  declarationsDeadline: string | null; // ISO timestamp
  taskSetIds: string[];
}

/** Student zaznacza podpunkty, które chce (całe zadanie = wszystkie jego podpunkty). */
export interface DeclareDto {
  classId: string;
  round: 1 | 2; // tura 2: tylko podpunkty wolne po turze 1
  subtaskIds: string[];
}

/** Edge Function `assign`: wywołuje admin grupy dla bieżącej tury; wynik to propozycja. */
export interface AssignRequestDto {
  classId: string;
  round: 1 | 2;
}
export interface AssignResponseDto {
  assignments: { subtaskId: string; studentId: string | null; backupStudentId: string | null }[];
  limitPerPerson: number | null; // tura 1: 1; tura 2: null (bez limitu, ale najpierw osoby bez podpunktu)
}

/** Plus z kartki prowadzącego: student wpisuje sobie +1, admin dowolny wpis (też -1). */
export interface AddPointDto {
  groupId: string;
  userId: string;
  classId: string | null;
  subtaskId: string | null;
  value: number; // +1; korekta -1 tylko admin
  note?: string;
}

/** Ranking grupy (widok `points_totals` + `profiles`). */
export interface RankingRowDto {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  points: number;
}
