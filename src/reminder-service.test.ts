import assert from "node:assert/strict";
import test from "node:test";
import { reminderDecision, reminderRequest } from "./infrai-reminders.ts";

test("an inspection within 30 days is scheduled, while a later one is reviewed", () => {
  const soon = reminderRequest.parse({
    propertyId: "p-1",
    tenantDocument: "lease-1",
    maintenanceRequest: "heater",
    inspectionDate: "2026-01-20",
    reminderUrl: "https://example.test/reminder"
  });
  const later = { ...soon, inspectionDate: "2026-03-15" };
  assert.equal(reminderDecision(soon), "schedule-inspection-reminder");
  assert.equal(reminderDecision(later), "review-required");
});
