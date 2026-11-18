# Dziennik decyzji projektu

Tylko dopisywanie na końcu. Format: data, decyzja, powód.

## 2026-11-04: stos startowy

Backend Supabase (Postgres + Auth + RLS + Edge Functions), bo osoba od backendu ma się go nauczyć, a Supabase daje gotowe logowanie oraz API dla frontu w Angularze. Algorytm przydziału w czystym TypeScript (supabase/functions/_shared), testy wbudowanym runnerem Node 24 (bez zależności). Bez modułu księgowego (plusy to nie pieniądze). Plusy jako księga tylko dopisywana, żeby historia była audytowalna.

## 2026-11-04: role i prawdopodobieństwo

Prowadzący nie używa aplikacji (plusy na kartce), więc role to student i admin grupy. Plus wpisuje student sobie (+1) albo admin (też korekta -1). Prawdopodobieństwo podpunktu: stałe wg pozycji w zadaniu (0.9 / 0.7 / 0.4), bo pierwszy podpunkt jest zawsze najpewniejszy, drugi zaraz po nim, dalej różnie.

## 2026-11-04: przydział w rundach z limitem, gotowe zestawy, mail uczelniany

Nie chcemy wyrównywania plusów, tylko automatyzacji. Algorytm: rundy, w każdej rundzie zgłoszeni wybierają najpewniejszy wolny podpunkt z deklaracji (mniej plusów = wcześniej), do własnego limitu. Zadania to gotowe zestawy PDF, więc zestawy i podpunkty wpisuje się raz, a zajęcia tylko je wskazują. Logowanie magic linkiem z ograniczeniem do domeny uczelni (USOS OAuth odłożony). PDF-y z zadania_stare/ poza repo (materiały prowadzącego).

## 2026-11-05: angielskie nazwy, dwie tury, przydział optymalny

Nazwy w kodzie i bazie po angielsku (dla frontu w Angularze i typów generowanych przez Supabase), dokumentacja po polsku. Baza była pusta, więc dwie migracje z 2026-11-04 zastąpiła jedna `20261105000000_initial_schema.sql` (z `db reset`), zamiast migracji zmieniających nazwy. Przydział w dwóch turach: tura 1 z limitem ceil(podpunkty / chętni), tura 2 tylko wolne podpunkty bez limitu. Algorytm: przepływ o minimalnym koszcie (pomysł z algorytmu przedmiotów obieralnych), żeby nikt nie tracił jedynego wyboru przez zachłanne rundy.

## 2026-11-18: tura 1 z limitem 1, w turze 2 pierwszeństwo dla osób bez podpunktu

Pierwsze użycie na zajęciach: limit ceil(podpunkty / chętni) dał po 3 podpunkty (23 podpunkty, ok. 8 chętnych), a cel „przydziel jak najwięcej” wygrywał z „każdy po jednym”. Efekt: jedni mieli 3 podpunkty, część osób żadnego, a prowadzący zwykle robi ok. 8 podpunktów, więc ludzie powtarzali się, zanim poszli wszyscy chętni. Teraz tura 1: limit 1. Tura 2: koszt k-tego podpunktu liczy też te z tury 1 (`held`), więc najpierw dostają osoby bez niczego.

## 2026-11-18: szanse podpunktów

Prowadzący w większości przypadków robi pierwsze 2 podpunkty każdego zadania, potem różnie. Domyślne szanse: x.1 = 0.9, x.2 = 0.85, dalsze 0.3 (było 0.9 / 0.7 / 0.4).

## 2026-11-18: bonus w turze 2 i zastępca do podpunktu

Tura 2: kto z tury 1 ma tylko niepewny podpunkt (np. x.4), dostaje bonus do wolnych x.1/x.2, żeby nie został bez szansy na wyjście do tablicy. Zastępca: kolumna `assignments.backup_user_id`; to druga osoba spośród zaznaczających podpunkt, nie liczy się do limitów, max 1 zastępstwo na osobę. Powód: nieobecność przydzielonej osoby; zastępca nie powoduje „powtórek”, bo nie jest przydziałem. Front Alana dziś ignoruje nową kolumnę, więc zastępców trzeba dopiero wyświetlić.

## 2026-11-18: rotacja gorących podpunktów zamiast pierwszeństwa wg plusów

Testy na przykładowych zgłoszeniach pokazały, że obecny algorytm (cel „jak najwięcej przydzielonych” przed plusami) spychał osoby zgłaszające wszystko na resztki o szansie 0.3, a plusy mierzą aktywność, więc karały aktywnych. Teraz o gorące podpunkty (szansa ≥ 0.8) decyduje kolejka wg tego, kto najdawniej miał gorący; plusy nie wpływają. Kto nie ma gorącego, dobiera resztki do sumy szans 0.85 (zamiast limitu 1 podpunktu na osobę w turze 1), a w turze 2 wolne gorące trafiają jeszcze do posiadaczy jednego. Historia liczona z `assignments` i `classes.date`, bez migracji; `limitPerPerson` w odpowiedzi zostaje jako `null`, żeby front się nie zepsuł. Spec: `docs/specs/rotacja-gorących.md`.
