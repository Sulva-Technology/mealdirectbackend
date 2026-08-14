# Slice E — Automated Paystack Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip vendor & rider payouts from manual admin clicks to an automated, retried, reconciled Paystack pay-run behind `PAYOUTS_ENABLED`, with an admin approval gate on both beneficiary types and an admin payout-transfer queue.

**Architecture:** A `run-payouts` cron selects eligible settlements via one auditable SQL function (`select_payable_settlements`) and initiates one Paystack transfer per settlement through the existing `payToSettlement` path, now multi-attempt (`payout_transfers.attempt`, per-attempt reference `<settlementId>-a<attempt>`). A `reconcile-payout-transfers` cron actively verifies stuck `pending` rows via a new `PaystackClient.fetchTransfer`, mirroring the payments reconcile sweep. Vendors gain the `admin_review_status`/`failure_reason` columns riders already have, and new admin endpoints (under a new `payouts:manage` RBAC permission) approve/reject accounts and list transfers.

**Tech Stack:** NestJS + Kysely (`sql` tag) over Postgres/Supabase, Vitest unit tests, pgTAP DB tests, Paystack REST, Render cron.

**Design decision (settlement status gate):** The spec's eligibility list omits settlement `status`. To avoid auto-paying already-settled or cancelled rows, `select_payable_settlements` additionally requires `status not in ('paid','cancelled')`. It does **not** require `status = 'approved'` — the approval gate for automation is the beneficiary-account `admin_review_status = 'approved'`, consistent with the spec's automation intent. The "no pending/success transfer" filter plus this status filter is the double-send guard.

---

## File Structure

**New migrations (apply after slice-D `20260729000200`):**

- `supabase/migrations/20260729000300_vendor_payout_account_review.sql` — vendor account review columns.
- `supabase/migrations/20260729000400_payout_automation.sql` — `payout_transfers.attempt` + unique swap, `select_payable_settlements`, seeded guardrail settings.

**New pgTAP tests:**

- `supabase/tests/database/107_vendor_payout_review_test.sql`
- `supabase/tests/database/108_payout_automation_test.sql`

**Modified TS (application):**

- `src/modules/payments/payments.types.ts` — add `PaystackFetchTransferResult` + `fetchTransfer` to the contract.
- `src/modules/payments/paystack.client.ts` — implement `fetchTransfer`.
- `src/modules/settlements/payout.types.ts` — attempt-aware records + new repo contract methods.
- `src/modules/settlements/payout.repository.ts` — next-attempt insert, `findActiveTransfer`, `selectPayableSettlements`, `getPayoutGuardrails`, `listPendingTransfers`, `applyReconcile`, `listTransfers`, `findTransferById`.
- `src/modules/settlements/payout.service.ts` — `payToSettlement(settlementId, initiatedBy)` attempt-aware; `runPayouts()`; `reconcilePendingPayouts()`.
- `src/cron.ts` — register `run-payouts` + `reconcile-payout-transfers`.
- `src/domain/admin-permissions.ts` — add `payouts:manage`.
- `src/modules/admin/admin.controller.ts` — payout-account review endpoints + payout-transfer list/detail; update the `payToSettlement` call site.
- `src/modules/admin/admin.service.ts` + `admin.repository.ts` — review + transfer-list logic + audit.
- `src/modules/admin/dto/*.ts` — review + list DTOs.
- `render.yaml` — two new cron services.
- `docs/go-live-checklist.md` — `PAYOUTS_ENABLED` flip checklist.

**Test mocks to touch (add `fetchTransfer: vi.fn()`):** `test/unit/payout.service.spec.ts`, `riders.service.spec.ts`, `vendors.service.spec.ts`, `payments.service.spec.ts`, `refunds.service.spec.ts` — every place that builds a full `PaystackClientContract`.

---

## Task 1: Vendor payout-account review columns (migration + pgTAP)

**Files:**

- Create: `supabase/migrations/20260729000300_vendor_payout_account_review.sql`
- Create: `supabase/tests/database/107_vendor_payout_review_test.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729000300_vendor_payout_account_review.sql`:

```sql
begin;

-- Admin review + failure diagnostics for vendor payout accounts, mirroring the columns
-- rider_payout_accounts gained in 20260703000500. Vendors cannot change admin_review_status
-- themselves — the vendor payout-account update path whitelists mutable columns and does not
-- include it. Auto-payouts only select accounts with admin_review_status = 'approved'.
alter table public.vendor_payout_accounts
  add column if not exists admin_review_status text not null default 'pending'
    check (admin_review_status in ('pending', 'approved', 'rejected')),
  add column if not exists failure_reason text;

comment on column public.vendor_payout_accounts.admin_review_status is 'Admin review state for the payout account; vendors cannot change this.';
comment on column public.vendor_payout_accounts.failure_reason is 'Recorded reason when recipient provisioning or a payout attempt fails.';

commit;
```

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/database/107_vendor_payout_review_test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

select has_column('public', 'vendor_payout_accounts', 'admin_review_status',
  'vendor_payout_accounts has admin_review_status');
select has_column('public', 'vendor_payout_accounts', 'failure_reason',
  'vendor_payout_accounts has failure_reason');

-- Default is 'pending'.
select col_default_is('public', 'vendor_payout_accounts', 'admin_review_status', 'pending'::text,
  'admin_review_status defaults to pending');

-- Check constraint rejects an unknown status.
select throws_ok(
  $$ insert into public.vendor_payout_accounts
       (vendor_id, bank_name, masked_account_number, account_name, admin_review_status)
     values
       ((select id from public.vendors limit 1), 'Kuda', '****1234', 'Ada V', 'bogus') $$,
  '23514',
  null,
  'admin_review_status rejects values outside pending/approved/rejected'
);

select * from finish();

rollback;
```

- [ ] **Step 3: Verify vendor update path does not write admin_review_status**

Run: `grep -rn "admin_review_status\|adminReviewStatus" src/modules/vendors/`
Expected: no assignment in the vendor-facing payout-account update/repo path (only the new admin endpoint writes it). If the vendor update path passes a whitelist object, confirm the column is absent. Note findings in the commit message; add a code comment only if the whitelist is not obvious.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729000300_vendor_payout_account_review.sql supabase/tests/database/107_vendor_payout_review_test.sql
git commit -m "feat(payouts): vendor payout-account admin review columns"
```

---

## Task 2: payout_transfers multi-attempt + select_payable_settlements + guardrails (migration + pgTAP)

**Files:**

- Create: `supabase/migrations/20260729000400_payout_automation.sql`
- Create: `supabase/tests/database/108_payout_automation_test.sql`

- [ ] **Step 1: Confirm the exact settlement-unique constraint name**

Run: `grep -n "settlement" supabase/migrations/20260619001700_payout_transfers.sql`
Expected: the constraint is named `payout_transfers_settlement_unique` (from `constraint payout_transfers_settlement_unique unique (settlement_id)`). Use that exact name in the drop below.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260729000400_payout_automation.sql`:

```sql
begin;

-- 1) Multi-attempt payouts. A failed transfer must be retryable with a FRESH Paystack
--    reference (a reused reference is rejected), so payout_transfers becomes one row per
--    attempt. reconcile_payout_transfer still looks rows up by reference (unchanged), and
--    each attempt's reference stays globally unique via payout_transfers_reference_unique.
alter table public.payout_transfers
  add column if not exists attempt integer not null default 1;

alter table public.payout_transfers
  drop constraint payout_transfers_settlement_unique;

alter table public.payout_transfers
  add constraint payout_transfers_settlement_attempt_key unique (settlement_id, attempt);

comment on column public.payout_transfers.attempt is 'Retry attempt number for this settlement; reference is <settlementId>-a<attempt>. Bounded by payout_max_attempts.';

-- 2) Guardrail settings. Read through platform_setting_int(key, default) so a missing or
--    malformed row falls back to the app default and can never silently change payout behaviour.
insert into public.platform_settings (key, value, description)
values
  ('payout_hold_hours', to_jsonb(24), 'Minimum settlement age in hours before an automated payout may run.'),
  ('payout_max_attempts', to_jsonb(3), 'Failed payout attempts per settlement before it is parked for admin review.')
