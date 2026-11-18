

## Architektura

- Postgres + PostgREST (Data API, schemat `public`) + Supabase Auth + jedna Edge Function (`assign`).
- Autoryzacja wyłącznie przez RLS; brak warstwy pośredniej. Klient: `@supabase/supabase-js` v2 z kluczem publishable (`anon`).
- „Automatically expose new tables” jest wyłączone: rola `anon` nie ma żadnych grantów, `authenticated` ma granty na tabele z listy niżej. Każde zapytanie wymaga sesji.
- Funkcje pomocnicze RLS (`private.*`) nie są wystawione w API.

Konfiguracja: `SUPABASE_URL = https://riwydhzinltomflajxkl.supabase.co`, klucz publishable z Project Settings → API.

```ts
const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
```

Regeneracja typów po zmianie schematu:
`npx supabase gen types typescript --project-id riwydhzinltomflajxkl > src/app/database.types.ts`

## Auth

- Email OTP / magic link: `auth.signInWithOtp({ email, options: { emailRedirectTo } })`. Brak haseł i OAuth.
- Trigger na `auth.users` odrzuca adresy spoza `@student.agh.edu.pl`: `signInWithOtp` dla nowego adresu zwraca wtedy błąd Auth (`Database error saving new user`). Warto walidować domenę w formularzu.
- `profiles` (1:1 z `auth.users`) powstaje w triggerze z samym `email`; `first_name`, `last_name` uzupełnia użytkownik (`update` własnego wiersza).
- Redirect: Site URL w Auth → URL Configuration = `http://localhost:4200` na czas developmentu; adres produkcyjny dopisujemy do Redirect URLs.

## Model danych

```
groups 1─* group_members *─1 profiles
groups 1─* task_sets 1─* subtasks
groups 1─* classes *─* task_sets            (class_task_sets)
classes 1─* declarations *─1 subtasks       (PK: class_id, user_id, subtask_id; kolumna round 1|2)
classes 1─* assignments  *─1 subtasks       (PK: class_id, subtask_id; user_id NULL = wolny; round 1|2)
groups 1─* points                            (append-only, value ≠ 0, created_by)
view points_totals(group_id, user_id, points)
```

- Podpunkt identyfikuje para `task_no.subtask_no` w obrębie zestawu (`unique(task_set_id, task_no, subtask_no)`).
- `subtasks.probability` (0..1, nullable): szansa, że podpunkt pojawi się na zajęciach; `null` = domyślna wg `subtask_no` (0.9 / 0.7 / 0.4). Używana tylko przez algorytm.
- Rola jest per grupa: `member_role = student | admin`.

## Cykl życia zajęć

```
draft ──(admin)──▶ round1_open ──assign(1)──▶ round2_open ──assign(2)──▶ assigned ──(admin)──▶ finished
```

- Przejścia `draft → round1_open` i `assigned → finished` robi admin zwykłym `update` na `classes.status`.
- Przejścia po turach robi wyłącznie funkcja `assign` (patrz niżej).
- `classes.declarations_deadline` (opcjonalny): po tym czasie RLS blokuje zmiany deklaracji w bieżącej turze.

## Macierz uprawnień (RLS)

| Tabela | student (członek grupy) | admin grupy |
|---|---|---|
| `groups` | select | select, update |
| `group_members` | select (cały skład) | all |
| `profiles` | select członków wspólnych grup; update własny | jak student |
| `task_sets`, `subtasks` | select | all |
| `classes`, `class_task_sets` | select | all (zestaw musi należeć do tej samej grupy) |
| `declarations` | select/insert/delete **własnych**, tylko gdy `private.can_declare` | select wszystkich |
| `assignments` | select | all (w praktyce przez `assign`) |
| `points` | select całej grupy; insert tylko `user_id = created_by = auth.uid()`, `value = 1` | insert dowolny (`created_by = auth.uid()`), w tym korekty `-1` |
| `points_totals` | select | select |

`private.can_declare(class, subtask, round)`: status zajęć = `round{n}_open`, podpunkt należy do zestawu przypiętego do zajęć, termin nie minął, a dla `round = 2` podpunkt nie ma przydziału z `user_id` w turze 1.

