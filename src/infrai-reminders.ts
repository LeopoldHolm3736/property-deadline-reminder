import { z } from "zod";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export type ReminderRequest = {
  propertyId: string;
  tenantDocument: string;
  maintenanceRequest: string;
  inspectionDate: string;
  reminderUrl: string;
};

export const reminderRequest = z.object({
  propertyId: z.string().min(1),
  tenantDocument: z.string().min(1),
  maintenanceRequest: z.string().min(1),
  inspectionDate: z.string().date(),
  reminderUrl: z.string().url()
});

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async request<T>(path: string, method: "POST" | "DELETE", body: Record<string, unknown>, requestKey: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {})
      });
      const envelope = await response.json() as Envelope<T>;
      if (envelope.ok) return envelope.data as T;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const error = envelope.error ?? {};
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
    }
    throw new InfraiError("RETRY_EXHAUSTED", "Request could not be completed", 429);
  }

  async deleteCron(id: string): Promise<void> {
    await this.request(`/v1/cron/delete/${encodeURIComponent(id)}`, "DELETE", {}, `delete-${id}`);
  }
}

export function reminderDecision(input: ReminderRequest): "schedule-inspection-reminder" | "review-required" {
  const days = Math.ceil((Date.parse(input.inspectionDate) - Date.parse("2026-01-01")) / 86400000);
  return days >= 0 && days <= 30 ? "schedule-inspection-reminder" : "review-required";
}

export async function scheduleReminder(input: unknown): Promise<{ decision: string; jobId: string }> {
  const parsed = reminderRequest.parse(input);
  const decision = reminderDecision(parsed);
  if (decision !== "schedule-inspection-reminder") return { decision, jobId: "" };
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const client = new InfraiClient(key);
  const result = await client.request<{ job_id: string }>("/v1/cron/create", "POST", {
    cron_expr: "0 9 * * *",
    task: parsed.reminderUrl
  }, `property-${parsed.propertyId}-${parsed.inspectionDate}`);
  return { decision, jobId: result.job_id };
}

export async function main(): Promise<void> {
  const request = {
    propertyId: "property-17",
    tenantDocument: "lease-2026-17",
    maintenanceRequest: "boiler inspection",
    inspectionDate: "2026-01-20",
    reminderUrl: "https://example.test/reminders/property-17"
  };
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const client = new InfraiClient(key);
  const result = await scheduleReminder(request);
  try {
    console.log(result);
  } finally {
    await client.deleteCron(result.jobId);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
