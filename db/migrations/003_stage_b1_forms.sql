-- ============================================================
-- Stage B.1: Form improvements
-- - Add status / criticality enums
-- - Create lubricants master table
-- - Track component type & point name suggestions (for typeahead)
-- - Add running_hours_interval, calendar_interval to lubrication_points
-- ============================================================

-- ---------- Enum types ----------
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

-- Seed some common lubricants
insert into lubricants_master (name, lubricant_type, description, uom) values
  ('EP2 Lithium Complex Grease', 'Grease', 'General purpose bearing grease', 'kg'),
  ('ISO VG 46 Hydraulic Oil', 'Oil', 'Standard industrial hydraulic fluid', 'L'),
  ('ISO VG 320 Gear Oil', 'Oil', 'Mineral gear oil for gearboxes', 'L'),
  ('ISO VG 680 Circulating Oil', 'Circulating Oil System', 'High-viscosity circulating system oil', 'L'),
  ('Open Gear Compound', 'Grease', 'Sticky gear lubricant for exposed gears', 'kg')
on conflict (name) do nothing;

-- RLS for lubricants_master
alter table lubricants_master enable row level security;
create policy lub_master_read on lubricants_master for select to authenticated using (true);
create policy lub_master_write on lubricants_master for insert to authenticated with check (has_feature('inventory.edit'));
create policy lub_master_update on lubricants_master for update to authenticated using (has_feature('inventory.edit'));
create policy lub_master_delete on lubricants_master for delete to authenticated using (has_feature('inventory.edit'));

-- ---------- Update equipment table ----------
alter table equipment add column if not exists status equipment_status default 'Active';
alter table equipment add column if not exists lubrication_criticality asset_criticality default 'Medium';
alter table equipment drop column if exists manufacturer;
alter table equipment drop column if exists model;
alter table equipment drop column if exists serial_number;

-- ---------- Update components table ----------
alter table components add column if not exists criticality asset_criticality default 'Medium';
alter table components add column if not exists status equipment_status default 'Active';

-- ---------- Suggestion history tables (for typeahead) ----------
create table if not exists component_type_suggestions (
  id uuid primary key default gen_random_uuid(),
  type_name text not null,
  use_count int default 1,
  last_used timestamptz default now(),
  unique(type_name)
);

create table if not exists lubrication_point_name_suggestions (
  id uuid primary key default gen_random_uuid(),
  point_name text not null,
  use_count int default 1,
  last_used timestamptz default now(),
  unique(point_name)
);

-- ---------- Update lubrication_points table ----------
alter table lubrication_points add column if not exists lubrication_type lubrication_type_enum default 'Oil';
alter table lubrication_points add column if not exists lubricant_id uuid references lubricants_master(id);
alter table lubrication_points add column if not exists running_hours_interval int;
alter table lubrication_points add column if not exists calendar_interval_months int;
alter table lubrication_points add column if not exists status equipment_status default 'Active';
alter table lubrication_points add column if not exists criticality asset_criticality default 'Medium';
alter table lubrication_points add column if not exists special_instructions text;

-- RLS for suggestion tables (read by everyone, write by system only)
alter table component_type_suggestions enable row level security;
alter table lubrication_point_name_suggestions enable row level security;
create policy comp_type_suggest_read on component_type_suggestions for select to authenticated using (true);
create policy lp_name_suggest_read on lubrication_point_name_suggestions for select to authenticated using (true);

-- ---------- Helper: update suggestion counts on component add ----------
create or replace function track_component_type_suggestion(type_name text)
returns void
language plpgsql
as $$
begin
  insert into component_type_suggestions (type_name, use_count, last_used)
  values (type_name, 1, now())
  on conflict (type_name) do update set
    use_count = use_count + 1,
    last_used = now();
end;
$$;

-- ---------- Resources (physical plant machines) ----------
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  resource_name text not null unique,
  running_hours numeric(12,2) default 0,
  last_running_hours_update timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Seed the 36 resources from the plant
insert into resources (resource_name) values
  ('AQCLP01'),('AQCLP02'),('AQCMP01'),('AQCMP02'),('AUXCR01'),('BLKCEM01'),('CLAYCR01'),
  ('CM01'),('CM02'),('CM03'),('COALM01'),('COALM02'),('KILN01'),('KILN02'),('LSCR01'),('LSCR02'),
  ('MINLS'),('PACKER01'),('PACKER02'),('PACKER03'),('PACKER04'),('PACKER05'),('PACKER06'),('PACKER07'),('PACKER08'),
  ('RM01'),('RM02'),('RM03'),('SPB01'),('SPB02'),('WHRTG01'),('WHRTG02'),('XTBOND01')
on conflict (resource_name) do nothing;

-- RLS for resources
alter table resources enable row level security;
create policy res_read on resources for select to authenticated using (true);
create policy res_write on resources for update to authenticated using (has_feature('assets.edit') or is_app_admin(auth.uid()));

-- ---------- Equipment-Resource linking (equipment can run on multiple resources) ----------
create table if not exists equipment_resource_mapping (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  created_at timestamptz default now(),
  unique(equipment_id, resource_id)
);

-- RLS for equipment_resource_mapping
alter table equipment_resource_mapping enable row level security;
create policy eq_res_read on equipment_resource_mapping for select to authenticated using (true);
create policy eq_res_write on equipment_resource_mapping for all to authenticated using (has_feature('assets.edit'));

