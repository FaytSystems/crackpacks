const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function hourlyRateCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000) return null;
  const cents = Math.round(amount * 100);
  return Math.abs(amount - cents / 100) < 0.000001 ? cents : null;
}

function timeToMinutes(value) {
  const match = String(value || "").match(TIME_PATTERN);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function calculateTimeEntry({ workDate, startTime, endTime, breakMinutes, rateCents }) {
  const date = String(workDate || "");
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) return null;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const pause = Number(breakMinutes || 0);
  const rate = Number(rateCents);
  if (start === null || end === null || end <= start) return null;
  if (!Number.isInteger(pause) || pause < 0 || pause >= end - start) return null;
  if (!Number.isInteger(rate) || rate < 1 || rate > 1000000) return null;
  const minutesWorked = end - start - pause;
  const expectedPayCents = Math.round(minutesWorked * rate / 60);
  if (minutesWorked < 1 || expectedPayCents < 1) return null;
  return {
    workDate: date,
    startTime: String(startTime),
    endTime: String(endTime),
    breakMinutes: pause,
    minutesWorked,
    hoursWorked: Number((minutesWorked / 60).toFixed(2)),
    hourlyRateCents: rate,
    expectedPayCents
  };
}

export function workforceSummary(entries = []) {
  const summary = {
    submittedMinutes: 0,
    approvedMinutes: 0,
    paidMinutes: 0,
    submittedPayCents: 0,
    approvedPayCents: 0,
    paidPayCents: 0
  };
  for (const entry of entries) {
    const status = String(entry.status || "");
    const minutes = Math.max(0, Number(entry.minutes_worked ?? entry.minutesWorked) || 0);
    const pay = Math.max(0, Number(entry.expected_pay_cents ?? entry.expectedPayCents) || 0);
    if (status === "submitted") {
      summary.submittedMinutes += minutes;
      summary.submittedPayCents += pay;
    } else if (status === "approved") {
      summary.approvedMinutes += minutes;
      summary.approvedPayCents += pay;
    } else if (status === "paid") {
      summary.paidMinutes += minutes;
      summary.paidPayCents += pay;
    }
  }
  return {
    ...summary,
    submittedHours: Number((summary.submittedMinutes / 60).toFixed(2)),
    approvedHours: Number((summary.approvedMinutes / 60).toFixed(2)),
    paidHours: Number((summary.paidMinutes / 60).toFixed(2)),
    expectedOutstandingPayCents: summary.submittedPayCents + summary.approvedPayCents
  };
}
