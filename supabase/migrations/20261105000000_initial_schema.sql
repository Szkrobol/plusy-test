-- Schemat bazy (2026-11-05): nazwy po angielsku, komentarze po polsku.
-- Zastępuje dwie pierwsze migracje z 2026-11-04 (baza była pusta, wyczyszczona przez `db reset`).
--
-- Model: prowadzący nie używa aplikacji. Zestawy zadań są gotowe (PDF); admin grupy wpisuje je raz,
-- a dla każdych zajęć wskazuje, które zestawy będą. Przydział w dwóch turach:
--   tura 1: każdy zaznacza podpunkty, które chce -> admin uruchamia przydział (limit liczony sam),
--   tura 2: wolne podpunkty widzą wszyscy, chętni się dopisują -> przydział bez limitu.

-- Sprzątanie po starym schemacie (polskie nazwy) na wypadek, gdyby db reset go nie usunął.
drop trigger if exists po_utworzeniu_konta on auth.users;
drop schema if exists private cascade;

create type member_role as enum ('student', 'admin');
create type class_status as enum ('draft', 'round1_open', 'round2_open', 'assigned', 'finished');

-- ===== Konta =====
-- Profil tworzy się sam przy pierwszym logowaniu (trigger niżej); id = auth.users.id.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text,
  last_name text
);

-- ===== Grupa =====
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role member_role not null default 'student',
  primary key (group_id, user_id)
);

-- ===== Zestawy zadań (wpisywane raz) =====
create table task_sets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  name text not null,           -- np. 'Transformata Laplace''a i odpowiedzi czasowe'
  file_path text                -- opcjonalnie: PDF w Supabase Storage
);

-- Podpunkt 'task_no.subtask_no', np. 2.3 = zadanie 2, podpunkt 3.
create table subtasks (
  id uuid primary key default gen_random_uuid(),
  task_set_id uuid not null references task_sets (id) on delete cascade,
  task_no smallint not null check (task_no >= 1),
  subtask_no smallint not null check (subtask_no >= 1),
  -- szansa, że podpunkt pojawi się na zajęciach; null = domyślna wg numeru (0.9 / 0.7 / 0.4)
  probability numeric(4,3) check (probability between 0 and 1),
  unique (task_set_id, task_no, subtask_no)
);

-- ===== Zajęcia =====
create table classes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  date date not null,
  status class_status not null default 'draft',
  declarations_deadline timestamptz  -- opcjonalny termin zamknięcia bieżącej tury
);

create table class_task_sets (
  class_id uuid not null references classes (id) on delete cascade,
  task_set_id uuid not null references task_sets (id) on delete cascade,
  primary key (class_id, task_set_id)
);

