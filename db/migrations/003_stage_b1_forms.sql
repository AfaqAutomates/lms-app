-- ============================================================
-- Stage B.1: Form improvements (new tables only)
-- ============================================================

-- ---------- Enum types ----------
drop type if exists equipment_status cascade;
drop type if exists asset_criticality cascade;
drop type if exists lubrication_type_enum cascade;

create type equipment_status as enum ('Active', 'Inactive');
create type asset_criticality as enum ('High', 'Medium', 'Low');
create type lubrication_type_enum as enum ('Oil', 'Grease', 'Automatic Lubricator', 'Circulating Oil System', 'Other');

-- ---------- Lubricants master table ----------
create table if not exists lubricants_master (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  lubricant_type lubrication_type_enum not null,
  description text,
  uom text not null default 'L',
  created_at timestamptz default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

insert into lubricants_master (name, lubricant_type, description, uom) values
  ('EP2 Lithium Complex Grease', 'Grease', 'General purpose bearing grease', 'kg'),
  ('ISO VG 46 Hydraulic Oil', 'Oil', 'Standard industrial hydraulic fluid', 'L'),
  ('ISO VG 320 Gear Oil', 'Oil', 'Mineral gear oil for gearboxes', 'L'),
  ('ISO VG 680 Circulating Oil', 'Circulating Oil System', 'High-viscosity circulating system oil', 'L'),
  ('Open Gear Compound', 'Grease', 'Sticky gear lubricant for exposed gears', 'kg')
on conflict (name) do nothing;

alter table lubricants_master enable row level security;
drop policy if exists lub_master_read on lubricants_master;
drop policy if exists lub_master_write on lubricants_master;
drop policy if exists lub_master_update on lubricants_master;
drop policy if exists lub_master_delete on lubricants_master;

create policy lub_master_read on lubricants_master for select to authenticated using (true);
create policy lub_master_write on lubricants_master for insert to authenticated with check (has_feature(auth.uid()::uuid,'inventory.edit'));
create policy lub_master_update on lubricants_master for update to authenticated using (has_feature(auth.uid()::uuid,'inventory.edit'));
create policy lub_master_delete on lubricants_master for delete to authenticated using (has_feature(auth.uid()::uuid,'inventory.edit'));

-- ---------- Update equipment table ----------
alter table equipment add column if not exists status equipment_status default 'Active';
alter table equipment add column if not exists lubrication_criticality asset_criticality default 'Medium';
alter table equipment add column if not exists running_hours numeric(12,2) default 0;
alter table equipment add column if not exists last_running_hours_update timestamptz;

-- ---------- Update components table ----------
alter table components add column if not exists criticality asset_criticality default 'Medium';
alter table components add column if not exists status equipment_status default 'Active';

-- ---------- Suggestion history tables ----------
create table if not exists component_type_suggestions (
  id uuid primary key default gen_random_uuid(),
  type_name text not null unique,
  use_count int default 1,
  last_used timestamptz default now()
);

create table if not exists lubrication_point_name_suggestions (
  id uuid primary key default gen_random_uuid(),
  point_name text not null unique,
  use_count int default 1,
  last_used timestamptz default now()
);

-- ---------- Resources (physical plant machines) ----------
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  resource_name text not null unique,
  running_hours numeric(12,2) default 0,
  last_running_hours_update timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz default now()
);

insert into resources (resource_name) values
  ('AQCLP01'),('AQCLP02'),('AQCMP01'),('AQCMP02'),('AUXCR01'),('BLKCEM01'),('CLAYCR01'),
  ('CM01'),('CM02'),('CM03'),('COALM01'),('COALM02'),('KILN01'),('KILN02'),('LSCR01'),('LSCR02'),
  ('MINLS'),('PACKER01'),('PACKER02'),('PACKER03'),('PACKER04'),('PACKER05'),('PACKER06'),('PACKER07'),('PACKER08'),
  ('RM01'),('RM02'),('RM03'),('SPB01'),('SPB02'),('WHRTG01'),('WHRTG02'),('XTBOND01')
on conflict (resource_name) do nothing;

alter table resources enable row level security;
drop policy if exists res_read on resources;
drop policy if exists res_write on resources;
create policy res_read on resources for select to authenticated using (true);
create policy res_write on resources for update to authenticated using (has_feature(auth.uid()::uuid,'assets.edit') or is_app_admin(auth.uid()::uuid));

-- ---------- Equipment-Resource linking ----------
create table if not exists equipment_resource_mapping (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  created_at timestamptz default now(),
  unique(equipment_id, resource_id)
);

alter table equipment_resource_mapping enable row level security;
drop policy if exists eq_res_read on equipment_resource_mapping;
drop policy if exists eq_res_write on equipment_resource_mapping;
create policy eq_res_read on equipment_resource_mapping for select to authenticated using (true);
create policy eq_res_write on equipment_resource_mapping for all to authenticated using (has_feature(auth.uid()::uuid,'assets.edit'));

-- ---------- Lubrication Points updates ----------
alter table lubrication_points add column if not exists lubrication_type lubrication_type_enum default 'Oil';
alter table lubrication_points add column if not exists lubricant_id uuid references lubricants_master(id);
alter table lubrication_points add column if not exists running_hours_interval int;
alter table lubrication_points add column if not exists calendar_interval_months int;
alter table lubrication_points add column if not exists status equipment_status default 'Active';
alter table lubrication_points add column if not exists criticality asset_criticality default 'Medium';
alter table lubrication_points add column if not exists special_instructions text;

-- ---------- Helper RPC: update resource running hours + cascade to linked equipment ----------
create or replace function update_resource_running_hours(res_id uuid, new_hours numeric)
returns void
language plpgsql
as $$
declare
  v_eq_id uuid;
begin
  update resources set
    running_hours = new_hours,
    last_running_hours_update = now(),
    updated_by = auth.uid()
  where id = res_id;
  
  for v_eq_id in select equipment_id from equipment_resource_mapping where resource_id = res_id
  loop
    update equipment set
      running_hours = new_hours,
      last_running_hours_update = now(),
      updated_by = auth.uid()
    where id = v_eq_id;
  end loop;
end;
$$;