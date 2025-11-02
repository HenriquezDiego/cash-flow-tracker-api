// Pure calculator for credit statements (no side-effects)
// Computes: previousBalance, charges, interests, payments, statementBalance,
// bonifiableInterest, installmentBalance, annualEffectiveRate, termMonths, periodDays

export function normalizeAnnualRateToUnit(rate) {
  if (rate === null || rate === undefined) return 0;
  const n = Number(rate);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

export function toDateOnly(d) {
  // If d is a string in YYYY-MM-DD format, parse it safely
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    const parts = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (parts) {
      const year = parseInt(parts[1], 10);
      const month = parseInt(parts[2], 10) - 1; // Month is 0-indexed
      const day = parseInt(parts[3], 10);
      return new Date(year, month, day);
    }
  }
  
  // For other formats, use standard Date parsing
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function clampDay(year, monthIndexZeroBased, day) {
  const last = new Date(year, monthIndexZeroBased + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

export function daysBetween(from, to) {
  if (!from || !to) return 0;
  const a = toDateOnly(from);
  const b = toDateOnly(to);
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function resolvePeriodBounds({ cutOffDay, dueDay }, base) {
  // base: Date inside or after the period to compute (e.g., any day in month)
  const baseDate = base ? toDateOnly(base) : toDateOnly(new Date());

  // statementDate: last cutoff on or before base, or last day prev month
  let statementDate;
  if (Number.isFinite(cutOffDay)) {
    const y = baseDate.getFullYear();
    const m = baseDate.getMonth();
    const cut = new Date(y, m, clampDay(y, m, cutOffDay));
    if (baseDate.getDate() >= cut.getDate()) {
      statementDate = cut;
    } else {
      const prev = new Date(y, m - 1, 1);
      statementDate = new Date(prev.getFullYear(), prev.getMonth(), clampDay(prev.getFullYear(), prev.getMonth(), cutOffDay));
    }
  } else {
    // last day of previous month
    statementDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 0);
  }

  const prevMonth = new Date(statementDate.getFullYear(), statementDate.getMonth() - 1, 1);
  const prevStatementDate = Number.isFinite(cutOffDay)
    ? new Date(prevMonth.getFullYear(), prevMonth.getMonth(), clampDay(prevMonth.getFullYear(), prevMonth.getMonth(), cutOffDay))
    : new Date(statementDate.getFullYear(), statementDate.getMonth(), 0);

  const nextStatementDate = Number.isFinite(cutOffDay)
    ? new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, clampDay(statementDate.getFullYear(), statementDate.getMonth() + 1, cutOffDay))
    : new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, 0);

  const dueDate = Number.isFinite(dueDay)
    ? new Date(statementDate.getFullYear(), statementDate.getMonth(), clampDay(statementDate.getFullYear(), statementDate.getMonth(), dueDay))
    : new Date(statementDate.getFullYear(), statementDate.getMonth(), clampDay(statementDate.getFullYear(), statementDate.getMonth(), 25));

  const periodDays = daysBetween(prevStatementDate, statementDate);

  return { prevStatementDate, statementDate, nextStatementDate, dueDate, periodDays };
}

export function buildEvents(expenses, debtId, startInclusive, endExclusive) {
  const start = toDateOnly(startInclusive);
  const end = toDateOnly(endExclusive);
  const events = [];
  for (const e of expenses || []) {
    if (!e || !e.debtId || String(e.debtId) !== String(debtId) || !e.date) continue;
    const d = toDateOnly(e.date);
    // Include events from start (inclusive) to end (exclusive - cutoff day not included)
    if (d >= start && d < end) {
      const entryType = e.entryType ? String(e.entryType).toLowerCase() : '';
      const amount = Number(e.amount) || 0;
      if (amount <= 0) continue;
      if (entryType === 'charge' || entryType === 'payment') {
        events.push({ date: d, kind: entryType, amount });
      }
    }
  }
  // payments before charges on same day
  events.sort((a, b) => {
    if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
    if (a.kind === b.kind) return 0;
    return a.kind === 'payment' ? -1 : 1;
  });
  return events;
}

export function sumCharges(events) {
  return Number(events.filter(e => e.kind === 'charge').reduce((s, e) => s + e.amount, 0).toFixed(2));
}

export function sumPayments(events) {
  return Number(events.filter(e => e.kind === 'payment').reduce((s, e) => s + e.amount, 0).toFixed(2));
}

export function computeSpdInterests(previousBalance, events, annualRateUnit, start, end) {
  const dailyRate = (annualRateUnit || 0) / 365;
  let nbBalance = Math.max(0, Number(previousBalance) || 0); // non-bonificable
  let bBalance = 0; // bonificable
  let nbBalanceDays = 0;
  let bBalanceDays = 0;
  let cursor = toDateOnly(start);

  const addSegment = (until) => {
    const days = daysBetween(cursor, until);
    if (days > 0) {
      nbBalanceDays += nbBalance * days;
      bBalanceDays += bBalance * days;
      cursor = until;
    }
  };

  for (const ev of events) {
    addSegment(ev.date);
    if (ev.kind === 'payment') {
      const appliedToNb = Math.min(nbBalance, ev.amount);
      nbBalance -= appliedToNb;
      const remainder = ev.amount - appliedToNb;
      bBalance = Math.max(0, bBalance - remainder);
    } else if (ev.kind === 'charge') {
      bBalance += ev.amount;
    }
  }
  addSegment(toDateOnly(end));

  const interestSobreSaldo = nbBalanceDays * dailyRate;
  const interestBonificable = bBalanceDays * dailyRate;
  return { 
    interestSobreSaldo,
    interestBonificable
  };
}

// Decide cuánto interés bonificable del periodo anterior se traslada (carry-over)
// Regla: si el pago del periodo anterior es menor a la cuota (installmentBalance),
// trasladar el bonificable anterior; de lo contrario, 0.
export function computeInterestCarryOver(previousRecord, previousPeriodPaid, epsilon = 0.005) {
  if (!previousRecord) return 0;
  const prevInstallment = Number(previousRecord.installmentBalance) || 0;
  const prevBonificable = Number(previousRecord.bonifiableInterest) || 0;
  const paid = Number(previousPeriodPaid) || 0;
  if (paid + epsilon < prevInstallment) {
    return prevBonificable; // Return exact value, rounding will happen when summing
  }
  return 0;
}

export function computeStatement(previousBalance, charges, interests, payments) {
  return Number((Math.max(0, (Number(previousBalance)||0) + (Number(charges)||0) + (Number(interests)||0) - (Number(payments)||0))).toFixed(2));
}

export function computeInstallmentBalance(statementBalance, bonificable) {
  return Number(((Number(statementBalance)||0) + (Number(bonificable)||0)).toFixed(2));
}

export function calculateStatement({
  debt,
  expenses,
  periodDate // Date representing the month to compute (any day); optional
}, opts = {}) {
  const { prevStatementDate, statementDate, nextStatementDate, dueDate, periodDays } = resolvePeriodBounds({ cutOffDay: debt.cutOffDay, dueDay: debt.dueDay }, periodDate);
  const annualUnit = normalizeAnnualRateToUnit(debt.interesEfectivo);

  // Period starts the day AFTER previous cutoff (inclusive) and ends BEFORE current cutoff day (exclusive)
  const startPeriod = new Date(prevStatementDate.getFullYear(), prevStatementDate.getMonth(), prevStatementDate.getDate() + 1);
  const periodEvents = buildEvents(expenses, debt.id, startPeriod, statementDate);
  const charges = sumCharges(periodEvents);
  const payments = sumPayments(periodEvents);

  const previousBalance = Number.isFinite(opts.previousBalance)
    ? Number(opts.previousBalance)
    : Number.isFinite(debt.balance) ? Number(debt.balance) - 0 /* assumes current balance includes last cycle */ : 0;

  // Calculate interests from startPeriod (day after prev cutoff) to statementDate (exclusive - cutoff day not included)
  const { interestSobreSaldo, interestBonificable } = computeSpdInterests(previousBalance, periodEvents, annualUnit, startPeriod, statementDate);
  const interests = Number(interestSobreSaldo.toFixed(2));
  const bonifiableInterest = Number(interestBonificable.toFixed(2));

  const statementBalance = computeStatement(previousBalance, charges, interests, payments);
  const installmentBalance = computeInstallmentBalance(statementBalance, bonifiableInterest);

  // Calculate period days: from startPeriod (inclusive) to statementDate (exclusive - cutoff day not included)
  const calculatedPeriodDays = daysBetween(startPeriod, statementDate); // statementDate is exclusive, so no +1 needed

  return {
    previousBalance,
    charges,
    interests,
    payments,
    statementBalance,
    bonifiableInterest,
    installmentBalance,
    annualEffectiveRate: annualUnit,
    periodDays: calculatedPeriodDays,
    dates: {
      prevStatementDate: prevStatementDate.toISOString().slice(0,10),
      statementDate: statementDate.toISOString().slice(0,10),
      nextStatementDate: nextStatementDate.toISOString().slice(0,10),
      dueDate: dueDate.toISOString().slice(0,10)
    }
  };
}

export default {
  normalizeAnnualRateToUnit,
  resolvePeriodBounds,
  buildEvents,
  sumCharges,
  sumPayments,
  computeSpdInterests,
  computeInterestCarryOver,
  computeStatement,
  computeInstallmentBalance,
  calculateStatement
};



