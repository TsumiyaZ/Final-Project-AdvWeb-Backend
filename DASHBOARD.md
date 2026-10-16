# Dashboard API

`GET /api/dashboard?date=YYYY-MM-DD`

The date is optional and defaults to the current date in `Asia/Bangkok`.
Invalid calendar dates return HTTP 400. This endpoint only reads the existing
database and does not require schema changes.

- `total_orders` includes cancelled orders for the selected order date.
- `total_boxes` excludes cancelled orders.
- `pending_orders`, `delivered_orders`, and `cancelled_orders` reflect saved order statuses.
- `rider_count` counts distinct riders in the latest plan for the selected date.
- `latest_plan` is null when no plan exists. Otherwise, it contains that plan's
  saved revenue, food cost, delivery cost, total cost, profit, and time prediction.
  These are plan estimates, not recorded payments or confirmed delivery times.
- `plan_matches_orders` compares the latest plan's order IDs, quantities, and
  customer location/contact snapshots with current noncancelled daily orders.

Only the latest plan is used because recalculating creates another plan for
the same orders. Summing all plans would count those orders more than once.

The frontend uses the existing `API_BASE_URL`. Deploy this backend to that URL
before using the Dashboard against the hosted API, or point the existing config
to the local backend during local development.

After `npm ci`, verify without a live database:

```sh
npx tsc --noEmit
node --test tests/dashboard.test.cjs
```

The tests mock the existing database pool and use localhost for the Express
route test. Existing business logic and SQL schema are unchanged; `app.ts`
only imports and mounts the new router.
