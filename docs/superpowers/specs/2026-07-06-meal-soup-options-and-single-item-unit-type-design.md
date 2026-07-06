# Meal soup options + single-item (pepper-soup) unit type — design

Date: 2026-07-06
Status: approved (brainstorm) → pending implementation

## Problem

Two related gaps in the catalogue/order model:

1. **Soup pick.** Swallows (eba, semo, pounded yam, etc.) are eaten with a soup, but the
   catalogue is flat — a menu item is one thing at one price, and the only per-item
   freedom is the freeform `order_items.customization` jsonb blob (validated `@IsObject`,
   shape unknown to the system). So a swallow cannot offer a real, validated soup picker;
   the customer can at best type free text the system does not understand.

2. **Single-portion + takeaway items.** Items like pepper soup are sold as a single
   portion in their own takeaway pack. Today the takeaway/service fee and the "max 3 spoon
   units per takeaway" cap are the *same* switch — `unit_types.counts_toward_spoon_limit`.
   Pepper soup needs the takeaway fee but is not a swallow (must not consume the 3-spoon
   cap) and must be capped at quantity 1. The two behaviours have to be split.

## Decisions (from brainstorm)

- **Soup model:** labelled choices only — no per-soup price, no per-soup inventory.
- **Soup list scope:** one shared list per vendor (`vendor_soup_options`); a menu item is
  flagged `requires_soup` and reuses that shared list. Proteins are NOT part of this —
  proteins are their own menu items.
- **Which items may require soup:** any menu item the vendor flags (not restricted to
  swallow unit types).
- **Pick rule:** exactly one soup, required. Order rejected if the item requires soup and
  the pick is missing, not in the vendor's list, or inactive.
- **Pepper-soup unit type:** max quantity 1 per line, triggers the takeaway/service fee,
  does NOT count toward the 3-spoon cap. This requires `unit_types` to split
  "triggers takeaway fee" from "counts toward spoon limit" and to gain a per-line
  max-quantity rule.
- **Soup availability:** simple `active` on/off per soup (no price, no daily stock).

## Data model

New table:

```
vendor_soup_options (
  id            uuid pk default gen_random_uuid(),
  vendor_id     uuid not null references vendors(id),
  name          text not null,
  active        boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (vendor_id, lower(name))   -- no duplicate soup names per vendor
)
```

`unit_types` — add two columns, backfill from the existing flag:

- `triggers_takeaway_fee boolean not null default false` — drives the takeaway/service fee.
  Backfill `= counts_toward_spoon_limit` so existing swallows keep charging the fee.
- `max_quantity integer null check (max_quantity is null or max_quantity >= 1)` — per-line
  quantity cap; NULL = unlimited (current behaviour).

`counts_toward_spoon_limit` keeps its ONLY remaining meaning: consumes the max-3 cap.

`menu_items` — add `requires_soup boolean not null default false`.

`order_items` — add `soup_option_id uuid null references vendor_soup_options(id)`.
NULL for items that don't require soup.

Seed the pepper-soup unit type (or leave to admin): `code = 'single_takeaway'`,
`triggers_takeaway_fee = true`, `counts_toward_spoon_limit = false`, `max_quantity = 1`.

## Order creation (`create_pending_order_and_reserve_inventory`)

New migration recreating the function from the current 17-arg version
(`20260705000100_large_order_surcharge.sql`). Changes, all inside the existing loops:

- Extract `soup_option_id` from the item jsonb in both `jsonb_to_recordset` loops.
- First loop, per item, additionally select `ut.triggers_takeaway_fee`, `ut.max_quantity`,
  `mi.requires_soup` alongside the existing catalog fields.
- **Max quantity:** if `max_quantity is not null and quantity > max_quantity` → raise
  `23514` ("item exceeds its maximum quantity per order").
- **Soup validation:** if `requires_soup` then require `soup_option_id` present AND
  `exists (select 1 from vendor_soup_options where id = soup_option_id and vendor_id =
  p_vendor_id and active)`; else raise `23514`. If NOT `requires_soup`, ignore/blank any
  soup_option_id sent.
- **Spoon cap** stays keyed on `counts_toward_spoon_limit` (unchanged).
- Persist `soup_option_id` into `order_items` in the insert loop.

