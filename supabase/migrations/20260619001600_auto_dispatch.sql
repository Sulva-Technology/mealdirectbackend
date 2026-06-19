begin;

-- Assign the least-loaded available, verified, active rider in the batch's zone to the batch,
-- if it has no assignment yet. Returns the new assignment id, or null when no rider is
-- available or an assignment already exists. SECURITY DEFINER with a fixed search_path so the
-- outbox worker can call it without elevated client privileges.
create or replace function public.assign_available_rider_to_batch(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campus_id uuid;
  v_rider_id uuid;
  v_assignment_id uuid;
begin
  if exists (select 1 from public.delivery_assignments where batch_id = p_batch_id) then
    return null;
  end if;

  select campus_id into v_campus_id from public.delivery_batches where id = p_batch_id;
  if v_campus_id is null then
    return null;
  end if;

  select r.id into v_rider_id
  from public.riders r
  left join public.delivery_assignments a
    on a.rider_id = r.id and a.status in ('assigned', 'accepted', 'picked_up')
  where r.campus_id = v_campus_id and r.available and r.active and r.status = 'verified'
  group by r.id
  order by count(a.id) asc, r.display_name asc
  limit 1;

  if v_rider_id is null then
    return null;
  end if;

  insert into public.delivery_assignments (batch_id, rider_id, status)
  values (p_batch_id, v_rider_id, 'assigned')
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

comment on function public.assign_available_rider_to_batch(uuid) is 'Auto-assigns the least-loaded available verified active rider in the batch zone to a batch with no existing assignment; returns the assignment id or null. Idempotent per batch.';

commit;
