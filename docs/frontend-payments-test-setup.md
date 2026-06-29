# Frontend — Paystack Test Payments Integration

How to wire up order payments against Paystack **test** keys.

## 0. Prerequisites

- Backend has `PAYSTACK_SECRET_KEY=sk_test_...` set and is restarted (backend team handles this).
- You have the matching **public** test key: `pk_test_...` (from Paystack dashboard → Settings → API Keys & Webhooks, Test mode). Put it in your frontend env, e.g. `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`.
- All endpoints below require the Supabase bearer token: `Authorization: Bearer <supabase_jwt>`.
- API base path is prefixed with `/v1`.

## 1. Payment flow overview

```
create order (status: pending_payment)
   ↓
POST .../payments/paystack/initialize   → get authorizationUrl + accessCode + reference
   ↓
customer pays on Paystack (redirect OR inline popup)
   ↓
Paystack → backend webhook → payment marked successful (server-side, automatic)
   ↓
frontend polls GET .../payment-status until status === "successful"
```

The frontend does **not** verify the transaction itself. The webhook is the source of truth. You only initialize, send the user to Paystack, then poll status.

## 2. Initialize payment

```
POST /v1/orders/{orderId}/payments/paystack/initialize
Authorization: Bearer <supabase_jwt>
```

- Order must be owned by the customer and in status `pending_payment`.
- No request body.

Response (`200`):

```json
{
  "data": {
    "accessCode": "abc123...",
    "authorizationUrl": "https://checkout.paystack.com/abc123...",
    "paymentId": "uuid",
    "reference": "uuid"
  }
}
```

## 3. Send the customer to pay — pick ONE

### Option A — Redirect (simplest)

```ts
window.location.href = data.authorizationUrl;
```

Paystack hosts the checkout. After payment Paystack returns the user to the callback URL configured in the Paystack dashboard. Set that callback to a frontend route that then polls payment-status (step 4).

### Option B — Inline popup (no full redirect)

Load Paystack inline script (`https://js.paystack.co/v2/inline.js`), then resume the transaction with the `accessCode`:

```ts
const popup = new PaystackPop();
popup.resumeTransaction(data.accessCode);
```

`pk_test_...` public key is required by the inline script. On popup success callback, start polling step 4.

> Do NOT trust the popup/redirect success signal as final. Always confirm via payment-status.

## 4. Confirm payment (poll)

```
GET /v1/orders/{orderId}/payment-status
Authorization: Bearer <supabase_jwt>
```

Response:

```json
{
  "data": {
    "orderId": "uuid",
    "orderStatus": "pending_payment",
    "payment": {
      "id": "uuid",
      "provider": "paystack",
      "providerReference": "uuid",
      "status": "pending",
      "expectedAmountKobo": 250000,
      "paidAmountKobo": null,
      "currency": "NGN",
      "initializedAt": "...",
      "verifiedAt": null,
      "paidAt": null
    }
  }
}
```

Poll every ~3s (cap ~60s). Success when `payment.status === "successful"` (and `orderStatus` moves off `pending_payment`). Stop polling on success; show failure/retry if it never flips.

All amounts are in **kobo** (₦2,500.00 = `250000`). Divide by 100 for display.

## 5. Test cards (Paystack test mode)

| Field  | Value                         |
| ------ | ----------------------------- |
| Card   | `4084 0840 8408 4081`         |
| CVV    | `408`                         |
| Expiry | any future date, e.g. `12/30` |
| PIN    | `0000`                        |
| OTP    | `123456`                      |

More test cards / failure scenarios: https://paystack.com/docs/payments/test-payments

## 6. Error responses

Errors use shape `{ "error": { "code": "...", "message": "..." } }`.

- `404 NOT_FOUND` — order/payment not found or not owned by caller.
- `400 VALIDATION_FAILED` — order not in `pending_payment`, amount mismatch, or missing customer email.
- `401 UNAUTHORIZED` — missing/expired Supabase token.
- `403 FORBIDDEN` — non-customer role calling initialize.

## Quick checklist

- [ ] `pk_test_...` in frontend env
- [ ] Initialize → store `reference` / `paymentId`
- [ ] Redirect or inline popup with `authorizationUrl` / `accessCode`
- [ ] Poll `payment-status` until `successful`
- [ ] Display kobo / 100
- [ ] Test with card `4084 0840 8408 4081`
