import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';
import { buildDebtSummary, monthlyRateFromAnnualEffective, interestForMonth, nextDateForDayOfMonth, formatResponseTwoDecimals } from '../utils/finance.js';
import { calculateStatement, normalizeAnnualRateToUnit, resolvePeriodBounds, buildEvents, sumPayments as sumPaymentsCalc, sumCharges as sumChargesCalc, computeSpdInterests, computeInterestCarryOver } from '../utils/creditStatementCalculator.js';
import { daysBetweenDates } from '../utils/finance.js';

/**
 * Get all debts
 */
export const getDebts = async (req, res, next) => {
  try {
    logger.info('GET /api/debts - Fetching all debts');
    const items = await req.sheetsService.getDebtsObjects();
    res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    logger.error('Error in getDebts controller', { error: error.message });
    next(error);
  }
};

/**
 * Add new debt
 */
export const addDebt = async (req, res, next) => {
  try {
    const { id, name, issuer, creditLimit, balance, dueDay, cutOffDay, active, maskPan, interesEfectivo, brand } = req.body;

    logger.info('POST /api/debts - Adding new debt', { name, issuer });

    if (!name) {
      throw new ApiError(400, 'Missing required field: name');
    }

    const debtId = id || uuidv4();

    const debt = {
      id: String(debtId),
      name: name.trim(),
      issuer: issuer ? String(issuer).trim() : '',
      creditLimit: creditLimit !== undefined && creditLimit !== null ? parseFloat(creditLimit) : undefined,
      balance: balance !== undefined && balance !== null ? parseFloat(balance) : undefined,
      dueDay: dueDay !== undefined && dueDay !== null ? parseInt(dueDay, 10) : undefined,
      cutOffDay: cutOffDay !== undefined && cutOffDay !== null ? parseInt(cutOffDay, 10) : undefined,
      active: active !== undefined ? Boolean(active) : true,
      maskPan: maskPan !== undefined && maskPan !== null ? String(maskPan).trim() : undefined,
      interesEfectivo: interesEfectivo !== undefined && interesEfectivo !== null ? parseFloat(interesEfectivo) : undefined,
      brand: brand !== undefined && brand !== null ? String(brand).trim() : undefined
    };

    const result = await req.sheetsService.addDebt(debt);

    logger.info('Debt added successfully', { debtId: debt.id });

    res.status(201).json({
      success: true,
      message: 'Debt added successfully',
      data: debt,
      result
    });
  } catch (error) {
    logger.error('Error in addDebt controller', { body: req.body, error: error.message });
    next(error);
  }
};

/**
 * Update debt
 */
export const updateDebt = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, issuer, creditLimit, balance, dueDay, cutOffDay, active, maskPan, interesEfectivo, brand } = req.body;

    logger.info('PUT /api/debts - Updating debt', { id, name });

    if (!id) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const debt = {
      id: String(id),
      name: name !== undefined ? String(name).trim() : undefined,
      issuer: issuer !== undefined ? String(issuer).trim() : undefined,
      creditLimit: creditLimit !== undefined ? parseFloat(creditLimit) : undefined,
      balance: balance !== undefined ? parseFloat(balance) : undefined,
      dueDay: dueDay !== undefined ? parseInt(dueDay, 10) : undefined,
      cutOffDay: cutOffDay !== undefined ? parseInt(cutOffDay, 10) : undefined,
      active: active !== undefined ? Boolean(active) : undefined,
      maskPan: maskPan !== undefined ? String(maskPan).trim() : undefined,
      interesEfectivo: interesEfectivo !== undefined ? parseFloat(interesEfectivo) : undefined,
      brand: brand !== undefined ? String(brand).trim() : undefined
    };

    const result = await req.sheetsService.updateDebt(debt);

    logger.info('Debt updated successfully', { debtId: debt.id });

    res.json({
      success: true,
      message: 'Debt updated successfully',
      data: debt,
      result
    });
  } catch (error) {
    logger.error('Error in updateDebt controller', { body: req.body, error: error.message });
    next(error);
  }
};

