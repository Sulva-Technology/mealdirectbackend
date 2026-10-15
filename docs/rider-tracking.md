# Live Rider Tracking and ETAs

Riders on shift share their position from the rider app. Admins and fleet managers see riders on a map. Customers see an ETA, and once their order is on the way, a dot for their rider. Riders get their stops in visiting order with an ETA per stop.

## How ETAs are computed

`ETA = straight-line distance × 1.35 (campus detour) ÷ RIDER_AVERAGE_SPEED_KMH`, plus 2 minutes of hand-off time at every stop before yours. No routing API or API key is needed. Accuracy is good for short campus trips; it does not know about one-way roads, gates, or traffic. Tune `RIDER_AVERAGE_SPEED_KMH` (default 15) from real delivery times. Responses carry `method: "straight_line_estimate"` so a paid routing provider (Google, Mapbox) can replace it later without changing clients.

**ETAs need map pins.** A campus location (drop-off) or vendor (pickup) without a pin shows on the route with `etaAt: null`, and every stop after it also has no ETA. Pin every active location and vendor before switching tracking on.

## Privacy rules

- Only the **latest** position is stored (`rider_locations`), never a history or trail.
- A rider can share only while **verified, active, and on shift, or holding an open delivery**. Anyone else gets `409`, which tells the app to stop sending.
- The stored position is **deleted** automatically when a rider goes off shift with nothing to deliver, finishes their last delivery while off shift, or is suspended/deactivated (DB triggers). `DELETE /v1/rider/location` deletes it on demand.
- Customers see the rider's **first name and position only**, only while their order is `on_the_way`, and only for their own order. No phone number is exposed.
- Fleet managers see only their own fleet's riders. Campus admins see only their campus.

## Endpoints

Rider (`rider` role):

- `PUT /v1/rider/location`: `{ latitude, longitude, accuracyMeters?, headingDegrees?, speedMps?, recordedAt? }`. Send every 10–20 s while on shift or delivering. `accepted: false` means the fix was older than one already stored, or more than 15 minutes old; that's fine, keep sending. A `recordedAt` more than 2 minutes in the future is rejected (bad device clock).
- `DELETE /v1/rider/location`: stop sharing now.
- `GET /v1/rider/assignments/:assignmentId/route`: the pickup (until picked up), then drop-offs grouped by location in nearest-first order, each with `legDistanceMeters`, `etaAt`, `etaMinutes`, and the order numbers to hand over there.

Customer (`customer` role):

- `GET /v1/orders/:orderId/tracking`: `phase` (`awaiting_payment` | `preparing` | `awaiting_pickup` | `on_the_way` | `delivered` | `closed`), destination pin, `etaAt`/`etaMinutes`, `distanceMeters`, `stopsBeforeYou`, and `rider` (only while `on_the_way`). Poll every 15–30 s while the tracking screen is open.

Admin (`campus_admin`/`super_admin`; campus admins pinned to their campus):

- `GET /v1/admin/map/riders?campusId=`: riders sharing a position, with `stale: true` when the last fix is over 5 minutes old.
- `GET /v1/admin/map/campuses/:campusId/points`: every location and vendor with its pin (`null` if unset); use it to find what still needs pinning.
- `PUT|DELETE /v1/admin/map/locations/:locationId/coordinates`: `{ latitude, longitude }`.
- `PUT|DELETE /v1/admin/map/vendors/:vendorId/coordinates`: needs `vendors:manage`.

Fleet manager:

- `GET /v1/fleet/partners/:partnerId/map/riders`: the fleet's riders who are sharing.

## Deploying

1. Push migration `20261015000200_rider_tracking.sql` (`supabase db push`). Existing endpoints don't read the new columns, so the API can deploy first; the tracking endpoints need the migration.
2. Pin locations and vendors through the admin map endpoints. A pin can be taken from Google Maps: long-press the spot and copy the coordinates.
3. Ship the rider app change (send location while on shift), then the customer tracking screen and the admin and fleet maps.
