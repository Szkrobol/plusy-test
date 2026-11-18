-- Zastępca na wypadek nieobecności osoby przydzielonej do podpunktu (decyzja 2026-11-18).
alter table assignments
  add column backup_user_id uuid references profiles (id) on delete set null;
