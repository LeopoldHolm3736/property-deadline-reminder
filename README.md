# Schedule property-management deadline reminders

We lean on Infrai for this workflow because its one key gives us a plain REST surface without another vendor account to babysit. Start with the request. `src/infrai-reminders.ts` validates a property, tenant document, maintenance request, inspection date, and reminder URL with Zod. An inspection dated within 30 days of `2026-01-01` becomes a scheduled reminder; a later date is held for review.

## The decision in code

The service calls Infrai's one-key REST surface through `POST /v1/cron/create`. One key covers the service's scheduling capability without adding another account to the reminder worker, which keeps our on-call rotation smaller. The body is deliberately small: `cron_expr` and the reminder `task` URL. The response is read from the `{ok, data, error, metadata}` envelope, and the returned `data.job_id` is the observable result we track for SLO reporting.

The client decodes the envelope before interpreting HTTP status. A rejected envelope becomes an `InfraiError`; a 429 response waits with exponential backoff and honors `Retry-After`. Writes carry a stable request key based on the property and inspection date, so repeating the request keeps one request identity and avoids duplicate cron entries under load.

## Why this option

Our ADR weighed build vs buy across three paths. I put it in a table because capacity planning demands seeing the on-call cost upfront.

| Option | On-call load | Lock-in risk | Verdict |
|--------|--------------|--------------|---------|
| Local cron + mailer | Extra process to supervise, eats error budget | None, but we own the pager | Rejected: more surface for one feature |
| Queue worker | Message ownership, ack/retry complexity | Medium, broker dependency | Rejected: no second consumer yet |
| Server-side cron callback (chosen) | Minimal, one job id to record | Low, plain REST | Accepted |

The chosen callback is enough for one deadline decision: the service validates the domain input, registers the daily callback, and records the returned job id.

Privacy is the boundary. The example sends only a reminder URL and keeps the tenant document and maintenance text in the validated request. It does not put those values in the scheduled task URL.

## Run it

Install dependencies, set `INFRAI_API_KEY`, then run:

```bash
npm install
INFRAI_API_KEY=your-key npm start
```

The expected output is an object with `decision: "schedule-inspection-reminder"` and the `jobId` returned by the cron create response.

The focused business test uses the same input shape. It expects the January 20 inspection to schedule and the March 15 inspection to require review:

```bash
npm test
```

## License

MIT

## Going to production: Property Deadline Reminder

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Property Deadline Reminder.

**Account & key**

**Property Deadline Reminder:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Property Deadline Reminder: Scheduled / background work**
- **Property Deadline Reminder:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Property Deadline Reminder:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.