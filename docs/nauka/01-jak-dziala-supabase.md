# Lekcja 1: jak działa nasz backend w Supabase

## Wielki obraz

```
Angular (frontend) --supabase-js-->  Data API (REST)  -->  Postgres (nasza baza)
                                        ^                    |
                         token logowania (JWT)        RLS: czy temu użytkownikowi wolno?
```

Nazwy w kodzie i bazie są po angielsku (tabele `declarations`, `points` itd.), opisy po polsku.

Supabase to zwykła baza **Postgres**, do której dołożono gotowe usługi:

| Usługa | Co robi | U nas |
|---|---|---|
| **Auth** | logowanie, konta, tokeny | link logujący na mail @student.agh.edu.pl |
| **Data API** | automatyczne REST API do każdej tabeli | front czyta i zapisuje tabele bez naszego kodu |
| **RLS** (Row Level Security) | reguły w bazie: kto widzi i zmienia które wiersze | cała logika uprawnień |
| **Edge Functions** | własny kod w TypeScript na serwerze | później: algorytm przydziału |

Najważniejsza myśl: **nie piszemy serwera**. Backend to schemat bazy i reguły RLS. Front rozmawia z bazą przez Data API, a baza sama pilnuje, co wolno.

## Co się dzieje, gdy student zapisuje deklarację

1. Student loguje się linkiem z maila. Auth daje frontowi **token (JWT)**, w którym jest jego id.
2. Front wywołuje `supabase.from('declarations').insert({...})`. Biblioteka dokleja token.
3. Data API przełącza się na rolę `authenticated` i przekazuje bazie id z tokena. W SQL to id zwraca funkcja `auth.uid()`.
4. Postgres sprawdza politykę `"declarations: student adds own"`: czy `user_id = auth.uid()`, czy student jest w grupie i czy `private.can_declare(...)` pozwala (tura otwarta, podpunkt z zestawu tych zajęć, w turze 2 tylko wolny).
5. Jeśli wszystko się zgadza, wiersz jest zapisany. Jeśli nie, przychodzi błąd `new row violates row-level security policy`.

Dlatego klucz `anon` może być publiczny: sam niczego nie otwiera, bo o dostępie decyduje RLS.

## Gdzie co jest w repo

| Plik | Co to |
|---|---|
| `supabase/migrations/*.sql` | historia zmian bazy; każda zmiana to nowy plik, **starych nie edytujemy** |
| `supabase/tests/rls_test.sql` | test RLS na udawanych użytkownikach |
| `supabase/functions/_shared/assignment.ts` | algorytm przydziału + testy (`npm test`) |
| `supabase/functions/_shared/dto.ts` | umowa z frontem: jakie dane się wymienia |
| `supabase/config.toml` | konfiguracja CLI |

## Polecenia, które warto znać (w `C:\Projects\aplikacja-plusy`)

| Polecenie | Co robi |
|---|---|
| `npx supabase migration new <nazwa>` | tworzy pusty plik nowej migracji |
| `npx supabase db push --remote` | wysyła nowe migracje do bazy w chmurze |
| `npx supabase migration list --remote` | które migracje są lokalnie, a które na serwerze |
| `npx supabase db advisors --remote` | doradca bezpieczeństwa i wydajności |
| `npx supabase gen types typescript --project-id riwydhzinltomflajxkl` | typy TS tabel dla frontu |

## Ćwiczenie 1: test uprawnień w panelu

1. Panel Supabase → **SQL Editor** → New query.
2. Wklej całą zawartość `supabase/tests/rls_test.sql` i kliknij **Run**.
3. Oczekiwany wynik: jeden wiersz `WSZYSTKIE TESTY OK`. Test kończy się `rollback`, więc w bazie nic nie zostaje.
4. Zepsuj coś celowo: w teście zmień `5` na `1` w linii `values (g, auth.uid(), 5, auth.uid())` w próbie „student wpisał sobie +5” i uruchom ponownie. Powinieneś dostać `BŁĄD: student wpisał sobie +5`. Tak wygląda test, który łapie problem.

## Ćwiczenie 2: obejrzyj reguły

Panel → **Authentication → Policies**. Każda tabela ma swoje polityki: porównaj je z plikiem migracji. Spróbuj własnymi słowami powiedzieć, co robi `"points: student adds own +1"`.

## Słowniczek

- **Migracja**: plik SQL zmieniający schemat; wykonywany raz, w kolejności nazw (data na początku).
- **Polityka RLS**: warunek SQL dopisywany do każdego zapytania; `using` filtruje odczyt, `with check` sprawdza zapis.
- **security definer**: funkcja działająca z prawami właściciela zamiast wywołującego; używamy jej ostrożnie i trzymamy w schemacie `private`, którego API nie wystawia.
- **JWT**: podpisany token z id użytkownika; front dostaje go po zalogowaniu.
