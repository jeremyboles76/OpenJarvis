// ---------------------------------------------------------------------------
// Home Finance engine — pure functions for the paycheck-to-paycheck friction
// forecast, agent suggestions, and what-if sandboxing. All functions take
// `today` explicitly so projections are deterministic and testable.
//
// Dates are ISO `YYYY-MM-DD` strings interpreted in local time at noon, which
// keeps day arithmetic stable across DST transitions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaySchedule {
  /** Net take-home per paycheck. */
  amount: number;
  /** ISO date of the next expected paycheck. */
  nextPayDate: string;
  /** Days between paychecks (14 = bi-weekly). */
  frequencyDays: number;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  /** Day of month the bill is due (1–31; clamped to month length). */
  dueDay: number;
}

export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  /** ISO date the spend is planned for. */
  date: string;
  /** Whether the Liquidity Guard may suggest pushing this expense back. */
  deferrable: boolean;
}

export interface SpendEntry {
  id: string;
  amount: number;
  /** ISO date the spend happened. */
  date: string;
  note: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  /** Dollars committed to this goal per month (savings velocity). */
  monthlyContribution: number;
}

export interface SideHustle {
  id: string;
  name: string;
  monthlyRevenue: number;
  monthlyCosts: number;
}

export interface FinanceState {
  /** Combined liquid balance across checking accounts. */
  currentBalance: number;
  /** Minimum balance you never want to dip below. */
  comfortBuffer: number;
  /** Discretionary budget for each pay cycle (resets every paycheck). */
  discretionaryPerCycle: number;
  pay: PaySchedule;
  bills: Bill[];
  planned: PlannedExpense[];
  spends: SpendEntry[];
  goals: Goal[];
  hustles: SideHustle[];
}

export interface DayPoint {
  date: string;
  /** Projected end-of-day balance. */
  balance: number;
  /** Human-readable money events landing on this day. */
  events: string[];
  /** Net cash movement on this day. */
  delta: number;
  belowBuffer: boolean;
}

export interface SafeToSpend {
  /** Days remaining in the current pay cycle, including today. */
  daysLeft: number;
  /** Discretionary budget remaining this cycle. */
  remaining: number;
  /** Recalculated daily allowance for the remaining days. */
  dailyAllowance: number;
  weeklyAllowance: number;
  /** Total discretionary spent so far this cycle. */
  spentThisCycle: number;
  cycleStart: string;
  cycleEnd: string;
}

export interface DeferralSuggestion {
  expense: PlannedExpense;
  /** New date that keeps the projection above the buffer. */
  newDate: string;
  daysDeferred: number;
  /** Lowest projected balance if the deferral is taken. */
  newMinBalance: number;
}

export interface LiquidityReport {
  crunchDays: DayPoint[];
  minBalance: number;
  minBalanceDate: string;
  suggestions: DeferralSuggestion[];
}

export interface IdleCashReport {
  /** Cash needed for bills + planned expenses before the next paycheck. */
  mandatoryAhead: number;
  /** Discretionary allowance reserved for the rest of the cycle. */
  discretionaryReserved: number;
  /** Balance that can be routed out on day one without risking the buffer. */
  idleCash: number;
}

export interface BillAlignment {
  bill: Bill;
  /** Days from the most recent payday to the bill's next due date (0–13). */
  daysAfterPayday: number;
  /** True when the bill lands in the tight back half of the cycle. */
  misaligned: boolean;
  /** Suggested day-of-month for a due-date change request. */
  suggestedDueDay: number | null;
}

