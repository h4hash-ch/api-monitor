-- Aggregate recent check history in PostgreSQL so the Worker does not need to
-- download every raw check to build dashboard and report statistics.
create or replace function public.get_recent_monitor_statistics(
  p_monitor_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to
     or p_to - p_from > 89 then
    raise exception 'INVALID_STATISTICS_RANGE';
  end if;

  with days as (
    select series.day::date as stat_date
    from generate_series(
      p_from::timestamp,
      p_to::timestamp,
      interval '1 day'
    ) as series(day)
  ), checks as (
    select
      (c.checked_at at time zone 'UTC')::date as stat_date,
      count(*)::integer as total_checks,
      count(*) filter (where c.success)::integer as successful_checks,
      count(*) filter (where not c.success)::integer as failed_checks,
      case when count(*) > 0 then round(
        count(*) filter (where c.success)::numeric / count(*) * 100, 2
      ) else 0 end as uptime_percentage,
      round(avg(c.response_ms))::integer as avg_response_ms,
      min(c.response_ms)::integer as min_response_ms,
      max(c.response_ms)::integer as max_response_ms
    from public.check_results c
    where c.monitor_id = p_monitor_id
      and c.checked_at >= p_from::timestamp at time zone 'UTC'
      and c.checked_at < (p_to + 1)::timestamp at time zone 'UTC'
    group by (c.checked_at at time zone 'UTC')::date
  ), incident_days as (
    select
      d.stat_date,
      (
        select count(*)::integer
        from public.incidents i
        where i.monitor_id = p_monitor_id
          and (i.confirmed_at at time zone 'UTC')::date = d.stat_date
      ) as incident_count,
      (
        select coalesce(sum(greatest(0, extract(epoch from (
          least(coalesce(i.resolved_at, now()),
            (d.stat_date + 1)::timestamp at time zone 'UTC')
          - greatest(i.started_at,
            d.stat_date::timestamp at time zone 'UTC'))))), 0)::integer
        from public.incidents i
        where i.monitor_id = p_monitor_id
          and i.started_at < (d.stat_date + 1)::timestamp at time zone 'UTC'
          and coalesce(i.resolved_at, now()) > d.stat_date::timestamp at time zone 'UTC'
      ) as total_downtime_seconds
    from days d
  ), points as (
    select
      d.stat_date,
      coalesce(c.total_checks, 0) as total_checks,
      coalesce(c.successful_checks, 0) as successful_checks,
      coalesce(c.failed_checks, 0) as failed_checks,
      coalesce(c.uptime_percentage, 0) as uptime_percentage,
      c.avg_response_ms,
      c.min_response_ms,
      c.max_response_ms,
      i.incident_count,
      i.total_downtime_seconds
    from days d
    left join checks c using (stat_date)
    join incident_days i using (stat_date)
  ), failures as (
    select c.failure_type as type, count(*)::integer as count
    from public.check_results c
    where c.monitor_id = p_monitor_id
      and c.checked_at >= p_from::timestamp at time zone 'UTC'
      and c.checked_at < (p_to + 1)::timestamp at time zone 'UTC'
      and c.failure_type is not null
    group by c.failure_type
  ), statuses as (
    select c.http_status as status, count(*)::integer as count
    from public.check_results c
    where c.monitor_id = p_monitor_id
      and c.checked_at >= p_from::timestamp at time zone 'UTC'
      and c.checked_at < (p_to + 1)::timestamp at time zone 'UTC'
    group by c.http_status
  )
  select jsonb_build_object(
    'points', coalesce((select jsonb_agg(to_jsonb(points) order by stat_date) from points), '[]'::jsonb),
    'failureTypes', coalesce((select jsonb_agg(to_jsonb(failures)) from failures), '[]'::jsonb),
    'httpStatuses', coalesce((select jsonb_agg(to_jsonb(statuses)) from statuses), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_recent_monitor_statistics(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_recent_monitor_statistics(uuid, date, date)
  to service_role;
