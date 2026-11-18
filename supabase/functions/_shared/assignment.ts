// Algorytm przydziału podpunktów: rotacja gorących (spec: docs/specs/rotacja-gorących.md, 2026-11-18).
// Wynik to propozycja dla grupy: na zajęciach i tak decyduje prowadzący.
//
// Gorący podpunkt (szansa >= HOT_THRESHOLD, domyślnie x.1 i x.2) dostaje ten, kto najdawniej miał
// gorący (kolejka wg hotWait); plusy w kolejce nie biorą udziału, więc aktywność nie jest karana.
// Faza A: gorące, jak najwięcej osób (skojarzenie dwudzielne w kolejności kolejki: nikt wyżej w kolejce
//         nie przegrywa z kimś niżej, a elastyczny ustępuje tylko, gdy ma inny gorący).
// Faza B: kto nie ma budżetu (suma szans < TARGET_BUDGET), dobiera resztki po jednym w rundach.
// Faza A2 (tura 2): wolne gorące dostają jeszcze osoby, które już mają gorący.
// Po przydziale każdy przydzielony podpunkt dostaje opcjonalnie zastępcę (drugą osobę, która go
// zaznaczyła), na wypadek nieobecności. Zastępca nie liczy się jako podpunkt, nikt nie jest zastępcą
// więcej niż raz, a najpierw zastępują osoby, które mają najmniej do zrobienia.
// Nikt nie dostaje podpunktu, którego nie zaznaczył.

export interface Subtask {
  id: string;
  /** Numer podpunktu w zadaniu: 1 = x.1, 2 = x.2, ... */
  subtaskNo: number;
  /** Szansa, że podpunkt pojawi się na zajęciach (0..1); brak = wartość domyślna wg numeru. */
  probability?: number | null;
}

export interface Student {
  id: string;
  /** Plusy w grupie; tylko do wyboru zastępcy (kolejka do gorących ich nie używa). */
  points?: number;
  /** Id podpunktów, które student chce. */
  declarations: string[];
  /** Ile poprzednich zajęć minęło od jego ostatniego gorącego; brak = jeszcze nigdy nie miał (największy priorytet). */
  hotWait?: number;
  /** Tura 2: suma szans podpunktów przydzielonych w turze 1. Domyślnie 0. */
  heldBudget?: number;
  /** Tura 2: ile podpunktów ma z tury 1 (tylko do wyboru zastępcy). Domyślnie 0. */
  held?: number;
}

export interface Assignment {
  subtaskId: string;
  studentId: string | null; // null: wolny
  /** Zastępca na wypadek nieobecności; null: brak chętnego. */
  backupStudentId: string | null;
}

/** Domyślne szanse wg numeru w zadaniu: pierwszy prawie zawsze, drugi często, dalej stała. */
export const DEFAULT_PROBABILITY = { first: 0.9, second: 0.85, rest: 0.3 };
/** Podpunkt o takiej szansie lub większej jest „gorący”. */
export const HOT_THRESHOLD = 0.8;
/** Budżet: suma szans przydzielonych podpunktów, po której osoba nie dobiera już resztek. */
export const TARGET_BUDGET = 0.85;

export function probability(s: Subtask): number {
  if (s.probability != null) return s.probability;
  if (s.subtaskNo === 1) return DEFAULT_PROBABILITY.first;
  if (s.subtaskNo === 2) return DEFAULT_PROBABILITY.second;
  return DEFAULT_PROBABILITY.rest;
}

/**
 * Przydział jednej tury. Tura 2: tylko wolne podpunkty i deklaracje do nich;
 * `heldBudget` studentów liczy się z tury 1.
 */
