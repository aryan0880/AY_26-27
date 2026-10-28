-- Campus Library MVP: persistent Drive metadata + global sync state.
-- Run the entire file in Supabase Dashboard -> SQL Editor.

create table if not exists public.drive_items (
  drive_file_id text primary key,
  name text not null,
  mime_type text not null,
  parent_drive_id text,
  path text not null,
  is_folder boolean not null default false,
  modified_time timestamptz,
  size_bytes bigint,
  indexed_at timestamptz not null default now()
);

create index if not exists drive_items_parent_idx on public.drive_items (parent_drive_id);
create index if not exists drive_items_is_folder_idx on public.drive_items (is_folder);
-- At 100–300 files, a simple ILIKE scan is fast enough. Add a trigram index only if the library grows substantially.

create table if not exists public.sync_state (
  id smallint primary key check (id = 1),
  is_syncing boolean not null default false,
  last_sync_started_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text not null default 'never'
    check (last_sync_status in ('never', 'running', 'success', 'error')),
  last_sync_error text,
  next_manual_sync_at timestamptz not null default (now() - interval '1 minute'),
  last_folder_count integer not null default 0,
  last_file_count integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.sync_state (id)
values (1)
on conflict (id) do nothing;

-- Frontend calls Express only. RLS blocks browser clients from reading/writing these tables.
alter table public.drive_items enable row level security;
alter table public.sync_state enable row level security;

-- Atomically claim a manual sync and set the one-minute global cooldown.
create or replace function public.claim_manual_sync()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_state public.sync_state%rowtype;
begin
  update public.sync_state
  set is_syncing = true,
      last_sync_started_at = now(),
      last_sync_status = 'running',
      last_sync_error = null,
      next_manual_sync_at = now() + interval '1 minute',
      updated_at = now()
  where id = 1
    and (is_syncing = false or last_sync_started_at < now() - interval '30 minutes')
    and next_manual_sync_at <= now()
  returning * into current_state;

  if found then
    return jsonb_build_object('accepted', true, 'reason', 'accepted', 'retryAfterSeconds', 0);
  end if;

  select * into current_state from public.sync_state where id = 1;
  if current_state.is_syncing then
    return jsonb_build_object('accepted', false, 'reason', 'busy', 'retryAfterSeconds', 5);
  end if;

  return jsonb_build_object(
    'accepted', false,
    'reason', 'cooldown',
    'retryAfterSeconds', greatest(1, ceil(extract(epoch from (current_state.next_manual_sync_at - now())))::integer)
  );
end;
$$;

-- Scheduled/startup syncs share the same database-level lock but do not use or reset manual cooldown.
create or replace function public.claim_scheduled_sync()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_id smallint;
begin
  update public.sync_state
  set is_syncing = true,
      last_sync_started_at = now(),
      last_sync_status = 'running',
      last_sync_error = null,
      updated_at = now()
  where id = 1
    and (is_syncing = false or last_sync_started_at < now() - interval '30 minutes')
  returning id into claimed_id;
  return found;
end;
$$;

-- Keep operational RPCs executable by the backend service role only.
revoke all on function public.claim_manual_sync() from public, anon, authenticated;
revoke all on function public.claim_scheduled_sync() from public, anon, authenticated;
grant execute on function public.claim_manual_sync() to service_role;
grant execute on function public.claim_scheduled_sync() to service_role;

-- Do not create anonymous SELECT/INSERT/UPDATE policies. Public visitors use the controlled Express API.


-- Atomically replace the whole index after the backend completes a full Drive scan.
-- If this function fails, PostgreSQL rolls back every upsert/delete in this call.
create or replace function public.replace_drive_index(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint := 0;
  folder_count bigint := 0;
  file_count bigint := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  -- A valid scan always includes the configured root folder. Reject empty payloads to
  -- ensure a programming/configuration error cannot wipe the entire library index.
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Refusing to replace the library index with an empty scan';
  end if;

  insert into public.drive_items (
    drive_file_id, name, mime_type, parent_drive_id, path,
    is_folder, modified_time, size_bytes, indexed_at
  )
  select
    incoming.drive_file_id,
    incoming.name,
    incoming.mime_type,
    incoming.parent_drive_id,
    incoming.path,
    incoming.is_folder,
    incoming.modified_time,
    incoming.size_bytes,
    coalesce(incoming.indexed_at, now())
  from jsonb_to_recordset(p_items) as incoming(
    drive_file_id text,
    name text,
    mime_type text,
    parent_drive_id text,
    path text,
    is_folder boolean,
    modified_time timestamptz,
    size_bytes bigint,
    indexed_at timestamptz
  )
  on conflict (drive_file_id) do update set
    name = excluded.name,
    mime_type = excluded.mime_type,
    parent_drive_id = excluded.parent_drive_id,
    path = excluded.path,
    is_folder = excluded.is_folder,
    modified_time = excluded.modified_time,
    size_bytes = excluded.size_bytes,
    indexed_at = excluded.indexed_at;

  delete from public.drive_items as existing
  where not exists (
    select 1
    from jsonb_to_recordset(p_items) as scanned(drive_file_id text)
    where scanned.drive_file_id = existing.drive_file_id
  );
  get diagnostics deleted_count = row_count;

  select count(*) filter (where is_folder), count(*) filter (where not is_folder)
  into folder_count, file_count
  from public.drive_items;

  return jsonb_build_object(
    'folders', folder_count,
    'files', file_count,
    'staleRemoved', deleted_count
  );
end;
$$;

revoke all on function public.replace_drive_index(jsonb) from public, anon, authenticated;
grant execute on function public.replace_drive_index(jsonb) to service_role;