-- Deklaracja: „chcę ten podpunkt”. Front może zaznaczyć całe zadanie naraz (wiele wierszy).
create table declarations (
  class_id uuid not null references classes (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  subtask_id uuid not null references subtasks (id) on delete cascade,
  round smallint not null default 1 check (round in (1, 2)),
  created_at timestamptz not null default now(),
  primary key (class_id, user_id, subtask_id)
);

-- Wynik algorytmu: kto zgłasza się do którego podpunktu (null = wolny).
create table assignments (
  class_id uuid not null references classes (id) on delete cascade,
  subtask_id uuid not null references subtasks (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  round smallint not null check (round in (1, 2)),
  primary key (class_id, subtask_id)
);

-- ===== Plusy: księga tylko do dopisywania; korekta = wpis z wartością ujemną =====
create table points (
  id bigint generated always as identity primary key,
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  class_id uuid references classes (id) on delete set null,
  subtask_id uuid references subtasks (id) on delete set null,
  value smallint not null check (value <> 0),
  note text,
  created_by uuid not null references profiles (id), -- kto dodał wpis (student sam albo admin)
  created_at timestamptz not null default now()
);

create view points_totals with (security_invoker = true) as
  select group_id, user_id, sum(value)::int as points
  from points group by group_id, user_id;

-- ===== Funkcje pomocnicze w schemacie `private` (Data API go nie wystawia) =====
create schema private;

-- Logowanie tylko adresem studenckim AGH.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email !~* '@student\.agh\.edu\.pl$' then
    raise exception 'Logowanie tylko adresem @student.agh.edu.pl';
  end if;
  insert into profiles (id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- security definer: sprawdzają członkostwo bez rekurencji polityk na group_members.
create function private.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = auth.uid());
$$;

create function private.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members
                 where group_id = g and user_id = auth.uid() and role = 'admin');
$$;

create function private.class_group(c uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from classes where id = c;
$$;

create function private.task_set_group(t uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from task_sets where id = t;
$$;

-- Czy można teraz deklarować ten podpunkt w tej turze:
-- tura musi być otwarta, podpunkt musi należeć do zestawu z tych zajęć,
-- a w turze 2 podpunkt musi być wolny po turze 1.
create function private.can_declare(c uuid, s uuid, r smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from classes cl
    join class_task_sets cts on cts.class_id = cl.id
    join subtasks st on st.task_set_id = cts.task_set_id
    where cl.id = c and st.id = s
      and cl.status = case r when 1 then 'round1_open'::class_status else 'round2_open'::class_status end
      and (cl.declarations_deadline is null or now() < cl.declarations_deadline)
      and (r = 1 or not exists (select 1 from assignments a
                                where a.class_id = c and a.subtask_id = s and a.user_id is not null))
  );
$$;

-- ===== RLS: bez polityki = brak dostępu =====
alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table task_sets enable row level security;
alter table subtasks enable row level security;
alter table classes enable row level security;
alter table class_task_sets enable row level security;
alter table declarations enable row level security;
alter table assignments enable row level security;
alter table points enable row level security;

create policy "profiles: own" on profiles for all
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: group members can read" on profiles for select
  using (exists (select 1 from group_members m
                 where m.user_id = profiles.id and private.is_member(m.group_id)));

create policy "groups: members read" on groups for select using (private.is_member(id));
create policy "groups: admin updates" on groups for update using (private.is_admin(id));

create policy "group_members: members read" on group_members for select
  using (private.is_member(group_id));
create policy "group_members: admin manages" on group_members for all
  using (private.is_admin(group_id)) with check (private.is_admin(group_id));

create policy "task_sets: members read" on task_sets for select using (private.is_member(group_id));
create policy "task_sets: admin manages" on task_sets for all
  using (private.is_admin(group_id)) with check (private.is_admin(group_id));

create policy "subtasks: members read" on subtasks for select
  using (private.is_member(private.task_set_group(task_set_id)));
create policy "subtasks: admin manages" on subtasks for all
  using (private.is_admin(private.task_set_group(task_set_id)))
  with check (private.is_admin(private.task_set_group(task_set_id)));

create policy "classes: members read" on classes for select using (private.is_member(group_id));
create policy "classes: admin manages" on classes for all
  using (private.is_admin(group_id)) with check (private.is_admin(group_id));

create policy "class_task_sets: members read" on class_task_sets for select
  using (private.is_member(private.class_group(class_id)));
create policy "class_task_sets: admin manages" on class_task_sets for all
  using (private.is_admin(private.class_group(class_id)))
  with check (private.is_admin(private.class_group(class_id))
              and private.task_set_group(task_set_id) = private.class_group(class_id));

-- Deklaracje: student tylko za siebie i tylko w otwartej turze; admin widzi wszystkie.
create policy "declarations: own or admin read" on declarations for select
  using (user_id = (select auth.uid()) or private.is_admin(private.class_group(class_id)));
create policy "declarations: student adds own" on declarations for insert
  with check (user_id = (select auth.uid())
              and private.is_member(private.class_group(class_id))
              and private.can_declare(class_id, subtask_id, round));
create policy "declarations: student withdraws own" on declarations for delete
  using (user_id = (select auth.uid()) and private.can_declare(class_id, subtask_id, round));

create policy "assignments: members read" on assignments for select
  using (private.is_member(private.class_group(class_id)));
create policy "assignments: admin writes" on assignments for all
  using (private.is_admin(private.class_group(class_id)))
  with check (private.is_admin(private.class_group(class_id)));

-- Plusy daje prowadzący na kartce; w aplikacji wpisuje je student sam (+1) albo admin (też -1).
-- Brak polityk update/delete = nikt nie zmienia historii.
create policy "points: members read" on points for select using (private.is_member(group_id));
create policy "points: student adds own +1" on points for insert
  with check (user_id = (select auth.uid()) and created_by = (select auth.uid()) and value = 1
              and private.is_member(group_id));
create policy "points: admin adds and corrects" on points for insert
  with check (private.is_admin(group_id) and created_by = (select auth.uid()));

-- ===== Funkcje wywoływane z frontu: supabase.rpc(...) =====
-- Założenie grupy: twórca zostaje adminem.
create function public.create_group(group_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  insert into groups (name) values (group_name) returning id into g;
  insert into group_members (group_id, user_id, role) values (g, auth.uid(), 'admin');
  return g;
end $$;

-- Dołączenie do grupy kodem zaproszenia (zawsze jako student).
create function public.join_group(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select id into g from groups where invite_code = code;
  if g is null then raise exception 'Nieznany kod grupy'; end if;
  insert into group_members (group_id, user_id) values (g, auth.uid()) on conflict do nothing;
  return g;
end $$;

-- ===== Uprawnienia (projekt ma wyłączone „Automatically expose new tables”) =====
-- `authenticated` = zalogowany; co konkretnie widzi, decyduje RLS. `anon` nie dostaje nic.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  profiles, groups, group_members, task_sets, subtasks, classes, class_task_sets,
  declarations, assignments
  to authenticated;
grant select, insert on points to authenticated;   -- bez update/delete: księga tylko dopisywana
grant select on points_totals to authenticated;

grant usage on schema private to authenticated, supabase_auth_admin;
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.is_member(uuid), private.is_admin(uuid), private.class_group(uuid),
  private.task_set_group(uuid), private.can_declare(uuid, uuid, smallint)
  to authenticated;                          -- potrzebne, bo polityki RLS liczą się jako użytkownik
revoke execute on function private.handle_new_user() from authenticated;
grant execute on function private.handle_new_user() to supabase_auth_admin;

revoke execute on function public.create_group(text), public.join_group(text) from public, anon;
grant execute on function public.create_group(text), public.join_group(text) to authenticated;