export function assign(
  subtasks: Subtask[],
  students: Student[],
  round: 1 | 2,
  random: () => number = Math.random,
): Assignment[] {
  const chance = new Map(subtasks.map((s) => [s.id, probability(s)]));
  for (const [id, c] of chance) {
    if (!(c >= 0 && c <= 1)) {
      throw new Error(`Podpunkt ${id}: prawdopodobieństwo poza zakresem 0..1`);
    }
  }
  const isHot = (id: string) => chance.get(id)! >= HOT_THRESHOLD;
  const byChance = (a: string, b: string) => chance.get(b)! - chance.get(a)!;

  // Kolejka: najdłużej czekający pierwszy (brak = nigdy = Infinity), remis losowany.
  const wait = (st: Student) => st.hotWait ?? Infinity;
  const tie = new Map(students.map((st) => [st.id, random()]));
  const queue = [...students].sort((a, b) => {
    const wa = wait(a);
    const wb = wait(b);
    return (wa === wb ? 0 : wb > wa ? 1 : -1) || tie.get(a.id)! - tie.get(b.id)!;
  });
  const wanted = new Map(
    students.map((st) => [st.id, [...new Set(st.declarations)].filter((id) => chance.has(id)).sort(byChance)]),
  );

  const owner = new Map<string, string>(); // podpunkt -> student
  const budget = new Map(students.map((st) => [st.id, st.heldBudget ?? 0]));

  /** Faza A / A2: skojarzenie gorących, osoby w kolejności kolejki (ścieżki powiększające Kuhna). */
  const matchHot = (people: Student[], pool: (id: string) => boolean) => {
    const slot = new Map<string, string>(); // podpunkt -> student w tym skojarzeniu
    const hotOf = (id: string) => wanted.get(id)!.filter((sid) => isHot(sid) && pool(sid));
    const place = (id: string, seen: Set<string>): boolean => {
      // najpierw wolny gorący (nikogo nie ruszamy), dopiero potem przesuwanie innych
      const free = hotOf(id).find((sid) => !slot.has(sid));
      if (free !== undefined) {
        slot.set(free, id);
        return true;
      }
      for (const sid of hotOf(id)) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        const current = slot.get(sid);
        if (current === undefined || place(current, seen)) {
          slot.set(sid, id);
          return true;
        }
      }
      return false;
    };
    for (const p of people) place(p.id, new Set());
    for (const [sid, id] of slot) {
      owner.set(sid, id);
      budget.set(id, budget.get(id)! + chance.get(sid)!);
    }
  };

  // Faza A: osoby bez budżetu.
  matchHot(queue.filter((st) => budget.get(st.id)! < TARGET_BUDGET), () => true);

  // Faza B: resztki po jednym w rundach, aż każdy wypełni budżet albo nie ma już wolnych zgłoszonych.
  for (let progress = true; progress; ) {
    progress = false;
    for (const st of queue) {
      if (budget.get(st.id)! >= TARGET_BUDGET) continue;
      const pick = wanted.get(st.id)!.find((id) => !owner.has(id));
      if (pick === undefined) continue;
      owner.set(pick, st.id);
      budget.set(st.id, budget.get(st.id)! + chance.get(pick)!);
      progress = true;
    }
  }

  // Faza A2 (tura 2): wolne gorące dla tych, którzy już mają gorący.
  if (round === 2) matchHot(queue, (id) => !owner.has(id));

  const assigned = new Map(owner);
  const backups = pickBackups(subtasks, students, assigned, chance, random);
  return [...subtasks]
    .sort((a, b) => chance.get(b.id)! - chance.get(a.id)!)
    .map((s) => ({
      subtaskId: s.id,
      studentId: assigned.get(s.id) ?? null,
      backupStudentId: backups.get(s.id) ?? null,
    }));
}

/** Zastępcy: od najpewniejszych podpunktów; kandydat = ktoś inny, kto zaznaczył podpunkt i jeszcze nie zastępuje. */
function pickBackups(
  subtasks: Subtask[],
  students: Student[],
  assigned: Map<string, string>,
  chance: Map<string, number>,
  random: () => number,
): Map<string, string> {
  const load = new Map(students.map((st) => [st.id, st.held ?? 0]));
  for (const id of assigned.values()) load.set(id, (load.get(id) ?? 0) + 1);
  const used = new Set<string>();
  const backups = new Map<string, string>();
  const ordered = subtasks.filter((s) => assigned.has(s.id)).sort((a, b) => chance.get(b.id)! - chance.get(a.id)!);
  for (const sub of ordered) {
    const candidates = students
      .filter((st) => st.id !== assigned.get(sub.id) && !used.has(st.id) && st.declarations.includes(sub.id))
      .map((st) => ({ st, tie: random() }))
      .sort((a, b) => load.get(a.st.id)! - load.get(b.st.id)! || (a.st.points ?? 0) - (b.st.points ?? 0) || a.tie - b.tie);
    if (candidates.length === 0) continue;
    const pick = candidates[0].st.id;
    backups.set(sub.id, pick);
    used.add(pick);
  }
  return backups;
}
