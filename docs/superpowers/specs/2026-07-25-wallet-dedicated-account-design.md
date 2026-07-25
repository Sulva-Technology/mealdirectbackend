# Wallet with Paystack Dedicated Account — Design

**Date:** 2026-07-25
**Slice:** v2 slice A (see [v2 roadmap](2026-07-25-v2-roadmap.md))
**Status:** Approved design, ready for implementation planning.

## Goal

Give every customer a wallet with a dedicated Nigerian bank account number. Customers fund the
wallet by transfer and pay for orders from the balance. Paying per order through Paystack checkout
remains available. Wallet payment becomes the default experience.

## Scope

**In scope:** customer wallets, dedicated virtual account provisioning, top-up by bank transfer,
paying an order from balance, refunds to balance, admin wallet oversight, balance reconciliation.

**Out of scope:** vendor and rider wallets (they continue receiving Paystack transfers per
`payout.service.ts`), withdrawals to bank, split payment across wallet and card, eating-habit
analytics, the fee-model and order-status changes (slices B–F).

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Who holds a wallet | Customers only | Vendors and riders are already paid by Paystack transfer; wallets for them would turn settlements into a second ledger system |
| DVA provisioning | Automatically at signup, plus a backfill for existing customers at cutover | The account number is always present in the UI with no extra step |
| Withdrawals | Not supported | Balance is spendable on orders only. Keeps MealDirect out of the "financial services" business category, which is what would force per-customer BVN validation on DVAs |
| Refund destination | Always to wallet | Instant, no Paystack refund fee or 3–10 day wait. The existing card-refund path stays, admin-only, for disputes |
| Insufficient balance | Blocked; customer chooses to top up or to pay for that order directly through Paystack checkout | Every order is paid from exactly one source, so there is one leg to reconcile and one leg to refund |
| Direct-pay option | Existing hosted Paystack checkout, all channels | Card, bank transfer (which presents a temporary account number) and USSD already work; no new integration |
| Debit timing | Atomic — order creation and wallet debit are one database transaction | No `pending_payment`, no reservation timer, no expiry sweep, no webhook for wallet orders |
| Balance storage | Cached `balance_kobo` with an append-only ledger as source of truth, reconciled nightly | Fast reads, full auditability, drift is detectable |

## Paystack constraints

Established from Paystack documentation while scoping:

- Dedicated virtual accounts are available only to **Nigeria-registered businesses**.
- Fee is **1% capped at ₦300** per inbound transfer. This is cheaper than card for the same money:
  a ₦10,000 top-up costs ₦100 and covers roughly five orders, against roughly ₦150 in card fees
  for the same five orders. Batching payments into top-ups lowers payment cost.
- **Per-customer BVN validation is required only** for businesses in the betting, financial
  services and general services categories. Food delivery is not one of them, so no customer KYC
  step is expected. **Launch blocker: confirm the registered business category on the Paystack
  dashboard before go-live.**
- Providers are **Wema** and **Paystack-Titan**. Test mode uses `test-bank`.
- **DVA is not yet enabled on the MealDirect Paystack account.** It must be requested from
  Paystack support. This is the long pole for this slice.
- Inbound money arrives as a `charge.success` webhook whose `authorization.channel` is
  `dedicated_nuban`, carrying `receiver_bank_account_number` and `sender_name`.

## Limits are advisory, not enforceable

An inbound bank transfer cannot be rejected — the money arrives before the system sees it.
Therefore:

- **Minimum top-up ₦500** is UI guidance only. The backend credits any amount received.
- **Maximum balance ₦50,000** does not block a credit. A transfer that pushes a wallet past the
  cap is credited in full and raises an admin flag.

Refusing to record received money would mean holding funds with no ledger entry, which is worse
than exceeding a soft cap. Both values live in `platform_settings` and are admin-editable.

## Data model

