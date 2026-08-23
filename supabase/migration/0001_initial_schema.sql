create extension if not exists pgcrypto;

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  url text not null check (url ~ '^https?://'),
  enabled boolean not null default true,
  interval_minutes integer not null check (interval_minutes in (1, 5, 10, 15, 30)),
  next_check_at timestamptz not null default now(),
  state text not null default 'HEALTHY'
    check (state in ('HEALTHY', 'SUSPECTED_FAILURE', 'DOWN')),
  consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  last_failure_at timestamptz,
  notification_email_enabled boolean not null default false,
  notification_webhook_enabled boolean not null default false,
  webhook_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.check_results (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null
    references public.monitors(id) on delete cascade,
  checked_at timestamptz not null,
  success boolean not null,
  http_status integer,
  response_ms integer,
  failure_type text
    check (
      failure_type in (
        'HTTP_ERROR',
        'TIMEOUT',
        'CONNECTION_ERROR',
        'UNEXPECTED_ERROR'
      )
    ),
  error_message text,
  execution_key text not null,
  created_at timestamptz not null default now(),
  -- Real idempotency marker for apply_check_transition(). Deliberately
  -- a dedicated column rather than overloading error_message: a failed
  -- check's error_message holds genuine error text and must never be
  -- mutated to also serve as a status flag.
  transition_processed_at timestamptz,
  unique (monitor_id, execution_key)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null
    references public.monitors(id) on delete cascade,
  started_at timestamptz not null,
  confirmed_at timestamptz not null,
  resolved_at timestamptz,
  status text not null check (status in ('OPEN', 'RESOLVED')),
  failure_type text
    check (
      failure_type in (
        'HTTP_ERROR',
        'TIMEOUT',
        'CONNECTION_ERROR',
        'UNEXPECTED_ERROR'
      )
    ),
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create unique index one_open_incident_per_monitor
  on public.incidents(monitor_id)
  where status = 'OPEN';

create table public.daily_monitor_statistics (
  monitor_id uuid not null
    references public.monitors(id) on delete cascade,
  stat_date date not null,
  total_checks integer not null,
  successful_checks integer not null,
  failed_checks integer not null,
  uptime_percentage numeric(5, 2) not null,
  avg_response_ms integer,
  min_response_ms integer,
  max_response_ms integer,
  incident_count integer not null default 0,
  total_downtime_seconds integer not null default 0,
  primary key (monitor_id, stat_date)
);

create index monitors_due_idx
  on public.monitors(enabled, next_check_at)
  where enabled = true;

create index monitors_user_created_idx
  on public.monitors(user_id, created_at desc);

create index check_results_monitor_checked_at_idx
  on public.check_results(monitor_id, checked_at desc);

create index incidents_monitor_started_at_idx
  on public.incidents(monitor_id, started_at desc);

create index incidents_monitor_status_idx
  on public.incidents(monitor_id, status);

create or replace function public.set_monitor_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger monitors_set_updated_at
before update on public.monitors
for each row
execute function public.set_monitor_updated_at();

create or replace function public.claim_due_monitors(
  p_limit integer
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  url text,
  enabled boolean,
  interval_minutes integer,
  scheduled_for timestamptz,
  next_check_at timestamptz,
  state text,
  consecutive_failures integer,
  last_failure_at timestamptz,
  notification_email_enabled boolean,
  notification_webhook_enabled boolean,
  webhook_url text,
  created_at timestamptz,
  updated_at timestamptz,
  execution_key text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select
      m.id,
      m.next_check_at as scheduled_for
    from public.monitors m
    where m.enabled = true
      and m.next_check_at <= now()
    order by m.next_check_at, m.id
    limit greatest(p_limit, 0)
    for update of m skip locked
  ),
  claimed as (
    update public.monitors m
    set next_check_at =
      c.scheduled_for
      + make_interval(mins => m.interval_minutes)
    from candidates c
    where m.id = c.id
    returning m.*
  )
  select
    m.id,
    m.user_id,
    m.name,
    m.url,
    m.enabled,
    m.interval_minutes,
    c.scheduled_for,
    m.next_check_at,
    m.state,
    m.consecutive_failures,
    m.last_failure_at,
    m.notification_email_enabled,
    m.notification_webhook_enabled,
    m.webhook_url,
    m.created_at,
    m.updated_at,
    m.id::text || ':' ||
      floor(
        extract(epoch from c.scheduled_for)
        / (m.interval_minutes * 60)
      )::bigint::text
  from claimed m
  join candidates c
    on c.id = m.id;
end;
$$;

revoke all
  on function public.claim_due_monitors(integer)
  from public, anon, authenticated;

grant execute
  on function public.claim_due_monitors(integer)
  to service_role;

-- Atomically enforces the 25-monitor-per-user quota. A per-user
-- advisory transaction lock serializes concurrent create_monitor()
-- calls for the SAME user only (other users are never blocked by
-- each other), so a count-then-insert race can no longer let two
-- simultaneous requests both observe 24 monitors and both insert a
-- 25th. The lock is released automatically at the end of the
-- transaction (pg_advisory_XACT_lock), so no explicit unlock is
-- needed and it cannot be leaked by a crashed connection.
create or replace function public.create_monitor(
  p_user_id uuid,
  p_name text,
  p_url text,
  p_enabled boolean,
  p_interval_minutes integer,
  p_notification_email_enabled boolean,
  p_notification_webhook_enabled boolean,
  p_webhook_url text
)
returns public.monitors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_monitor public.monitors%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select count(*)
  into v_count
  from public.monitors
  where user_id = p_user_id;

  if v_count >= 25 then
    raise exception 'MONITOR_QUOTA_REACHED';
  end if;

  insert into public.monitors (
    user_id,
    name,
    url,
    enabled,
    interval_minutes,
    next_check_at,
    notification_email_enabled,
    notification_webhook_enabled,
    webhook_url
  )
  values (
    p_user_id,
    p_name,
    p_url,
    p_enabled,
    p_interval_minutes,
    now() + make_interval(mins => p_interval_minutes),
    p_notification_email_enabled,
    p_notification_webhook_enabled,
    p_webhook_url
  )
  returning *
  into v_monitor;

  return v_monitor;
end;
$$;

revoke all
  on function public.create_monitor(
    uuid, text, text, boolean, integer, boolean, boolean, text
  )
  from public, anon, authenticated;

grant execute
  on function public.create_monitor(
    uuid, text, text, boolean, integer, boolean, boolean, text
  )
  to service_role;

-- Drives the HEALTHY -> SUSPECTED_FAILURE -> DOWN -> HEALTHY state
-- machine for exactly one already-recorded check, identified by
-- (p_monitor_id, p_execution_key).
--
-- Idempotency: guarded by check_results.transition_processed_at, set
-- exactly once per check row, checked BEFORE any state is read. A
-- duplicate call for the same execution key (e.g. two racing workers,
-- or a retried invocation) is a true no-op and returns null.
--
-- Trust boundary: success/failure_type/checked_at are read from the
-- already row-locked check_results record itself, never from
-- parameters, so a caller cannot influence the transition with
-- mismatched or stale values.
create or replace function public.apply_check_transition(
  p_monitor_id uuid,
  p_execution_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_monitor public.monitors%rowtype;
  v_check public.check_results%rowtype;
  v_incident public.incidents%rowtype;
  v_failure_count integer;
begin
  select *
  into v_monitor
  from public.monitors
  where id = p_monitor_id
  for update;

  if not found then
    raise exception 'Monitor % not found', p_monitor_id;
  end if;

  select *
  into v_check
  from public.check_results
  where monitor_id = p_monitor_id
    and execution_key = p_execution_key
  for update;

  if not found then
    raise exception
      'Check result for execution % was not found',
      p_execution_key;
  end if;

  if v_check.transition_processed_at is not null then
    return null;
  end if;

  if not v_check.success then
    v_failure_count := v_monitor.consecutive_failures + 1;

    if v_monitor.state = 'HEALTHY' then
      update public.monitors
      set state = 'SUSPECTED_FAILURE',
          consecutive_failures = v_failure_count,
          last_failure_at = v_check.checked_at
      where id = p_monitor_id;

      update public.check_results
      set transition_processed_at = now()
      where id = v_check.id;

      return null;
    end if;

    if v_monitor.state = 'SUSPECTED_FAILURE'
       and v_failure_count >= 2 then

      insert into public.incidents (
        monitor_id,
        started_at,
        confirmed_at,
        status,
        failure_type
      )
      values (
        p_monitor_id,
        coalesce(v_monitor.last_failure_at, v_check.checked_at),
        v_check.checked_at,
        'OPEN',
        v_check.failure_type
      )
      returning *
      into v_incident;

      update public.monitors
      set state = 'DOWN',
          consecutive_failures = v_failure_count
      where id = p_monitor_id;

      update public.check_results
      set transition_processed_at = now()
      where id = v_check.id;

      return jsonb_build_object(
        'type', 'OPENED',
        'incidentId', v_incident.id
      );
    end if;

    update public.monitors
    set state = 'DOWN',
        consecutive_failures = v_failure_count
    where id = p_monitor_id;

    update public.check_results
    set transition_processed_at = now()
    where id = v_check.id;

    return null;
  end if;

  /*
   * Successful check:
   * HEALTHY -> HEALTHY
   * SUSPECTED_FAILURE -> HEALTHY
   * DOWN -> HEALTHY + resolve incident
   */
  if v_monitor.state = 'DOWN' then
    select *
    into v_incident
    from public.incidents
    where monitor_id = p_monitor_id
      and status = 'OPEN'
    order by started_at desc
    limit 1
    for update;

    if found then
      update public.incidents
      set status = 'RESOLVED',
          resolved_at = v_check.checked_at,
          duration_seconds = greatest(
            0,
            floor(
              extract(
                epoch from (
                  v_check.checked_at - v_incident.started_at
                )
              )
            )::integer
          )
      where id = v_incident.id
        and status = 'OPEN';
    end if;
  end if;

  update public.monitors
  set state = 'HEALTHY',
      consecutive_failures = 0,
      last_failure_at = null
  where id = p_monitor_id;

  update public.check_results
  set transition_processed_at = now()
  where id = v_check.id;

  if v_monitor.state = 'DOWN' and v_incident.id is not null then
    return jsonb_build_object(
      'type', 'RECOVERED',
      'incidentId', v_incident.id
    );
  end if;

  return null;
end;
$$;

revoke all
  on function public.apply_check_transition(uuid, text)
  from public, anon, authenticated;

grant execute
  on function public.apply_check_transition(uuid, text)
  to service_role;

alter table public.monitors enable row level security;
alter table public.check_results enable row level security;
alter table public.incidents enable row level security;
alter table public.daily_monitor_statistics enable row level security;

create policy "users manage their monitors"
  on public.monitors
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users read their check results"
  on public.check_results
  for select
  using (
    exists (
      select 1
      from public.monitors m
      where m.id = monitor_id
        and m.user_id = auth.uid()
    )
  );

create policy "users read their incidents"
  on public.incidents
  for select
  using (
    exists (
      select 1
      from public.monitors m
      where m.id = monitor_id
        and m.user_id = auth.uid()
    )
  );

create policy "users read their statistics"
  on public.daily_monitor_statistics
  for select
  using (
    exists (
      select 1
      from public.monitors m
      where m.id = monitor_id
        and m.user_id = auth.uid()
    )
  );

-- Aggregates raw checks older than the retention boundary into
-- permanent daily_monitor_statistics rows, then deletes those raw
-- rows.
--
-- Cutoff is day-aligned (date_trunc('day', now()) - 30 days), not a
-- raw "now() - 30 days" instant. This guarantees every calendar day is
-- captured by exactly one retention run: a day is either entirely
-- before the cutoff (all its checks are aggregated and deleted now) or
-- entirely on/after it (nothing about it is touched yet). Without this
-- alignment, a day whose checks straddle the exact cutoff instant
-- would be partially aggregated on one run and partially on a later
-- run, and the second run's REPLACE-style upsert would silently
-- discard the first run's counts. Day-alignment removes the need to
-- ever accumulate across runs and keeps the upsert idempotent by
-- simple replacement.
--
-- incident_count is attributed to each incident's confirmed_at date.
-- total_downtime_seconds is the portion of each incident's
-- [started_at, resolved_at ?? now()] interval that overlaps that
-- specific calendar day, so a multi-day incident has its downtime
-- split proportionally across every day it touches rather than being
-- charged entirely to one date.
create or replace function public.aggregate_and_delete_expired_checks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- All reporting dates are UTC dates. Do not depend on the database session
  -- timezone, which is unrelated to Cloudflare Cron's UTC schedule.
  v_cutoff timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '30 days';
begin
  with agg as (
    select
      c.monitor_id,
      (c.checked_at at time zone 'UTC')::date as stat_date,
      count(*) as total_checks,
      count(*) filter (where c.success) as successful_checks,
      count(*) filter (where not c.success) as failed_checks,
      round(
        (
          count(*) filter (where c.success)::numeric
          / count(*) * 100
        ),
        2
      ) as uptime_percentage,
      round(avg(c.response_ms))::int as avg_response_ms,
      min(c.response_ms) as min_response_ms,
      max(c.response_ms) as max_response_ms
    from public.check_results c
    where c.checked_at < v_cutoff
    group by c.monitor_id, (c.checked_at at time zone 'UTC')::date
  ),
  -- Keep every already-retained day in the recalculation set. This is
  -- essential for an outage that was still open when a day was first retained:
  -- a later recovery must revise that day's final downtime even though its raw
  -- check rows have already been deleted. Include incident-only days as well,
  -- so downtime is not lost on a calendar day with no health checks.
  historical_days as (
    select a.monitor_id, a.stat_date from agg a
    union
    select d.monitor_id, d.stat_date
    from public.daily_monitor_statistics d
    where d.stat_date < v_cutoff::date
    union
    select i.monitor_id, day::date
    from public.incidents i
    cross join lateral generate_series(
      greatest((i.started_at at time zone 'UTC')::date, date '1970-01-01'),
      least(
        (coalesce(i.resolved_at, now()) at time zone 'UTC')::date,
        (v_cutoff - interval '1 day')::date
      ),
      interval '1 day'
    ) day
    where (i.started_at at time zone 'UTC')::date < v_cutoff::date
  ),
  base as (
    select
      h.monitor_id,
      h.stat_date,
      coalesce(a.total_checks, d.total_checks, 0) as total_checks,
      coalesce(a.successful_checks, d.successful_checks, 0) as successful_checks,
      coalesce(a.failed_checks, d.failed_checks, 0) as failed_checks,
      coalesce(a.uptime_percentage, d.uptime_percentage, 0) as uptime_percentage,
      coalesce(a.avg_response_ms, d.avg_response_ms) as avg_response_ms,
      coalesce(a.min_response_ms, d.min_response_ms) as min_response_ms,
      coalesce(a.max_response_ms, d.max_response_ms) as max_response_ms
    from historical_days h
    left join agg a
      on a.monitor_id = h.monitor_id and a.stat_date = h.stat_date
    left join public.daily_monitor_statistics d
      on d.monitor_id = h.monitor_id and d.stat_date = h.stat_date
  ),
  incident_days as (
    select
      b.monitor_id,
      b.stat_date,
      (
        select count(*)
        from public.incidents i
        where i.monitor_id = b.monitor_id
          and (i.confirmed_at at time zone 'UTC')::date = b.stat_date
      ) as incident_count,
      (
        select coalesce(sum(
          greatest(
            0,
            extract(
              epoch from (
                least(coalesce(i.resolved_at, now()), (b.stat_date + 1)::timestamp at time zone 'UTC')
                - greatest(i.started_at, b.stat_date::timestamp at time zone 'UTC')
              )
            )
          )
        ), 0)::integer
        from public.incidents i
        where i.monitor_id = b.monitor_id
          and i.started_at < (b.stat_date + 1)::timestamp at time zone 'UTC'
          and coalesce(i.resolved_at, now()) > b.stat_date::timestamp at time zone 'UTC'
      ) as total_downtime_seconds
    from base b
  )
  insert into public.daily_monitor_statistics (
    monitor_id,
    stat_date,
    total_checks,
    successful_checks,
    failed_checks,
    uptime_percentage,
    avg_response_ms,
    min_response_ms,
    max_response_ms,
    incident_count,
    total_downtime_seconds
  )
  select
    a.monitor_id,
    a.stat_date,
    a.total_checks,
    a.successful_checks,
    a.failed_checks,
    a.uptime_percentage,
    a.avg_response_ms,
    a.min_response_ms,
    a.max_response_ms,
    d.incident_count,
    d.total_downtime_seconds
  from base a
  join incident_days d
    on d.monitor_id = a.monitor_id
   and d.stat_date = a.stat_date
  on conflict (monitor_id, stat_date)
  do update set
    total_checks = excluded.total_checks,
    successful_checks = excluded.successful_checks,
    failed_checks = excluded.failed_checks,
    uptime_percentage = excluded.uptime_percentage,
    avg_response_ms = excluded.avg_response_ms,
    min_response_ms = excluded.min_response_ms,
    max_response_ms = excluded.max_response_ms,
    incident_count = excluded.incident_count,
    total_downtime_seconds = excluded.total_downtime_seconds;

  delete from public.check_results
  where checked_at < v_cutoff;
end;
$$;

revoke all
  on function public.aggregate_and_delete_expired_checks()
  from public, anon, authenticated;

grant execute
  on function public.aggregate_and_delete_expired_checks()
  to service_role;