/**
 * Delete debt
 */
export const deleteDebt = async (req, res, next) => {
  try {
    const { id } = req.params;
    logger.info('DELETE /api/debts - Deleting debt', { id });

    if (!id) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const result = await req.sheetsService.deleteDebt(String(id));

    res.json({
      success: true,
      message: 'Debt deleted successfully',
      id,
      result
    });
  } catch (error) {
    logger.error('Error in deleteDebt controller', { params: req.params, error: error.message });
    next(error);
  }
};

/**
 * Get summary for a single debt by id
 */
export const getDebtSummary = async (req, res, next) => {
  try {
    const { id } = req.params;
    logger.info('GET /api/debts/:id/summary - Building debt summary', { id });

    if (!id) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const rows = await req.sheetsService.getDebts();
    const header = rows[0] || [];
    const idx = {
      id: 0, name: 1, issuer: 2, creditLimit: 3, balance: 4, dueDay: 5, cutOffDay: 6, maskPan: 7, interesEfectivo: 8, brand: 9, active: 10
    };
    const row = rows.slice(1).find(r => String(r[idx.id]) === String(id));
    if (!row) {
      throw new ApiError(404, 'Debt not found');
    }
    const debt = {
      id: row[idx.id],
      name: row[idx.name],
      issuer: row[idx.issuer],
      creditLimit: row[idx.creditLimit] ? parseFloat(row[idx.creditLimit]) : undefined,
      balance: row[idx.balance] ? parseFloat(row[idx.balance]) : undefined,
      dueDay: row[idx.dueDay] ? parseInt(row[idx.dueDay], 10) : undefined,
      cutOffDay: row[idx.cutOffDay] ? parseInt(row[idx.cutOffDay], 10) : undefined,
      maskPan: row[idx.maskPan] || undefined,
      interesEfectivo: row[idx.interesEfectivo] ? parseFloat(row[idx.interesEfectivo]) : undefined,
      brand: row[idx.brand] || undefined,
      active: row[idx.active] === 'TRUE'
    };

    const summary = buildDebtSummary(debt);
    res.json({ success: true, data: { debt, summary } });
  } catch (error) {
    logger.error('Error in getDebtSummary controller', { params: req.params, error: error.message });
    next(error);
  }
};

/**
 * Get summaries for all debts
 */
export const getDebtsSummary = async (req, res, next) => {
  try {
    logger.info('GET /api/debts/summary - Building debts summaries');
    const rows = await req.sheetsService.getDebts();
    const idx = { id: 0, name: 1, issuer: 2, creditLimit: 3, balance: 4, dueDay: 5, cutOffDay: 6, maskPan: 7, interesEfectivo: 8, brand: 9, active: 10 };
    const items = rows.slice(1).map(r => {
      const debt = {
        id: r[idx.id],
        name: r[idx.name],
        issuer: r[idx.issuer],
        creditLimit: r[idx.creditLimit] ? parseFloat(r[idx.creditLimit]) : undefined,
        balance: r[idx.balance] ? parseFloat(r[idx.balance]) : undefined,
        dueDay: r[idx.dueDay] ? parseInt(r[idx.dueDay], 10) : undefined,
        cutOffDay: r[idx.cutOffDay] ? parseInt(r[idx.cutOffDay], 10) : undefined,
        maskPan: r[idx.maskPan] || undefined,
        interesEfectivo: r[idx.interesEfectivo] ? parseFloat(r[idx.interesEfectivo]) : undefined,
        brand: r[idx.brand] || undefined,
        active: r[idx.active] === 'TRUE'
      };
      return { debt, summary: buildDebtSummary(debt) };
    });
    res.json({ success: true, count: items.length, data: items });
  } catch (error) {
    logger.error('Error in getDebtsSummary controller', { error: error.message });
    next(error);
  }
};