```
wallets
  id uuid pk
  user_id uuid unique not null references profiles(id) on delete restrict
  balance_kobo integer not null default 0 check (balance_kobo >= 0)
  currency text not null default 'NGN'
  status wallet_status not null default 'active'      -- active | frozen
  created_at, updated_at

wallet_ledger_entries                                  -- append-only
  id uuid pk
  wallet_id uuid not null references wallets(id)
  entry_type wallet_entry_type not null                -- topup | order_payment | order_refund
                                                       -- | adjustment | reversal
  amount_kobo integer not null check (amount_kobo <> 0)  -- signed: credits positive, debits negative
  balance_after_kobo integer not null check (balance_after_kobo >= 0)
  order_id uuid references orders(id)
  provider_reference text
  actor_user_id uuid references profiles(id)           -- set for admin adjustments
  reason text
  metadata jsonb not null default '{}'
  created_at timestamptz not null default now()

  trigger: forbid UPDATE and DELETE (same pattern as the existing audit tables)
  unique index on (provider_reference) where entry_type = 'topup'   -- webhook replay guard

wallet_dedicated_accounts
  id uuid pk
  wallet_id uuid unique not null references wallets(id)
  paystack_customer_code text not null
  account_number text unique not null
  account_name text not null
  bank_name text not null
  bank_slug text not null
  status dva_status not null default 'pending'         -- pending | active | failed | deactivated
  provider_payload jsonb not null default '{}'
  created_at, updated_at

platform_settings                                      -- new, generic; slice B reuses it
  key text pk
  value jsonb not null
  updated_by uuid references profiles(id)
  updated_at timestamptz not null default now()
```

Changes to existing objects:

- `payment_provider` enum gains `'wallet'` (it currently contains only `'paystack'`).
- `orders` gains `payment_method` — an enum of `('wallet','paystack')`.
- `payment_reconciliation_issue_type` gains `'wallet_balance_drift'`.

A wallet-paid order still writes a `payments` row with `provider = 'wallet'` and
`status = 'successful'`. Admin payment lists, settlements and audit therefore keep working over a
single uniform money path rather than gaining a second invisible one.

Seeded settings: `wallet_min_topup_kobo = 50000`, `wallet_max_balance_kobo = 5000000`.

## Flows

### Provisioning

Signup creates a `wallets` row with a zero balance and emits an outbox event
`wallet.dva_requested`. The outbox worker calls Paystack create-customer, then
`POST /dedicated_account`, and stores the result.

The whole DVA path is gated by `WALLET_DVA_ENABLED`. While Paystack approval is pending the flag
is off: wallets exist with no account number, and top-up falls back to a Paystack checkout link
whose successful payment credits the wallet. A backfill script provisions accounts for all
existing customers at cutover.

`POST /wallet/dedicated-account` re-runs provisioning idempotently for a wallet whose signup-time
attempt failed.

### Top-up by transfer

Customer transfers to their account number. Paystack sends `charge.success` with
`authorization.channel = 'dedicated_nuban'`. The handler resolves the wallet from
`receiver_bank_account_number` and writes a `topup` ledger entry, idempotent on the Paystack
reference.

This branch must be evaluated **before** the existing order-reference lookup in
`paystack-webhook.service.ts`. A top-up has no order, so falling through to the order path would
file a spurious reconciliation issue for every top-up.

Crossing `wallet_max_balance_kobo` credits normally and raises an admin flag.

### Checkout paid from wallet

A new RPC, `create_paid_order_from_wallet`, performs in one transaction:

1. Reserve inventory under row locks (the existing logic from
   `create_pending_order_and_reserve_inventory`, including cutoff, spoon-limit, promotion and
   surcharge rules).
2. `SELECT ... FOR UPDATE` on the wallet row.
3. Reject if the wallet is frozen, or if `balance_kobo < total_kobo`.
4. Debit: insert the `order_payment` ledger entry, update `balance_kobo`.
5. Insert the order **directly at status `paid`** with `payment_method = 'wallet'`.
6. Insert the `payments` row (`provider = 'wallet'`, `status = 'successful'`), the
   `order_status_history` row, and the `order.paid` outbox event.

Insufficient balance returns `402` with code `WALLET_INSUFFICIENT_BALANCE` and the shortfall
amount, and the inventory reservation is rolled back with the transaction.