Brak `update`/`delete` na `points` (zarówno grant, jak i polityka) — historia jest niezmienna.

Naruszenie polityki przy zapisie: `42501 new row violates row-level security policy`. Przy odczycie RLS po prostu filtruje wiersze (pusta lista, nie błąd).

## RPC

| Funkcja | Argumenty | Zwraca | Uwagi |
|---|---|---|---|
| `create_group` | `{ group_name: string }` | `uuid` | wywołujący zostaje adminem |
| `join_group` | `{ code: string }` | `uuid` | idempotentne; nieznany kod → `P0001 Nieznany kod grupy` |

## Edge Function `assign`

`supabase.functions.invoke('assign', { body: AssignRequestDto })` — wywołuje admin. Działa z JWT wywołującego (bez `service_role`), więc RLS obowiązuje także w środku.

```ts
type AssignRequestDto  = { classId: string; round: 1 | 2 };
type AssignResponseDto = {
  assignments: { subtaskId: string; studentId: string | null }[]; // posortowane malejąco wg szansy
  limitPerPerson: null;                                            // zawsze null (od 2026-11-18 przydział nie ma limitu podpunktów na osobę)
};
```

| Kod | Kiedy |
|---|---|
| 200 | zapisano `assignments` (upsert) i przestawiono status |
| 400 | brak/niepoprawne `classId` lub `round` |
| 401 | brak sesji |
| 403 | wywołujący nie jest adminem grupy |
| 404 | zajęcia nie istnieją lub są niewidoczne dla wywołującego |
| 409 | status zajęć nie odpowiada turze |

Semantyka:
- Tura 1: wszystkie podpunkty zestawów przypiętych do zajęć; limit na osobę liczony automatycznie.
- Tura 2: tylko podpunkty bez właściciela po turze 1; deklaracje z obu tur; bez limitu. Wiersze z tury 1 z `user_id` nie są nadpisywane.
- Ponowne wywołanie tej samej tury jest niemożliwe (409), bo status już się zmienił.

Algorytm (`supabase/functions/_shared/assignment.ts`): min-cost max-flow na grafie źródło → student → podpunkt → ujście. Priorytety leksykograficzne: (1) maksymalna liczba przydzielonych podpunktów, (2) równomierny rozkład w obrębie zajęć (wypukły koszt kolejnego podpunktu tej samej osoby), (3) większa szansa podpunktu dla osób z mniejszą liczbą plusów, (4) losowy tie-break. Nikt nie dostaje podpunktu, którego nie zadeklarował.

## Zapytania, które się przydadzą

```ts
// zajęcia z podpunktami do deklarowania
supabase.from('classes')
  .select('id, date, status, declarations_deadline, class_task_sets(task_sets(id, name, subtasks(id, task_no, subtask_no, probability)))')
  .eq('id', classId).single();

// wolne podpunkty w turze 2
supabase.from('assignments').select('subtask_id').eq('class_id', classId).is('user_id', null);

// moje deklaracje (zaznaczenia w UI)
supabase.from('declarations').select('subtask_id, round').eq('class_id', classId);

// ranking: widok nie ma FK do profiles, więc dwa zapytania i złączenie po user_id
supabase.from('points_totals').select('user_id, points').eq('group_id', groupId);
supabase.from('group_members').select('user_id, profiles(first_name, last_name)').eq('group_id', groupId);
```

Zmiany na żywo (np. odświeżenie widoku po `assign`): Realtime nie jest jeszcze włączony dla żadnej tabeli; do uzgodnienia, jeśli potrzebny (`alter publication supabase_realtime add table assignments`).

## Znane ograniczenia

- Student może dopisać sobie plus bez pokrycia (kartka prowadzącego jest źródłem prawdy); każdy wpis ma `created_by` i `created_at`, admin koryguje wpisem `-1`.
- Brak Storage dla PDF-ów zestawów (`task_sets.file_path` zarezerwowane).
- Brak endpointu do cofnięcia tury; w razie potrzeby admin może zmienić status i wyczyścić `assignments` ręcznie.