/**
 * Get installments plan for a debt (id) over N months
 * Query: months (1-120), start (YYYY-MM-DD optional; defaults to next due date or today)
 */
export const getDebtInstallments = async (req, res, next) => {
  try {
    const { id } = req.params;
    const months = parseInt(req.query.months, 10);
    const startStr = req.query.start;

    logger.info('GET /api/debts/:id/installments - Calculating installments', { id, months, startStr });

    if (!id || !Number.isFinite(months) || months <= 0) {
      throw new ApiError(400, 'Invalid parameters');
    }

    // Load debt rows and find the specific debt
    const rows = await req.sheetsService.getDebts();
    const idx = { id: 0, name: 1, issuer: 2, creditLimit: 3, balance: 4, dueDay: 5, cutOffDay: 6, maskPan: 7, interesEfectivo: 8, brand: 9, active: 10 };
    const row = rows.slice(1).find(r => String(r[idx.id]) === String(id));
    if (!row) {
      throw new ApiError(404, 'Debt not found');
    }
    const debt = {
      id: row[idx.id],
      name: row[idx.name],
      issuer: row[idx.issuer],
      creditLimit: row[idx.creditLimit] ? parseFloat(row[idx.creditLimit]) : 0,
      balance: row[idx.balance] ? parseFloat(row[idx.balance]) : 0,
      dueDay: row[idx.dueDay] ? parseInt(row[idx.dueDay], 10) : null,
      cutOffDay: row[idx.cutOffDay] ? parseInt(row[idx.cutOffDay], 10) : null,
      interesEfectivo: row[idx.interesEfectivo] ? parseFloat(row[idx.interesEfectivo]) : null,
      brand: row[idx.brand] || undefined,
      active: row[idx.active] === 'TRUE'
    };

    const monthlyRate = debt.interesEfectivo !== null ? monthlyRateFromAnnualEffective(debt.interesEfectivo) : 0;
    const startDate = startStr ? new Date(startStr) : (debt.dueDay ? nextDateForDayOfMonth(debt.dueDay, new Date()) : new Date());

    // Amortization: equal payments over N months (if rate>0 uses standard annuity formula)
    const principal = Math.max(0, debt.balance);
    let payment;
    if (monthlyRate > 0) {
      const r = monthlyRate;
      const n = months;
      payment = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    } else {
      payment = months > 0 ? (principal / months) : principal;
    }

    const schedule = [];
    let remaining = principal;
    const baseYear = startDate.getFullYear();
    const baseMonth = startDate.getMonth();
    const targetDay = startDate.getDate();
    for (let i = 0; i < months; i++) {
      const y = baseYear;
      const m = baseMonth + i;
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(targetDay, daysInMonth);
      const date = new Date(y, m, day);
      const interest = interestForMonth(remaining, monthlyRate);
      let principalPart = payment - interest;
      if (principalPart < 0) principalPart = 0;
      if (principalPart > remaining) {
        principalPart = remaining;
      }
      remaining = Math.max(0, remaining - principalPart);
      schedule.push({
        period: i + 1,
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`,
        payment: Number(payment.toFixed(2)),
        interest: Number(interest.toFixed(2)),
        principal: Number(principalPart.toFixed(2)),
        remainingBalance: Number(remaining.toFixed(2))
      });
      if (remaining <= 0) break;
    }

    const totals = schedule.reduce((acc, s) => {
      acc.totalPaid += s.payment;
      acc.totalInterest += s.interest;
      acc.totalPrincipal += s.principal;
      return acc;
    }, { totalPaid: 0, totalInterest: 0, totalPrincipal: 0 });

    res.json({
      success: true,
      data: {
        debt: { id: debt.id, name: debt.name, issuer: debt.issuer, balance: principal, interesEfectivo: debt.interesEfectivo },
        monthlyRate,
        payment: Number(payment.toFixed(2)),
        months: schedule.length,
        schedule,
        totals: {
          totalPaid: Number(totals.totalPaid.toFixed(2)),
          totalInterest: Number(totals.totalInterest.toFixed(2)),
          totalPrincipal: Number(totals.totalPrincipal.toFixed(2))
        }
      }
    });
  } catch (error) {
    logger.error('Error in getDebtInstallments controller', { params: req.params, query: req.query, error: error.message });
    next(error);
  }
};

/**
 * POST /api/debts/:id/accrue?date=YYYY-MM-DD&dryRun=true|false
 * Calculate and record one cycle in CreditHistory and add interest to Debts.balance
 */
export const accrueDebt = async (req, res, next) => {
  try {
    const { id } = req.params;
    const recompute = String(req.query.recompute || 'false').toLowerCase() === 'true';
    const dateParam = req.query.date;
    const periodParam = req.query.period;
    const baseDate = dateParam ? new Date(dateParam) : new Date();

    logger.info('POST /api/debts/:id/accrue - Start', { id, dateParam, periodParam, recompute });

    // 1) Load debt
    const rows = await req.sheetsService.getDebts();
    const idx = { id: 0, name: 1, issuer: 2, creditLimit: 3, balance: 4, dueDay: 5, cutOffDay: 6, maskPan: 7, interesEfectivo: 8, brand: 9, active: 10 };
    const row = rows.slice(1).find(r => String(r[idx.id]) === String(id));
    if (!row) throw new ApiError(404, 'Debt not found');

    const debt = {
      id: row[idx.id],
      name: row[idx.name],
      balance: row[idx.balance] ? parseFloat(row[idx.balance]) : 0,
      dueDay: row[idx.dueDay] ? parseInt(row[idx.dueDay], 10) : null,
      cutOffDay: row[idx.cutOffDay] ? parseInt(row[idx.cutOffDay], 10) : null,
      interesEfectivo: row[idx.interesEfectivo] ? parseFloat(row[idx.interesEfectivo]) : 0,
      active: row[idx.active] === 'TRUE'
    };
    if (!debt.active) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Debt is inactive' });
    }

    // 2) Resolve statementDate and dueDate
    const dayClamp = (y, m, d) => Math.min(Math.max(1, d), new Date(y, m + 1, 0).getDate());
    const dateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const base = dateOnly(baseDate);

    let statementDate;
    if (periodParam && /^\d{4}-\d{2}$/.test(String(periodParam))) {
      const [yStr, mStr] = String(periodParam).split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10) - 1; // 0-based
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 0 || m > 11) {
        throw new ApiError(400, 'Invalid period format. Expected YYYY-MM');
      }
      if (Number.isFinite(debt.cutOffDay)) {
        statementDate = new Date(y, m, dayClamp(y, m, debt.cutOffDay));
      } else {
        // No cutOffDay: use last day of that month
        statementDate = new Date(y, m + 1, 0);
      }
    } else {
      if (Number.isFinite(debt.cutOffDay)) {
        // If base date is not on cutoff, use the latest cutoff on or before base
        const currentMonthCut = new Date(base.getFullYear(), base.getMonth(), dayClamp(base.getFullYear(), base.getMonth(), debt.cutOffDay));
        if (base.getDate() >= currentMonthCut.getDate()) {
          statementDate = currentMonthCut;
        } else {
          const prevMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1);
          statementDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), dayClamp(prevMonth.getFullYear(), prevMonth.getMonth(), debt.cutOffDay));
        }
      } else {
        // Use last day of previous month as statementDate
        const prevMonthEnd = new Date(base.getFullYear(), base.getMonth(), 0);
        statementDate = prevMonthEnd;
      }
    }

    const nextStatementDate = Number.isFinite(debt.cutOffDay)
      ? nextDateForDayOfMonth(debt.cutOffDay, new Date(statementDate.getFullYear(), statementDate.getMonth(), statementDate.getDate() + 1))
      : new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, 0);

    const dueDate = Number.isFinite(debt.dueDay)
      ? nextDateForDayOfMonth(debt.dueDay, statementDate)
      : new Date(statementDate.getFullYear(), statementDate.getMonth(), dayClamp(statementDate.getFullYear(), statementDate.getMonth(), 25));

    // 3) Idempotency: check existing CreditHistory for (id, statementDate)
    const history = await req.sheetsService.getCreditHistoryObjects();
    const statementDateStr = statementDate.toISOString().slice(0, 10);
    const exists = history.some(h => String(h.debtId) === String(id) && String(h.statementDate) === statementDateStr);
    let previousRowNumber = null;
    let previousRecord = null;
    if (exists) {
      if (!recompute && !dryRun) {
        return res.status(200).json({ success: true, skipped: true, reason: 'Already accrued for this statementDate', statementDate: statementDateStr });
      }
      // Load previous record to rollback
      previousRowNumber = await req.sheetsService.findCreditHistoryRow(id, statementDateStr);
      if (previousRowNumber) {
        previousRecord = await req.sheetsService.getCreditHistoryByRow(previousRowNumber);
      }
    }

    // 4) Determine previous record for previousBalance (we keep backward compat where available)
    const lastForDebt = history
      .filter(h => String(h.debtId) === String(id) && h.statementDate && h.statementDate < statementDateStr)
      .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1))[0];
    const previousBalance = lastForDebt && Number.isFinite(lastForDebt.statementBalance) ? Number(lastForDebt.statementBalance) : (Number.isFinite(debt.balance) ? Number(debt.balance) : 0);

    // 5) Gather expenses in [prevStatementDate, statementDate) and compute components
    const allExpenses = await req.sheetsService.getExpensesObjects();
    const periodEvents = [];
    const startPeriod = new Date(statementDate.getFullYear(), statementDate.getMonth() - 1, statementDate.getDate());
    for (const e of allExpenses) {
      if (!e || !e.debtId || String(e.debtId) !== String(id) || !e.date) continue;
      const d = new Date(e.date);
      const dateOnlyEvent = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (dateOnlyEvent >= new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate()) && dateOnlyEvent < new Date(statementDate.getFullYear(), statementDate.getMonth(), statementDate.getDate())) {
        const entryType = e.entryType ? String(e.entryType).toLowerCase() : '';
        const amount = Number(e.amount) || 0;
        if (amount <= 0) continue;
        if (entryType === 'charge' || entryType === 'payment') {
          periodEvents.push({ date: dateOnlyEvent, kind: entryType, amount });
        }
      }
    }
    periodEvents.sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
      if (a.kind === b.kind) return 0;
      return a.kind === 'payment' ? -1 : 1;
    });

    const charges = periodEvents.filter(e => e.kind === 'charge').reduce((s, e) => s + e.amount, 0);
    const payments = periodEvents.filter(e => e.kind === 'payment').reduce((s, e) => s + e.amount, 0);

    const annualRateUnit = debt.interesEfectivo > 1 ? (debt.interesEfectivo / 100) : debt.interesEfectivo;
    // Compute SPD interests using same breakdown
    let nbBalance = Math.max(0, previousBalance);
    let bBalance = 0;
    let nbBalanceDays = 0;
    let bBalanceDays = 0;
    let cursor = new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate());
    const addSegment = (until) => {
      const days = daysBetweenDates(cursor, until) || 0;
      if (days > 0) {
        nbBalanceDays += nbBalance * days;
        bBalanceDays += bBalance * days;
        cursor = until;
      }
    };
    for (const ev of periodEvents) {
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
    addSegment(new Date(statementDate.getFullYear(), statementDate.getMonth(), statementDate.getDate()));
    const interestSobreSaldo = Number((nbBalanceDays * ((annualRateUnit || 0)/365)).toFixed(2));
    const interestBonificable = Number((bBalanceDays * ((annualRateUnit || 0)/365)).toFixed(2));
    // Carry-over usando utilidad compartida (usar el periodo anterior real, no el registro actual)
    let interestCarryOver = 0;
    if (lastForDebt) {
      try {
        const prevPaid = await req.sheetsService.sumPaymentsForDebt(
          id,
          String(lastForDebt.statementDate),
          String(lastForDebt.dueDate)
        );
        interestCarryOver = computeInterestCarryOver(lastForDebt, prevPaid);
      } catch (e) {
        interestCarryOver = 0;
      }
    }
    const interests = Number((interestSobreSaldo + interestCarryOver).toFixed(2));
    const bonifiableInterest = Number(interestBonificable.toFixed(2));
    const statementBalance = Number((Math.max(0, previousBalance + charges + interests - payments)).toFixed(2));
    const installmentBalance = Number((statementBalance + bonifiableInterest).toFixed(2));

    // No dryRun here; use preview endpoint for GET

    // 7) Persist: append/update CreditHistory (no balance adjustments; interests are descriptive)
    const record = {
      debtId: id,
      statementDate: statementDateStr,
      dueDate: dueDate.toISOString().slice(0, 10),
      previousBalance,
      charges,
      interests,
      payments,
      statementBalance,
      bonifiableInterest,
      installmentBalance,
      annualEffectiveRate: annualRateUnit,
      termMonths: null,
      periodDays: daysBetweenDates(new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate()), statementDate) || 0,
      paymentMade: await req.sheetsService.sumPaymentsForDebt(id, statementDateStr, dueDate.toISOString().slice(0,10))
    };
    if (exists && previousRowNumber && recompute) {
      await req.sheetsService.updateCreditHistoryRow(previousRowNumber, record);
    } else {
      await req.sheetsService.appendCreditHistoryRecord(record);
    }

    logger.info('Debt statement computed', { debtId: id, statementDate: statementDateStr });
    // Formatear breakdown y campos numéricos como strings con 2 decimales
    const breakdownFormatted = formatResponseTwoDecimals(
      { interestSobreSaldo, interestBonificable, interestCarryOver },
      ['interestSobreSaldo','interestBonificable','interestCarryOver'],
      true
    );
    const formatted = formatResponseTwoDecimals(
      { ...record, interestBreakdown: breakdownFormatted },
      ['previousBalance','charges','interests','payments','statementBalance','bonifiableInterest','installmentBalance','annualEffectiveRate','paymentMade'],
      true
    );
    return res.status(200).json({
      success: true,
      idempotency: { key: `${id}|${statementDateStr}`, status: 'created' },
      data: formatted
    });
  } catch (error) {
    logger.error('Error in accrueDebt controller', { params: req.params, query: req.query, error: error.message });
    next(error);
  }
};
export default {};

/**
 * GET /api/debts/:id/statement-preview?period=YYYY-MM|date=YYYY-MM-DD
 * Calculate a statement preview without persisting
 */
export const getDebtStatementPreview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const dateParam = req.query.date;
    const periodParam = req.query.period;
    const recompute = String(req.query.recompute || 'false').toLowerCase() === 'true';
    const baseDate = dateParam ? new Date(dateParam) : new Date();

    logger.info('GET /api/debts/:id/statement-preview - Start', { id, dateParam, periodParam });

    // Load debt
    const rows = await req.sheetsService.getDebts();
    const idx = { id: 0, name: 1, issuer: 2, creditLimit: 3, balance: 4, dueDay: 5, cutOffDay: 6, maskPan: 7, interesEfectivo: 8, brand: 9, active: 10 };
    const row = rows.slice(1).find(r => String(r[idx.id]) === String(id));
    if (!row) throw new ApiError(404, 'Debt not found');

    const debt = {
      id: row[idx.id],
      name: row[idx.name],
      balance: row[idx.balance] ? parseFloat(row[idx.balance]) : 0,
      dueDay: row[idx.dueDay] ? parseInt(row[idx.dueDay], 10) : null,
      cutOffDay: row[idx.cutOffDay] ? parseInt(row[idx.cutOffDay], 10) : null,
      interesEfectivo: row[idx.interesEfectivo] ? parseFloat(row[idx.interesEfectivo]) : 0,
      active: row[idx.active] === 'TRUE'
    };
    if (!debt.active) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Debt is inactive' });
    }

    // Resolve dates (reuse logic from accrueDebt)
    const dayClamp = (y, m, d) => Math.min(Math.max(1, d), new Date(y, m + 1, 0).getDate());
    const dateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const base = dateOnly(baseDate);

    let statementDate;
    if (periodParam && /^\d{4}-\d{2}$/.test(String(periodParam))) {
      const [yStr, mStr] = String(periodParam).split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10) - 1;
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 0 || m > 11) {
        throw new ApiError(400, 'Invalid period format. Expected YYYY-MM');
      }
      if (Number.isFinite(debt.cutOffDay)) {
        statementDate = new Date(y, m, dayClamp(y, m, debt.cutOffDay));
      } else {
        statementDate = new Date(y, m + 1, 0);
      }
    } else {
      if (Number.isFinite(debt.cutOffDay)) {
        const currentMonthCut = new Date(base.getFullYear(), base.getMonth(), dayClamp(base.getFullYear(), base.getMonth(), debt.cutOffDay));
        if (base.getDate() >= currentMonthCut.getDate()) {
          statementDate = currentMonthCut;
        } else {
          const prevMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1);
          statementDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), dayClamp(prevMonth.getFullYear(), prevMonth.getMonth(), debt.cutOffDay));
        }
      } else {
        const prevMonthEnd = new Date(base.getFullYear(), base.getMonth(), 0);
        statementDate = prevMonthEnd;
      }
    }

    const nextStatementDate = Number.isFinite(debt.cutOffDay)
      ? new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, dayClamp(statementDate.getFullYear(), statementDate.getMonth() + 1, debt.cutOffDay))
      : new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, 0);

    const dueDate = Number.isFinite(debt.dueDay)
      ? nextDateForDayOfMonth(debt.dueDay, statementDate)
      : new Date(statementDate.getFullYear(), statementDate.getMonth(), dayClamp(statementDate.getFullYear(), statementDate.getMonth(), 25));

    // If recompute=false and a record exists for this statementDate, return it directly
    const history = await req.sheetsService.getCreditHistoryObjects();
    const statementDateStr = statementDate.toISOString().slice(0,10);
    const existing = history.find(h => String(h.debtId) === String(id) && String(h.statementDate) === statementDateStr);
    if (existing && !recompute) {
      return res.status(200).json({ success: true, data: existing, cached: true });
    }

    // PreviousBalance from last statement (if any) or current debt balance
    const lastForDebt = history
      .filter(h => String(h.debtId) === String(id) && h.statementDate && h.statementDate < statementDateStr)
      .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1))[0];
    const previousBalance = lastForDebt && Number.isFinite(lastForDebt.statementBalance) ? Number(lastForDebt.statementBalance) : (Number.isFinite(debt.balance) ? Number(debt.balance) : 0);

    // Build events within period
    const allExpenses = await req.sheetsService.getExpensesObjects();
    const startPeriod = new Date(statementDate.getFullYear(), statementDate.getMonth() - 1, statementDate.getDate());
    const periodEvents = [];
    for (const e of allExpenses) {
      if (!e || !e.debtId || String(e.debtId) !== String(id) || !e.date) continue;
      const d = new Date(e.date);
      const dateOnlyEvent = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (dateOnlyEvent >= new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate()) && dateOnlyEvent < new Date(statementDate.getFullYear(), statementDate.getMonth(), statementDate.getDate())) {
        const entryType = e.entryType ? String(e.entryType).toLowerCase() : '';
        const amount = Number(e.amount) || 0;
        if (amount <= 0) continue;
        if (entryType === 'charge' || entryType === 'payment') {
          periodEvents.push({ date: dateOnlyEvent, kind: entryType, amount });
        }
      }
    }
    periodEvents.sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
      if (a.kind === b.kind) return 0;
      return a.kind === 'payment' ? -1 : 1;
    });

    const charges = periodEvents.filter(e => e.kind === 'charge').reduce((s, e) => s + e.amount, 0);
    const payments = periodEvents.filter(e => e.kind === 'payment').reduce((s, e) => s + e.amount, 0);

    const annualRateUnit = debt.interesEfectivo > 1 ? (debt.interesEfectivo / 100) : debt.interesEfectivo;
    let nbBalance = Math.max(0, previousBalance);
    let bBalance = 0;
    let nbBalanceDays = 0;
    let bBalanceDays = 0;
    let cursor = new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate());
    const addSegment = (until) => {
      const days = Math.round((new Date(until.getFullYear(), until.getMonth(), until.getDate()) - new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())) / (1000*60*60*24));
      if (days > 0) {
        nbBalanceDays += nbBalance * days;
        bBalanceDays += bBalance * days;
        cursor = until;
      }
    };
    for (const ev of periodEvents) {
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
    addSegment(new Date(statementDate.getFullYear(), statementDate.getMonth(), statementDate.getDate()));
    const interestSobreSaldo = Number((nbBalanceDays * ((annualRateUnit || 0)/365)).toFixed(2));
    const interestBonificable = Number((bBalanceDays * ((annualRateUnit || 0)/365)).toFixed(2));

    // Carry-over usando utilidad compartida
    let interestCarryOver = 0;
    if (lastForDebt) {
      try {
        const prevPaid = await req.sheetsService.sumPaymentsForDebt(
          id,
          String(lastForDebt.statementDate),
          String(lastForDebt.dueDate)
        );
        interestCarryOver = computeInterestCarryOver(lastForDebt, prevPaid);
      } catch (e) {
        interestCarryOver = 0;
      }
    }
    const interests = Number((interestSobreSaldo + interestCarryOver).toFixed(2));
    const bonifiableInterest = Number(interestBonificable.toFixed(2));
    const statementBalance = Number((Math.max(0, previousBalance + charges + interests - payments)).toFixed(2));
    const installmentBalance = Number((statementBalance + bonifiableInterest).toFixed(2));

    const previewData = {
      debtId: id,
      statementDate: statementDate.toISOString().slice(0,10),
      dueDate: dueDate.toISOString().slice(0,10),
      previousBalance,
      charges,
      interests,
      payments,
      statementBalance,
      bonifiableInterest,
      installmentBalance,
      annualEffectiveRate: annualRateUnit,
      termMonths: null,
      periodDays: daysBetweenDates(new Date(startPeriod.getFullYear(), startPeriod.getMonth(), startPeriod.getDate()), statementDate),
      paymentMade: await req.sheetsService.sumPaymentsForDebt(id, statementDate.toISOString().slice(0,10), dueDate.toISOString().slice(0,10)),
      interestBreakdown: { interestSobreSaldo, interestBonificable, interestCarryOver }
    };
    const breakdownPreview = formatResponseTwoDecimals(
      previewData.interestBreakdown,
      ['interestSobreSaldo','interestBonificable','interestCarryOver'],
      true
    );
    const formattedPreview = formatResponseTwoDecimals(
      { ...previewData, interestBreakdown: breakdownPreview },
      ['previousBalance','charges','interests','payments','statementBalance','bonifiableInterest','installmentBalance','annualEffectiveRate','paymentMade'],
      true
    );
    return res.status(200).json({ success: true, data: formattedPreview });
  } catch (error) {
    logger.error('Error in getDebtStatementPreview controller', { params: req.params, query: req.query, error: error.message });
    next(error);
  }
};


