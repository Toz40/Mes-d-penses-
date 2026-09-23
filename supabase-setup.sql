-- A exécuter une seule fois dans Supabase > SQL Editor
create table if not exists public.shared_groups (
  code text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shared_groups enable row level security;

drop policy if exists shared_groups_select on public.shared_groups;
drop policy if exists shared_groups_insert on public.shared_groups;
drop policy if exists shared_groups_update on public.shared_groups;

create policy shared_groups_select on public.shared_groups
for select to anon using (true);

create policy shared_groups_insert on public.shared_groups
for insert to anon with check (true);

create policy shared_groups_update on public.shared_groups
for update to anon using (true) with check (true);

-- Les données du groupe sont chiffrées dans le navigateur (AES-GCM).
-- Le secret de déchiffrement est transmis uniquement dans le lien d'invitation.
