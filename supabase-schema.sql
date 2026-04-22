-- ═══════════════════════════════════════════════
-- Valley E-Bikes Fleet Manager — Supabase Schema
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── BIKES ───
create table if not exists bikes (
  id uuid primary key default gen_random_uuid(),
  name text,
  category text,
  brand text,
  model text,
  serial text,
  purchase_date date,
  status text default 'Needs Check',
  condition_score int default 10,
  total_km int default 0,
  total_rides int default 0,
  battery_id uuid,
  last_pre_ride timestamptz,
  last_post_ride timestamptz,
  last_service timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- ─── BATTERIES ───
create table if not exists batteries (
  id uuid primary key default gen_random_uuid(),
  serial text,
  purchase_date date,
  status text default 'Active',
  last_charge_date timestamptz,
  last_issue_date timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- ─── CHECKS ───
create table if not exists checks (
  id uuid primary key default gen_random_uuid(),
  bike_id uuid references bikes(id) on delete cascade,
  type text,
  staff text,
  toggles jsonb,
  result text,
  notes text,
  date timestamptz default now(),
  created_at timestamptz default now()
);

-- ─── FAULTS ───
create table if not exists faults (
  id uuid primary key default gen_random_uuid(),
  bike_id uuid references bikes(id) on delete cascade,
  reported_by text,
  category text,
  code text,
  severity text,
  description text,
  status text default 'Open',
  assigned_to text,
  resolution text,
  parts_used text,
  closed_date timestamptz,
  date timestamptz default now(),
  created_at timestamptz default now()
);

-- ─── SERVICES ───
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  bike_id uuid references bikes(id) on delete cascade,
  service_type text,
  due_date date,
  completed_date timestamptz,
  assigned_to text,
  tasks text,
  work_notes text,
  parts_used jsonb default '[]'::jsonb,
  time_spent text,
  outcome text,
  created_at timestamptz default now()
);

-- ─── PARTS ───
create table if not exists parts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  supplier text,
  supplier_code text,
  qty int default 0,
  reorder int default 1,
  cost numeric(10,2) default 0,
  compatible text,
  notes text,
  created_at timestamptz default now()
);

-- ─── STAFF ───
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text default 'frontline',
  phone text,
  active boolean default true,
  created_at timestamptz default now()
);

-- ─── SEED DEFAULT PARTS ───
insert into parts (name, category, qty, reorder, cost, compatible) values
  ('Brake Pads (Set)', 'Brake pads', 8, 4, 25, 'All'),
  ('Inner Tube 26×4.0', 'Tubes', 12, 6, 15, 'Fat Tyre'),
  ('Chain KMC Z7', 'Chains', 4, 2, 22, 'All'),
  ('Tyre 26×4.0 Fat', 'Tyres', 6, 3, 55, 'Fat Tyre'),
  ('Rotor 180mm', 'Rotors', 4, 2, 18, 'All'),
  ('Derailleur Hanger', 'Hangers', 6, 3, 12, 'All'),
  ('Battery Key (Spare)', 'Keys', 3, 2, 8, 'All'),
  ('Charger 48V 2A', 'Chargers', 2, 1, 65, 'All')
on conflict do nothing;

-- ─── SEED DEFAULT STAFF ───
insert into staff (name, role) values ('Mick', 'admin') on conflict do nothing;

-- ═══════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- For v1 simplicity: enable RLS with permissive policies.
-- Lock down later when you add proper auth / staff login.
-- ═══════════════════════════════════════════════
alter table bikes enable row level security;
alter table batteries enable row level security;
alter table checks enable row level security;
alter table faults enable row level security;
alter table services enable row level security;
alter table parts enable row level security;
alter table staff enable row level security;

-- Permissive policies (anon key can do everything)
-- TIGHTEN THESE when you add auth — swap "true" for "auth.uid() is not null" etc.
do $$
declare
  t text;
begin
  for t in select unnest(array['bikes','batteries','checks','faults','services','parts','staff']) loop
    execute format('drop policy if exists "public_all" on %I', t);
    execute format('create policy "public_all" on %I for all using (true) with check (true)', t);
  end loop;
end $$;
