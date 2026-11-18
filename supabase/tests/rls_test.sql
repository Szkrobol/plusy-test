-- Test uprawnień (RLS) na prawdziwej bazie, bez frontu.
-- Wszystko dzieje się w jednej transakcji zakończonej ROLLBACK: po teście w bazie nic nie zostaje.
-- Uruchomienie: wklej w SQL Editor w panelu i kliknij Run.
-- Wynik: jeden wiersz „WSZYSTKIE TESTY OK” albo błąd „BŁĄD: …” mówiący, co nie działa.
--
-- Jak udajemy użytkownika: tak samo robi Data API przy każdym zapytaniu z frontu.
--   1) set_config('request.jwt.claims', '{"sub": "<id>"}')  -> auth.uid() zwraca <id>
--   2) set local role authenticated                         -> działają polityki RLS

begin;

-- ===== Przygotowanie (jako właściciel bazy): trzech udawanych użytkowników =====
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'test.admin@student.agh.edu.pl', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'test.student.b@student.agh.edu.pl', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'test.student.c@student.agh.edu.pl', 'authenticated', 'authenticated');

do $$ begin
  if (select count(*) from profiles where email like 'test.%@student.agh.edu.pl') <> 3 then
    raise exception 'BŁĄD: trigger nie utworzył profili';
  end if;
  begin
    insert into auth.users (id, email, aud, role)
      values (gen_random_uuid(), 'ktos@gmail.com', 'authenticated', 'authenticated');
    raise exception 'BŁĄD: konto spoza @student.agh.edu.pl zostało przyjęte';
  exception when raise_exception then
    if sqlerrm like 'BŁĄD%' then raise; end if;  -- nasz błąd przepuszczamy dalej
  end;
end $$;

-- ===== Admin A zakłada grupę, zestaw i zajęcia z otwartą turą 1 =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$
declare g uuid; ts uuid; c uuid;
begin
  g := create_group('Grupa testowa');
  insert into task_sets (group_id, name) values (g, 'Laplace') returning id into ts;
  insert into subtasks (task_set_id, task_no, subtask_no) values (ts, 1, 1), (ts, 1, 2);
  insert into classes (group_id, date, status) values (g, current_date + 7, 'round1_open') returning id into c;
  insert into class_task_sets values (c, ts);
  perform set_config('test.group', g::text, true);
  perform set_config('test.class', c::text, true);
  perform set_config('test.code', (select invite_code from groups where id = g), true);
  perform set_config('test.s11', (select id from subtasks where task_set_id = ts and subtask_no = 1)::text, true);
  perform set_config('test.s12', (select id from subtasks where task_set_id = ts and subtask_no = 2)::text, true);
end $$;
reset role;

-- ===== Student C przed dołączeniem nie widzi grupy =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from groups) then raise exception 'BŁĄD: obcy widzi grupę'; end if;
end $$;
reset role;

-- ===== Student B dołącza, deklaruje w turze 1, wpisuje plusa =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
do $$
declare c uuid := current_setting('test.class')::uuid; g uuid;
begin
  g := join_group(current_setting('test.code'));
  insert into declarations (class_id, user_id, subtask_id, round)
    values (c, auth.uid(), current_setting('test.s11')::uuid, 1);
  insert into points (group_id, user_id, value, created_by) values (g, auth.uid(), 1, auth.uid());

  begin
    insert into declarations (class_id, user_id, subtask_id, round)
      values (c, auth.uid(), current_setting('test.s12')::uuid, 2);
    raise exception 'BŁĄD: deklaracja w turze 2, choć otwarta jest tura 1';
  exception when insufficient_privilege then null; end;

  begin
    insert into points (group_id, user_id, value, created_by)
      values (g, '00000000-0000-0000-0000-00000000000c', 1, auth.uid());
    raise exception 'BŁĄD: student wpisał plusa komuś innemu';
  exception when insufficient_privilege then null; end;

  begin
    insert into points (group_id, user_id, value, created_by) values (g, auth.uid(), 5, auth.uid());
    raise exception 'BŁĄD: student wpisał sobie +5';
  exception when insufficient_privilege then null; end;

  begin
    update points set value = 10;
    raise exception 'BŁĄD: dało się zmienić plusy';
  exception when insufficient_privilege then null; end;

  begin
    insert into task_sets (group_id, name) values (g, 'Cudzy zestaw');
    raise exception 'BŁĄD: student dodał zestaw';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== Student C dołącza: widzi plusy i skład grupy, nie widzi cudzych deklaracji =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform join_group(current_setting('test.code'));
  if (select count(*) from points) <> 1 then raise exception 'BŁĄD: członek nie widzi plusów grupy'; end if;
  if exists (select 1 from declarations) then raise exception 'BŁĄD: student widzi cudze deklaracje'; end if;
  if (select count(*) from group_members) <> 3 then raise exception 'BŁĄD: członek nie widzi składu grupy'; end if;
end $$;
reset role;

-- ===== Admin A: widzi deklaracje, zapisuje przydział tury 1, otwiera turę 2 =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$
declare c uuid := current_setting('test.class')::uuid;
begin
  if (select count(*) from declarations) <> 1 then raise exception 'BŁĄD: admin nie widzi deklaracji'; end if;
  insert into assignments (class_id, subtask_id, user_id, round) values
    (c, current_setting('test.s11')::uuid, '00000000-0000-0000-0000-00000000000b', 1),
    (c, current_setting('test.s12')::uuid, null, 1);
  update classes set status = 'round2_open' where id = c;
end $$;
reset role;

-- ===== Student C w turze 2: może wziąć wolny 1.2, nie może zająć 1.1 =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$
declare c uuid := current_setting('test.class')::uuid;
begin
  insert into declarations (class_id, user_id, subtask_id, round)
    values (c, auth.uid(), current_setting('test.s12')::uuid, 2);
  begin
    insert into declarations (class_id, user_id, subtask_id, round)
      values (c, auth.uid(), current_setting('test.s11')::uuid, 2);
    raise exception 'BŁĄD: w turze 2 dało się zadeklarować zajęty podpunkt';
  exception when insufficient_privilege then null; end;
  begin
    insert into assignments (class_id, subtask_id, user_id, round)
      values (c, current_setting('test.s12')::uuid, auth.uid(), 2);
    raise exception 'BŁĄD: student sam zapisał sobie przydział';
  exception when insufficient_privilege or unique_violation then null; end;
end $$;
reset role;

select 'WSZYSTKIE TESTY OK' as wynik;
rollback;
