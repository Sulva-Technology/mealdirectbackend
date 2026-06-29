# Meal Direct API Postman Guide

This guide describes how to import, configure, and use the generated Postman collection to test the Meal Direct backend API.

## File Location

The Postman collection is generated and located in the workspace at:

- **Collection JSON:** [postman_collection.json](file:///c:/sulvatech/mealdirectbackend/docs/postman_collection.json)

---

## 1. Importing the Collection

1. Open **Postman**.
2. Click the **Import** button in the top left or top center of the Postman window.
3. Choose **Files** and select the [postman_collection.json](file:///c:/sulvatech/mealdirectbackend/docs/postman_collection.json) file from this repository.
4. Click **Import** to load the collection.

---

## 2. Configuration & Environment Variables

The collection is generated with dynamic variables. We recommend creating a Postman Environment containing the following variables:

| Variable Name     | Description                                                            | Default / Example Value                              |
| :---------------- | :--------------------------------------------------------------------- | :--------------------------------------------------- |
| `baseUrl`         | The base URL of the running API.                                       | `http://localhost:4000/v1`                           |
| `supabaseAuth`    | The Supabase JWT token for authenticated endpoints.                    | _(JWT token retrieved from authentication)_          |
| `operationsToken` | The internal operations token used for admin/infrastructure endpoints. | _(Defined in `.env` as `INTERNAL_OPERATIONS_TOKEN`)_ |
| `idempotencyKey`  | UUID used for tracking request idempotency.                            | `{{$guid}}` (Postman dynamic UUID)                   |

---

## 3. Authentication & Header Specifications

The API uses three types of authentication or custom headers depending on the surface:

### A. Supabase JWT Authentication (`Bearer Token`)

Used for customer, vendor, rider, and campus admin endpoints:

- **Header Name:** `Authorization`
- **Format:** `Bearer <supabaseAuth>`
- **Configuration:** Pre-configured on folder/request levels to pull from the `{{supabaseAuth}}` collection variable.

### B. Internal Operations Token (`Bearer Token`)

Used for infrastructure/operations status monitoring:

- **Header Name:** `Authorization`
- **Format:** `Bearer <operationsToken>`
- **Configuration:** Pulls from `{{operationsToken}}`.

### C. Idempotency Key Header

Required for state-mutating requests (e.g. creating orders, initiating payments):

- **Header Name:** `Idempotency-Key`
- **Configuration:** Automatically supplied as `{{idempotencyKey}}` (resolves to a unique UUID for each request).

---

## 4. Collection Structure

The collection is organized by resource groups mapping directly to NestJS modules:

- **`me`**: Access-controlled profile management, default locations, onboarding.
- **`vendors` / `vendor-orders` / `vendor-reviews`**: Vendor portal actions including catalog management, delivery schedules, order fulfillment (accept, prepare, ready), and settlement logs.
- **`orders`**: Customer order quotes, checkout/creation (idempotent), payment status checks, and customer confirmation.
- **`payments` / `payments/webhooks`**: Paystack payment initialization, reconciliation, refunds, and paystack webhook simulation.
- **`riders`**: Rider assignment feeds, status updates, earnings queries, issue reporting, and rider settlement logs.
- **`campuses`**: Public directory listings for campuses, campus locations, and zones.
- **`settlements`**: Administrative tools for generating daily settlements for vendors and riders.
- **`admin`**: Administrative controls for user roles, campus management, and platform configuration.
- **`operations`**: Platform health monitoring, metrics dumps, and DB pool stats.
- **`health`**: Public status and liveness checks (`/health/live`, `/health/ready`).
