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
} from 'lucide-react';
import { getBase, authHeaders } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyzeResponse {
  run_id: string;
  market_context: string;
  agent_response: string;
  model: string;
  max_risk_pct: number;
  created_at: number;
}

interface HistoryEntry extends AnalyzeResponse {
  id: string;
}

type Phase = 'idle' | 'analyzing' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function formatRisk(pct: number) {
  return `${(pct * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function runAnalysis(
  marketContext: string,
  model: string,
  maxRiskPct: number,
): Promise<AnalyzeResponse> {
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

async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch(`${getBase()}/v1/solomon-trading/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
}

// ---------------------------------------------------------------------------
// History row component
// ---------------------------------------------------------------------------

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Activity size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span
            className="text-sm truncate"
            style={{ color: 'var(--color-text)' }}
          >
            {entry.market_context}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-3 flex-shrink-0">
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {formatDate(entry.created_at)}
          </span>
          {expanded ? (
            <ChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} />
          ) : (
            <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
          )}
        </div>
      </button>
      {expanded && (
        <div
          className="px-4 pb-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div className="flex gap-4 mt-3 mb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="flex items-center gap-1">
              <DollarSign size={11} /> Max risk: {formatRisk(entry.max_risk_pct)}
            </span>
            <span>Model: {entry.model}</span>
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
            {entry.agent_response}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SolomonTradingPage() {
  const [marketContext, setMarketContext] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [maxRiskPct, setMaxRiskPct] = useState(0.02);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    fetchHistory().then(setHistory).catch(() => {});
  }, []);

  async function handleRun() {
    if (!marketContext.trim()) return;
    setPhase('analyzing');
    setResult(null);
    setErrorMsg('');
    try {
      const res = await runAnalysis(marketContext, model, maxRiskPct);
      setResult(res);
      setPhase('done');
      fetchHistory().then(setHistory).catch(() => {});
    } catch (err: any) {
      setErrorMsg(err.message || 'Unknown error');
      setPhase('error');
    }
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-6"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div
            className="p-2 rounded-xl"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
          >
            <TrendingUp size={22} style={{ color: 'var(--color-accent)' }} />
          </div>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
              Solomon · Trading
            </h1>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Autonomous crypto trading powered by Coinbase AgentKit
            </p>
          </div>
        </div>

        <p className="text-sm mb-6 mt-2" style={{ color: 'var(--color-text-secondary)' }}>
          Describe current market conditions. Solomon will verify your balance, evaluate
          the signal against risk rules, and place a spot trade if conditions are met —
          never risking more than the configured limit on a single position.
        </p>

        {/* Input card */}
        <div
          className="rounded-xl p-5 mb-5"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Market context
          </label>
          <textarea
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none bg-transparent mb-4"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
              minHeight: 100,
            }}
            placeholder={
              'e.g. BTC price drops 5% on high volume. RSI is at 28. Analyze and trade if conditions met.'
            }
            value={marketContext}
            onChange={(e) => setMarketContext(e.target.value)}
            disabled={phase === 'analyzing'}
          />

          {/* Config row */}
          <div className="flex flex-wrap gap-4 mb-4">
            <div>
              <label
                className="block text-xs mb-1"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={phase === 'analyzing'}
                className="px-2 py-1 rounded text-sm"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
              </select>
            </div>
            <div>
              <label
                className="block text-xs mb-1"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Max risk per trade
              </label>
              <select
                value={maxRiskPct}
                onChange={(e) => setMaxRiskPct(parseFloat(e.target.value))}
                disabled={phase === 'analyzing'}
                className="px-2 py-1 rounded text-sm"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
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
            disabled={!marketContext.trim() || phase === 'analyzing'}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              opacity: !marketContext.trim() || phase === 'analyzing' ? 0.5 : 1,
            }}
          >
            <Play size={14} />
            {phase === 'analyzing' ? 'Solomon is analyzing…' : 'Run Trading Cycle'}
          </button>
        </div>

        {/* Analyzing state */}
        {phase === 'analyzing' && (
          <div
            className="flex flex-col items-center gap-3 rounded-xl p-8 mb-5"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
            />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Solomon is analyzing the market…
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Checking balance, evaluating signal, applying risk rules
            </p>
          </div>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <div
            className="flex items-start gap-3 rounded-xl p-4 mb-5"
            style={{
              background: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              border: '1px solid var(--color-error)',
            }}
          >
            <AlertTriangle size={16} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>
                Trading cycle failed
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                {errorMsg}
              </p>
              {errorMsg.includes('uv sync') && (
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
        {phase === 'done' && result && (
          <div
            className="rounded-xl p-5 mb-5"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} style={{ color: 'var(--color-accent)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Solomon's Decision
              </span>
              <span className="ml-auto text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {formatDate(result.created_at)}
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
              <span>Max risk: {formatRisk(result.max_risk_pct)}</span>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Past Trading Cycles
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {history.map((h) => (
                <HistoryRow key={h.id} entry={h} />
              ))}
            </div>
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs mt-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          Solomon never risks more than your configured limit per trade — no cloud subscriptions,
          no external fees beyond Coinbase spreads.
        </p>
      </div>
    </div>
  );
}
