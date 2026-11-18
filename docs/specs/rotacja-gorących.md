# Przydział z rotacją gorących podpunktów (propozycja 2026-11-18)

Status: zaimplementowany 2026-11-18. Zastępuje cele 1-3 algorytmu z `backend-supabase.md` (przepływ o minimalnym koszcie, pierwszeństwo wg plusów).

## Cel

Kto zgłasza się często i ma sporo plusów, nie może przez to przegrywać o dobre podpunkty. Pierwszeństwo do „gorących” podpunktów (x.1, x.2) ma ten, kto najdawniej dostał gorący, a nie ten, kto ma najmniej plusów. Zgłoszenie dodatkowych podpunktów nigdy nie pogarsza wyniku.

## Pojęcia

- **Gorący** podpunkt: szansa ≥ `HOT_THRESHOLD` = 0.8 (domyślnie x.1 = 0.9 i x.2 = 0.85; admin może zmienić szansę i tym samym status).
- **Czekanie** (`hotWait`): liczba poprzednich zajęć grupy od ostatniego przydzielonego gorącego; kto nigdy nie miał, ma największe (`Infinity`). Liczone z `assignments` + `classes.date` + `subtasks`, bez zmiany schematu. W bieżących zajęciach osoba z gorącym z tury 1 ma `hotWait = 0`.
- **Budżet**: suma szans przydzielonych podpunktów osoby; cel = `TARGET` = 0.85. Jeden gorący go wypełnia, resztki (0.3) wypełniają się po trzy.
- **Kolejka**: malejąco wg `hotWait`, remis losowany. Plusy nie wpływają na kolejkę.

## Algorytm

Tura 1:
1. **Faza A (gorące):** w kolejności kolejki każda osoba, która zgłosiła jakiś gorący, próbuje go dostać; jeśli wszystkie jej gorące są zajęte, przesuwamy wcześniej przydzielonych na ich inne zgłoszone gorące (ścieżka powiększająca, jak w skojarzeniu dwudzielnym). Skutek: maksymalna liczba osób z gorącym, a o tym, kto go dostanie, decyduje kolejka; nikt wyżej w kolejce nie przegrywa z kimś niżej.
2. **Faza B (resztki):** osoby bez gorącego, od początku kolejki, po jednym dobierają najpewniejszy wolny zgłoszony podpunkt; wiele rund, aż budżet ≥ `TARGET` albo brak wolnych zgłoszonych.
3. Zastępcy jak dotąd (bez zmian).

Tura 2 (wolne po turze 1, deklaracje z obu tur):
1. Faza A i B jak wyżej dla osób z budżetem < `TARGET` (budżet liczony z tury 1).
2. **Faza A2:** pozostałe wolne gorące dostają osoby, które już mają gorący (po jednym dodatkowym, wg kolejki). To daje „dwa dobre podpunkty na zajęciach”, gdy zostaną wolne.

Nikt nie dostaje podpunktu, którego nie zaznaczył.

## Zmiany względem dziś

- Tura 1 przestaje mieć limit 1 podpunktu na osobę: bez gorącego można dostać kilka resztek (po ok. 0.9 szansy łącznie). Nikomu to nie szkodzi, bo resztki zgłaszają prawie tylko elastyczni.
- `assign(subtasks, students, limit, random)` → `assign(subtasks, students, round, random)`.
- `Student`: `points` zostaje tylko dla zastępców, dochodzą `hotWait` i `heldBudget` (zamiast `heldChance`); `held` zostaje tylko do wyboru zastępcy.
- `planRound` dostaje historię przydziałów (id zajęć, data, podpunkt, użytkownik, numer w zadaniu, szansa) i liczy `hotWait`; Edge Function `assign` musi tę historię wczytać.

## Poza zakresem

- Wyrównywanie plusów, uprzywilejowanie wskazanych osób.
- Okno historii (np. tylko ostatnie 5 zajęć): na start liczymy całą historię.
- Wyświetlanie zastępców w interfejsie.

## Ograniczenie, które zostaje

Gdy gorących jest mniej niż chętnych na nie, część osób dostanie tylko resztki albo nic, jeśli zgłosiła wyłącznie gorące. Rotacja sprawia, że robi się to po kolei; student powinien zaznaczać też resztki.

## Kryteria akceptacji (testy)

1. Osoba z większym `hotWait` dostaje gorący przed osobą z mniejszym, niezależnie od plusów i liczby zgłoszeń.
2. Zgłoszenie dodatkowych podpunktów nie pogarsza przydziału tej osoby (ten sam los).
3. Gdy da się obsłużyć gorącym więcej osób przez przesunięcie elastycznego, tak się dzieje, a wyższy w kolejce nie traci.
4. Osoba bez gorącego dostaje resztki do budżetu ≥ 0.85; osoba z gorącym ich nie dostaje w turze 1.
5. Tura 2: wolny gorący trafia najpierw do osoby bez gorącego, potem do posiadacza jednego (A2).
6. Nikt nie dostaje niezgłoszonego podpunktu; ten sam los daje ten sam wynik; błędna szansa jest odrzucana.

## Weryfikacja

`npm run test:algorithm` (testy najpierw czerwone, potem zielone), na końcu przejście przez `plan-round.test.ts`.
