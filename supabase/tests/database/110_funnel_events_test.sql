begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

select has_table('public', 'funnel_events', 'funnel_events exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.funnel_events'::regclass),
  true,
  'funnel_events has RLS enabled'
);

select lives_ok(
  $$insert into public.funnel_events (event, anonymous_id, campus_id)
    values ('campus_link_opened', 'b1111111-1111-4111-8111-111111111111',
            '11111111-1111-1111-1111-111111111111')$$,
  'a known funnel event is accepted'
);

select throws_ok(
  $$insert into public.funnel_events (event, anonymous_id)
    values ('page_viewed', 'b1111111-1111-4111-8111-111111111111')$$,
  '23514',
  null,
  'an unknown event name is rejected'
);

select throws_ok(
  $$insert into public.funnel_events (event, anonymous_id, campus_id)
    values ('campus_selected', 'b1111111-1111-4111-8111-111111111111',
            'f1111111-1111-4111-8111-111111111111')$$,
  '23503',
  null,
  'campus_id must reference a real campus'
);

select is(
  has_table_privilege('anon', 'public.funnel_events', 'select'),
  false,
  'anon cannot read funnel events'
);

select * from finish();

rollback;
