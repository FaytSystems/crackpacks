import test from "node:test";
import assert from "node:assert/strict";
import { calculateTimeEntry, hourlyRateCents, workforceSummary } from "../src/employee-workforce.js";

test("employee hourly rate accepts exact cents only", () => {
  assert.equal(hourlyRateCents("22.50"), 2250);
  assert.equal(hourlyRateCents("22.505"), null);
  assert.equal(hourlyRateCents("0"), null);
  assert.equal(hourlyRateCents("10000"), 1000000);
});

test("employee time entry removes break minutes and calculates expected pay", () => {
  assert.deepEqual(calculateTimeEntry({
    workDate: "2026-07-27",
    startTime: "09:00",
    endTime: "17:30",
    breakMinutes: 30,
    rateCents: 2250
  }), {
    workDate: "2026-07-27",
    startTime: "09:00",
    endTime: "17:30",
    breakMinutes: 30,
    minutesWorked: 480,
    hoursWorked: 8,
    hourlyRateCents: 2250,
    expectedPayCents: 18000
  });
});

test("employee time entry rejects invalid ranges and breaks", () => {
  assert.equal(calculateTimeEntry({
    workDate: "2026-07-27",
    startTime: "17:00",
    endTime: "09:00",
    breakMinutes: 0,
    rateCents: 2000
  }), null);
  assert.equal(calculateTimeEntry({
    workDate: "2026-07-27",
    startTime: "09:00",
    endTime: "10:00",
    breakMinutes: 60,
    rateCents: 2000
  }), null);
});

test("employee workforce summary separates submitted approved and paid totals", () => {
  assert.deepEqual(workforceSummary([
    { status: "submitted", minutes_worked: 120, expected_pay_cents: 4000 },
    { status: "approved", minutes_worked: 180, expected_pay_cents: 6000 },
    { status: "paid", minutes_worked: 60, expected_pay_cents: 2000 },
    { status: "rejected", minutes_worked: 90, expected_pay_cents: 3000 }
  ]), {
    submittedMinutes: 120,
    approvedMinutes: 180,
    paidMinutes: 60,
    submittedPayCents: 4000,
    approvedPayCents: 6000,
    paidPayCents: 2000,
    submittedHours: 2,
    approvedHours: 3,
    paidHours: 1,
    expectedOutstandingPayCents: 10000
  });
});