-- ---------- Add running_hours tracking to equipment ----------
alter table equipment add column if not exists running_hours numeric(12,2) default 0;
alter table equipment add column if not exists last_running_hours_update timestamptz;

-- ---------- Helper: update suggestion counts on component add ----------
create or replace function track_component_type_suggestion(type_name text)
returns void
language plpgsql
as $$
begin
  insert into component_type_suggestions (type_name, use_count, last_used)
  values (type_name, 1, now())
  on conflict (type_name) do update set
    use_count = use_count + 1,
    last_used = now();
end;
$$;

-- ---------- Helper: update suggestion counts on point add ----------
create or replace function track_point_name_suggestion(point_name text)
returns void
language plpgsql
as $$
begin
  insert into lubrication_point_name_suggestions (point_name, use_count, last_used)
  values (point_name, 1, now())
  on conflict (point_name) do update set
    use_count = use_count + 1,
    last_used = now();
end;
$$;

-- ---------- RPC: update resource running hours + cascade to linked equipment ----------
create or replace function update_resource_running_hours(res_id uuid, new_hours numeric)
returns void
language plpgsql
as $$
declare
  v_eq_id uuid;
begin
  -- Update the resource
  update resources set
    running_hours = new_hours,
    last_running_hours_update = now(),
    updated_by = auth.uid()
  where id = res_id;
  
  -- Cascade to all linked equipment
  for v_eq_id in select equipment_id from equipment_resources where resource_id = res_id
  loop
    update equipment set
      running_hours = new_hours,
      last_running_hours_update = now(),
      updated_by = auth.uid()
    where id = v_eq_id;
  end loop;
end;
$$;

-- ---------- Resources master table (cement plant operational units) ----------
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  resource_name text not null unique,
  description text,
  running_hours numeric(12,2) default 0,
  running_hours_updated_at timestamptz default now(),
  running_hours_updated_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed the fixed resource names
insert into resources (resource_name, description) values
  ('AQCLP01','Clinker Packer Line 1'),
  ('AQCLP02','Clinker Packer Line 2'),
  ('AQCMP01','Cement Mill Line 1'),
  ('AQCMP02','Cement Mill Line 2'),
  ('AUXCR01','Auxiliary Crusher'),
  ('BLKCEM01','Bulk Cement Loader'),
  ('CLAYCR01','Clay Crusher'),
  ('CM01','Cement Mill 1'),
  ('CM02','Cement Mill 2'),
  ('CM03','Cement Mill 3'),
  ('COALM01','Coal Mill 1'),
  ('COALM02','Coal Mill 2'),
  ('KILN01','Kiln Line 1'),
  ('KILN02','Kiln Line 2'),
  ('LSCR01','Limestone Crusher 1'),
  ('LSCR02','Limestone Crusher 2'),
  ('MINLS','Mill (Limestone)'),
  ('PACKER01','Packer 1'),
  ('PACKER02','Packer 2'),
  ('PACKER03','Packer 3'),
  ('PACKER04','Packer 4'),
  ('PACKER05','Packer 5'),
  ('PACKER06','Packer 6'),
  ('PACKER07','Packer 7'),
  ('PACKER08','Packer 8'),
  ('RM01','Raw Mill 1'),
  ('RM02','Raw Mill 2'),
  ('RM03','Raw Mill 3'),
  ('SPB01','Separate/Blender 1'),
  ('SPB02','Separate/Blender 2'),
  ('WHRTG01','Weighing & Routing 1'),
  ('WHRTG02','Weighing & Routing 2'),
  ('XTBOND01','External Bond Mill')
on conflict (resource_name) do nothing;

-- RLS for resources
alter table resources enable row level security;
create policy res_read on resources for select to authenticated using (true);
create policy res_update on resources for update to authenticated using (has_feature('workorders.edit'));

-- ---------- Equipment-Resource mapping (many-to-many) ----------
create table if not exists equipment_resource_mapping (
  equipment_id uuid references equipment(id) on delete cascade,
  resource_id uuid references resources(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (equipment_id, resource_id)
);

alter table equipment_resource_mapping enable row level security;
create policy erm_read on equipment_resource_mapping for select to authenticated using (true);
create policy erm_write on equipment_resource_mapping for insert to authenticated with check (has_feature('assets.edit'));
create policy erm_delete on equipment_resource_mapping for delete to authenticated using (has_feature('assets.edit'));

-- ---------- Running hours tracking on equipment ----------
alter table equipment add column if not exists running_hours numeric(12,2) default 0;
alter table equipment add column if not exists running_hours_updated_at timestamptz default now();
alter table equipment add column if not exists running_hours_updated_by uuid references auth.users(id);

-- ---------- Helper: update running hours for equipment + all attached equipment ----------
create or replace function update_resource_running_hours(res_id uuid, new_hours numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  eq_id uuid;
begin
  -- Update the resource itself
  update resources set running_hours = new_hours, running_hours_updated_at = now(), running_hours_updated_by = auth.uid()
  where id = res_id;
  
  -- Update all equipment attached to this resource
  for eq_id in select distinct equipment_id from equipment_resource_mapping where resource_id = res_id loop
    update equipment set running_hours = new_hours, running_hours_updated_at = now(), running_hours_updated_by = auth.uid()
    where id = eq_id;
  end loop;
end;
$$;