### Checkout paid directly

Unchanged. `POST /orders` with `paymentMethod: 'paystack'` follows the existing
pending-payment → hosted checkout → webhook → paid flow.

### Refund

A refund writes an `order_refund` credit entry linked to the order and raises the balance
immediately. The Paystack card-refund path in `refunds.service.ts` remains available to admins for
disputes and chargeback handling.

## API surface

Customer:

```
GET  /wallet                        { balanceKobo, status, dedicatedAccount | null }
GET  /wallet/ledger?cursor=&limit=  keyset-paginated entries, { data, pagination } envelope
POST /wallet/dedicated-account      idempotent provision or retry
POST /orders                        + paymentMethod: 'wallet' | 'paystack'
```

Admin — every route carries `@RequirePermission` and writes an audit row through the existing
`AuditService`:

```
GET   /admin/wallets?cursor=              payments:manage   wallets over the balance cap sort first
GET   /admin/wallets/:id/ledger?cursor=   payments:manage
POST  /admin/wallets/:id/adjust           payments:manage   signed amount, mandatory reason
POST  /admin/wallets/:id/freeze           payments:manage
GET   /admin/settings                     admin:manage
PATCH /admin/settings                     admin:manage      wallet limits today, fee splits in slice B
```

Pagination follows the keyset cursor convention already used across the admin lists
(`decodeListCursor` / `toList` in `admin.repository.ts`).

`POST /admin/wallets/:id/adjust` is the sensitive route: it is an administrator creating or
destroying balance. It is the only way to write a ledger entry with no provider reference, it
requires a reason, and it is audited.

## Reconciliation

Extend the existing reconciliation cron with two checks:

1. **Balance drift** — for each wallet, assert `balance_kobo = SUM(wallet_ledger_entries.amount_kobo)`.
   A mismatch files a `payment_reconciliation_issues` row of type `wallet_balance_drift` at
   `critical` severity.
2. **Unrecorded inbound transfer** — a Paystack `charge.success` on a `dedicated_nuban` account
   with no corresponding `topup` entry files `provider_success_not_local`.

## Testing

- **Concurrent debit.** Two orders placed against one wallet holding enough for only one. Exactly
  one succeeds; the other returns `WALLET_INSUFFICIENT_BALANCE` and leaks no inventory
  reservation. This test is what proves the `FOR UPDATE` lock is correct.
- **Webhook replay.** The same Paystack reference delivered three times credits the wallet once.
- **Ledger invariant.** Property test over a random sequence of credits and debits asserting
  `balance_kobo = SUM(entries)` and `balance_after_kobo` monotonically consistent throughout.
- **Insufficient balance.** Returns `402`, order is not created, inventory reservation released.
- **Refund to wallet.** Credits exactly the order total and links the entry to the order.
- **Append-only enforcement.** `UPDATE` and `DELETE` against `wallet_ledger_entries` are rejected.
- **Frozen wallet.** Cannot pay for an order; can still receive credits.

## Risks

| Risk | Handling |
|---|---|
| Paystack has not enabled DVA on the account | Everything ships behind `WALLET_DVA_ENABLED`. The wallet still funds through a checkout link until approval lands. Request approval now — it gates the slice |
| The registered business category turns out to require customer validation | The spec assumes no BVN step. If the category is general or financial services, a BVN plus bank-account validation step must be added before provisioning. Verify before go-live |
| Wallet balances are customer money held on the platform | No withdrawals keeps MealDirect clear of deposit-taking. The balance cap limits per-wallet exposure |
| Card-funded top-up refunded to wallet, then charged back | The customer keeps spendable balance while the card money is clawed back. Admins can force a real card refund instead for any disputed order |
| Administrator abuses manual adjustment | RBAC permission, mandatory reason, audit row, and adjustments are visible in the wallet ledger the customer can see |

## Open items before implementation

1. Request dedicated virtual accounts from Paystack support.
2. Confirm the registered business category does not require customer validation.
3. Choose the DVA provider (Wema or Paystack-Titan) for live traffic.
