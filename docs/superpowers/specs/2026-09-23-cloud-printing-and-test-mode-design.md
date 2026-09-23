# Cloud printing of order tickets + feature-flag test mode

Date: 2026-09-23
Status: BUILT (backend) — vendor/admin portal UI pending

## 1. Goal

Every paid order prints a kitchen ticket at the vendor automatically, with no phone in the
loop. Vendors use iPhones, which have no Web Bluetooth and suspend background apps, so the
design uses **Wi-Fi/4G cloud printers that poll our API** (Star Micronics CloudPRNT
protocol). Also add a **test mode** so new features (starting with printing) can be exercised
on production by a hand-picked set of test vendors/users without touching real vendors.

## 2. Decisions (made with the founder, 2026-09-23)

| Question             | Decision                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport            | Cloud printer (CloudPRNT HTTP polling). Bluetooth rejected: iPhones.                                                                                                                                                                                                                      |
| When a ticket prints | At the **slot cutoff** (`delivery_time − cutoff_minutes`, campus timezone). Orders paid after cutoff print immediately.                                                                                                                                                                   |
| Ticket content       | Vendor name, order number, delivery date + time + slot, customer name + full phone, location + room, delivery mode, items with unit price × qty, soup + customization lines, special instructions, **food total (food subtotal only — no delivery/service fee/surcharge)**, paid-at time. |
| Rider on ticket      | No — usually unassigned at print time.                                                                                                                                                                                                                                                    |
| Currency             | `NGN` text — `₦` is not in printer code pages.                                                                                                                                                                                                                                            |
| Test mode            | Per-feature flag `off` / `test` / `on`. `test` = only the tester cohort (listed users/vendors) sees the feature.                                                                                                                                                                          |

Open question left to founder: food total is printed **before** any discount (vendor is paid on
the undiscounted food amount). Flip in `receipt.renderer.ts` if that changes.

## 3. CloudPRNT protocol (what the printer does)

The printer is configured (in its own web UI) with one Server URL:
`https://<api>/v1/printers/cloudprnt/<printerKey>`. It then loops, every ~5 s:

1. `POST <url>` JSON `{ printerMAC, statusCode, status, printingInProgress, ... }`
   → we reply `{ jobReady, mediaTypes: ["text/plain"], jobToken }`.
2. If `jobReady`: `GET <url>?mac=…&type=text/plain&token=<jobToken>` → we reply the ticket
   as `text/plain`.
3. After printing: `DELETE <url>?mac=…&code=200%20OK&token=<jobToken>` → we mark it printed.
   A non-2xx `code` (paper out, cover open) puts the job back in the queue.

`printerKey` is a 32-byte random secret shown to the vendor once; only its SHA-256 is stored.
The printer's MAC must also match the registered MAC. Unknown key/MAC → 404.

## 4. Data model (migration `20260923000100_cloud_printing_and_feature_flags.sql`)

- `feature_flags(key pk, mode off|test|on, description, updated_by, updated_at)` — seeded
  `cloud_printing = test`.
- `feature_testers(id, subject_type user|vendor, subject_id, note, created_by, created_at)`,
  unique `(subject_type, subject_id)`.
- `vendor_printers(id, vendor_id, name, mac_address, key_hash, paper_width_chars 32|42|48,
last_seen_at, last_status_code, revoked_at, …)`; one live printer per MAC.
- `print_jobs(id, vendor_id, order_id unique nullable, kind order|test, status
pending|printing|printed|failed|cancelled, print_after, attempts, leased_at,
leased_printer_id, printed_at, printed_by_printer_id, last_error, …)`.
- Trigger `orders_enqueue_print_job` (AFTER INSERT / UPDATE OF paid_at on `orders`): when
  `paid_at` goes null → not-null **and the vendor has a live printer**, insert a job with
  `print_after = greatest(now(), slot local time − cutoff)`. `on conflict (order_id) do nothing`.
  A DB trigger (not app code) because there are ≥6 paths to paid (verify, webhook, reconcile
  cron, wallet RPC, admin force-paid, expired-order recovery).
- All four tables: RLS enabled, no anon/authenticated grants (API role only).

### Job claiming rules (`claim` on printer GET)