on conflict (key) do nothing;

-- 3) Single auditable eligibility function for the pay-run. Invariants live here, not in the
--    Nest job. Returns settlement ids ready for an automated transfer.
--    SECURITY DEFINER + fixed search_path: the payout tables are RLS-locked; the privileged
--    app role already bypasses RLS, and this keeps behaviour identical if ever called otherwise.
create or replace function public.select_payable_settlements(
  p_hold_hours integer,
  p_max_attempts integer,
  p_limit integer
)
returns table (settlement_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.settlements s
  where s.payable_kobo > 0
    and s.status not in ('paid', 'cancelled')
    and s.created_at <= now() - make_interval(hours => p_hold_hours)
    and exists (
      select 1 from public.vendor_payout_accounts vpa
      where vpa.vendor_id = s.vendor_id
        and vpa.active
        and vpa.paystack_recipient_code is not null
        and vpa.admin_review_status = 'approved'
      union all
      select 1 from public.rider_payout_accounts rpa
      where rpa.rider_id = s.rider_id
        and rpa.active
        and rpa.paystack_recipient_code is not null
        and rpa.admin_review_status = 'approved'
    )
    and not exists (
      select 1 from public.payout_transfers pt
      where pt.settlement_id = s.id
        and pt.status in ('pending', 'success')
    )
    and (
      select count(*) from public.payout_transfers pt
      where pt.settlement_id = s.id
        and pt.status = 'failed'
    ) < p_max_attempts
  order by s.created_at
  limit p_limit;
$$;

comment on function public.select_payable_settlements(integer, integer, integer) is 'Selects settlement ids eligible for an automated Paystack payout: payable, past the hold period, beneficiary account approved with a recipient code, no in-flight/successful transfer, and under the failed-attempt cap.';

commit;
```

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/database/108_payout_automation_test.sql`. It seeds four settlements against the fixtures used by `085` (the vendor settlement `e1111111-1111-1111-1111-111111111111`) plus fresh rows, then asserts selection:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

select has_column('public', 'payout_transfers', 'attempt', 'payout_transfers has attempt');
select col_has_check('public', 'vendor_payout_accounts', 'admin_review_status',
  'admin_review_status is check-constrained');
select has_function('public', 'select_payable_settlements',
  array['integer', 'integer', 'integer'],
  'select_payable_settlements(integer, integer, integer) exists');

-- Approve the vendor payout account behind the seeded settlement and back-date the settlement
-- past the hold window so it is eligible.
update public.vendor_payout_accounts
  set admin_review_status = 'approved',
      paystack_recipient_code = 'RCP_seed_vendor'
  where vendor_id = (select vendor_id from public.settlements
                     where id = 'e1111111-1111-1111-1111-111111111111');

update public.settlements
  set created_at = now() - interval '48 hours', status = 'approved'
  where id = 'e1111111-1111-1111-1111-111111111111';

-- Eligible: appears in selection.
select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'approved + held + payable settlement is selected'
);

-- A pending transfer excludes it (in-flight guard).
insert into public.payout_transfers (settlement_id, reference, amount_kobo, status, attempt)
values ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111-a1', 60000, 'pending', 1);

select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid not in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'settlement with a pending transfer is excluded'
);

-- Exhausted attempts exclude it: flip the pending to failed and add failures up to the cap.
update public.payout_transfers set status = 'failed'
  where settlement_id = 'e1111111-1111-1111-1111-111111111111';
insert into public.payout_transfers (settlement_id, reference, amount_kobo, status, attempt)
values
  ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111-a2', 60000, 'failed', 2),
  ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111-a3', 60000, 'failed', 3);

select ok(
  'e1111111-1111-1111-1111-111111111111'::uuid not in
    (select settlement_id from public.select_payable_settlements(24, 3, 100)),
  'settlement at the failed-attempt cap is excluded'
);

select * from finish();

rollback;
```

> If `col_has_check` / `col_default_is` are unavailable in the pinned pgTAP, fall back to `throws_ok` on a bad insert and a `col_default_is` alternative already used elsewhere in `supabase/tests/database/`. Match the assertions to helpers already used in that directory.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729000400_payout_automation.sql supabase/tests/database/108_payout_automation_test.sql
git commit -m "feat(payouts): multi-attempt transfers, eligibility fn, guardrail settings"
```

---

## Task 3: PaystackClient.fetchTransfer

**Files:**

- Modify: `src/modules/payments/payments.types.ts:185` (add result type) and `:216-227` (contract)
- Modify: `src/modules/payments/paystack.client.ts` (implement)
- Test: `test/unit/paystack-transfers.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/paystack-transfers.spec.ts` inside the `describe('PaystackClient transfers')` block:

```ts
it('verifies a transfer via /transfer/verify/:reference', async () => {
  const fetchMock = mockFetchOnce({ status: 'success', transfer_code: 'TRF_999' });

  const result = await client.fetchTransfer('settlement-1-a1');

  expect(result.status).toBe('success');
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.paystack.test/transfer/verify/settlement-1-a1');
  expect(init.method).toBe('GET');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- paystack-transfers`
Expected: FAIL — `client.fetchTransfer is not a function`.

- [ ] **Step 3: Add the result type and contract method**

In `src/modules/payments/payments.types.ts`, add after `PaystackTransferResult` (line ~189):

```ts
export type PaystackFetchTransferResult = {
  status: string;
  providerPayload: Record<string, unknown>;
};
```

And in `PaystackClientContract` (after the `initiateTransfer` line):

```ts
fetchTransfer: (referenceOrCode: string) => Promise<PaystackFetchTransferResult>;
```

- [ ] **Step 4: Implement in the client**

In `src/modules/payments/paystack.client.ts`, add the import to the `payments.types.js` type list: `PaystackFetchTransferResult`. Then add this method after `initiateTransfer` (line ~237):

```ts
  async fetchTransfer(referenceOrCode: string): Promise<PaystackFetchTransferResult> {
    const envelope = await this.request(
      `/transfer/verify/${encodeURIComponent(referenceOrCode)}`,
      { method: 'GET' }
    );

    if (!isRecord(envelope.data)) {
      throw badGateway('Paystack transfer verification returned an invalid response.');
    }

    const status = stringFrom(envelope.data.status);
    if (status === undefined) {
      throw badGateway('Paystack transfer verification response was missing a status.');
    }

    return { providerPayload: this.providerPayload(envelope), status };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- paystack-transfers`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/payments/payments.types.ts src/modules/payments/paystack.client.ts test/unit/paystack-transfers.spec.ts
git commit -m "feat(payouts): PaystackClient.fetchTransfer for active reconcile"
```

---

## Task 4: Payout types + repository (attempts, selection, reconcile, listing)

**Files:**

- Modify: `src/modules/settlements/payout.types.ts`
- Modify: `src/modules/settlements/payout.repository.ts`

- [ ] **Step 1: Extend the types**

Replace the contents of `src/modules/settlements/payout.types.ts` with:

```ts
export type PayoutContext = {
  settlementId: string;
  payableKobo: number;
  // Transfer recipient provisioned when the beneficiary's bank details were captured;
  // null means payouts cannot run until the account is (re)provisioned.
  recipientCode: string | null;
};

export type PayoutDestination = {
  settlementId: string;
  payableKobo: number;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
};

export type PayoutTransferRecord = {
  id: string;
  settlementId: string;
  reference: string;
  amountKobo: number;
  providerTransferCode: string | null;
  status: string;
  attempt: number;
};

export type RecordTransferInput = {
  settlementId: string;
  attempt: number;
  reference: string;
  amountKobo: number;
  providerTransferCode: string;
  status: string;
  initiatedBy: string | null;
  providerPayload: Record<string, unknown>;
};

export type PayoutGuardrails = {
  holdHours: number;
  maxAttempts: number;
};

// Admin queue view of a transfer, with the derived needs-admin flag.
export type PayoutTransferListItem = {
  id: string;
  settlementId: string;
  reference: string;
  amountKobo: number;
  providerTransferCode: string | null;
  status: string;
  attempt: number;
  needsAdmin: boolean;
  createdAt: string;
};

