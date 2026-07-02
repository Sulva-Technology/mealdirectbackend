# Plan: Image uploads via Supabase Storage

Date: 2026-07-02
Status: Proposed

## Decisions (locked)

- **Upload:** signed upload URLs — client uploads binary **directly** to Supabase
  Storage; API server never streams the file.
- **Privacy:** private buckets. Reads served via short-lived **signed read URLs**
  minted by the backend.
- **Persistence:** store the object **key/path** (e.g. `menu-item-images/{vendorId}/{itemId}/{uuid}.webp`)
  in the existing `text` columns (`vendors.logo_url`, `menu_items.image_url`,
  `profiles.avatar_url`). NOT a public URL. Reuse existing columns.

## Context (current state)

- Image columns already exist as plain `text`: `vendors.logo_url`,
  `menu_items.image_url`, `profiles.avatar_url`. Surfaced as `logoUrl` /
  `imageUrl` / `avatarUrl` in vendor, catalog, profile DTOs. Update endpoints
  already accept these strings; no upload mechanism exists today.
- Supabase SDK already wired: `@supabase/supabase-js` in
  `src/modules/auth/supabase-auth.service.ts` builds a service-role admin client.
  Env has `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  (`src/config/env.ts:56-62`).
- No Storage bucket, policy, or upload code exists yet.

## Big implication of "private + signed read"

Because buckets are private, **every read path that returns an image must convert
the stored key into a signed read URL** before responding. This touches:

- `src/modules/catalog/catalog.repository.ts` (vendor logos + menu item images) —
  customer-facing, highest volume.
- `src/modules/vendors/vendors.repository.ts` (logo, menu item images).
- `src/modules/profiles/profiles.repository.ts` (avatar).

Do the signing in the **service layer** after the repo fetch, batch-signing with
`storage.from(bucket).createSignedUrls(paths, ttl)` to avoid N calls.

Tradeoffs to accept/decide:
- Signed URLs expire (pick TTL, e.g. 1h). Client must tolerate expiry / re-fetch.
- Rotating URLs weaken client/CDN caching. Mitigation: longer TTL, or a stable
  `/media/{key}` redirect endpoint that 302s to a fresh signed URL.

## Work breakdown

### 1. Buckets + Storage RLS (SQL migration, applied by hand via psql)

- Buckets (private): `vendor-logos`, `menu-item-images`, `avatars`.
- Storage RLS policies: authenticated writes scoped to owner path prefix
  (`{vendorId}/…`, `auth.uid()` for avatars); reads via service-role signing only.

### 2. StorageModule + StorageService

- Mirror `SupabaseAuthService` service-role admin client pattern.
- Methods:
  - `createSignedUploadUrl(bucket, path)` → `{ signedUrl, token, path }`
  - `createSignedReadUrl(bucket, path, ttl)` / `createSignedReadUrls(bucket, paths, ttl)`
  - `removeObject(bucket, path)`
- Guard: throw a clear error if `SUPABASE_SERVICE_ROLE_KEY` unset (matches auth
  service behavior).

### 3. Upload issuance endpoints

- Issue signed upload URL, e.g.:
  - `POST /vendor/menu-items/{itemId}/image/upload-url`
  - `POST /vendor/profile/logo/upload-url`
  - `PATCH /me` avatar → `POST /me/avatar/upload-url`
- Request body: `contentType`, `sizeBytes` (for validation before signing).
- Response: `{ uploadUrl, token, key }`. Backend computes the owner-scoped `key`.

### 4. Validation

- Content-type allowlist: `image/jpeg`, `image/png`, `image/webp`.
- Size caps (e.g. 2MB logos/avatars, 5MB menu images).
- Owner-scoped path enforced server-side (never trust client path).

### 5. Persist + cleanup

- After client confirms upload, persist the `key` via existing update logic
  (a confirm endpoint, or reuse the existing PATCH with the returned key).
- On replace: `removeObject` the previous key (orphan cleanup).
- Nullable behavior preserved (clearing an image nulls the column).

### 6. Read-side signing

- Service layer converts stored keys → signed read URLs (batched) in catalog,
  vendors, profiles responses. DTOs unchanged (still emit `*Url`).

### 7. Tests

- StorageService unit (mock supabase storage client).
- Upload-url issuance: content-type/size rejection, owner path scoping.
- Read-side signing: key → signed URL mapping, batch behavior.
- Authorization: vendor cannot issue upload URL for another vendor's item.

### 8. Optional

- Supabase image transformation (resize/webp) for thumbnails on signed reads.

## Env / config

- `SUPABASE_SERVICE_ROLE_KEY` already defined (optional secret) — required for
  signing. Add signed-URL TTL config knob (e.g. `MEDIA_SIGNED_URL_TTL_SECONDS`).

## Open items

- Confirm TTL + whether to add the stable `/media/{key}` redirect for caching.
- Confirm confirm-upload flow: dedicated confirm endpoint vs reuse existing PATCH.
