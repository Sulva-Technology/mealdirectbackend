begin;

-- Bulk-flag existing swallow items: every menu item whose unit type is the "wraps" unit
-- (eba, semo, pounded yam, etc.) now requires a soup selection. New wraps items still
-- default to requires_soup = false, so vendors opt those in per item.
update public.menu_items mi
set requires_soup = true,
    updated_at = now()
from public.unit_types ut
where ut.id = mi.unit_type_id
  and ut.code = 'wraps'
  and mi.requires_soup = false;

comment on column public.menu_items.requires_soup is 'When true, ordering this item requires exactly one soup selection. Wraps/swallow items are bulk-flagged true; other items default false and vendors opt in per item.';

commit;
