# Meal Direct Database Launch Review

## Migration Inventory

1. `20260612000100_extensions_and_database_utilities.sql`
2. `20260612000200_identity_campus_access.sql`
3. `20260612000300_vendor_rider_catalogue_inventory.sql`
4. `20260612000400_orders_payments_batches_settlements.sql`
5. `20260612000500_rls_privileges_security.sql`

## Required Pre-Launch Commands

Run these commands from the repository root before staging or production deployment:

```bash
pnpm supabase:start
pnpm db:reset
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm db:status
pnpm db:diff:check
```

## Query Plan Checks

Use `EXPLAIN (ANALYZE, BUFFERS)` on these production-critical query shapes after realistic staging data is loaded:

```sql
select * from public.available_menu_items('<campus-id>', current_date + 1, '<slot-id>');
select * from public.orders where customer_id = '<user-id>' order by created_at desc limit 20;
select * from public.orders where vendor_id = '<vendor-id>' and service_date = current_date;
select * from public.delivery_batches where campus_id = '<campus-id>' and service_date = current_date;
select * from public.settlements where vendor_id = '<vendor-id>' and settlement_date = current_date;
```

## Release Rules

Remote schema edits must not be made from the Supabase dashboard SQL editor. Create a new timestamped migration, run it locally with `supabase db reset`, review generated diffs, and deploy the reviewed migration through CI/CD.