export interface Milestone {
  goal: Goal;
  monthsRemaining: number | null;
  /** ISO date of projected completion; null when velocity is zero. */
  projectedDate: string | null;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  return Math.round(
    (parseISO(toISOStr).getTime() - parseISO(fromISO).getTime()) / 86_400_000,
  );
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Whether `iso` is a due date for a bill with the given day-of-month,
 * clamping (e.g. dueDay 31 lands on Feb 28). */
function isDueOn(iso: string, dueDay: number): boolean {
  const d = parseISO(iso);
  const clamped = Math.min(dueDay, daysInMonth(d.getFullYear(), d.getMonth()));
  return d.getDate() === clamped;
}

// ---------------------------------------------------------------------------
// Pay-cycle helpers
// ---------------------------------------------------------------------------

/** All paydays that land within [startISO, endISO], inclusive. */
export function paydaysInRange(pay: PaySchedule, startISO: string, endISO: string): string[] {
  const freq = Math.max(1, pay.frequencyDays);
  // Walk backwards from nextPayDate so past paydays are covered too.
  let first = pay.nextPayDate;
  while (daysBetween(startISO, first) >= freq) first = addDays(first, -freq);
  while (daysBetween(startISO, first) < 0) first = addDays(first, freq);

  const out: string[] = [];
  for (let d = first; daysBetween(d, endISO) >= 0; d = addDays(d, freq)) out.push(d);
  return out;
}

/** The payday that started the cycle containing `today`. */
export function currentCycleStart(pay: PaySchedule, today: string): string {
  const freq = Math.max(1, pay.frequencyDays);
  let d = pay.nextPayDate;
  while (daysBetween(today, d) > 0) d = addDays(d, -freq);
  while (daysBetween(addDays(d, freq), today) >= 0) d = addDays(d, freq);
  return d;
}

/** The next payday strictly after `today` (or `today` itself if it is one). */
export function nextPayday(pay: PaySchedule, today: string): string {
  const freq = Math.max(1, pay.frequencyDays);
  let d = pay.nextPayDate;
  while (daysBetween(today, d) < 0) d = addDays(d, freq);
  while (daysBetween(today, addDays(d, -freq)) >= 0) d = addDays(d, -freq);
  return d;
}

// ---------------------------------------------------------------------------
// 1. Delta Dip — daily projected balance for the next N days
// ---------------------------------------------------------------------------

export function projectBalances(
  state: FinanceState,
  today: string,
  days = 14,
): DayPoint[] {
  const points: DayPoint[] = [];
  let balance = state.currentBalance;

  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    const events: string[] = [];
    let delta = 0;

    if (paydaysInRange(state.pay, date, date).length > 0) {
      delta += state.pay.amount;
      events.push(`Paycheck +$${state.pay.amount.toFixed(0)}`);
    }
    for (const bill of state.bills) {
      if (isDueOn(date, bill.dueDay)) {
        delta -= bill.amount;
        events.push(`${bill.name} −$${bill.amount.toFixed(0)}`);
      }
    }
    for (const exp of state.planned) {
      if (exp.date === date) {
        delta -= exp.amount;
        events.push(`${exp.name} −$${exp.amount.toFixed(0)}`);
      }
    }

    balance += delta;
    points.push({
      date,
      balance: Math.round(balance * 100) / 100,
      events,
      delta: Math.round(delta * 100) / 100,
      belowBuffer: balance < state.comfortBuffer,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// 2. Safe-to-Spend pace — dynamic allowance for the rest of the cycle
// ---------------------------------------------------------------------------

export function safeToSpend(state: FinanceState, today: string): SafeToSpend {
  const cycleStart = currentCycleStart(state.pay, today);
  const cycleEnd = addDays(cycleStart, Math.max(1, state.pay.frequencyDays));

  const spentThisCycle = state.spends
    .filter((s) => daysBetween(cycleStart, s.date) >= 0 && daysBetween(s.date, cycleEnd) > 0)
    .reduce((sum, s) => sum + s.amount, 0);

  const remaining = Math.max(0, state.discretionaryPerCycle - spentThisCycle);
  const daysLeft = Math.max(1, daysBetween(today, cycleEnd));
  const dailyAllowance = remaining / daysLeft;

  return {
    daysLeft,
    remaining: Math.round(remaining * 100) / 100,
    dailyAllowance: Math.round(dailyAllowance * 100) / 100,
    weeklyAllowance: Math.round(Math.min(remaining, dailyAllowance * 7) * 100) / 100,
    spentThisCycle: Math.round(spentThisCycle * 100) / 100,
    cycleStart,
    cycleEnd,
  };
}

// ---------------------------------------------------------------------------
// 3. Liquidity Guard — crunch detection + deferral suggestions
// ---------------------------------------------------------------------------

export function liquidityGuard(
  state: FinanceState,
  today: string,
  days = 14,
): LiquidityReport {
  const points = projectBalances(state, today, days);
  const crunchDays = points.filter((p) => p.belowBuffer);
  const min = points.reduce((a, b) => (b.balance < a.balance ? b : a), points[0]);

  const suggestions: DeferralSuggestion[] = [];
  if (crunchDays.length > 0) {
    const horizon = addDays(today, days);
    for (const exp of state.planned) {
      if (!exp.deferrable) continue;
      if (daysBetween(today, exp.date) < 0 || daysBetween(exp.date, horizon) < 0) continue;

      // Try pushing the expense to just after the next paycheck that follows
      // its current date; fall back to day-by-day within the window.
      const payAfter = nextPayday(state.pay, addDays(exp.date, 1));
      const candidates: string[] = [];
      if (daysBetween(exp.date, payAfter) > 0) candidates.push(addDays(payAfter, 1));
      for (let shift = 1; shift <= days; shift++) candidates.push(addDays(exp.date, shift));

      for (const newDate of candidates) {
        if (daysBetween(newDate, addDays(horizon, 14)) < 0) continue; // too far out
        const trial: FinanceState = {
          ...state,
          planned: state.planned.map((p) => (p.id === exp.id ? { ...p, date: newDate } : p)),
        };
        // Project far enough to include the deferred expense so the suggestion
        // is validated against its new landing date, not just the old window.
        const trialDays = Math.max(days, daysBetween(today, newDate));
        const trialPoints = projectBalances(trial, today, trialDays);
        if (trialPoints.every((p) => !p.belowBuffer)) {
          const trialMin = trialPoints.reduce((a, b) => (b.balance < a.balance ? b : a));
          suggestions.push({
            expense: exp,
            newDate,
            daysDeferred: daysBetween(exp.date, newDate),
            newMinBalance: trialMin.balance,
          });
          break;
        }
      }
    }
  }

  return {
    crunchDays,
    minBalance: min?.balance ?? state.currentBalance,
    minBalanceDate: min?.date ?? today,
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// 4. Arbitrage & Goal Optimizer — idle cash on payday
// ---------------------------------------------------------------------------

export function idleCash(state: FinanceState, today: string): IdleCashReport {
  const next = nextPayday(state.pay, addDays(today, 1));
  const daysAhead = Math.max(1, daysBetween(today, next));

  let mandatory = 0;
  for (let i = 1; i <= daysAhead; i++) {
    const date = addDays(today, i);
    for (const bill of state.bills) if (isDueOn(date, bill.dueDay)) mandatory += bill.amount;
    for (const exp of state.planned) if (exp.date === date) mandatory += exp.amount;
  }

  const pace = safeToSpend(state, today);
  const discretionaryReserved = pace.remaining;
  const idle = state.currentBalance - mandatory - discretionaryReserved - state.comfortBuffer;

  return {
    mandatoryAhead: Math.round(mandatory * 100) / 100,
    discretionaryReserved,
    idleCash: Math.round(Math.max(0, idle) * 100) / 100,
  };
}

/** Split idle cash across goals proportional to their remaining need. */
export function allocateIdleCash(idle: number, goals: Goal[]): { goal: Goal; amount: number }[] {
  const open = goals.filter((g) => g.target > g.saved);
  const totalNeed = open.reduce((s, g) => s + (g.target - g.saved), 0);
  if (idle <= 0 || totalNeed <= 0) return [];
  return open.map((goal) => ({
    goal,
    amount: Math.round(((goal.target - goal.saved) / totalNeed) * idle * 100) / 100,
  }));
}

// ---------------------------------------------------------------------------
// 5. Bill-Matching Optimization
// ---------------------------------------------------------------------------

/** A bill is "misaligned" when it lands in the back half of the pay cycle,
 * where the account is at its thinnest right before the next check. */
export function billAlignments(state: FinanceState, today: string): BillAlignment[] {
  const freq = Math.max(1, state.pay.frequencyDays);
  return state.bills.map((bill) => {
    // Find the bill's next due date.
    let due = today;
    for (let i = 0; i < 62; i++) {
      const c = addDays(today, i);
      if (isDueOn(c, bill.dueDay)) { due = c; break; }
    }
    const cycleStart = currentCycleStart(state.pay, due);
    const daysAfterPayday = daysBetween(cycleStart, due) % freq;
    const misaligned = daysAfterPayday >= Math.ceil(freq * 0.65);

    let suggestedDueDay: number | null = null;
    if (misaligned) {
      // Aim for 2 days after the payday that follows this due date.
      const target = addDays(nextPayday(state.pay, addDays(due, 1)), 2);
      suggestedDueDay = parseISO(target).getDate();
    }
    return { bill, daysAfterPayday, misaligned, suggestedDueDay };
  });
}

export function draftDueDateLetter(
  bill: Bill,
  suggestedDueDay: number,
  payFrequencyDays: number,
): string {
  const cadence = payFrequencyDays === 14 ? 'bi-weekly' : `every ${payFrequencyDays} days`;
  return `To Whom It May Concern,

I am writing to request a change to the monthly due date on my ${bill.name} account.

My due date currently falls on day ${bill.dueDay} of the month, which lands in the gap just before my ${cadence} paycheck arrives. To ensure consistent, on-time payments, I would like to request that my due date be moved to day ${suggestedDueDay} of the month, shortly after my pay is deposited.

I have maintained my account in good standing and this change would help me continue paying reliably and on time. Please let me know if any additional information or documentation is needed to process this request.

Thank you for your time and assistance.

Sincerely,
[Your name]
[Account number]
[Contact information]`;
}

// ---------------------------------------------------------------------------
// 6. Goals & What-If Sandbox
// ---------------------------------------------------------------------------

export function milestoneTimeline(
  goals: Goal[],
  today: string,
  extraMonthlyInjection = 0,
): Milestone[] {
  const open = goals.filter((g) => g.target > g.saved);
  const totalNeed = open.reduce((s, g) => s + (g.target - g.saved), 0);

  return goals.map((goal) => {
    const need = goal.target - goal.saved;
    if (need <= 0) return { goal, monthsRemaining: 0, projectedDate: today };

    // Extra injection splits across open goals proportional to remaining need.
    const share = totalNeed > 0 ? need / totalNeed : 0;
    const velocity = goal.monthlyContribution + extraMonthlyInjection * share;
    if (velocity <= 0) return { goal, monthsRemaining: null, projectedDate: null };

    const months = need / velocity;
    return {
      goal,
      monthsRemaining: Math.round(months * 10) / 10,
      projectedDate: addDays(today, Math.ceil(months * 30.44)),
    };
  });
}

export function hustleNetMonthly(hustles: SideHustle[]): number {
  return hustles.reduce((s, h) => s + (h.monthlyRevenue - h.monthlyCosts), 0);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'oj-home-finance-v1';

export function defaultFinanceState(today: string): FinanceState {
  return {
    currentBalance: 2400,
    comfortBuffer: 500,
    discretionaryPerCycle: 400,
    pay: { amount: 2100, nextPayDate: nextFridayFrom(today), frequencyDays: 14 },
    bills: [
      { id: 'b-mortgage', name: 'Mortgage', amount: 1450, dueDay: 1 },
      { id: 'b-electric', name: 'Electric', amount: 160, dueDay: 12 },
      { id: 'b-internet', name: 'Internet', amount: 80, dueDay: 20 },
      { id: 'b-auto', name: 'Auto insurance', amount: 140, dueDay: 25 },
    ],
    planned: [],
    spends: [],
    goals: [
      {
        id: 'g-reserve',
        name: 'Cash reserve',
        target: 5000,
        saved: 1200,
        monthlyContribution: 250,
      },
    ],
    hustles: [],
  };
}

function nextFridayFrom(today: string): string {
  let d = today;
  for (let i = 1; i <= 7; i++) {
    d = addDays(today, i);
    if (parseISO(d).getDay() === 5) return d;
  }
  return d;
}

export function loadFinanceState(today: string): FinanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFinanceState(today);
    const parsed = JSON.parse(raw) as Partial<FinanceState>;
    return { ...defaultFinanceState(today), ...parsed };
  } catch {
    return defaultFinanceState(today);
  }
}

export function saveFinanceState(state: FinanceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — the page keeps working in memory.
  }
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
