begin;

-- Corrective: 20260707000100 inserted 'snacks'/'single' with `on conflict (code) do nothing`,
-- so where a 'snacks' unit type already existed (e.g. created via the admin unit-types UI with
-- triggers_takeaway_fee = true) the fee flag was NOT reset and snack orders kept pulling the
-- takeaway fee. Force the no-fee shape now. Idempotent; safe to re-run.

-- Ensure both rows exist (no-op if 20260707000100 already created them).
insert into public.unit_types (code, display_name, counts_toward_spoon_limit, triggers_takeaway_fee, max_quantity)
values
  ('snacks', 'Snack', false, false, null),
  ('single', 'Single portion', false, false, 1)
on conflict (code) do nothing;

-- Snacks: never pull the takeaway fee, never count toward the spoon cap.
update public.unit_types
set triggers_takeaway_fee = false,
    counts_toward_spoon_limit = false
where code = 'snacks'
  and (triggers_takeaway_fee is distinct from false
    or counts_toward_spoon_limit is distinct from false);

-- Single: no-fee sibling of single_takeaway; one per line, no spoon cap.
update public.unit_types
set triggers_takeaway_fee = false,
    counts_toward_spoon_limit = false,
    max_quantity = 1
where code = 'single'
  and (triggers_takeaway_fee is distinct from false
    or counts_toward_spoon_limit is distinct from false
    or max_quantity is distinct from 1);

commit;
