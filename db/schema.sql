-- ============================================================
-- Industrial Lubrication Management & Reliability System
-- Database schema for Supabase (Postgres + Auth + RLS)
-- Run this whole file once in: Supabase project -> SQL Editor -> New query -> Run
-- ============================================================

-- ---------- extensions ----------
create extension if not exists pgcrypto;

-- ---------- profiles (one row per signed-up user, display info only) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- user_roles (functional role per spec section 53) ----------
-- Kept in its own table (not on profiles) so write access can be locked
-- down separately from "can edit your own display name".
create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in
    ('Technician','Supervisor','Engineer','Storekeeper','Procurement User','Manager','Administrator')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- security-definer helper: true if the given user currently holds the
-- Administrator role. Used inside RLS policies to avoid infinite recursion
-- (a normal policy on user_roles can't safely query user_roles itself).
create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from user_roles where user_id = uid and role = 'Administrator'
  );
$$;

-- same idea for "Engineer or Administrator" (the roles allowed to edit masters)
create or replace function can_edit_masters(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from user_roles where user_id = uid and role in ('Engineer','Administrator')
  );
$$;

-- ---------- equipment master (spec section 7) ----------
create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  sap_equipment_number text unique not null,
  description text,
  functional_location text,
  plant text,
  area text,
  equipment_type text,
  manufacturer text,
  model text,
  serial_number text,
  status text default 'Active',
  criticality text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

-- ---------- components (spec section 8) ----------
create table if not exists components (
  id uuid primary key default gen_random_uuid(),
  equipment_number text not null references equipment(sap_equipment_number) on update cascade,
  name text not null,
  type text,
  description text,
  criticality text,
  status text default 'Active',
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

-- ---------- lubrication points (spec section 9) ----------
create table if not exists lubrication_points (
  id uuid primary key default gen_random_uuid(),
  equipment_number text not null references equipment(sap_equipment_number) on update cascade,
  component_name text,
  point_name text not null,
  lubrication_type text,
  lubricant_name text,
  required_quantity text,
  uom text,
  frequency text,
  running_hour_interval text,
  calendar_interval text,
  status text default 'Active',
  special_instructions text,
  criticality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

-- ---------- lubricant master (spec section 11) ----------
create table if not exists lubricants (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  product_name text not null,
  lubricant_type text,
  base_oil text,
  iso_vg text,
  nlgi_grade text,
  manufacturer text,
  uom text,
  sap_material_code text,
  status text default 'Active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

-- ---------- lubrication activities (spec sections 12-17) ----------
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  equipment_number text not null references equipment(sap_equipment_number) on update cascade,
  component_name text,
  point_name text,
  activity_type text not null,
  activity_date date not null,
  running_hours text,
  lubricant_name text,
  quantity text,
  uom text,
  previous_level text,
  new_level text,
  condition text,
  reason text,
  sap_notification text,
  observation text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

-- ============================================================
-- Row Level Security — this is the REAL, server-enforced permission
-- layer (unlike the earlier Claude-artifact prototype, this cannot be
-- bypassed from the browser).
-- ============================================================

alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table equipment enable row level security;
alter table components enable row level security;
alter table lubrication_points enable row level security;
alter table lubricants enable row level security;
alter table activities enable row level security;

-- profiles: everyone signed in can read all profiles (to show names);
-- you may only edit your own.
create policy profiles_select on profiles for select to authenticated using (true);
create policy profiles_upsert_self on profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_self on profiles for update to authenticated using (id = auth.uid());

-- user_roles: everyone signed in can read (so the app can show who has
-- what role); only Administrators can assign/change/remove roles.
create policy roles_select on user_roles for select to authenticated using (true);
create policy roles_write_admin on user_roles for insert to authenticated with check (is_admin(auth.uid()));
create policy roles_update_admin on user_roles for update to authenticated using (is_admin(auth.uid()));
create policy roles_delete_admin on user_roles for delete to authenticated using (is_admin(auth.uid()));

-- masters (equipment/components/points/lubricants): everyone signed in
-- reads; only Engineer/Administrator write.
create policy eq_select on equipment for select to authenticated using (true);
create policy eq_write on equipment for insert to authenticated with check (can_edit_masters(auth.uid()));
create policy eq_update on equipment for update to authenticated using (can_edit_masters(auth.uid()));
create policy eq_delete on equipment for delete to authenticated using (can_edit_masters(auth.uid()));

create policy comp_select on components for select to authenticated using (true);
create policy comp_write on components for insert to authenticated with check (can_edit_masters(auth.uid()));
create policy comp_update on components for update to authenticated using (can_edit_masters(auth.uid()));
create policy comp_delete on components for delete to authenticated using (can_edit_masters(auth.uid()));

create policy pts_select on lubrication_points for select to authenticated using (true);
create policy pts_write on lubrication_points for insert to authenticated with check (can_edit_masters(auth.uid()));
create policy pts_update on lubrication_points for update to authenticated using (can_edit_masters(auth.uid()));
create policy pts_delete on lubrication_points for delete to authenticated using (can_edit_masters(auth.uid()));

create policy lub_select on lubricants for select to authenticated using (true);
create policy lub_write on lubricants for insert to authenticated with check (can_edit_masters(auth.uid()));
create policy lub_update on lubricants for update to authenticated using (can_edit_masters(auth.uid()));
create policy lub_delete on lubricants for delete to authenticated using (can_edit_masters(auth.uid()));

-- activities: everyone signed in can read AND record a new activity
-- (Technicians need this daily, spec section 12/42); only
-- Engineer/Administrator may edit or delete an existing record, so the
-- history stays trustworthy (spec section 52, audit trail).
create policy act_select on activities for select to authenticated using (true);
create policy act_insert on activities for insert to authenticated with check (true);
create policy act_update on activities for update to authenticated using (can_edit_masters(auth.uid()));
create policy act_delete on activities for delete to authenticated using (can_edit_masters(auth.uid()));

-- ---------- auto-create a profile row (and bootstrap the first Administrator) ----------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  -- the very first person to ever sign up becomes Administrator automatically,
  -- so there's always someone able to assign roles to everyone else.
  if not exists (select 1 from user_roles) then
    insert into user_roles (user_id, role) values (new.id, 'Administrator');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
