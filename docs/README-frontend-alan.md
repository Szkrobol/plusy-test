# Plusy

Aplikacja dla grup studenckich na zajęciach audytoryjnych (tablicowych). Zastępuje zapisy w arkuszu: studenci zaznaczają podpunkty zadań, które chcą zrobić, aplikacja proponuje sprawiedliwy przydział, a plusy z zajęć są zapisywane w jednym miejscu.

Wersja: **1.0.0**

## Jak to działa

1. **Konto i grupa.** Rejestracja adresem `@student.agh.edu.pl` (e-mail i hasło), uzupełnienie imienia i nazwiska, dołączenie do grupy kodem zaproszenia. Grupy zakłada się w bazie.
2. **Zestawy zadań.** Administrator grupy wpisuje zestawy raz: zadania i podpunkty. Numery można podawać ręcznie, więc zestaw da się dokończyć na kolejnych zajęciach.
3. **Zajęcia.** Administrator tworzy zajęcia, wskazuje zestawy, ustawia termin zapisów i otwiera zapisy.
4. **Tura 1.** Każdy zaznacza podpunkty, które chce zrobić. Administrator uruchamia przydział, a limit na osobę liczy się sam.
5. **Tura 2.** Wolne podpunkty widzą wszyscy i mogą się do nich dopisać. Drugi przydział działa bez limitu.
6. **Plusy.** Po zajęciach student wpisuje sobie plusa za dowolny podpunkt, a administrator może dodawać wpisy i korygować pomyłki. Historia wpisów jest niezmienna. Przy rejestracji można podać plusy zdobyte wcześniej.

Przydział jest propozycją dla grupy, na zajęciach i tak decyduje prowadzący.