export type PayoutTransferPage = {
  items: PayoutTransferListItem[];
  hasMore: boolean;
  limit: number;
  nextCursor?: string;
};

export type PayoutRepositoryContract = {
  findActiveTransfer: (settlementId: string) => Promise<PayoutTransferRecord | undefined>;
  findPayoutContext: (settlementId: string) => Promise<PayoutContext | undefined>;
  nextAttempt: (settlementId: string) => Promise<number>;
  recordTransfer: (input: RecordTransferInput) => Promise<PayoutTransferRecord>;
  getPayoutGuardrails: () => Promise<PayoutGuardrails>;
  selectPayableSettlements: (guardrails: PayoutGuardrails, limit: number) => Promise<string[]>;
  listPendingTransfers: (
    graceSeconds: number,
    limit: number
  ) => Promise<Array<{ id: string; reference: string }>>;
  applyReconcile: (
    reference: string,
    status: 'success' | 'failed' | 'reversed',
    payload: Record<string, unknown>
  ) => Promise<void>;
  listTransfers: (input: {
    status?: string;
    maxAttempts: number;
    limit: number;
    cursor?: string;
  }) => Promise<PayoutTransferPage>;
  findTransferById: (id: string) => Promise<PayoutTransferListItem | undefined>;
};
```

- [ ] **Step 2: Rewrite the repository**

Replace `src/modules/settlements/payout.repository.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { decodeCursor, encodeCursor } from '../../common/api/pagination.js';
import { DatabaseService } from '../../database/database.service.js';
import type {
  PayoutContext,
  PayoutGuardrails,
  PayoutRepositoryContract,
  PayoutTransferListItem,
  PayoutTransferPage,
  PayoutTransferRecord,
  RecordTransferInput
} from './payout.types.js';

const transferColumns = sql`
  id::text as "id",
  settlement_id::text as "settlementId",
  reference,
  amount_kobo as "amountKobo",
  provider_transfer_code as "providerTransferCode",
  status,
  attempt
`;

@Injectable()
export class PayoutRepository implements PayoutRepositoryContract {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  // The idempotency guard: a settlement with an in-flight (pending) or completed (success)
  // transfer must never be paid again. Failed/reversed rows do not block a retry.
  async findActiveTransfer(settlementId: string): Promise<PayoutTransferRecord | undefined> {
    const result = await sql<PayoutTransferRecord>`
      select ${transferColumns}
      from public.payout_transfers
      where settlement_id = ${settlementId}::uuid
        and status in ('pending', 'success')
      order by attempt desc
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async findPayoutContext(settlementId: string): Promise<PayoutContext | undefined> {
    const result = await sql<PayoutContext>`
      select
        s.id::text as "settlementId",
        s.payable_kobo as "payableKobo",
        coalesce(
          vpa.paystack_recipient_code,
          rpa.paystack_recipient_code,
          r.paystack_recipient_code
        ) as "recipientCode"
      from public.settlements s
      left join public.vendor_payout_accounts vpa
        on vpa.vendor_id = s.vendor_id and vpa.active
      left join public.rider_payout_accounts rpa
        on rpa.rider_id = s.rider_id and rpa.active
      left join public.riders r on r.id = s.rider_id
      where s.id = ${settlementId}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }

  async nextAttempt(settlementId: string): Promise<number> {
    const result = await sql<{ next: number }>`
      select coalesce(max(attempt), 0) + 1 as "next"
      from public.payout_transfers
      where settlement_id = ${settlementId}::uuid
    `.execute(this.database.db);

    return result.rows[0]?.next ?? 1;
  }

  async recordTransfer(input: RecordTransferInput): Promise<PayoutTransferRecord> {
    const result = await sql<PayoutTransferRecord>`
      insert into public.payout_transfers (
        settlement_id,
        attempt,
        reference,
        amount_kobo,
        provider_transfer_code,
        status,
        initiated_by,
        provider_payload
      )
      values (
        ${input.settlementId}::uuid,
        ${input.attempt},
        ${input.reference},
        ${input.amountKobo},
        ${input.providerTransferCode},
        ${input.status},
        ${input.initiatedBy}::uuid,
        ${JSON.stringify(input.providerPayload)}::jsonb
      )
      on conflict (settlement_id, attempt) do nothing
      returning ${transferColumns}
    `.execute(this.database.db);

    const inserted = result.rows[0];
    if (inserted !== undefined) {
      return inserted;
    }

    // A racing pay-run inserted this (settlement, attempt) first — return the row it wrote.
    const existing = await sql<PayoutTransferRecord>`
      select ${transferColumns}
      from public.payout_transfers
      where settlement_id = ${input.settlementId}::uuid and attempt = ${input.attempt}
      limit 1
    `.execute(this.database.db);

    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error('Payout transfer could not be recorded or retrieved.');
    }
    return row;
  }

  async getPayoutGuardrails(): Promise<PayoutGuardrails> {
    const result = await sql<PayoutGuardrails>`
      select
        public.platform_setting_int('payout_hold_hours', 24) as "holdHours",
        public.platform_setting_int('payout_max_attempts', 3) as "maxAttempts"
    `.execute(this.database.db);

    return result.rows[0] ?? { holdHours: 24, maxAttempts: 3 };
  }

  async selectPayableSettlements(guardrails: PayoutGuardrails, limit: number): Promise<string[]> {
    const result = await sql<{ settlementId: string }>`
      select settlement_id::text as "settlementId"
      from public.select_payable_settlements(
        ${guardrails.holdHours},
        ${guardrails.maxAttempts},
        ${limit}
      )
    `.execute(this.database.db);

    return result.rows.map((row) => row.settlementId);
  }

  async listPendingTransfers(
    graceSeconds: number,
    limit: number
  ): Promise<Array<{ id: string; reference: string }>> {
    const result = await sql<{ id: string; reference: string }>`
      select id::text as "id", reference
      from public.payout_transfers
      where status = 'pending'
        and created_at <= now() - make_interval(secs => ${graceSeconds})
      order by created_at
      limit ${limit}
    `.execute(this.database.db);

    return result.rows;
  }

  async applyReconcile(
    reference: string,
    status: 'success' | 'failed' | 'reversed',
    payload: Record<string, unknown>
  ): Promise<void> {
    await sql`
      select public.reconcile_payout_transfer(
        ${reference},
        ${status},
        ${JSON.stringify(payload)}::jsonb
      )
    `.execute(this.database.db);
  }

  // Admin queue. needs_admin is derived (spec: "max failed attempts reached and no success"),
  // computed here so no extra write is needed. A `status = 'needs_admin'` filter maps onto it.
  async listTransfers(input: {
    status?: string;
    maxAttempts: number;
    limit: number;
    cursor?: string;
  }): Promise<PayoutTransferPage> {
    const cursor = decodeKeysetCursor(input.cursor);
    const wantsNeedsAdmin = input.status === 'needs_admin';
    const statusFilter = wantsNeedsAdmin ? undefined : input.status;

    const rows = await sql<PayoutTransferListItem>`
      with ranked as (
        select
          pt.id::text as "id",
          pt.settlement_id::text as "settlementId",
          pt.reference,
          pt.amount_kobo as "amountKobo",
          pt.provider_transfer_code as "providerTransferCode",
          pt.status,
          pt.attempt,
          pt.created_at,
          (
            not exists (
              select 1 from public.payout_transfers s
              where s.settlement_id = pt.settlement_id and s.status = 'success'
            )
            and (
              select count(*) from public.payout_transfers f
              where f.settlement_id = pt.settlement_id and f.status = 'failed'
            ) >= ${input.maxAttempts}
            and pt.attempt = (
              select max(a.attempt) from public.payout_transfers a
              where a.settlement_id = pt.settlement_id
            )
          ) as "needsAdmin"
        from public.payout_transfers pt
      )
      select
        "id", "settlementId", reference, "amountKobo", "providerTransferCode",
        status, attempt, "needsAdmin",
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') as "createdAt"
      from ranked
      where (${statusFilter}::text is null or status = ${statusFilter})
        and (${wantsNeedsAdmin} is false or "needsAdmin" is true)
        and (
          ${cursor === undefined}
          or (created_at, id) < (${cursor?.ts ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
        )
      order by created_at desc, id desc
      limit ${input.limit + 1}
    `.execute(this.database.db);

    const hasMore = rows.rows.length > input.limit;
    const items = rows.rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      limit: input.limit,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor({ ts: last.createdAt, id: last.id }) }
        : {})
    };
  }

  async findTransferById(id: string): Promise<PayoutTransferListItem | undefined> {
    const result = await sql<PayoutTransferListItem>`
      select
        pt.id::text as "id",
        pt.settlement_id::text as "settlementId",
        pt.reference,
        pt.amount_kobo as "amountKobo",
        pt.provider_transfer_code as "providerTransferCode",
        pt.status,
        pt.attempt,
        (
          not exists (
            select 1 from public.payout_transfers s
            where s.settlement_id = pt.settlement_id and s.status = 'success'
          )
          and (
            select count(*) from public.payout_transfers f
            where f.settlement_id = pt.settlement_id and f.status = 'failed'
          ) >= public.platform_setting_int('payout_max_attempts', 3)
          and pt.attempt = (
            select max(a.attempt) from public.payout_transfers a
            where a.settlement_id = pt.settlement_id
          )
        ) as "needsAdmin",
        to_char(pt.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') as "createdAt"
      from public.payout_transfers pt
      where pt.id = ${id}::uuid
      limit 1
    `.execute(this.database.db);

    return result.rows[0];
  }
}