A job is due when: vendor matches the printer, `status = pending` (or `printing` with lease older
than 2 min), `print_after <= now()`, `print_after > now() − 12 h` (stale backlog never
auto-prints — use Reprint), and for `kind = order` the order is not
`cancelled|expired|refunded`. Oldest `print_after` first, then location name, room number (so
a slot's stack comes out in rider route order). Claimed with `for update skip locked`, so two
printers at one vendor never print the same ticket.

Ack failure → `attempts + 1`, back to `pending`; at 5 attempts → `failed`.

## 5. API

Printer (no JWT; key in path):

- `POST /v1/printers/cloudprnt/:printerKey` — poll
- `GET /v1/printers/cloudprnt/:printerKey` — fetch job (text/plain)
- `DELETE /v1/printers/cloudprnt/:printerKey` — ack

Vendor (JWT, role vendor; register/test-print gated by `cloud_printing` flag):

- `GET /v1/vendor/printers` — list, with `online` (seen < 2 min)
- `POST /v1/vendor/printers` `{ name, macAddress, paperWidthChars? }` → printer + one-time
  `serverUrl` to paste into the printer
- `DELETE /v1/vendor/printers/:printerId` — revoke
- `POST /v1/vendor/printers/:printerId/rotate-key` → new one-time `serverUrl`
- `POST /v1/vendor/printers/:printerId/test-print` — queue a sample ticket (no order data)
- `GET /v1/vendor/print-jobs?status=` — recent jobs (for "not printed" banner)
- `GET /v1/vendor/orders/:orderId/receipt` — structured receipt + rendered text (preview)
- `POST /v1/vendor/orders/:orderId/reprint` — re-queue now

Admin (`admin:manage`):

- `GET /v1/admin/feature-flags`, `PATCH /v1/admin/feature-flags/:key { mode }`
- `GET /v1/admin/feature-testers`, `POST /v1/admin/feature-testers { subjectType, subjectId, note? }`,
  `DELETE /v1/admin/feature-testers/:testerId`
  All audited.

Any signed-in user:

- `GET /v1/me/feature-flags` → `{ cloud_printing: true, … }` for the caller, so portals can
  hide unfinished UI.

## 6. Test mode — what it does and does not isolate

**Does:** a feature in `test` mode is invisible and inert for everyone except testers. For
printing: non-tester vendors cannot register printers, and a printer whose vendor is not a
tester receives `jobReady: false`. Roll-out = flip `test → on`; kill switch = `→ off`.

**Does not:** separate data. Test orders are real rows in the production database. For
full isolation of destructive experiments (migrations, payouts, data backfills) use a
**staging environment** — see `docs/deployment/staging-environment.md`. `NODE_ENV=staging`
is already supported by `src/config/env.ts`.

Recommended pattern: create a test vendor + test customer on production, add both as testers,
exercise the feature end-to-end with Paystack test cards (prod still runs `sk_test_`), then
flip to `on`.

## 7. Failure modes

| Failure                                | Behaviour                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Printer offline / power cut            | Jobs stay `pending`; printed in order when it polls again (within 12 h).                                |
| Paper out / cover open                 | Printer DELETEs with non-2xx code → retried, `failed` after 5.                                          |
| Printer crashes mid-job                | Lease expires after 2 min → re-claimed. Possible duplicate ticket (acceptable; better than a lost one). |
| Order cancelled/refunded before cutoff | Never printed.                                                                                          |
| Flag turned off                        | Printers get `jobReady:false`; queue waits. Jobs older than 12 h never auto-print.                      |
| Key leaked                             | Vendor rotates key; old URL immediately 404s.                                                           |

## 8. Hardware note

Target: Star Micronics CloudPRNT-capable printers (e.g. mC-Print3, TSP143IV). Confirm local
availability/price before buying. Other CloudPRNT-compatible clients work unchanged. The
ticket is sent as `text/plain` (every CloudPRNT printer supports it); bold/large text via
StarPRNT or Star Document Markup is a later enhancement.

## 9. Out of scope / follow-ups

- Vendor portal UI (printer setup screen, "N tickets not printed" banner, reprint button).
- Admin portal UI for flags/testers.
- FCM alert when a job is still pending 5 min after `print_after`.
- Rich formatting (StarPRNT), QR code.
