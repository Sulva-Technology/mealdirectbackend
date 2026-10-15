# Fleet Partners

A fleet partner is a third-party delivery company onboarded onto one campus. The company's managers bring their own riders, dispatch batches to them, and see what their fleet earned. Meal Direct admins create partners, set their terms, and keep override control over every rider and batch.

## Roles

| Who                                          | How access is decided                                                    | What they can do                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Super admin / campus admin (`riders:manage`) | JWT role + `admin_memberships`; campus admins are pinned to their campus | Create and edit partners, suspend/deactivate, add/remove managers, attach/detach riders, rotate the join code, read earnings |
| Fleet manager (`owner` or `manager`)         | Active row in `fleet_partner_members`; **no JWT role is granted**        | View the fleet and join code, list riders, release a rider, dispatch batches to fleet riders, read earnings and commission   |
| Rider                                        | `rider` JWT role                                                         | Join a fleet on their own campus with the join code, see their fleet, leave it                                               |

Verification stays with Meal Direct: a rider who joins a fleet still has to be verified by an admin before dispatch, and admins can still suspend any rider or reassign any batch from `/v1/admin`.

## Endpoints

Admin (`/v1/admin/fleet-partners`, writes need `riders:manage`):

- `GET /` and `GET /:partnerId` (with managers and riders)
- `POST /`: `{ campusId, name, contactName?, contactPhone?, contactEmail?, commissionBps?, canDispatch?, dispatchPriority? }`
- `PATCH /:partnerId`: same fields plus `status` (`active` | `suspended` | `deactivated`)
- `POST /:partnerId/managers`: `{ email, role? }`. An unknown email gets a Supabase invite that lands on `APP_URL_FLEET/auth/callback`.
- `POST /:partnerId/managers/:userId/remove`
- `POST /:partnerId/riders`: `{ riderId }` (attach without a code); `POST /:partnerId/riders/:riderId/remove`
- `POST /:partnerId/join-code/rotate`
- `GET /:partnerId/earnings?dateFrom=&dateTo=`

Fleet dashboard (`/v1/fleet`, any signed-in account; non-members get 404):

- `POST /v1/auth/fleet/login`: signs in only accounts that manage a non-deactivated fleet. The account's JWT role is left as it is.
- `GET /partners`: the fleets the caller manages
- `GET /partners/:partnerId`
- `POST /partners/:partnerId/join-code/rotate` (active fleets only)
- `GET /partners/:partnerId/riders?status=&available=`
- `POST /partners/:partnerId/riders/:riderId/remove`
- `GET /partners/:partnerId/batches?date=`: rider-delivered batches on the campus for the date that are unassigned or held by this fleet's riders
- `POST /partners/:partnerId/batches/:batchId/assign`: `{ riderId }`
- `GET /partners/:partnerId/earnings?dateFrom=&dateTo=`

Rider (`/v1/rider/fleet`):

- `GET /`: the rider's fleet, or `null`
- `POST /join`: `{ joinCode }` (case, spaces, and dashes ignored)
- `POST /leave`

## Rules

- **Campus-bound.** A partner belongs to one campus. A rider can only be in a fleet on its own campus (DB trigger). A join code from another campus answers exactly like an unknown code.
- **Dispatch is atomic.** `fleet_assign_batch` locks the batch and its assignment. A fleet can assign a batch that is unassigned, cancelled, or still only `assigned` within the same fleet. A batch a rider has accepted or picked up, or one held by a platform rider or another fleet, is refused (409).
- **Suspension.** A `suspended` fleet stays readable but cannot dispatch, rotate its code, or take new riders. Its riders are taken off shift and auto-dispatch skips them. `deactivated` also locks the managers out.
- **Auto-dispatch.** `assign_available_rider_to_batch` skips riders of inactive fleets and prefers higher `dispatchPriority` (0–100; platform riders count as 0) before load. With every priority at 0, behaviour is unchanged.
- **Joining or leaving a fleet takes the rider off shift.** The rider has to switch availability back on.
- **Earnings attribution.** Each delivery assignment snapshots the rider's fleet (`delivery_assignments.fleet_partner_id`), so a rider leaving later does not move past earnings between fleets.

## Commission

`commissionBps` (basis points, 10000 = 100%) is the partner's share of its riders' delivery earnings. It is currently **reporting only**: the earnings endpoint shows `commissionKobo = floor(totalAmountKobo × commissionBps / 10000)`, while rider settlements and payouts still go to each rider as before. Settling the commission with the partner (or paying the partner instead of its riders) happens outside the app until a payout-routing change is made.

## Deploying

The API depends on migration `20261015000100_fleet_partners.sql`. Existing endpoints do not read the new columns, so deploying the API first is safe. Fleet endpoints return errors until the migration is applied. Run the migration with the normal release process (`supabase db push`) before announcing the feature. Set `APP_URL_FLEET` if the fleet dashboard is not served from the admin app, and allow-list `<APP_URL_FLEET>/auth/callback` in Supabase Auth redirect URLs.
