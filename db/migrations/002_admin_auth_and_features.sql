-- ============================================================
-- Stage A: Auth & Admin overhaul
-- Run this in Supabase SQL Editor AFTER db/schema.sql, once.
-- Idempotent where practical (safe to re-run if something fails partway).
-- ============================================================

-- ---------- profiles gets an email column + admin flag ----------
alter table profiles add column if not exists email text;
alter table profiles add column if not exists is_admin boolean not null default false;

-- ---------- feature catalog (what CAN be toggled) ----------
-- Adding a row here only matters if the application code checks that key
-- somewhere — this table controls WHO has a capability, not WHAT
-- capabilities exist. Adding a brand-new capability is still a code change;
-- toggling an existing one on/off per user is not.
create table if not exists features (
  key text primary key,
  module text not null,
  label text not null,
  description text
);

insert into features (key, module, label, description) values
  ('assets.edit', 'Assets', 'Edit Assets', 'Add, edit and delete equipment records'),
  ('points.edit', 'Lubrication Points', 'Edit Lubrication Points', 'Add, edit and delete lubrication points and components'),
  ('workorders.record', 'Work Orders', 'Record Activities', 'Record new lubrication activities'),
  ('workorders.edit', 'Work Orders', 'Edit Activities', 'Edit or delete previously recorded activities'),
  ('inventory.edit', 'Inventory', 'Edit Inventory', 'Add, edit and delete lubricant records')
on conflict (key) do nothing;

-- ---------- per-user feature toggles (WHO has WHAT) ----------
create table if not exists user_features (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null references features(key) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (user_id, feature_key)
);

-- ---------- helper: does this user currently have this feature? ----------
-- Admins implicitly have every feature; everyone else needs an explicit
-- enabled=true row. security definer so RLS policies can call it safely.
create or replace function has_feature(uid uuid, fkey text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from profiles where id = uid), false
  ) or exists(
    select 1 from user_features where user_id = uid and feature_key = fkey and enabled = true
  );
$$;

create or replace function is_app_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = uid), false);
$$;

-- ---------- RLS: features catalog ----------
alter table features enable row level security;
create policy features_select on features for select to authenticated using (true);
create policy features_write_admin on features for all to authenticated using (is_app_admin(auth.uid()));

-- ---------- RLS: user_features ----------
alter table user_features enable row level security;
create policy uf_select on user_features for select to authenticated using (true);
create policy uf_write_admin on user_features for insert to authenticated with check (is_app_admin(auth.uid()));
create policy uf_update_admin on user_features for update to authenticated using (is_app_admin(auth.uid()));
create policy uf_delete_admin on user_features for delete to authenticated using (is_app_admin(auth.uid()));

-- ---------- replace the old role-based master-data policies ----------
drop policy if exists eq_write on equipment;   drop policy if exists eq_update on equipment;   drop policy if exists eq_delete on equipment;
drop policy if exists comp_write on components; drop policy if exists comp_update on components; drop policy if exists comp_delete on components;
drop policy if exists pts_write on lubrication_points; drop policy if exists pts_update on lubrication_points; drop policy if exists pts_delete on lubrication_points;
drop policy if exists lub_write on lubricants;  drop policy if exists lub_update on lubricants; drop policy if exists lub_delete on lubricants;
drop policy if exists act_insert on activities; drop policy if exists act_update on activities; drop policy if exists act_delete on activities;

create policy eq_write on equipment for insert to authenticated with check (has_feature(auth.uid(),'assets.edit'));
create policy eq_update on equipment for update to authenticated using (has_feature(auth.uid(),'assets.edit'));
create policy eq_delete on equipment for delete to authenticated using (has_feature(auth.uid(),'assets.edit'));

create policy comp_write on components for insert to authenticated with check (has_feature(auth.uid(),'points.edit'));
create policy comp_update on components for update to authenticated using (has_feature(auth.uid(),'points.edit'));
create policy comp_delete on components for delete to authenticated using (has_feature(auth.uid(),'points.edit'));

create policy pts_write on lubrication_points for insert to authenticated with check (has_feature(auth.uid(),'points.edit'));
create policy pts_update on lubrication_points for update to authenticated using (has_feature(auth.uid(),'points.edit'));
create policy pts_delete on lubrication_points for delete to authenticated using (has_feature(auth.uid(),'points.edit'));

create policy lub_write on lubricants for insert to authenticated with check (has_feature(auth.uid(),'inventory.edit'));
create policy lub_update on lubricants for update to authenticated using (has_feature(auth.uid(),'inventory.edit'));
create policy lub_delete on lubricants for delete to authenticated using (has_feature(auth.uid(),'inventory.edit'));

create policy act_insert on activities for insert to authenticated with check (has_feature(auth.uid(),'workorders.record'));
create policy act_update on activities for update to authenticated using (has_feature(auth.uid(),'workorders.edit'));
create policy act_delete on activities for delete to authenticated using (has_feature(auth.uid(),'workorders.edit'));

-- ---------- retire the old role system ----------
-- user_roles / roles_* policies / is_admin()+can_edit_masters() from
-- schema.sql are superseded by is_app_admin()/has_feature() above.
-- Not dropping user_roles itself yet (safer) — it's simply unused now.
drop policy if exists roles_write_admin on user_roles;
drop policy if exists roles_update_admin on user_roles;
drop policy if exists roles_delete_admin on user_roles;

-- ---------- updated new-user trigger: capture email, default is_admin=false ----------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
-- (trigger on_auth_user_created from schema.sql already points at this function)

-- ============================================================
-- Seed the fixed admin account: admin@lubrication.com / Admin@123
-- Safe to re-run — skips if that email already exists.
-- This directly inserts into Supabase's internal auth tables, which is
-- the standard, documented approach for seeding a first admin without
-- going through the public sign-up flow (which you're about to disable
-- in the dashboard anyway).
-- ============================================================
do $$
declare
  new_id uuid;
begin
  if not exists (select 1 from auth.users where email = 'admin@lubrication.com') then
    new_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
      'admin@lubrication.com', crypt('Admin@123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Administrator"}',
      false, now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), new_id::text, new_id,
      jsonb_build_object('sub', new_id::text, 'email', 'admin@lubrication.com'),
      'email', now(), now(), now()
    );
    -- profiles row + is_admin=true (the trigger creates the profile row;
    -- this just promotes it)
    update profiles set is_admin = true, full_name = 'Administrator' where id = new_id;
  end if;
end $$;
