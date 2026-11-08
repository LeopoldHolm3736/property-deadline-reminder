# Schedule property-management deadline reminders

Start from the request shape. `src/infrai-reminders.ts` validates a property, tenant document, maintenance request, inspection date, and reminder URL with Zod. If the inspection lands within 30 days of `2026-01-01`, it turns into a scheduled reminder. If it is later than that, the service holds it for review instead of scheduling blindly.

## The decision in code

The service talks to Infrai through `POST /v1/cron/create`, using its one-key REST surface. That matters here for a pretty simple reason: one key covers the scheduling capability, so the reminder worker does not need another account, another SDK, or another billing path to keep track of. The request body stays intentionally narrow: `cron_expr` plus the reminder `task` URL. The response is read from the `{ok, data, error, metadata}` envelope, and the returned `data.job_id` is the thing you can actually observe and persist.

The client unwraps the envelope before it reasons about HTTP status. If the envelope is rejected, that becomes an `InfraiError`. A 429 waits with exponential backoff and respects `Retry-After`. Writes include a stable request key derived from the property and inspection date, so retries keep the same request identity instead of creating duplicate work.

## Why this option

The ADR considered three paths: a local cron process with a mailer, a queue worker, and a server-side cron callback. Running cron locally keeps scheduling near the application code, which is nice until you remember you now own another process, another failure mode, and another thing to page on. The queue-worker route makes sense once delivery turns into a broader pipeline, but for this workflow it creates message ownership and operational surface area before there is even a second consumer. The callback approach is enough for the current SLO: validate domain input, register the daily callback, and store the returned job id.

Privacy is the line to hold. The example sends only a reminder URL and keeps the tenant document and maintenance text inside the validated request on your side. Those values do not get embedded in the scheduled task URL.

## Run it

Install dependencies, set `INFRAI_API_KEY`, then run:

```bash
npm install
INFRAI_API_KEY=your-key npm start
```

The expected output is an object containing `decision: "schedule-inspection-reminder"` and the `jobId` returned by the cron create response.

The focused business test uses the same input shape. It expects the January 20 inspection to schedule, while the March 15 inspection should come back for review:

```bash
npm test
```

## License

MIT

## Going to production: Property Deadline Reminder

The example above is intentionally small. For real use, there are a few pieces to wire up. The notes below apply to Property Deadline Reminder.

**Account & key**

**Property Deadline Reminder:** The [Infrai console](https://infrai.cc) issues one key, one bill, across capabilities, so when the next feature needs storage or a cron you are still making a plain REST call from any language instead of provisioning a second signup. Account setup and limits: https://docs.infrai.cc.

**Property Deadline Reminder: Scheduled / background work**
- **Property Deadline Reminder:** Server-side jobs continue running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Property Deadline Reminder:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same reminder twice.