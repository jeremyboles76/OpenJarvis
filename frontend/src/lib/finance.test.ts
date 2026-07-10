import { describe, it, expect } from 'vitest';
import {
  FinanceState,
  addDays,
  daysBetween,
  paydaysInRange,
  currentCycleStart,
  nextPayday,
  projectBalances,
  safeToSpend,
  liquidityGuard,
  idleCash,
  allocateIdleCash,
  billAlignments,
  draftDueDateLetter,
  milestoneTimeline,
  hustleNetMonthly,
} from './finance';

const TODAY = '2026-07-10'; // Friday

function baseState(overrides: Partial<FinanceState> = {}): FinanceState {
  return {
    currentBalance: 2000,
    comfortBuffer: 500,
    discretionaryPerCycle: 280,
    pay: { amount: 2100, nextPayDate: '2026-07-17', frequencyDays: 14 },
    bills: [],
    planned: [],
    spends: [],
    goals: [],
    hustles: [],
    ...overrides,
  };
}

describe('date helpers', () => {
  it('addDays crosses month boundaries', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('daysBetween is signed', () => {
    expect(daysBetween('2026-07-10', '2026-07-17')).toBe(7);
    expect(daysBetween('2026-07-17', '2026-07-10')).toBe(-7);
  });
});

describe('pay-cycle helpers', () => {
  const pay = { amount: 2100, nextPayDate: '2026-07-17', frequencyDays: 14 };

  it('finds paydays inside a range', () => {
    expect(paydaysInRange(pay, '2026-07-10', '2026-08-10')).toEqual([
      '2026-07-17',
      '2026-07-31',
    ]);
  });

  it('finds past paydays when nextPayDate is ahead', () => {
    expect(paydaysInRange(pay, '2026-06-01', '2026-07-10')).toEqual([
      '2026-06-05',
      '2026-06-19',
      '2026-07-03',
    ]);
  });

  it('currentCycleStart returns the most recent payday', () => {
    expect(currentCycleStart(pay, '2026-07-10')).toBe('2026-07-03');
    expect(currentCycleStart(pay, '2026-07-17')).toBe('2026-07-17');
    // Stale nextPayDate in the past still resolves correctly.
    const stale = { ...pay, nextPayDate: '2026-06-05' };
    expect(currentCycleStart(stale, '2026-07-10')).toBe('2026-07-03');
  });

  it('nextPayday returns the first payday on/after the given day', () => {
    expect(nextPayday(pay, '2026-07-10')).toBe('2026-07-17');
    expect(nextPayday(pay, '2026-07-17')).toBe('2026-07-17');
    expect(nextPayday(pay, '2026-07-18')).toBe('2026-07-31');
  });
});

describe('projectBalances (Delta Dip)', () => {
  it('applies paychecks and bills on the right calendar days', () => {
    const state = baseState({
      bills: [{ id: 'b1', name: 'Mortgage', amount: 1450, dueDay: 15 }],
    });
    const points = projectBalances(state, TODAY, 14);
    expect(points).toHaveLength(14);

    const jul15 = points.find((p) => p.date === '2026-07-15')!;
    expect(jul15.delta).toBe(-1450);
    expect(jul15.balance).toBe(550); // 2000 − 1450

    const jul17 = points.find((p) => p.date === '2026-07-17')!;
    expect(jul17.delta).toBe(2100);
    expect(jul17.balance).toBe(2650);
  });

  it('flags days that dip below the comfort buffer', () => {
    const state = baseState({
      bills: [{ id: 'b1', name: 'Mortgage', amount: 1700, dueDay: 15 }],
    });
    const points = projectBalances(state, TODAY, 14);
    // 2000 − 1700 = 300 < 500 buffer on Jul 15–16, recovers with Jul 17 check.
    expect(points.find((p) => p.date === '2026-07-15')!.belowBuffer).toBe(true);
    expect(points.find((p) => p.date === '2026-07-16')!.belowBuffer).toBe(true);
    expect(points.find((p) => p.date === '2026-07-17')!.belowBuffer).toBe(false);
  });

  it('clamps due days past the end of short months', () => {
    const state = baseState({
      currentBalance: 5000,
      pay: { amount: 2100, nextPayDate: '2026-02-06', frequencyDays: 14 },
      bills: [{ id: 'b1', name: 'Rent', amount: 100, dueDay: 31 }],
    });
    const points = projectBalances(state, '2026-02-20', 14);
    const feb28 = points.find((p) => p.date === '2026-02-28')!;
    expect(feb28.delta).toBe(-100);
  });
});

describe('safeToSpend pace', () => {
  it('divides the remaining budget over the remaining days', () => {
    // Cycle: Jul 3 → Jul 17. Today Jul 10 → 7 days left.
    const state = baseState({ discretionaryPerCycle: 280 });
    const pace = safeToSpend(state, TODAY);
    expect(pace.cycleStart).toBe('2026-07-03');
    expect(pace.cycleEnd).toBe('2026-07-17');
    expect(pace.daysLeft).toBe(7);
    expect(pace.dailyAllowance).toBe(40);
  });

  it('drops the daily allowance immediately after early-cycle spending', () => {
    const state = baseState({
      discretionaryPerCycle: 280,
      spends: [{ id: 's1', amount: 100, date: '2026-07-05', note: 'takeout' }],
    });
    const pace = safeToSpend(state, TODAY);
    expect(pace.spentThisCycle).toBe(100);
    expect(pace.remaining).toBe(180);
    expect(pace.dailyAllowance).toBeCloseTo(180 / 7, 2);
  });

  it('ignores spends from previous cycles and never goes negative', () => {
    const state = baseState({
      discretionaryPerCycle: 280,
      spends: [
        { id: 's0', amount: 999, date: '2026-06-20', note: 'last cycle' },
        { id: 's1', amount: 400, date: '2026-07-08', note: 'blowout' },
      ],
    });
    const pace = safeToSpend(state, TODAY);
    expect(pace.spentThisCycle).toBe(400);
    expect(pace.remaining).toBe(0);
    expect(pace.dailyAllowance).toBe(0);
  });
});

describe('liquidityGuard', () => {
  it('reports no crunch when the projection stays above the buffer', () => {
    const report = liquidityGuard(baseState(), TODAY);
    expect(report.crunchDays).toHaveLength(0);
    expect(report.suggestions).toHaveLength(0);
  });

  it('suggests deferring a deferrable expense past the crunch', () => {
    const state = baseState({
      currentBalance: 900,
      planned: [
        {
          id: 'p1',
          name: 'Hardware store run',
          amount: 600,
          date: '2026-07-13',
          deferrable: true,
        },
      ],
    });
    const report = liquidityGuard(state, TODAY);
    // 900 − 600 = 300 < 500 on Jul 13 → crunch.
    expect(report.crunchDays.length).toBeGreaterThan(0);
    expect(report.suggestions).toHaveLength(1);
    const s = report.suggestions[0];
    expect(s.expense.id).toBe('p1');
    // Deferred to after the Jul 17 paycheck.
    expect(daysBetween('2026-07-17', s.newDate)).toBeGreaterThan(0);
    expect(s.newMinBalance).toBeGreaterThanOrEqual(500);
  });

  it('does not suggest moving non-deferrable expenses', () => {
    const state = baseState({
      currentBalance: 900,
      planned: [
        { id: 'p1', name: 'Medication', amount: 600, date: '2026-07-13', deferrable: false },
      ],
    });
    const report = liquidityGuard(state, TODAY);
    expect(report.crunchDays.length).toBeGreaterThan(0);
    expect(report.suggestions).toHaveLength(0);
  });
});

describe('idleCash (Arbitrage & Goal Optimizer)', () => {
  it('routes only what is left after mandatory, discretionary, and buffer', () => {
    // Payday scenario: today is Jul 17, balance includes the fresh check.
    const state = baseState({
      currentBalance: 3500,
      pay: { amount: 2100, nextPayDate: '2026-07-17', frequencyDays: 14 },
      bills: [{ id: 'b1', name: 'Electric', amount: 200, dueDay: 25 }],
      discretionaryPerCycle: 280,
    });
    const report = idleCash(state, '2026-07-17');
    expect(report.mandatoryAhead).toBe(200);
    expect(report.discretionaryReserved).toBe(280);
    // 3500 − 200 − 280 − 500 buffer = 2520
    expect(report.idleCash).toBe(2520);
  });

  it('never reports negative idle cash', () => {
    const state = baseState({ currentBalance: 400 });
    expect(idleCash(state, TODAY).idleCash).toBe(0);
  });

  it('allocates idle cash proportional to remaining goal need', () => {
    const goals = [
      { id: 'g1', name: 'Reserve', target: 1000, saved: 0, monthlyContribution: 100 },
      { id: 'g2', name: 'Project', target: 4000, saved: 1000, monthlyContribution: 100 },
      { id: 'g3', name: 'Done', target: 500, saved: 500, monthlyContribution: 0 },
    ];
    const alloc = allocateIdleCash(400, goals);
    expect(alloc).toHaveLength(2);
    expect(alloc[0].amount).toBe(100); // 1000/4000 of 400
    expect(alloc[1].amount).toBe(300); // 3000/4000 of 400
  });
});

describe('billAlignments + letter drafting', () => {
  it('flags bills landing late in the pay cycle', () => {
    // Paydays Jul 3 / Jul 17 / Jul 31. Bill due Jul 15 is day 12 of 14 → tight.
    const state = baseState({
      bills: [
        { id: 'b1', name: 'Mortgage', amount: 1450, dueDay: 15 },
        { id: 'b2', name: 'Internet', amount: 80, dueDay: 20 },
      ],
    });
    const [mortgage, internet] = billAlignments(state, TODAY);
    expect(mortgage.daysAfterPayday).toBe(12);
    expect(mortgage.misaligned).toBe(true);
    expect(mortgage.suggestedDueDay).not.toBeNull();
    // Jul 20 is day 3 after the Jul 17 payday → comfortable.
    expect(internet.daysAfterPayday).toBe(3);
    expect(internet.misaligned).toBe(false);
  });

  it('drafts a due-date change letter with the key details', () => {
    const letter = draftDueDateLetter(
      { id: 'b1', name: 'Mortgage', amount: 1450, dueDay: 15 },
      19,
      14,
    );
    expect(letter).toContain('Mortgage');
    expect(letter).toContain('day 15');
    expect(letter).toContain('day 19');
    expect(letter).toContain('bi-weekly');
  });
});

describe('milestoneTimeline + sandbox', () => {
  it('projects completion dates from savings velocity', () => {
    const goals = [
      { id: 'g1', name: 'Project fund', target: 6000, saved: 1000, monthlyContribution: 500 },
    ];
    const [m] = milestoneTimeline(goals, TODAY);
    expect(m.monthsRemaining).toBe(10); // 5000 / 500
    expect(m.projectedDate).not.toBeNull();
  });

  it('accelerates the timeline with a side-hustle injection', () => {
    const goals = [
      { id: 'g1', name: 'Project fund', target: 6000, saved: 1000, monthlyContribution: 500 },
    ];
    const [live] = milestoneTimeline(goals, TODAY);
    const [boosted] = milestoneTimeline(goals, TODAY, 500);
    expect(boosted.monthsRemaining).toBe(5); // 5000 / 1000
    expect(daysBetween(boosted.projectedDate!, live.projectedDate!)).toBeGreaterThan(0);
  });

  it('handles zero velocity and completed goals', () => {
    const goals = [
      { id: 'g1', name: 'Stalled', target: 1000, saved: 0, monthlyContribution: 0 },
      { id: 'g2', name: 'Done', target: 1000, saved: 1000, monthlyContribution: 100 },
    ];
    const [stalled, done] = milestoneTimeline(goals, TODAY);
    expect(stalled.monthsRemaining).toBeNull();
    expect(stalled.projectedDate).toBeNull();
    expect(done.monthsRemaining).toBe(0);
  });

  it('computes net monthly side-hustle distributions', () => {
    expect(
      hustleNetMonthly([
        { id: 'h1', name: 'Sawmill', monthlyRevenue: 900, monthlyCosts: 300 },
        { id: 'h2', name: 'Welding', monthlyRevenue: 400, monthlyCosts: 150 },
      ]),
    ).toBe(850);
  });
});
