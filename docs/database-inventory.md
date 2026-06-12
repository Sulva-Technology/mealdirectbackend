# Meal Direct Database Inventory

## Migrations

| File                                                     | Purpose                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `20260612000100_extensions_and_database_utilities.sql`   | Extensions, `updated_at` trigger helper, append-only trigger helper, kobo predicate                                       |
| `20260612000200_identity_campus_access.sql`              | Profiles, campuses, zones, locations, memberships, admin roles, audit log, Auth profile trigger                           |
| `20260612000300_vendor_rider_catalogue_inventory.sql`    | Vendors, riders, payout snapshots, menu catalogue, slot availability, dated inventory, inventory adjustments              |
| `20260612000400_orders_payments_batches_settlements.sql` | Orders, payments, webhook events, refunds, batches, assignments, settlements, confirmations, escalations, reviews, outbox |
| `20260612000500_rls_privileges_security.sql`             | RLS, grants, scoped policies, security helper functions, null-aware availability uniqueness                               |

## Table Inventory

Identity and access:
`profiles`, `campuses`, `campus_zones`, `campus_locations`, `campus_memberships`, `admin_memberships`, `audit_logs`.

Vendor, rider, catalogue, inventory:
`vendors`, `vendor_users`, `vendor_payout_accounts`, `riders`, `menu_categories`, `unit_types`, `menu_items`, `delivery_slots`, `vendor_slot_availability`, `menu_item_slot_availability`, `menu_item_inventory`, `inventory_adjustments`.

Transactions and operations:
`orders`, `order_items`, `order_status_history`, `idempotency_keys`, `payments`, `payment_events`, `refunds`, `delivery_batches`, `delivery_batch_orders`, `delivery_assignments`, `settlements`, `settlement_lines`, `delivery_confirmations`, `escalations`, `reviews`, `outbox_events`.

## Function Inventory

Utility and security:
`set_updated_at`, `prevent_update_delete`, `non_negative_kobo`, `handle_new_auth_user`, `current_user_id`, `is_super_admin`, `is_campus_admin`, `has_vendor_access`, `has_rider_access`, `is_assigned_rider_for_batch`, `can_read_delivery_batch`, `can_read_order`, `can_read_settlement`.

Catalogue and inventory:
`effective_ordering_cutoff_at`, `available_vendors`, `available_menu_items`, `record_inventory_adjustment`.

Orders and payments:
`generate_order_number`, `calculate_delivery_earnings`, `enforce_order_insert_cutoff`, `protect_order_financial_history`, `prevent_paid_order_item_changes`, `validate_order_item_rollups`, `create_pending_order_and_reserve_inventory`, `release_expired_reservations`, `transition_order_status`, `add_paid_order_to_batch`, `mark_verified_payment_successful`, `record_payment_event`, `close_batches_at_cutoff`, `produce_vendor_daily_settlement`, `produce_rider_daily_settlement`, `confirm_delivery`, `open_escalation`, `enforce_review_eligibility`.

## Index Inventory

The migrations add indexes for the main access paths:

- Campus lookup: active zones, active locations, location type.
- Admin lookup: active super admin and campus admin grants.
- Vendor lookup: campus/status/active, vendor users by user/vendor, payout account by vendor.
- Rider lookup: campus/status/active and user lookup.
- Catalogue lookup: categories by vendor, items by vendor/category/unit, delivery slots by campus.
- Availability and inventory lookup: slot/day/vendor, slot/day/item, item/date/slot, date/slot active inventory.
- Order lookup: customer history, vendor service date/slot/status, campus service date/slot/status, zone service date.
- Payment lookup: provider/reference unique, order, status, webhook fingerprint/reference/processed state.
- Delivery lookup: batch logical uniqueness, batch service queries, batch orders by batch/order, assignment by rider/vendor.
- Settlement lookup: vendor/date unique, rider/date unique, campus/date/status, settlement lines by settlement.
- Outbox lookup: available unprocessed events and aggregate id.

## RLS Summary

RLS is enabled for every public table. Anonymous users can read only active public catalogue/location surfaces. Authenticated customers can read their own profiles and orders. Vendor users can read their vendor catalogue, inventory, orders, batches, and settlement lines. Riders can read assigned batches and the connected order details needed for delivery. Campus admins are scoped to their campus. Super admins can manage administrative memberships and read global administrative surfaces. Payout accounts, payment payloads, webhook payloads, idempotency keys, and outbox rows have no direct browser grant.

## Test Inventory

| Test file                           | Coverage                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `000_schema_constraints_test.sql`   | Required tables, foreign keys, timestamptz, kobo integer fields, location/admin/zone constraints                                     |
| `010_inventory_catalogue_test.sql`  | Inventory uniqueness, negative/capacity checks, availability intersection, cutoff calculation, adjustment append-only behavior       |
| `020_orders_payments_test.sql`      | Totals, delivery fee/share constants, paid-order immutability, payment/webhook dedupe, status transitions, settlement arithmetic     |
| `025_order_function_rules_test.sql` | Pending order creation, three-spoon acceptance, four-spoon rejection, idempotency reuse, repeated purchase attempts without oversell |
| `030_rls_security_test.sql`         | Anonymous denial, customer/vendor/rider/admin scopes, payout protection, privilege escalation, append-only financial/audit history   |
| `040_seed_release_test.sql`         | Seeded campus, vendors, slots, units, seven-day inventory, sample order states, refund, review, escalation, batch, outbox            |
