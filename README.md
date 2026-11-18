# Plusy

Aplikacja dla grupy ćwiczeniowej na zajęciach audytoryjnych. Zamiast zapisów w arkuszu studenci zaznaczają podpunkty zadań, które chcą zrobić, aplikacja proponuje przydział, a plusy z zajęć trafiają do rankingu grupy.

## Jak to działa

1. **Konto i grupa.** Rejestracja adresem `@student.agh.edu.pl` (e-mail i hasło), uzupełnienie imienia i nazwiska, dołączenie do grupy kodem zaproszenia.
2. **Zestawy zadań.** Administrator grupy wpisuje zestawy raz: zadania i podpunkty. Numery można podawać ręcznie, więc zestaw da się dokończyć na kolejnych zajęciach.
3. **Zajęcia.** Administrator tworzy zajęcia, wskazuje zestawy, ustawia termin zapisów i otwiera zapisy.
4. **Tura 1.** Każdy zaznacza podpunkty, które chce zrobić. Prowadzący najczęściej robi pierwsze dwa podpunkty każdego zadania, więc to one są najcenniejsze: dostaje je ten, kto najdawniej na takim był, a liczba plusów nie ma znaczenia. Kto takiego podpunktu nie dostał, dostaje kilka dalszych, żeby jego szansa na wyjście do tablicy była podobna.
5. **Tura 2.** Wolne podpunkty widzą wszyscy i mogą się do nich dopisać. Wolne pierwsze podpunkty trafiają najpierw do osób, które w turze 1 żadnego nie dostały.
6. **Plusy.** Po zajęciach student wpisuje sobie plusa za podpunkt, a administrator może dodawać wpisy i korygować pomyłki. Historia wpisów jest niezmienna.

Do każdego podpunktu algorytm dobiera też zastępcę na wypadek nieobecności. Przydział jest propozycją dla grupy, na zajęciach i tak decyduje prowadzący.

## Uruchomienie lokalne

Potrzebny jest Node.js 24 lub nowszy.

```
npm install
npm start
```

Aplikacja działa wtedy na http://localhost:4200 i łączy się z lokalnym Supabase (`npx supabase start`, wymaga Dockera). Testy algorytmu przydziału: `npm run test:algorithm`.

## Struktura

- `src/` – frontend (Angular)
- `supabase/` – migracje bazy, testy uprawnień, funkcja `assign` i sam algorytm w `supabase/functions/_shared`
- `docs/` – specyfikacja i dziennik decyzji
