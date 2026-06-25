import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Play,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { getBase, authHeaders } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TradeRun {
  run_id?: string;
  id?: string;
  market_context: string;
  agent_response: string;
  model: string;
  max_risk_pct: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function runAnalysis(
  marketContext: string,
  model: string,
  maxRiskPct: number,
): Promise<TradeRun> {
  const res = await fetch(`${getBase()}/v1/solomon-trading/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ market_context: marketContext, model, max_risk_pct: maxRiskPct }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

async function fetchHistory(): Promise<TradeRun[]> {
  const res = await fetch(`${getBase()}/v1/solomon-trading/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
}

// ---------------------------------------------------------------------------
// History row
// ---------------------------------------------------------------------------

function HistoryRow({ run }: { run: TradeRun }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Activity size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
            {run.market_context}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-3 flex-shrink-0">
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {new Date(run.created_at * 1000).toLocaleString()}
          </span>
          {open
            ? <ChevronUp size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            : <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex gap-4 mt-3 mb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="flex items-center gap-1">
              <DollarSign size={10} /> Max risk: {(run.max_risk_pct * 100).toFixed(1)}%
            </span>
            <span>Model: {run.model}</span>
          </div>
          <pre
            className="text-sm whitespace-pre-wrap rounded-lg p-3"
            style={{
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            }}
          >
            {run.agent_response}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SolomonTradingPage() {
  const [marketContext, setMarketContext] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [maxRiskPct, setMaxRiskPct] = useState(0.02);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TradeRun | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [history, setHistory] = useState<TradeRun[]>([]);

  useEffect(() => {
    fetchHistory().then(setHistory).catch(() => {});
  }, []);

  async function handleRun() {
    if (!marketContext.trim()) return;
    setRunning(true);
    setResult(null);
    setErrorMsg('');
    try {
      const r = await runAnalysis(marketContext, model, maxRiskPct);
      setResult(r);
      fetchHistory().then(setHistory).catch(() => {});
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="p-2 rounded-lg"
              style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-border)' }}
            >
              <TrendingUp size={20} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                Crypto Trading
              </h1>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Solomon · Autonomous trading via Coinbase AgentKit
              </p>
            </div>
          </div>
          <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Describe current market conditions. Solomon will verify your balance, evaluate the
            signal against risk rules, and place a spot trade only when conditions are met —
            never risking more than the configured limit on a single position.
          </p>
        </header>

        {/* Input card */}
        <div
          className="rounded-xl p-5 mb-5"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Market context
          </label>
          <textarea
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none bg-transparent mb-4"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)', minHeight: 100 }}
            placeholder="e.g. BTC price drops 5% on high volume. RSI is at 28. Analyze and trade if conditions met."
            value={marketContext}
            onChange={(e) => setMarketContext(e.target.value)}
            disabled={running}
          />

          {/* Config row */}
          <div className="flex flex-wrap gap-4 mb-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={running}
                className="px-2 py-1 rounded text-sm"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Max risk per trade</label>
              <select
                value={maxRiskPct}
                onChange={(e) => setMaxRiskPct(parseFloat(e.target.value))}
                disabled={running}
                className="px-2 py-1 rounded text-sm"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value={0.01}>1%</option>
                <option value={0.02}>2% (recommended)</option>
                <option value={0.03}>3%</option>
                <option value={0.05}>5%</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={!marketContext.trim() || running}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              opacity: !marketContext.trim() || running ? 0.5 : 1,
            }}
          >
            <Play size={14} />
            {running ? 'Solomon is analyzing…' : 'Run Trading Cycle'}
          </button>
        </div>

        {/* Analyzing */}
        {running && (
          <div
            className="flex flex-col items-center gap-3 rounded-xl p-8 mb-5"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
            />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Solomon is analyzing the market…
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Checking balance · evaluating signal · applying risk rules
            </p>
          </div>
        )}

        {/* Error */}
        {errorMsg && !running && (
          <div
            className="flex items-start gap-3 rounded-xl p-4 mb-5"
            style={{
              background: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              border: '1px solid var(--color-error)',
            }}
          >
            <AlertTriangle size={15} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>Trading cycle failed</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{errorMsg}</p>
              {errorMsg.includes('trading-coinbase') && (
                <code
                  className="block mt-2 text-xs px-3 py-1.5 rounded"
                  style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)' }}
                >
                  uv sync --extra trading-coinbase
                </code>
              )}
            </div>
          </div>
        )}

        {/* Result */}
        {result && !running && (
          <div
            className="rounded-xl p-5 mb-5"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={13} style={{ color: 'var(--color-accent)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Solomon's Decision
              </span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {new Date(result.created_at * 1000).toLocaleString()}
              </span>
            </div>
            <pre
              className="text-sm whitespace-pre-wrap rounded-lg p-4"
              style={{
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              }}
            >
              {result.agent_response}
            </pre>
            <div className="flex gap-4 mt-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              <span>Model: {result.model}</span>
              <span>Max risk: {(result.max_risk_pct * 100).toFixed(1)}%</span>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={13} style={{ color: 'var(--color-text-tertiary)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Past Trading Cycles
              </h2>
              <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                {history.length} saved
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {history.map((h) => (
                <HistoryRow key={h.run_id ?? h.id} run={h} />
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <div
          className="rounded-xl p-4 mt-8 flex items-start gap-3"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <ShieldCheck size={16} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Solomon enforces strict risk limits per trade. Credentials are read from environment
            variables (<code style={{ color: 'var(--color-accent)' }}>CDP_API_KEY_NAME</code>,{' '}
            <code style={{ color: 'var(--color-accent)' }}>CDP_API_KEY_PRIVATE_KEY</code>,{' '}
            <code style={{ color: 'var(--color-accent)' }}>OPENAI_API_KEY</code>) — no cloud
            subscriptions, no vendor lock-in.
          </p>
        </div>
      </div>
    </div>
  );
}
