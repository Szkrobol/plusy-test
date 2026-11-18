# Backend w Supabase: założenia, algorytm, schemat (stan 2026-11-05)

Nazwy w kodzie i bazie po angielsku, opisy po polsku.

## Jak działa aplikacja

Zajęcia audytoryjne (tablicowe), grupa ok. 30 osób, zainteresowanych plusami do ~10. Prowadzący nie korzysta z aplikacji: sam wybiera osoby, chyba że ktoś się zgłosi, a plusy notuje na kartce. Zadania to gotowe zestawy (PDF); na koniec zajęć prowadzący mówi, które zestawy będą następnym razem. Dotąd grupa zapisywała się w Excelu, każdy na dwa podpunkty.

Przepływ:
1. Admin grupy wpisuje zestaw raz: zadania i podpunkty (1.1 … 1.7, 2.1 … 2.6) → `task_sets`, `subtasks`.
2. Admin tworzy zajęcia (`classes`), wskazuje zestawy (`class_task_sets`) i otwiera turę 1 (`status = round1_open`).
3. **Tura 1:** student zaznacza dokładnie te podpunkty, które chce (`declarations`, `round = 1`). Admin uruchamia przydział; każdy chętny dostaje najwyżej 1 podpunkt.
4. **Tura 2** (`round2_open`): wolne podpunkty widzą wszyscy, chętni się dopisują (`round = 2`, baza pozwala tylko na wolne). Przydział bez limitu, ale kolejny podpunkt kosztuje tym więcej, im więcej osoba już ma z tury 1. Co zostanie, zostaje wolne: ktoś zgłosi się na zajęciach.
5. Po zajęciach plus z kartki wpisuje student sam (+1) albo admin (też korekty -1) → `points`. Ranking: widok `points_totals`.

## Algorytm przydziału

Kod: `supabase/functions/_shared/assignment.ts`, testy obok (`npm test`).

Rotacja gorących podpunktów (od 2026-11-18, szczegóły: `docs/specs/rotacja-gorących.md`; wcześniej przepływ o minimalnym koszcie z pierwszeństwem wg plusów, który spychał elastycznych na resztki). Gorący = szansa ≥ 0.8 (domyślnie x.1, x.2).
1. Kolejka: kto najdawniej miał gorący (`hotWait`, liczone z `assignments` + `classes.date`), remis losowany; plusy nie wpływają.
2. Faza A: gorące, jak najwięcej osób (skojarzenie w kolejności kolejki; nikt wyżej w kolejce nie przegrywa z niższym).
3. Faza B: kto nie ma budżetu (suma szans < 0.85), dobiera resztki po jednym w rundach (zwykle 3 × 0.3).
4. Tura 2: A i B dla osób z budżetem z tury 1 < 0.85, potem wolne gorące dla posiadaczy jednego (A2).

Zastępca (`assignments.backup_user_id`, migracja 20261118): do każdego przydzielonego podpunktu algorytm dobiera drugą osobę, która go zaznaczyła, na wypadek nieobecności. Zastępca nie liczy się jako podpunkt, nikt nie zastępuje więcej niż raz, najpierw zastępują osoby z najmniejszą liczbą podpunktów.

Szansa, że podpunkt pojawi się na zajęciach: domyślnie x.1 = 0.9, x.2 = 0.85, dalsze 0.3 (prowadzący robi zwykle pierwsze dwa podpunkty zadania) (`DEFAULT_PROBABILITY`); admin może nadpisać w `subtasks.probability`.

Nie ma wyrównywania plusów między osobami: w turze 1 każdy najwyżej 1; w turze 2 dodatkowe podpunkty dopiero po tym, jak osoby bez podpunktu dostały swój.

## Schemat bazy

Migracja: `supabase/migrations/20261105000000_initial_schema.sql` (parser Postgresa 17: OK). Test RLS: `supabase/tests/rls_test.sql`.

| Tabela | Po co |
|---|---|
| `profiles` | e-mail, imię, nazwisko; tworzy się sam przy pierwszym logowaniu |
| `groups`, `group_members` | grupa z kodem zaproszenia; rola `student` / `admin` |
| `task_sets`, `subtasks` | gotowe zestawy; podpunkt = `task_no.subtask_no` + opcjonalna szansa |
| `classes`, `class_task_sets` | data, status tury, termin; które zestawy będą |
| `declarations` | student × podpunkt × tura |
| `assignments` | wynik algorytmu: podpunkt → student (null = wolny), z numerem tury |
| `points` | księga tylko dopisywana (+1 / -1), komu, za co i kto wpisał (`created_by`) |
| widok `points_totals` | ranking |

Statusy zajęć: `draft` → `round1_open` → `round2_open` → `assigned` → `finished`.

## Autoryzacja

- Logowanie: Supabase Auth, link logujący na mail. Trigger `private.handle_new_user` odrzuca adresy spoza `@student.agh.edu.pl`.
- Rola per grupa: `student` albo `admin` (twórca grupy). Prowadzący nie ma konta.
- RLS na każdej tabeli. Student deklaruje tylko za siebie i tylko w otwartej turze (`private.can_declare`); w turze 2 tylko wolne podpunkty. Plus wpisuje student sam sobie (tylko +1) albo admin; nikt nie edytuje ani nie usuwa wpisów.
- Funkcje pomocnicze RLS są w schemacie `private`, którego Data API nie wystawia.
- Front wywołuje `create_group(group_name)` i `join_group(code)` przez `supabase.rpc(...)`.
- Klucz `anon` (publishable) idzie do frontu, bo chroni go RLS. Hasło bazy i klucz `service_role` zostają u właściciela projektu.

## DTO

`supabase/functions/_shared/dto.ts`. Typy tabel generuje Supabase (`npx supabase gen types typescript`).

## Następne kroki

1. Edge Function `assign` (czyta deklaracje, liczy `assign(...)`, zapisuje `assignments`, przełącza status).
2. Logowanie linkiem: ustawienia Authentication → Email, adres strony frontu.
3. Materiały dla frontendu: `docs/notatka dla frontendu.md`, `supabase/database.types.ts`, Project URL, klucz `anon`.

## Poza zakresem na teraz

Powiadomienia, logowanie przez USOS, automatyczny import zestawów z PDF, aplikacja mobilna.
