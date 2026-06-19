begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into public.outbox_events (id, event_type, aggregate_type, aggregate_id, payload)
values ('00000000-0000-0000-0000-0000000000aa', 'test.event', 'order', gen_random_uuid(), '{}'::jsonb);

select is(
  (select count(*)::int from public.claim_outbox_batch('w1', 10)),
  1, 'claim_outbox_batch leases the available event'
);
select ok(
  (select locked_by = 'w1' and attempts = 1 from public.outbox_events
   where id = '00000000-0000-0000-0000-0000000000aa'),
  'claim sets locked_by and increments attempts'
);
select public.fail_outbox_event('00000000-0000-0000-0000-0000000000aa', 'boom', 5);
select ok(
  (select locked_at is null and available_at > now() and last_error = 'boom'
   from public.outbox_events where id = '00000000-0000-0000-0000-0000000000aa'),
  'fail releases lock and backs off when under max attempts'
);
select public.complete_outbox_event('00000000-0000-0000-0000-0000000000aa');
select ok(
  (select processed_at is not null from public.outbox_events
   where id = '00000000-0000-0000-0000-0000000000aa'),
  'complete marks the event processed'
);

select * from finish();

rollback;