type KeysetCursor = { ts: string; id: string };

function decodeKeysetCursor(cursor?: string): KeysetCursor | undefined {
  if (cursor === undefined || cursor.length === 0) return undefined;
  try {
    const payload = decodeCursor(cursor);
    if (typeof payload.ts === 'string' && typeof payload.id === 'string') {
      return { ts: payload.ts, id: payload.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the service still references the old `payToSettlement` shape — that is fixed in Task 5; if run standalone this file typechecks, but the service will error until Task 5. Run typecheck at the end of Task 5 instead if red here.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/settlements/payout.types.ts src/modules/settlements/payout.repository.ts
git commit -m "feat(payouts): attempt-aware payout repository + selection/reconcile/listing"
```

---

## Task 5: PayoutService — attempt-aware pay, runPayouts, reconcilePendingPayouts

**Files:**

- Modify: `src/modules/settlements/payout.service.ts`
- Modify: `src/modules/admin/admin.controller.ts` (the `paySettlement` call site only, this task)
- Test: `test/unit/payout.service.spec.ts`

- [ ] **Step 1: Rewrite the failing tests**

Replace `test/unit/payout.service.spec.ts` with the version below. It updates `makePaystack` to include `fetchTransfer`, updates the repository mock to the new contract, changes `payToSettlement` to the `(settlementId, initiatedBy)` signature, and adds `runPayouts` + `reconcilePendingPayouts` cases:

```ts
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvService } from '../../src/config/env.service.js';
import type { PaystackClientContract } from '../../src/modules/payments/payments.types.js';
import { PayoutService } from '../../src/modules/settlements/payout.service.js';
import type {
  PayoutContext,
  PayoutGuardrails,
  PayoutRepositoryContract,
  PayoutTransferRecord
} from '../../src/modules/settlements/payout.types.js';

const initiatedBy = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const settlementId = 'e1111111-1111-4111-8111-111111111111';

function makeEnv(payoutsEnabled: boolean): EnvService {
  return {
    get(key: string): unknown {
      return key === 'PAYOUTS_ENABLED' ? payoutsEnabled : undefined;
    }
  } as unknown as EnvService;
}

function makeContext(overrides: Partial<PayoutContext> = {}): PayoutContext {
  return { settlementId, payableKobo: 60000, recipientCode: 'RCP_existing', ...overrides };
}

const transferRecord: PayoutTransferRecord = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  settlementId,
  reference: `${settlementId}-a1`,
  amountKobo: 60000,
  providerTransferCode: 'TRF_1',
  status: 'pending',
  attempt: 1
};

const guardrails: PayoutGuardrails = { holdHours: 24, maxAttempts: 3 };

function makePaystack(): PaystackClientContract {
  return {
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    createRefund: vi.fn(),
    createTransferRecipient: vi.fn(),
    fetchTransferRecipient: vi.fn().mockResolvedValue({
      accountNumber: '0123456789',
      accountName: 'Jane Vendor',
      bankName: 'Kuda Bank',
      bankCode: '50211'
    }),
    initiateTransfer: vi
      .fn()
      .mockResolvedValue({ transferCode: 'TRF_1', status: 'pending', providerPayload: {} }),
    fetchTransfer: vi.fn(),
    createCustomer: vi.fn(),
    createDedicatedAccount: vi.fn()
  };
}

function makeRepository(context?: PayoutContext): PayoutRepositoryContract {
  return {
    findActiveTransfer: vi.fn().mockResolvedValue(undefined),
    findPayoutContext: vi.fn().mockResolvedValue(context),
    nextAttempt: vi.fn().mockResolvedValue(1),
    recordTransfer: vi.fn().mockResolvedValue(transferRecord),
    getPayoutGuardrails: vi.fn().mockResolvedValue(guardrails),
    selectPayableSettlements: vi.fn().mockResolvedValue([]),
    listPendingTransfers: vi.fn().mockResolvedValue([]),
    applyReconcile: vi.fn().mockResolvedValue(undefined),
    listTransfers: vi.fn(),
    findTransferById: vi.fn()
  };
}

describe('PayoutService', () => {
  let paystack: PaystackClientContract;

  beforeEach(() => {
    paystack = makePaystack();
  });

  it('refuses to pay when payouts are disabled', async () => {
    const service = new PayoutService(makeEnv(false), paystack, makeRepository(makeContext()));
    await expect(service.payToSettlement(settlementId, initiatedBy)).rejects.toThrow();
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('initiates a transfer with a per-attempt reference', async () => {
    const repository = makeRepository(makeContext());
    repository.nextAttempt = vi.fn().mockResolvedValue(2);
    const service = new PayoutService(makeEnv(true), paystack, repository);

    await service.payToSettlement(settlementId, initiatedBy);

    expect(paystack.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientCode: 'RCP_existing',
        amountKobo: 60000,
        reference: `${settlementId}-a2`
      })
    );
    expect(repository.recordTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, reference: `${settlementId}-a2`, initiatedBy })
    );
  });

  it('refuses to pay when the beneficiary has no recipient code', async () => {
    const repository = makeRepository(makeContext({ recipientCode: null }));
    const service = new PayoutService(makeEnv(true), paystack, repository);

    await expect(service.payToSettlement(settlementId, initiatedBy)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('is idempotent when a pending/successful transfer already exists', async () => {
    const repository = makeRepository(makeContext());
    repository.findActiveTransfer = vi.fn().mockResolvedValue(transferRecord);
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.payToSettlement(settlementId, initiatedBy);

    expect(result).toEqual(transferRecord);
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
    expect(repository.recordTransfer).not.toHaveBeenCalled();
  });

  it('runPayouts is a no-op when payouts are disabled', async () => {
    const repository = makeRepository(makeContext());
    const service = new PayoutService(makeEnv(false), paystack, repository);

    const result = await service.runPayouts();

    expect(result).toEqual({ selected: 0, initiated: 0, failed: 0 });
    expect(repository.selectPayableSettlements).not.toHaveBeenCalled();
  });

  it('runPayouts initiates one transfer per selected settlement and counts failures', async () => {
    const repository = makeRepository(makeContext());
    repository.selectPayableSettlements = vi.fn().mockResolvedValue([settlementId, 'other-id']);
    repository.findPayoutContext = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(id === 'other-id' ? makeContext({ recipientCode: null }) : makeContext())
      );
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.runPayouts();

    expect(result.selected).toBe(2);
    expect(result.initiated).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('reconcilePendingPayouts verifies each pending transfer and applies the status', async () => {
    const repository = makeRepository(makeContext());
    repository.listPendingTransfers = vi
      .fn()
      .mockResolvedValue([{ id: 't1', reference: `${settlementId}-a1` }]);
    paystack.fetchTransfer = vi
      .fn()
      .mockResolvedValue({ status: 'success', providerPayload: { ok: true } });
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.reconcilePendingPayouts();

    expect(paystack.fetchTransfer).toHaveBeenCalledWith(`${settlementId}-a1`);
    expect(repository.applyReconcile).toHaveBeenCalledWith(`${settlementId}-a1`, 'success', {
      ok: true
    });
    expect(result).toEqual({ scanned: 1, reconciled: 1 });
  });

  it('reconcilePendingPayouts skips transfers still pending at the provider', async () => {
    const repository = makeRepository(makeContext());
    repository.listPendingTransfers = vi
      .fn()
      .mockResolvedValue([{ id: 't1', reference: `${settlementId}-a1` }]);
    paystack.fetchTransfer = vi.fn().mockResolvedValue({ status: 'pending', providerPayload: {} });
    const service = new PayoutService(makeEnv(true), paystack, repository);

    const result = await service.reconcilePendingPayouts();

    expect(repository.applyReconcile).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- payout.service`
Expected: FAIL — `runPayouts`/`reconcilePendingPayouts` undefined, signature mismatch.

- [ ] **Step 3: Rewrite the service**

Replace `src/modules/settlements/payout.service.ts` with:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes.js';
import { EnvService } from '../../config/env.service.js';
import { PaystackClient } from '../payments/paystack.client.js';
import type { PaystackClientContract } from '../payments/payments.types.js';
import { PayoutRepository } from './payout.repository.js';
import type {
  PayoutDestination,
  PayoutRepositoryContract,
  PayoutTransferRecord
} from './payout.types.js';

// Paystack transfer status → our terminal reconcile status. Anything else (pending, otp,
// ongoing) is left untouched for a later sweep.
function terminalTransferStatus(status: string): 'success' | 'failed' | 'reversed' | undefined {
  if (status === 'success') return 'success';
  if (status === 'reversed') return 'reversed';
  if (status === 'failed' || status === 'abandoned') return 'failed';
  return undefined;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(PaystackClient) private readonly paystack: PaystackClientContract,
    @Inject(PayoutRepository) private readonly repository: PayoutRepositoryContract
  ) {}

  async getPayoutDestination(settlementId: string): Promise<PayoutDestination> {
    const context = await this.repository.findPayoutContext(settlementId);
    if (context === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Settlement was not found.'
      });
    }

    if (context.recipientCode === null) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Beneficiary has no payout bank account on file.'
      });
    }

    const details = await this.paystack.fetchTransferRecipient(context.recipientCode);
    return {
      settlementId,
      payableKobo: context.payableKobo,
      accountNumber: details.accountNumber,
      accountName: details.accountName,
      bankName: details.bankName,
      bankCode: details.bankCode
    };
  }

  /**
   * Initiate (or return the in-flight/completed) Paystack transfer for a settlement.
   * initiatedBy is the admin user id for a manual `POST /:id/pay`, or null for the pay-run.
   * A per-attempt reference (`<settlementId>-a<attempt>`) gives Paystack a fresh reference on
   * every retry; a settlement with a pending/successful transfer is never re-paid.
   */
  async payToSettlement(
    settlementId: string,
    initiatedBy: string | null
  ): Promise<PayoutTransferRecord> {
    if (!this.env.get('PAYOUTS_ENABLED')) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Automated payouts are disabled.'
      });
    }

    const active = await this.repository.findActiveTransfer(settlementId);
    if (active !== undefined) {
      return active;
    }

    const context = await this.repository.findPayoutContext(settlementId);
    if (context === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Settlement payout destination was not found.'
      });
    }

    if (context.recipientCode === null) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_FAILED,
        message:
          'Settlement beneficiary has no Paystack transfer recipient. Provision payout bank details first.'
      });
    }

    const attempt = await this.repository.nextAttempt(settlementId);
    const reference = `${settlementId}-a${String(attempt)}`;

    const transfer = await this.paystack.initiateTransfer({
      amountKobo: context.payableKobo,
      recipientCode: context.recipientCode,
      reference,
      reason: `Settlement ${settlementId}`
    });

    return this.repository.recordTransfer({
      settlementId,
      attempt,
      reference,
      amountKobo: context.payableKobo,
      providerTransferCode: transfer.transferCode,
      status: transfer.status,
      initiatedBy,
      providerPayload: transfer.providerPayload
    });
  }

  /**
   * The scheduled pay-run. Selects eligible settlements via the SQL invariant function and
   * initiates one transfer each. Best-effort per settlement so one bad row never blocks the
   * rest. A no-op (never touching the database) when PAYOUTS_ENABLED is off.
   */
  async runPayouts(limit = 100): Promise<{ selected: number; initiated: number; failed: number }> {
    if (!this.env.get('PAYOUTS_ENABLED')) {
      this.logger.log('runPayouts skipped: PAYOUTS_ENABLED is off');
      return { selected: 0, initiated: 0, failed: 0 };
    }

    const guardrails = await this.repository.getPayoutGuardrails();
    const ids = await this.repository.selectPayableSettlements(guardrails, limit);

    let initiated = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.payToSettlement(id, null);
        initiated += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'unknown payout failure';
        this.logger.warn(`Payout failed for settlement ${id}: ${message}`);
      }
    }

    this.logger.log(
      `Pay-run: selected ${String(ids.length)}, initiated ${String(initiated)}, failed ${String(failed)}`
    );
    return { selected: ids.length, initiated, failed };
  }

  /**
   * Active reconcile fallback for missed/late transfer webhooks. Verifies each still-pending
   * transfer against Paystack and applies a terminal status. Best-effort per row.
   */
  async reconcilePendingPayouts(options?: {
    graceSeconds?: number;
    limit?: number;
  }): Promise<{ scanned: number; reconciled: number }> {
    const graceSeconds = options?.graceSeconds ?? 900;
    const limit = options?.limit ?? 100;

    let pending;
    try {
      pending = await this.repository.listPendingTransfers(graceSeconds, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Could not load pending transfers for reconciliation: ${message}`);
      return { scanned: 0, reconciled: 0 };
    }

    let reconciled = 0;
    for (const transfer of pending) {
      try {
        const fetched = await this.paystack.fetchTransfer(transfer.reference);
        const status = terminalTransferStatus(fetched.status);
        if (status === undefined) continue; // still pending/otp — leave for a later sweep
        await this.repository.applyReconcile(transfer.reference, status, fetched.providerPayload);
        reconciled += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Transfer reconcile failed for ${transfer.reference}: ${message}`);
      }
    }

    this.logger.log(
      `Transfer reconcile sweep: scanned ${String(pending.length)}, reconciled ${String(reconciled)}`
    );
    return { scanned: pending.length, reconciled };
  }
}
```

- [ ] **Step 4: Update the admin controller call site**

In `src/modules/admin/admin.controller.ts`, change the `paySettlement` body (line ~640) from `this.payouts.payToSettlement(actor, params.id)` to:

```ts
return createSuccessEnvelope(await this.payouts.payToSettlement(params.id, actor.userId));
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test -- payout.service && pnpm typecheck`
Expected: PASS. Fix any remaining `PaystackClientContract` mock gaps flagged by typecheck (Task 3 added `fetchTransfer` to the contract — see Task 8/next step note).

- [ ] **Step 6: Fix other contract mocks**

Run: `pnpm test`
For every failing spec that builds a full `PaystackClientContract` (`riders.service.spec.ts`, `vendors.service.spec.ts`, `payments.service.spec.ts`, `refunds.service.spec.ts`), add `fetchTransfer: vi.fn(),` alongside the existing `initiateTransfer`/`fetchTransferRecipient` mock entry. Re-run `pnpm test` until green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/settlements/payout.service.ts src/modules/admin/admin.controller.ts test/unit/*.spec.ts
git commit -m "feat(payouts): runPayouts + active reconcile + per-attempt payToSettlement"
```

---

## Task 6: Register cron jobs

**Files:**

- Modify: `src/cron.ts`

- [ ] **Step 1: Add the jobs to the union and dispatcher**

In `src/cron.ts`, extend `cronJobs` (line 16-22):

```ts
const cronJobs = [
  'release-expired-reservations',
  'close-batches-at-cutoff',
  'generate-inventory-horizon',
  'reconcile-pending-payments',
  'reconcile-wallet-balances',
  'run-payouts',
  'reconcile-payout-transfers'
] as const;
```

Add the import near the other module imports:

```ts
import { PayoutService } from './modules/settlements/payout.service.js';
```

Add the two dispatch branches inside `runCronJob`, after the `reconcile-wallet-balances` block (line ~70):

```ts
if (job === 'run-payouts') {
  const result = await app.get(PayoutService).runPayouts();
  logger.log({ message: 'Ran payouts', job, ...result }, 'Cron');
}
if (job === 'reconcile-payout-transfers') {
  const result = await app.get(PayoutService).reconcilePendingPayouts();
  logger.log({ message: 'Reconciled payout transfers', job, ...result }, 'Cron');
}
```

- [ ] **Step 2: Typecheck + smoke the parser**

Run: `pnpm typecheck && node -e "process.argv[2]='run-payouts'" `
Expected: typecheck PASS. (Runtime boot needs a DB; the DB run happens in `db:ci`/Docker later.)

- [ ] **Step 3: Commit**

```bash
git add src/cron.ts
git commit -m "feat(payouts): register run-payouts and reconcile-payout-transfers crons"
```

---

## Task 7: RBAC permission `payouts:manage`

**Files:**

- Modify: `src/domain/admin-permissions.ts`
- Test: `test/unit/admin-permissions.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/unit/admin-permissions.spec.ts` (mirror the existing assertions style for `wallets:manage`):

```ts
it('grants payouts:manage to finance_admin and super_admin but not operations_admin', () => {
  expect(resolveAdminPermissions(['finance_admin'], 'campus_admin').has('payouts:manage')).toBe(
    true
  );
  expect(resolveAdminPermissions([], 'super_admin').has('payouts:manage')).toBe(true);
  expect(resolveAdminPermissions(['operations_admin'], 'campus_admin').has('payouts:manage')).toBe(
    false
  );
});
```

> Confirm the exact import of `resolveAdminPermissions` at the top of the spec matches the existing file; reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- admin-permissions`
Expected: FAIL — `payouts:manage` not a member of the permission set.

- [ ] **Step 3: Add the permission**

In `src/domain/admin-permissions.ts`, add `'payouts:manage'` to `adminPermissions` (after `'settlements:manage'`):

```ts
  'settlements:manage',
  'payouts:manage',
  'reconciliation:manage',
```

Add `'payouts:manage'` to `campus_admin`'s list and to `finance_admin`'s list (both already hold `settlements:manage`):

```ts
  campus_admin: [
    'read',
    'payments:verify',
    'refunds:manage',
    'wallets:manage',
    'settlements:manage',
    'payouts:manage',
    'reconciliation:manage',
    'vendors:manage',
    'riders:manage',
    'users:manage'
  ],
  finance_admin: [
    'read',
    'payments:verify',
    'refunds:manage',
    'wallets:manage',
    'settlements:manage',
    'payouts:manage',
    'reconciliation:manage'
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- admin-permissions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/admin-permissions.ts test/unit/admin-permissions.spec.ts
git commit -m "feat(payouts): add payouts:manage admin permission"
```

---

## Task 8: Admin payout-account review endpoints (vendor + rider)

**Files:**

- Create: `src/modules/admin/dto/payout-review.dto.ts`
- Modify: `src/modules/admin/admin.repository.ts` (add `reviewVendorPayoutAccount`, `reviewRiderPayoutAccount`)
- Modify: `src/modules/admin/admin.service.ts` (add `reviewPayoutAccount`)
- Modify: `src/modules/admin/admin.controller.ts` (two PATCH routes)
- Test: `test/unit/payout-admin.spec.ts` (new)

- [ ] **Step 1: Write the DTO**

Create `src/modules/admin/dto/payout-review.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class PayoutAccountReviewDto {
  @ApiProperty({ enum: ['approved', 'rejected', 'pending'] })
  @IsIn(['approved', 'rejected', 'pending'])
  status!: 'approved' | 'rejected' | 'pending';

  @ApiPropertyOptional({ description: 'Reason recorded when rejecting or flagging an account.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/payout-admin.spec.ts`. It drives `AdminService.reviewPayoutAccount` with mocked repository + audit and asserts the write + audit call. Match the constructor shape of `AdminService` (read `src/modules/admin/admin.service.ts` for its injected deps and mock each):

```ts
import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../../src/modules/admin/admin.service.js';
import type { AuthenticatedActor } from '../../src/modules/auth/actor-context.js';

const actor: AuthenticatedActor = {
  role: 'super_admin',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

// NOTE: fill the remaining AdminService deps with `{} as any` / vi.fn() stubs to match its
// actual constructor. Only the repository + audit deps are exercised here.
function makeService(overrides: {
  reviewVendorPayoutAccount?: ReturnType<typeof vi.fn>;
  reviewRiderPayoutAccount?: ReturnType<typeof vi.fn>;
  record?: ReturnType<typeof vi.fn>;
}): { service: AdminService; record: ReturnType<typeof vi.fn> } {
  const record = overrides.record ?? vi.fn().mockResolvedValue(undefined);
  const repository = {
    reviewVendorPayoutAccount:
      overrides.reviewVendorPayoutAccount ??
      vi.fn().mockResolvedValue({ id: 'v1', adminReviewStatus: 'approved' }),
    reviewRiderPayoutAccount:
      overrides.reviewRiderPayoutAccount ??
      vi.fn().mockResolvedValue({ id: 'r1', adminReviewStatus: 'rejected' })
  } as unknown as ConstructorParameters<typeof AdminService>[0];
  const audit = { record } as unknown as ConstructorParameters<typeof AdminService>[number];

  // Construct with positional args matching AdminService's constructor; unused deps are stubs.
  const service = new AdminService(repository, ...([].fill(undefined) as never[])) as AdminService;
  // Inject audit onto the instance if AdminService takes it later in the arg list.
  (service as unknown as { audit: typeof audit }).audit = audit;
  return { service, record };
}

describe('AdminService.reviewPayoutAccount', () => {
  it('approves a vendor payout account and audits it', async () => {
    const reviewVendorPayoutAccount = vi
      .fn()
      .mockResolvedValue({ id: 'v1', adminReviewStatus: 'approved' });
    const record = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService({ reviewVendorPayoutAccount, record });

    await service.reviewPayoutAccount(actor, 'vendor', 'vendor-1', {
      status: 'approved'
    });

    expect(reviewVendorPayoutAccount).toHaveBeenCalledWith('vendor-1', 'approved', undefined);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout_account.review',
        entityType: 'vendor_payout_account'
      })
    );
  });
});
```

> **Adapt the constructor wiring** to `AdminService`'s real signature — read it first. If `AdminService` already injects `AuditService`, mock it in place rather than the post-hoc assignment shown. The behavioural asserts (repo write + `payout_account.review` audit) are what matter.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- payout-admin`
Expected: FAIL — `reviewPayoutAccount` is not a function.

- [ ] **Step 4: Add repository writes**

In `src/modules/admin/admin.repository.ts`, add two methods (using the file's existing `sql` import and `this.database.db` pattern):

```ts
  async reviewVendorPayoutAccount(
    vendorId: string,
    status: 'approved' | 'rejected' | 'pending',
    failureReason: string | undefined
  ): Promise<{ id: string; adminReviewStatus: string } | undefined> {
    const result = await sql<{ id: string; adminReviewStatus: string }>`
      update public.vendor_payout_accounts
        set admin_review_status = ${status},
            failure_reason = ${failureReason ?? null}
      where vendor_id = ${vendorId}::uuid and active
      returning id::text as "id", admin_review_status as "adminReviewStatus"
    `.execute(this.database.db);
    return result.rows[0];
  }

  async reviewRiderPayoutAccount(
    riderId: string,
    status: 'approved' | 'rejected' | 'pending',
    failureReason: string | undefined
  ): Promise<{ id: string; adminReviewStatus: string } | undefined> {
    const result = await sql<{ id: string; adminReviewStatus: string }>`
      update public.rider_payout_accounts
        set admin_review_status = ${status},
            failure_reason = ${failureReason ?? null}
      where rider_id = ${riderId}::uuid and active
      returning id::text as "id", admin_review_status as "adminReviewStatus"
    `.execute(this.database.db);
    return result.rows[0];
  }
```

- [ ] **Step 5: Add the service method**

In `src/modules/admin/admin.service.ts`, add (using the file's existing `AuditService`/`actorTypeForRole` imports — add them if absent, mirroring `admin-wallets.service.ts`):

```ts
  async reviewPayoutAccount(
    actor: AuthenticatedActor,
    beneficiary: 'vendor' | 'rider',
    beneficiaryId: string,
    input: { status: 'approved' | 'rejected' | 'pending'; failureReason?: string }
  ): Promise<{ id: string; adminReviewStatus: string }> {
    const updated =
      beneficiary === 'vendor'
        ? await this.repository.reviewVendorPayoutAccount(
            beneficiaryId,
            input.status,
            input.failureReason
          )
        : await this.repository.reviewRiderPayoutAccount(
            beneficiaryId,
            input.status,
            input.failureReason
          );

    if (updated === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: `No active ${beneficiary} payout account was found to review.`
      });
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorType: actorTypeForRole(actor.role),
      action: 'payout_account.review',
      entityType: `${beneficiary}_payout_account`,
      entityId: updated.id,
      after: { adminReviewStatus: updated.adminReviewStatus },
      metadata: {
        beneficiaryId,
        status: input.status,
        ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason })
      }
    });

    return updated;
  }
```

> If `AdminService` does not already inject `AuditService`, add it to the constructor: `@Inject(AuditService) private readonly audit: AuditService`, importing from `../../common/audit/audit.service.js`. Ensure `NotFoundException`, `ErrorCodes`, and `AuthenticatedActor` are imported (they are used elsewhere in the file — verify).

- [ ] **Step 6: Add the controller routes**

In `src/modules/admin/admin.controller.ts`, import the DTO:

```ts
import { PayoutAccountReviewDto } from './dto/payout-review.dto.js';
```

Add two routes (place them near the settlement payout routes, ~line 641). They need a `vendorId`/`riderId` param DTO — reuse an existing uuid-param DTO if the codebase has a generic one; otherwise inline `@Param('vendorId') vendorId: string`:

```ts
  @Patch('payout-accounts/vendor/:vendorId/review')
  @RequirePermission('payouts:manage')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Set the admin review status of a vendor payout account.' })
  async reviewVendorPayoutAccount(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('vendorId') vendorId: string,
    @Body() body: PayoutAccountReviewDto
  ): Promise<SuccessEnvelope<{ id: string; adminReviewStatus: string }>> {
    return createSuccessEnvelope(
      await this.admin.reviewPayoutAccount(actor, 'vendor', vendorId, body)
    );
  }

  @Patch('payout-accounts/rider/:riderId/review')
  @RequirePermission('payouts:manage')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Set the admin review status of a rider payout account.' })
  async reviewRiderPayoutAccount(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('riderId') riderId: string,
    @Body() body: PayoutAccountReviewDto
  ): Promise<SuccessEnvelope<{ id: string; adminReviewStatus: string }>> {
    return createSuccessEnvelope(
      await this.admin.reviewPayoutAccount(actor, 'rider', riderId, body)
    );
  }
```

Add `Patch` to the `@nestjs/common` import list at the top of the controller if not already present.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm test -- payout-admin && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/admin/dto/payout-review.dto.ts src/modules/admin/admin.repository.ts src/modules/admin/admin.service.ts src/modules/admin/admin.controller.ts test/unit/payout-admin.spec.ts
git commit -m "feat(payouts): admin approve/reject payout accounts with audit"
```

---

## Task 9: Admin payout-transfer list + detail endpoints

**Files:**

- Create: `src/modules/admin/dto/payout-transfer-query.dto.ts`
- Modify: `src/modules/admin/admin.service.ts` (add `listPayoutTransfers`, `getPayoutTransfer`)
- Modify: `src/modules/admin/admin.controller.ts` (two GET routes)
- Modify: `src/modules/settlements/settlements.module.ts` / admin module wiring so `PayoutRepository` is injectable where used
- Test: extend `test/unit/payout-admin.spec.ts`

- [ ] **Step 1: Decide wiring — inject PayoutService/Repository into AdminService**

The transfer list/detail lives on `PayoutRepository`. Expose it through `PayoutService` to avoid a second injection surface. Add to `src/modules/settlements/payout.service.ts`:

```ts
  listTransfers(input: {
    status?: string;
    limit: number;
    cursor?: string;
  }): Promise<import('./payout.types.js').PayoutTransferPage> {
    return this.repository
      .getPayoutGuardrails()
      .then((g) =>
        this.repository.listTransfers({
          maxAttempts: g.maxAttempts,
          limit: input.limit,
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor })
        })
      );
  }

  getTransfer(id: string): Promise<import('./payout.types.js').PayoutTransferListItem | undefined> {
    return this.repository.findTransferById(id);
  }
```

`PayoutService` is already exported by `SettlementsModule` and `AdminModule` imports it (it injects `PayoutService` in the controller already — verify `AdminModule` imports `SettlementsModule`; if the controller uses `PayoutService`, it does). The admin controller can call `this.payouts.listTransfers(...)` directly — no `AdminService` change needed for these two reads.

- [ ] **Step 2: Write the query DTO**

Create `src/modules/admin/dto/payout-transfer-query.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PayoutTransferQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'success', 'failed', 'reversed', 'needs_admin']
  })
  @IsOptional()
  @IsIn(['pending', 'success', 'failed', 'reversed', 'needs_admin'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

- [ ] **Step 3: Write the failing test**

Extend `test/unit/payout-admin.spec.ts` with a `PayoutService` list test (reuse the `makeRepository` shape from `payout.service.spec.ts`):

```ts
import { PayoutService } from '../../src/modules/settlements/payout.service.js';

describe('PayoutService admin listing', () => {
  it('passes the configured maxAttempts into listTransfers', async () => {
    const listTransfers = vi.fn().mockResolvedValue({ items: [], hasMore: false, limit: 20 });
    const repository = {
      getPayoutGuardrails: vi.fn().mockResolvedValue({ holdHours: 24, maxAttempts: 5 }),
      listTransfers,
      findTransferById: vi.fn()
    } as never;
    const env = { get: () => true } as never;
    const paystack = {} as never;
    const service = new PayoutService(env, paystack, repository);

    await service.listTransfers({ status: 'failed', limit: 20 });

    expect(listTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', limit: 20, maxAttempts: 5 })
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- payout-admin`
Expected: FAIL — `service.listTransfers` undefined (until Step 1 code is added).

- [ ] **Step 5: Add controller routes**

In `src/modules/admin/admin.controller.ts`, import the DTO and the list item / page types:

```ts
import { PayoutTransferQueryDto } from './dto/payout-transfer-query.dto.js';
import type { PayoutTransferListItem } from '../settlements/payout.types.js';
```

Add the routes near the payout-account review routes:

```ts
  @Get('payout-transfers')
  @RequirePermission('payouts:manage')
  @ApiOkResponse({ description: 'Keyset-paginated payout transfers; filter by status or needs_admin.' })
  async listPayoutTransfers(
    @Query() query: PayoutTransferQueryDto
  ): Promise<ListEnvelope<PayoutTransferListItem>> {
    const page = await this.payouts.listTransfers({
      limit: query.limit ?? 20,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor })
    });
    return listEnvelope(page.items, {
      hasMore: page.hasMore,
      limit: page.limit,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  @Get('payout-transfers/:id')
  @RequirePermission('payouts:manage')
  @ApiOkResponse({ description: 'A single payout transfer with its derived needs_admin flag.' })
  async getPayoutTransfer(
    @Param() params: UuidIdParamDto
  ): Promise<SuccessEnvelope<PayoutTransferListItem>> {
    const transfer = await this.payouts.getTransfer(params.id);
    if (transfer === undefined) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Payout transfer was not found.'
      });
    }
    return createSuccessEnvelope(transfer);
  }
```

> Verify `listEnvelope`, `ListEnvelope`, `UuidIdParamDto`, `NotFoundException`, and `ErrorCodes` are already imported in `admin.controller.ts` (they are used by sibling routes). Add any missing import.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm test -- payout-admin && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/dto/payout-transfer-query.dto.ts src/modules/settlements/payout.service.ts src/modules/admin/admin.controller.ts test/unit/payout-admin.spec.ts
git commit -m "feat(payouts): admin payout-transfer queue list + detail"
```

---

## Task 10: Render crons, flip checklist, OpenAPI, full green

**Files:**

- Modify: `render.yaml`
- Modify: `docs/go-live-checklist.md`
- Regenerate: `docs/openapi.yaml` / `docs/openapi.json`

- [ ] **Step 1: Add the two cron services**

In `render.yaml`, append two cron services after `meal-direct-reconcile-wallet-balances`, copying the env-var block from `meal-direct-reconcile-payments` verbatim (it already includes `PAYSTACK_SECRET_KEY`, `PAYOUTS_ENABLED` must be added):

```yaml
- type: cron
  name: meal-direct-run-payouts
  runtime: docker
  schedule: '30 3 * * *' # daily, after settlement generation
  dockerfilePath: ./Dockerfile
  dockerCommand: node dist/cron.js run-payouts
  envVars:
    - key: NODE_ENV
      value: production
    - key: DATABASE_URL
      sync: false
    - key: DATABASE_SSL
      value: true
    - key: DATABASE_SSL_REJECT_UNAUTHORIZED
      value: true
    - key: DATABASE_SSL_CA
      sync: false
    - key: SUPABASE_URL
      sync: false
    - key: SUPABASE_JWT_ISSUER
      sync: false
    - key: SUPABASE_JWT_SECRET
      sync: false
    - key: SUPABASE_SERVICE_ROLE_KEY
      sync: false
    - key: RESEND_API_KEY
      sync: false
    - key: INTERNAL_OPERATIONS_TOKEN
      sync: false
    - key: PAYSTACK_SECRET_KEY
      sync: false
    - key: PAYOUTS_ENABLED
      value: true

- type: cron
  name: meal-direct-reconcile-payout-transfers
  runtime: docker
  schedule: '*/15 * * * *' # every 15 min, like payments
  dockerfilePath: ./Dockerfile
  dockerCommand: node dist/cron.js reconcile-payout-transfers
  envVars:
    - key: NODE_ENV
      value: production
    - key: DATABASE_URL
      sync: false
    - key: DATABASE_SSL
      value: true
    - key: DATABASE_SSL_REJECT_UNAUTHORIZED
      value: true
    - key: DATABASE_SSL_CA
      sync: false
    - key: SUPABASE_URL
      sync: false
    - key: SUPABASE_JWT_ISSUER
      sync: false
    - key: SUPABASE_JWT_SECRET
      sync: false
    - key: SUPABASE_SERVICE_ROLE_KEY
      sync: false
    - key: RESEND_API_KEY
      sync: false
    - key: INTERNAL_OPERATIONS_TOKEN
      sync: false
    - key: PAYSTACK_SECRET_KEY
      sync: false
    - key: PAYOUTS_ENABLED
      value: true
```

- [ ] **Step 2: Document the flip checklist**

Append to `docs/go-live-checklist.md` a `## PAYOUTS_ENABLED flip checklist` section with the six items from the spec §"Flip criteria" (accounts provisioned + admin-approved; Paystack transfer balance funded + transfers enabled + OTP policy decided; both crons registered with sane schedules; guardrail settings seeded; one end-to-end test transfer verified + reconciled; admin payout-transfer queue reviewed as the escape hatch).

- [ ] **Step 3: Regenerate OpenAPI**

Run: `pnpm openapi:generate` (or the repo's documented command; check `package.json` scripts) then `pnpm openapi:check`
Expected: the new `PATCH /admin/payout-accounts/*` and `GET /admin/payout-transfers*` routes appear; check passes.

- [ ] **Step 4: Full local gate**

Run: `pnpm test && pnpm typecheck && pnpm openapi:check`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add render.yaml docs/go-live-checklist.md docs/openapi.yaml docs/openapi.json
git commit -m "chore(payouts): render crons, flip checklist, openapi"
```

---

## Task 11: Database CI + types regen (Docker host)

**Files:**

- Regenerate: `src/database/database.types.ts`

- [ ] **Step 1: Run the DB suite on Docker**

Once Docker is up on this machine (per memory [[wallet-slice-a-built]] / [[fee-model-slice-bc]] — SQL for slices A–D is still unverified):

Run: `pnpm db:ci`
Expected: all migrations apply in order (including `20260729000300`, `20260729000400`) and pgTAP tests `107`, `108` pass alongside the pre-existing suite. Investigate any red gate — including the pre-existing ones flagged for slices A–D — before merge.

- [ ] **Step 2: Regenerate database types**

Run: `pnpm db:types` (or the documented type-gen command)
Expected: `src/database/database.types.ts` gains the `attempt` column and vendor review columns.

- [ ] **Step 3: Final green + commit**

Run: `pnpm test && pnpm typecheck && pnpm openapi:check`
Expected: all PASS.

```bash
git add src/database/database.types.ts
git commit -m "chore(payouts): regen database types after payout automation migrations"
```

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose merge/PR/cleanup for `feat/v2-wallet-dedicated-account`.

---

## Self-Review

**Spec coverage:**

- Gap 1 (no automated trigger) → Task 5 `runPayouts` + Task 6 cron + Task 10 Render.
- Gap 2 (no active reconcile) → Task 3 `fetchTransfer` + Task 5 `reconcilePendingPayouts` + Task 6/10 cron.
- Gap 3 (no retry) → Task 2 `attempt` + unique swap; Task 4 next-attempt/per-attempt insert; Task 5 per-attempt reference.
- Gap 4 (asymmetric approval + no admin visibility) → Task 1 vendor review columns; Task 7 permission; Task 8 review endpoints; Task 9 transfer queue.
- Gap 5 (no flip criteria) → Task 10 checklist.
- Eligibility invariants → Task 2 `select_payable_settlements` (payable, hold, approved+recipient+active, no pending/success, under cap) + status-not-paid/cancelled guard (documented decision).
- Guardrail settings `payout_hold_hours`/`payout_max_attempts` via `platform_setting_int` → Task 2 seed + Task 4 `getPayoutGuardrails`.
- Testing (pgTAP + Vitest) → Tasks 1,2 (pgTAP), 3,5,7,8,9 (Vitest); Task 10/11 gates.
- Out-of-scope items (amount cap, kill-switch, bulk pay-all, fee changes) → intentionally not planned.

**Placeholder scan:** No `TODO`/`later`/"similar to Task N". Steps that construct `AdminService`/audit mocks (Task 8/9) carry explicit "adapt to the real constructor" notes because that signature must be read at execution time — the behavioural assertions are concrete.

**Type consistency:** `PayoutTransferRecord` gains `attempt` (Task 4) and every producer/consumer uses it. `payToSettlement(settlementId, initiatedBy)` signature is changed once (Task 5) and its only caller updated same task. `PayoutRepositoryContract` method names (`findActiveTransfer`, `nextAttempt`, `getPayoutGuardrails`, `selectPayableSettlements`, `listPendingTransfers`, `applyReconcile`, `listTransfers`, `findTransferById`) match between `payout.types.ts`, `payout.repository.ts`, and the service/mocks. `fetchTransfer` is added to `PaystackClientContract` (Task 3) and every full mock (Task 5 Step 6).
