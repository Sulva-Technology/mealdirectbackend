# On-demand withdrawals (vendors and riders)

Vendors and riders withdraw their own earnings from the app. The money goes out at once by
Paystack Transfer from the Meal Direct Paystack balance to their admin-approved payout account.

## Paystack setup (one-time, required)

1. **Settle to your Paystack balance, not your bank.** Customer payments must stay inside
   Paystack so transfers can pay vendors and riders. Paystack calls this _Manual payouts_
   (dashboard settlements); request it from support@paystack.com. Registered (not Starter)
   businesses only.
2. **Turn off the transfer OTP** (Dashboard → Settings → Preferences, transfer confirmation). With OTP on,
   every API transfer waits for a code nobody types, and withdrawals stay "pending".
3. **Keep a float.** Card and transfer payments still reach the balance on Paystack's own
   settlement schedule (usually next business day). Withdrawals can only spend the
   _available_ balance, so top it up from the company bank account to cover same-day payouts.
   If the balance is short, Paystack rejects the transfer, the earnings return to the
   vendor's/rider's balance and the app shows "try again shortly".
4. Transfer webhooks (`transfer.success|failed|reversed`) must reach
   `POST /v1/payments/webhooks/paystack`; `PAYOUTS_ENABLED=true` on the API.

## Rules

| Setting (`platform_settings`)  | Default        | Meaning                                                      |
| ------------------------------ | -------------- | ------------------------------------------------------------ |
| `on_demand_payouts_start_date` | migration date | Orders served from this date are withdrawable. Remove = off. |
| `withdrawal_hold_minutes`      | `120`          | Wait after delivery before earnings can be withdrawn.        |
| `withdrawal_min_kobo`          | `100000`       | Minimum withdrawal (₦1,000). Meal Direct absorbs the fee.    |

- A withdrawal takes the whole available balance: food, delivery share and takeaway fee per
  delivered order, minus refunds. A refund on an order already withdrawn comes off the next one.
- Daily settlements are blocked from the cutover date. Settle any earlier days the old way
  (generate → approve; the 03:30 pay-run pays them).
- A failed or reversed transfer cancels the withdrawal and returns the earnings to the balance.

## API

| Method | Path                             | Role   |
| ------ | -------------------------------- | ------ |
| GET    | `/v1/vendor/withdrawals/balance` | vendor |
| POST   | `/v1/vendor/withdrawals`         | vendor |
| GET    | `/v1/rider/withdrawals/balance`  | rider  |
| POST   | `/v1/rider/withdrawals`          | rider  |

Balance: `availableKobo`, `pendingKobo` (in hold), `processingKobo` (sent, not yet confirmed),
`minimumKobo`, `holdMinutes`, `payoutAccountReady`, `enabled`, `canWithdraw`. Show the Withdraw
button when `canWithdraw` is true.

Withdraw (no body) returns `{ settlementId, amountKobo, status, reference }` where `status` is
`pending` (sent), `success` (paid) or `processing` (being confirmed; completes on its own).
Errors: `400` nothing to withdraw / below minimum / no approved bank account, `403` withdrawals
off, `503 PAYOUT_UNAVAILABLE` Paystack refused (balance unchanged, retry later).

Withdrawals appear in the existing settlement history (`/v1/vendor/settlements`,
`/v1/rider/settlements`) with `kind: "on_demand"`; status `approved` = on the way, `paid` =
in the bank, `cancelled` = failed and returned to balance.