Note: the takeaway/service *fee amount* is passed in as `p_service_fee_kobo`; it is decided
in TypeScript (see below), so the RPC needs no fee-trigger change — only the cap, max-qty,
and soup logic.

## TypeScript wiring

- **Quote** (`orders.repository.ts` `quoteOrder`): add
  `ut.triggers_takeaway_fee as "triggersTakeawayFee"` to the select; add to `OrderQuoteItem`.
- **Service fee trigger** (`orders.service.ts` `buildQuote`): change
  `quotedItems.some(i => i.countsTowardSpoonLimit)` →
  `quotedItems.some(i => i.triggersTakeawayFee)`. This makes pepper soup charge the fee
  while a non-swallow, non-takeaway item still doesn't.
- **Create-order DTO** (`create-order.dto.ts` `CreateOrderItemDto`): add optional
  `soupOptionId?: string` (`@IsOptional() @IsDatabaseUuid()`).
- **Repository createOrder**: include `soup_option_id: item.soupOptionId ?? null` in the
  items jsonb sent to the RPC.
- **Order-item read** (`orders.repository.ts` `listOrderItems` + `OrderItem` type): add
  `soupOptionId` and `soupName` (left join `vendor_soup_options`) so the kitchen/rider
  ticket shows e.g. "Eba — Egusi". Mirror on vendor and rider order reads.
- **Catalog read**: add `requiresSoup` to `MenuItem` (catalog.types + both queries in
  `catalog.repository.ts`). Expose the vendor's active soup list — add `soupOptions:
  {id,name}[]` to `CatalogVendor` (populated in `findVendorById`/`listVendors` or a small
  extra query in `getVendor`) so the client can render the picker.

## Vendor / admin surface

- **Unit types** (`admin-unit-types` — global catalogue, admin-gated): `CreateUnitTypeDto`
  / `UpdateUnitTypeDto` + `UnitTypeRecord` gain `triggersTakeawayFee` and `maxQuantity`.
  Repository create/update and the `unit_types` select include the new columns.
- **Soup options** (vendor-scoped, new): CRUD under the vendors module — list / create /
  rename / toggle `active` on `vendor_soup_options`, gated on vendor membership like other
  vendor menu writes. Follows the existing `MenuCategory` controller/service/repo pattern.
- **Menu item** (`UpsertMenuItemInput` + vendor menu-item upsert): accept `requiresSoup`.

## Error handling

- Soup missing / not in vendor list / inactive → `400 VALIDATION_FAILED`
  (`ErrorCodes.VALIDATION_FAILED`), consistent with other order-creation rejects. PG
  `23514` from the RPC maps to 400 via the existing PG-error→HTTP mapping.
- Quantity over the unit type's `max_quantity` → `400 VALIDATION_FAILED`.
- Duplicate soup name per vendor (unique index violation) → `400`.

## Testing

TS unit (`test/unit`):
- `orders.service` — takeaway fee now triggers off `triggersTakeawayFee`, not spoon flag:
  a takeaway-fee item that isn't a spoon item still charges the fee; a plain item doesn't.
- `catalog.service` — menu items expose `requiresSoup`; vendor exposes `soupOptions`.
- `vendors.service` — soup-option CRUD; unit-type create/update carries the new flags.

pgTAP (`supabase/tests/database`):
- Order rejected when a `requires_soup` item has no / invalid / inactive / wrong-vendor
  soup pick; accepted and `order_items.soup_option_id` persisted when valid.
- Order rejected when quantity exceeds a unit type's `max_quantity`; accepted at the cap.
- Non-soup items unaffected; spoon cap still keyed on `counts_toward_spoon_limit`.

## Rollout

Migrations are applied by hand via psql against the hosted DB (see hosted-db-deploy-model).
New migration files are additive; the function recreate drops the current 17-arg overload
and creates a new 17-arg version with the same signature (arg list unchanged — soup_option_id
rides inside `p_items` jsonb), so `orders.repository.ts` needs no new positional argument.

## Out of scope (YAGNI)

- Per-soup pricing or inventory.
- Per-meal soup overrides (shared vendor list only).
- Multiple soups per item; optional/no-soup.
- Daily soup availability windows (simple active flag only).
- Generalised choice groups for other modifiers (proteins are menu items).
