import { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  CalendarClock,
  Landmark,
  Plus,
  Trash2,
  Copy,
  Check,
  FlaskConical,
  Target,
  Hammer,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  FinanceState,
  DayPoint,
  Bill,
  loadFinanceState,
  saveFinanceState,
  toISO,
  addDays,
  parseISO,
  projectBalances,
  safeToSpend,
  liquidityGuard,
  idleCash,
  allocateIdleCash,
  billAlignments,
  draftDueDateLetter,
  milestoneTimeline,
  hustleNetMonthly,
  nextPayday,
  uid,
} from '../lib/finance';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtMoney(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmtMoneyCents(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDay(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDayLong(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

const STATUS_RED = '#f87171';
const STATUS_GREEN = '#34d399';
const STATUS_AMBER = '#f59e0b';

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg-tertiary)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
};

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl p-4 ${className}`}
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: typeof Wallet; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={15} style={{ color: 'var(--color-accent)' }} />
      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {sub && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</span>}
    </div>
  );
}

function NumField({
  label, value, onChange, step = 1, min,
}: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
        {label}
      </label>
      <input
        type="number"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
        className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
        style={inputStyle}
      />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
      style={{
        background: 'var(--color-accent-subtle)',
        color: 'var(--color-accent)',
        border: '1px solid var(--color-border)',
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy letter'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Delta Dip Visualizer
// ---------------------------------------------------------------------------

function DipTooltip({
  active, payload,
}: { active?: boolean; payload?: { payload: DayPoint }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
      }}
    >
      <div className="font-medium mb-1">{fmtDayLong(p.date)}</div>
      <div className="text-sm font-semibold" style={{ color: p.belowBuffer ? STATUS_RED : 'var(--color-text)' }}>
        {fmtMoney(p.balance)}
      </div>
      {p.events.map((ev, i) => (
        <div key={i} style={{ color: 'var(--color-text-secondary)' }}>{ev}</div>
      ))}
      {p.belowBuffer && (
        <div className="flex items-center gap-1 mt-1" style={{ color: STATUS_RED }}>
          <AlertTriangle size={10} /> Below comfort buffer
        </div>
      )}
    </div>
  );
}

function DipDot(props: {
  cx?: number; cy?: number; payload?: DayPoint;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?.belowBuffer) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="var(--color-bg-secondary)" />
      <circle cx={cx} cy={cy} r={4} fill={STATUS_RED} />
    </g>
  );
}

function DeltaDipChart({ points, buffer }: { points: DayPoint[]; buffer: number }) {
  const [showTable, setShowTable] = useState(false);
  const minY = Math.min(0, ...points.map((p) => p.balance), buffer);
  const maxY = Math.max(...points.map((p) => p.balance), buffer);
  // Snap the domain to clean $500 steps so the axis ticks read as round numbers.
  const yMin = Math.floor(minY / 500) * 500;
  const yMax = Math.ceil((maxY + Math.max(100, (maxY - minY) * 0.08)) / 500) * 500;
  const ticks: number[] = [];
  const step = Math.max(500, Math.ceil((yMax - yMin) / 5 / 500) * 500);
  for (let t = yMin; t <= yMax; t += step) ticks.push(t);

  return (
    <div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="var(--color-border)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDay}
              tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => `$${v.toLocaleString('en-US')}`}
              tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
              axisLine={false}
              tickLine={false}
              width={64}
              domain={[yMin, yMax]}
              ticks={ticks}
            />
            <Tooltip content={<DipTooltip />} cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }} />
            <ReferenceLine
              y={buffer}
              stroke={STATUS_AMBER}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              label={{
                value: `Comfort buffer ${fmtMoney(buffer)}`,
                position: 'insideTopRight',
                fontSize: 11,
                fill: 'var(--color-text-secondary)',
              }}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="none"
              fill="var(--color-accent)"
              fillOpacity={0.1}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="var(--color-accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={<DipDot />}
              activeDot={{ r: 5, stroke: 'var(--color-bg-secondary)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <button
        onClick={() => setShowTable((s) => !s)}
        className="flex items-center gap-1 text-xs mt-2"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {showTable ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Day-by-day table
      </button>
      {showTable && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <thead>
              <tr style={{ color: 'var(--color-text-tertiary)' }}>
                <th className="text-left py-1 pr-3 font-medium">Day</th>
                <th className="text-right py-1 pr-3 font-medium">Net</th>
                <th className="text-right py-1 pr-3 font-medium">Balance</th>
                <th className="text-left py-1 font-medium">Events</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {points.map((p) => (
                <tr key={p.date} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-1 pr-3">{fmtDayLong(p.date)}</td>
                  <td className="text-right py-1 pr-3">{p.delta === 0 ? '—' : fmtMoney(p.delta)}</td>
                  <td
                    className="text-right py-1 pr-3 font-medium"
                    style={{ color: p.belowBuffer ? STATUS_RED : 'var(--color-text)' }}
                  >
                    {fmtMoney(p.balance)}
                  </td>
                  <td className="py-1">{p.events.join(' · ') || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function HomeFinancePage() {
  const today = toISO(new Date());
  const [state, setState] = useState<FinanceState>(() => loadFinanceState(today));

  // Persist on every change.
  useEffect(() => {
    saveFinanceState(state);
  }, [state]);

  const patch = (p: Partial<FinanceState>) => setState((s) => ({ ...s, ...p }));

  // Derived engine outputs — all recompute instantly on any edit.
  const points = useMemo(() => projectBalances(state, today, 14), [state, today]);
  const pace = useMemo(() => safeToSpend(state, today), [state, today]);
  const guard = useMemo(() => liquidityGuard(state, today, 14), [state, today]);
  const idle = useMemo(() => idleCash(state, today), [state, today]);
  const idleAlloc = useMemo(() => allocateIdleCash(idle.idleCash, state.goals), [idle, state.goals]);
  const alignments = useMemo(() => billAlignments(state, today), [state, today]);

  // Sandbox (what-if) — never persisted into live tracking.
  const [sandboxOn, setSandboxOn] = useState(false);
  const [injectPct, setInjectPct] = useState(50);
  const hustleNet = hustleNetMonthly(state.hustles);
  const injection = sandboxOn ? Math.max(0, (hustleNet * injectPct) / 100) : 0;
  const liveMilestones = useMemo(() => milestoneTimeline(state.goals, today), [state.goals, today]);
  const sandboxMilestones = useMemo(
    () => milestoneTimeline(state.goals, today, injection),
    [state.goals, today, injection],
  );

  // Quick spend logging
  const [spendAmount, setSpendAmount] = useState('');
  const [spendNote, setSpendNote] = useState('');
  const logSpend = () => {
    const amount = parseFloat(spendAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    patch({
      spends: [
        ...state.spends,
        { id: uid('s'), amount, date: today, note: spendNote.trim() },
      ],
    });
    setSpendAmount('');
    setSpendNote('');
  };

  // Letter drafting
  const [openLetterBillId, setOpenLetterBillId] = useState<string | null>(null);

  const misalignedCount = alignments.filter((a) => a.misaligned).length;
  const crunch = guard.crunchDays;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="p-2 rounded-lg"
              style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-border)' }}
            >
              <Wallet size={20} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                Home Finance
              </h1>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Soloman V2 · Paycheck-to-paycheck friction forecast & agent money management
              </p>
            </div>
          </div>
          <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Every expense is mapped to a calendar day inside your bi-weekly pay cycle. Soloman V2
            projects the next 14 days, flags liquidity dips before they happen, paces your
            discretionary spending, and routes idle cash toward your goals.
          </p>
        </header>

        {/* Money snapshot */}
        <Card className="mb-6">
          <SectionTitle icon={Landmark} title="Money Snapshot" sub="the inputs everything else is computed from" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <NumField label="Current balance ($)" value={state.currentBalance}
              onChange={(v) => patch({ currentBalance: v })} step={10} />
            <NumField label="Comfort buffer ($)" value={state.comfortBuffer}
              onChange={(v) => patch({ comfortBuffer: v })} step={10} min={0} />
            <NumField label="Paycheck (net $)" value={state.pay.amount}
              onChange={(v) => patch({ pay: { ...state.pay, amount: v } })} step={10} min={0} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
                Next pay date
              </label>
              <input
                type="date"
                value={nextPayday(state.pay, addDays(today, 1))}
                onChange={(e) => e.target.value && patch({ pay: { ...state.pay, nextPayDate: e.target.value } })}
                className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <NumField label="Discretionary / cycle ($)" value={state.discretionaryPerCycle}
              onChange={(v) => patch({ discretionaryPerCycle: v })} step={10} min={0} />
          </div>
        </Card>

        {/* Delta Dip Visualizer */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon={TrendingUp} title="Delta Dip Visualizer" sub="14-day projected balance" />
            {crunch.length === 0 ? (
              <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: `${STATUS_GREEN}20`, color: STATUS_GREEN, border: `1px solid ${STATUS_GREEN}40` }}>
                <ShieldCheck size={11} /> Clear
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: `${STATUS_RED}20`, color: STATUS_RED, border: `1px solid ${STATUS_RED}40` }}>
                <AlertTriangle size={11} /> {crunch.length} crunch day{crunch.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <DeltaDipChart points={points} buffer={state.comfortBuffer} />

          {crunch.length > 0 && (
            <div
              className="rounded-lg px-3 py-2 mt-3 text-xs flex items-start gap-2"
              style={{ background: `${STATUS_RED}12`, border: `1px solid ${STATUS_RED}40` }}
            >
              <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: STATUS_RED }} />
              <div style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                  Liquidity drops below your {fmtMoney(state.comfortBuffer)} buffer on{' '}
                  {crunch.map((c) => fmtDayLong(c.date)).join(', ')}.
                </span>{' '}
                Lowest point: {fmtMoney(guard.minBalance)} on {fmtDayLong(guard.minBalanceDate)}.
                See the Liquidity Guard below for a way out.
              </div>
            </div>
          )}
        </Card>

        {/* Safe to Spend + Liquidity Guard */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Safe to Spend */}
          <Card>
            <SectionTitle icon={CalendarClock} title="Safe to Spend" sub="dynamic pace, not a fixed budget" />
            <div className="flex items-end gap-2 mb-1">
              <span className="text-3xl font-semibold" style={{ color: 'var(--color-text)' }}>
                {fmtMoneyCents(pace.dailyAllowance)}
              </span>
              <span className="text-xs mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                / day for the next {pace.daysLeft} day{pace.daysLeft > 1 ? 's' : ''}
              </span>
            </div>
            <div className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {fmtMoney(pace.remaining)} of {fmtMoney(state.discretionaryPerCycle)} left this cycle
              ({fmtDay(pace.cycleStart)} → {fmtDay(pace.cycleEnd)}) ·
              weekly pace {fmtMoney(pace.weeklyAllowance)}
            </div>

            {/* progress bar */}
            <div className="h-2 rounded-full overflow-hidden mb-4"
              style={{ background: 'var(--color-bg-tertiary)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (pace.spentThisCycle / Math.max(1, state.discretionaryPerCycle)) * 100)}%`,
                  background: pace.remaining === 0 ? STATUS_RED : 'var(--color-accent)',
                }}
              />
            </div>

            {/* Log a spend */}
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" step="0.01" placeholder="$ amount"
                value={spendAmount}
                onChange={(e) => setSpendAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && logSpend()}
                className="rounded-lg px-3 py-1.5 text-sm outline-none w-28"
                style={inputStyle}
              />
              <input
                type="text" placeholder="What was it?"
                value={spendNote}
                onChange={(e) => setSpendNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && logSpend()}
                className="rounded-lg px-3 py-1.5 text-sm outline-none flex-1"
                style={inputStyle}
              />
              <button
                onClick={logSpend}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--color-accent)', color: '#fff' }}
              >
                Log spend
              </button>
            </div>
            <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              Logging a spend immediately recalculates the daily allowance for the rest of the cycle.
            </div>

            {state.spends.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 max-h-32 overflow-y-auto">
                {[...state.spends].reverse().slice(0, 8).map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="font-medium" style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoneyCents(s.amount)}
                    </span>
                    <span className="truncate">{s.note || 'spend'}</span>
                    <span className="ml-auto shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmtDay(s.date)}
                    </span>
                    <button
                      onClick={() => patch({ spends: state.spends.filter((x) => x.id !== s.id) })}
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Liquidity Guard agent */}
          <Card>
            <SectionTitle icon={ShieldCheck} title="Liquidity Guard" sub="agent · watches for crunch days" />

            {crunch.length === 0 ? (
              <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-3"
                style={{ background: `${STATUS_GREEN}12`, border: `1px solid ${STATUS_GREEN}40`, color: 'var(--color-text-secondary)' }}>
                <ShieldCheck size={13} className="shrink-0 mt-0.5" style={{ color: STATUS_GREEN }} />
                <span>
                  All clear — the projected balance stays above your buffer for the next 14 days.
                  Lowest point: {fmtMoney(guard.minBalance)} on {fmtDayLong(guard.minBalanceDate)}.
                </span>
              </div>
            ) : guard.suggestions.length > 0 ? (
              <div className="flex flex-col gap-2 mb-3">
                {guard.suggestions.map((s) => (
                  <div key={s.expense.id} className="rounded-lg px-3 py-2 text-xs"
                    style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-start gap-2">
                      <Sparkles size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
                      <div style={{ color: 'var(--color-text-secondary)' }}>
                        If we defer <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {s.expense.name}</span> ({fmtMoney(s.expense.amount)}) by{' '}
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {s.daysDeferred} day{s.daysDeferred > 1 ? 's' : ''}
                        </span>{' '}
                        to {fmtDayLong(s.newDate)}, the balance stays above your buffer
                        (new low: {fmtMoney(s.newMinBalance)}).
                      </div>
                    </div>
                    <button
                      onClick={() => patch({
                        planned: state.planned.map((p) =>
                          p.id === s.expense.id ? { ...p, date: s.newDate } : p),
                      })}
                      className="mt-2 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold"
                      style={{ background: 'var(--color-accent)', color: '#fff' }}
                    >
                      Apply deferral <ArrowRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-3"
                style={{ background: `${STATUS_RED}12`, border: `1px solid ${STATUS_RED}40`, color: 'var(--color-text-secondary)' }}>
                <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: STATUS_RED }} />
                <span>
                  Crunch detected but no deferrable expense can clear it. Consider trimming
                  discretionary spending or moving a bill date (see Bill-Matching below).
                </span>
              </div>
            )}

            {/* Planned variable expenses */}
            <div className="text-xs font-semibold uppercase tracking-wide mb-2"
              style={{ color: 'var(--color-text-tertiary)' }}>
              Planned variable expenses
            </div>
            {state.planned.length === 0 && (
              <div className="text-xs mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                None yet — add upcoming one-off spends (hardware store run, vet visit…) so the
                guard can watch and re-schedule them.
              </div>
            )}
            <div className="flex flex-col gap-1.5 mb-2">
              {state.planned.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5"
                  style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => patch({
                      planned: state.planned.map((x) => x.id === p.id ? { ...x, name: e.target.value } : x),
                    })}
                    className="rounded-md px-2 py-1 outline-none font-medium min-w-0 flex-1"
                    style={{ ...inputStyle, background: 'var(--color-bg-secondary)' }}
                  />
                  <input
                    type="number" min="0" value={p.amount}
                    onChange={(e) => patch({
                      planned: state.planned.map((x) => x.id === p.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x),
                    })}
                    className="rounded-md px-2 py-1 outline-none w-20 text-right"
                    style={{ ...inputStyle, background: 'var(--color-bg-secondary)' }}
                  />
                  <input
                    type="date"
                    value={p.date}
                    onChange={(e) => e.target.value && patch({
                      planned: state.planned.map((x) => x.id === p.id ? { ...x, date: e.target.value } : x),
                    })}
                    className="rounded-md px-1.5 py-0.5 outline-none"
                    style={{ ...inputStyle, background: 'var(--color-bg-secondary)' }}
                  />
                  <label className="flex items-center gap-1 ml-auto shrink-0 cursor-pointer"
                    style={{ color: 'var(--color-text-tertiary)' }}>
                    <input
                      type="checkbox"
                      checked={p.deferrable}
                      onChange={(e) => patch({
                        planned: state.planned.map((x) => x.id === p.id ? { ...x, deferrable: e.target.checked } : x),
                      })}
                    />
                    deferrable
                  </label>
                  <button
                    onClick={() => patch({ planned: state.planned.filter((x) => x.id !== p.id) })}
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => patch({
                planned: [...state.planned, {
                  id: uid('p'), name: 'New expense', amount: 100,
                  date: addDays(today, 3), deferrable: true,
                }],
              })}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
              style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}
            >
              <Plus size={11} /> Add planned expense
            </button>
          </Card>
        </div>

        {/* Bills + Bill-Matching Optimization */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon={Landmark} title="Bill-Matching Optimization"
              sub="align due dates with your alternating pay weeks" />
            {misalignedCount > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: `${STATUS_AMBER}20`, color: STATUS_AMBER, border: `1px solid ${STATUS_AMBER}40` }}>
                <AlertTriangle size={11} /> {misalignedCount} misaligned
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-tertiary)' }}>
                  <th className="text-left py-1.5 pr-3 font-medium">Bill</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Amount</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Due day</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Cycle position</th>
                  <th className="text-left py-1.5 font-medium">Action</th>
                  <th />
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                {alignments.map(({ bill, daysAfterPayday, misaligned, suggestedDueDay }) => (
                  <tr key={bill.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="py-2 pr-3">
                      <input
                        type="text" value={bill.name}
                        onChange={(e) => patch({
                          bills: state.bills.map((b) => b.id === bill.id ? { ...b, name: e.target.value } : b),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-full max-w-40"
                        style={inputStyle}
                      />
                    </td>
                    <td className="text-right py-2 pr-3">
                      <input
                        type="number" min="0" value={bill.amount}
                        onChange={(e) => patch({
                          bills: state.bills.map((b) => b.id === bill.id ? { ...b, amount: parseFloat(e.target.value) || 0 } : b),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-20 text-right"
                        style={inputStyle}
                      />
                    </td>
                    <td className="text-right py-2 pr-3">
                      <input
                        type="number" min="1" max="31" value={bill.dueDay}
                        onChange={(e) => patch({
                          bills: state.bills.map((b) => b.id === bill.id
                            ? { ...b, dueDay: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) } : b),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-14 text-right"
                        style={inputStyle}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-1.5"
                        style={{ color: misaligned ? STATUS_AMBER : 'var(--color-text-secondary)' }}>
                        {misaligned && <AlertTriangle size={11} />}
                        day {daysAfterPayday + 1} of {state.pay.frequencyDays}
                        {misaligned ? ' — lands in the tight week' : ''}
                      </span>
                    </td>
                    <td className="py-2">
                      {misaligned && suggestedDueDay != null ? (
                        <button
                          onClick={() => setOpenLetterBillId(openLetterBillId === bill.id ? null : bill.id)}
                          className="px-2 py-1 rounded-md text-xs font-medium"
                          style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}
                        >
                          {openLetterBillId === bill.id ? 'Hide letter' : `Draft letter → day ${suggestedDueDay}`}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => patch({ bills: state.bills.filter((b) => b.id !== bill.id) })}
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => patch({
              bills: [...state.bills, { id: uid('b'), name: 'New bill', amount: 50, dueDay: 15 }],
            })}
            className="mt-3 flex items-center gap-1 text-xs px-2 py-1 rounded-md"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}
          >
            <Plus size={11} /> Add bill
          </button>

          {openLetterBillId && (() => {
            const a = alignments.find((x) => x.bill.id === openLetterBillId);
            if (!a || a.suggestedDueDay == null) return null;
            const letter = draftDueDateLetter(a.bill, a.suggestedDueDay, state.pay.frequencyDays);
            return (
              <div className="mt-4 rounded-lg p-3"
                style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                    Due-date change request — {a.bill.name}
                  </span>
                  <CopyButton text={letter} />
                </div>
                <pre className="text-xs whitespace-pre-wrap leading-relaxed"
                  style={{ color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>
                  {letter}
                </pre>
              </div>
            );
          })()}
        </Card>

        {/* Arbitrage & Goal Optimizer */}
        <Card className="mb-6">
          <SectionTitle icon={TrendingUp} title="Arbitrage & Goal Optimizer"
            sub="agent · routes idle cash the day a paycheck lands" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="rounded-lg px-3 py-2.5"
              style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Mandatory before next check ({fmtDay(nextPayday(state.pay, addDays(today, 1)))})
              </div>
              <div className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {fmtMoney(idle.mandatoryAhead)}
              </div>
            </div>
            <div className="rounded-lg px-3 py-2.5"
              style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Reserved (discretionary + buffer)
              </div>
              <div className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                {fmtMoney(idle.discretionaryReserved + state.comfortBuffer)}
              </div>
            </div>
            <div className="rounded-lg px-3 py-2.5"
              style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Idle cash — safe to route today
              </div>
              <div className="text-lg font-semibold" style={{ color: 'var(--color-accent)' }}>
                {fmtMoney(idle.idleCash)}
              </div>
            </div>
          </div>

          {idle.idleCash > 0 && idleAlloc.length > 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                Suggested routing (proportional to remaining need):
              </span>
              <div className="flex flex-wrap gap-2 mt-2">
                {idleAlloc.map(({ goal, amount }) => (
                  <span key={goal.id} className="px-2.5 py-1 rounded-full flex items-center gap-1.5"
                    style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
                    <Target size={11} style={{ color: 'var(--color-accent)' }} />
                    <span style={{ color: 'var(--color-text)' }}>{goal.name}</span>
                    <span className="font-semibold" style={{ color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(amount)}
                    </span>
                  </span>
                ))}
              </div>
              <div className="mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Move it to a high-yield account or savings bucket on day one — money that sits in
                checking gets accidentally spent.
              </div>
            </div>
          ) : (
            <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {idle.idleCash <= 0
                ? 'No idle cash right now — everything in checking is spoken for by bills, the discretionary allowance, or your buffer.'
                : 'Add a goal below so the optimizer knows where to route idle cash.'}
            </div>
          )}
        </Card>

        {/* Goals + What-If Sandbox */}
        <Card className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon={Target} title="Goals & Milestone Timelines" sub="driven by your actual savings velocity" />
            <button
              onClick={() => setSandboxOn((s) => !s)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={sandboxOn
                ? { background: 'var(--color-accent)', color: '#fff' }
                : { background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
            >
              <FlaskConical size={12} />
              {sandboxOn ? 'Sandbox ON — live data untouched' : 'What-If Sandbox'}
            </button>
          </div>

          {/* Goal rows */}
          <div className="flex flex-col gap-3 mb-4">
            {state.goals.map((g) => {
              const live = liveMilestones.find((m) => m.goal.id === g.id);
              const boosted = sandboxMilestones.find((m) => m.goal.id === g.id);
              const pct = Math.min(100, (g.saved / Math.max(1, g.target)) * 100);
              return (
                <div key={g.id} className="rounded-lg p-3"
                  style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
                  <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                    <input
                      type="text" value={g.name}
                      onChange={(e) => patch({
                        goals: state.goals.map((x) => x.id === g.id ? { ...x, name: e.target.value } : x),
                      })}
                      className="rounded-md px-2 py-1 outline-none font-medium"
                      style={{ ...inputStyle, background: 'var(--color-bg-secondary)', width: 160 }}
                    />
                    <label className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      saved
                      <input type="number" min="0" value={g.saved}
                        onChange={(e) => patch({
                          goals: state.goals.map((x) => x.id === g.id ? { ...x, saved: parseFloat(e.target.value) || 0 } : x),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-22 text-right"
                        style={{ ...inputStyle, background: 'var(--color-bg-secondary)' }} />
                    </label>
                    <label className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      of
                      <input type="number" min="0" value={g.target}
                        onChange={(e) => patch({
                          goals: state.goals.map((x) => x.id === g.id ? { ...x, target: parseFloat(e.target.value) || 0 } : x),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-22 text-right"
                        style={{ ...inputStyle, background: 'var(--color-bg-secondary)' }} />
                    </label>
                    <label className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      $/month
                      <input type="number" min="0" value={g.monthlyContribution}
                        onChange={(e) => patch({
                          goals: state.goals.map((x) => x.id === g.id ? { ...x, monthlyContribution: parseFloat(e.target.value) || 0 } : x),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-20 text-right"
                        style={{ ...inputStyle, background: 'var(--color-bg-secondary)' }} />
                    </label>
                    <button
                      onClick={() => patch({ goals: state.goals.filter((x) => x.id !== g.id) })}
                      className="ml-auto" style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <div className="h-2 rounded-full overflow-hidden mb-2"
                    style={{ background: 'var(--color-bg-secondary)' }}>
                    <div className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: 'var(--color-accent)' }} />
                  </div>

                  <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-1"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(g.saved)} / {fmtMoney(g.target)}
                    </span>
                    {live?.projectedDate ? (
                      <span className="flex items-center gap-1">
                        <CalendarClock size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                        on pace for <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {fmtDayLong(live.projectedDate)}</span>
                        ({live.monthsRemaining} mo)
                      </span>
                    ) : live?.monthsRemaining === 0 ? (
                      <span style={{ color: STATUS_GREEN }}>funded ✓</span>
                    ) : (
                      <span className="flex items-center gap-1" style={{ color: STATUS_AMBER }}>
                        <AlertTriangle size={11} /> no savings velocity — timeline stalled
                      </span>
                    )}
                    {sandboxOn && boosted?.projectedDate && live?.projectedDate
                      && boosted.projectedDate !== live.projectedDate && (
                      <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--color-accent)' }}>
                        <FlaskConical size={11} />
                        sandbox: {fmtDayLong(boosted.projectedDate)} ({boosted.monthsRemaining} mo)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => patch({
              goals: [...state.goals, {
                id: uid('g'), name: 'New goal', target: 1000, saved: 0, monthlyContribution: 100,
              }],
            })}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md mb-2"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}
          >
            <Plus size={11} /> Add goal
          </button>

          {/* Sandbox: side-hustle injection */}
          {sandboxOn && (
            <div className="mt-4 rounded-lg p-4"
              style={{ background: 'var(--color-accent-subtle)', border: '1px dashed var(--color-accent)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Hammer size={14} style={{ color: 'var(--color-accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Side-Hustle Injection — sandbox only
                </span>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Track business cash flows separately, then simulate routing a share of net profit
                into your goals. Nothing here changes your live tracking until you raise the real
                monthly contributions above.
              </p>

              <div className="flex flex-col gap-1.5 mb-3">
                {state.hustles.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-2 text-xs rounded-lg px-2.5 py-1.5"
                    style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <input
                      type="text" value={h.name}
                      onChange={(e) => patch({
                        hustles: state.hustles.map((x) => x.id === h.id ? { ...x, name: e.target.value } : x),
                      })}
                      className="rounded-md px-2 py-1 outline-none font-medium"
                      style={{ ...inputStyle, width: 140 }}
                    />
                    <label className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      revenue/mo
                      <input type="number" min="0" value={h.monthlyRevenue}
                        onChange={(e) => patch({
                          hustles: state.hustles.map((x) => x.id === h.id ? { ...x, monthlyRevenue: parseFloat(e.target.value) || 0 } : x),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-22 text-right" style={inputStyle} />
                    </label>
                    <label className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      costs/mo (materials, depreciation…)
                      <input type="number" min="0" value={h.monthlyCosts}
                        onChange={(e) => patch({
                          hustles: state.hustles.map((x) => x.id === h.id ? { ...x, monthlyCosts: parseFloat(e.target.value) || 0 } : x),
                        })}
                        className="rounded-md px-2 py-1 outline-none w-22 text-right" style={inputStyle} />
                    </label>
                    <span className="ml-auto font-medium" style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                      net {fmtMoney(h.monthlyRevenue - h.monthlyCosts)}/mo
                    </span>
                    <button
                      onClick={() => patch({ hustles: state.hustles.filter((x) => x.id !== h.id) })}
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => patch({
                  hustles: [...state.hustles, {
                    id: uid('h'), name: 'New venture', monthlyRevenue: 500, monthlyCosts: 200,
                  }],
                })}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md mb-3"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}
              >
                <Plus size={11} /> Add business cash flow
              </button>

              <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span>
                  Inject <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{injectPct}%</span>{' '}
                  of {fmtMoney(hustleNet)}/mo net profit →{' '}
                  <span className="font-semibold" style={{ color: 'var(--color-accent)' }}>
                    +{fmtMoney(injection)}/mo
                  </span>{' '}
                  across open goals
                </span>
              </div>
              <input
                type="range" min="0" max="100" step="5"
                value={injectPct}
                onChange={(e) => setInjectPct(parseInt(e.target.value))}
                className="w-full mt-2"
                style={{ accentColor: 'var(--color-accent)' }}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
