# aplikacja-plusy

Przydział podpunktów zadań na zajęciach audytoryjnych. Studenci deklarują, które podpunkty chcą omówić, algorytm proponuje przydział (dwie tury), a plusy z kartki prowadzącego trafiają do rankingu grupy.

Backend: Supabase (Postgres + RLS + Auth + Edge Function). Frontend: Angular, osobne repozytorium.

## Dokumentacja

- `docs/specs/backend-supabase.md`: założenia, algorytm, schemat, autoryzacja
- `docs/notatka dla frontendu.md`: kontrakt API dla frontendu
- `docs/DECYZJE.md`: dziennik decyzji (tylko dopisywanie)
- `docs/nauka/`: materiały do nauki Supabase

Nazwy w kodzie i bazie po angielsku, komentarze i dokumentacja po polsku.

## Komendy

Wymagany Node.js 24+.

| Co | Komenda |
|---|---|
| Instalacja (Supabase CLI) | `npm install` |
| Testy algorytmu | `npm run test:algorithm` |
| Frontend (Angular, kod z repo Alana) | `npm start` (http://localhost:4200; wymaga lokalnego Supabase: `npx supabase start`, Docker) |
| Test uprawnień (RLS) | wklej `supabase/tests/rls_test.sql` w SQL Editor w panelu |
| Logowanie i połączenie z projektem | `npx supabase login`, `npx supabase link` |
| Nowa migracja | `npx supabase migration new <nazwa>` |
| Wysłanie migracji | `npx supabase db push --remote` |
| Wdrożenie funkcji | `npx supabase functions deploy assign --use-api` |
| Doradca bezpieczeństwa | `npx supabase db advisors --remote` |
| Typy dla frontendu | `npx supabase gen types typescript --project-id riwydhzinltomflajxkl > supabase/database.types.ts` |

## Zasady pracy

- Zmiany w bazie tylko przez nowe pliki migracji, nigdy ręcznie w panelu; starych migracji nie edytujemy.
- Osobna gałąź i pull request na każdą zmianę; `db push` i `functions deploy` po scaleniu do `master`.
- Każda zmiana zachowania ma test (`npm run test:algorithm` lub `rls_test.sql`).
- Nie commitujemy sekretów: hasło bazy i klucz `sb_secret_…` nigdy nie trafiają do repo.
