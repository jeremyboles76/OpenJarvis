import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  Eye,
  CheckCircle,
  XCircle,
  Plus,
  Trash2,
  Layers,
  Clock,
  Box,
  FileCode,
  FlaskConical,
  Circle,
  Wrench,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ImageIcon,
  Cpu,
  TrendingUp,
  Play,
  Activity,
  DollarSign,
} from 'lucide-react';
import { getBase, authHeaders } from '../lib/api';

// ---------------------------------------------------------------------------
// Trading tab types + helpers
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

async function runTradeAnalysis(
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

async function fetchTradeHistory(): Promise<TradeRun[]> {
  const res = await fetch(`${getBase()}/v1/solomon-trading/history`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

function TradeHistoryRow({ run }: { run: TradeRun }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      <button className="w-full flex items-center justify-between px-4 py-3 text-left" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-3 min-w-0">
          <Activity size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{run.market_context}</span>
        </div>
        <div className="flex items-center gap-3 ml-3 flex-shrink-0">
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{new Date(run.created_at * 1000).toLocaleString()}</span>
          {open ? <ChevronUp size={13} style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex gap-4 mt-3 mb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="flex items-center gap-1"><DollarSign size={10} /> Max risk: {(run.max_risk_pct * 100).toFixed(1)}%</span>
            <span>Model: {run.model}</span>
          </div>
          <pre className="text-sm whitespace-pre-wrap rounded-lg p-3" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>
            {run.agent_response}
          </pre>
        </div>
      )}
    </div>
  );
}

function TradingTab() {
  const [marketContext, setMarketContext] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [maxRiskPct, setMaxRiskPct] = useState(0.02);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TradeRun | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [history, setHistory] = useState<TradeRun[]>([]);

  useEffect(() => { fetchTradeHistory().then(setHistory).catch(() => {}); }, []);

  async function handleRun() {
    if (!marketContext.trim()) return;
    setRunning(true);
    setResult(null);
    setErrorMsg('');
    try {
      const r = await runTradeAnalysis(marketContext, model, maxRiskPct);
      setResult(r);
      fetchTradeHistory().then(setHistory).catch(() => {});
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      {/* Input card */}
      <div className="rounded-xl p-5 mb-5" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>Market context</label>
        <textarea
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none bg-transparent mb-4"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)', minHeight: 90 }}
          placeholder="e.g. BTC price drops 5% on high volume. RSI is at 28. Analyze and trade if conditions met."
          value={marketContext}
          onChange={e => setMarketContext(e.target.value)}
          disabled={running}
        />
        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Model</label>
            <select value={model} onChange={e => setModel(e.target.value)} disabled={running} className="px-2 py-1 rounded text-sm" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Max risk per trade</label>
            <select value={maxRiskPct} onChange={e => setMaxRiskPct(parseFloat(e.target.value))} disabled={running} className="px-2 py-1 rounded text-sm" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value={0.01}>1%</option>
              <option value={0.02}>2% (recommended)</option>
              <option value={0.03}>3%</option>
              <option value={0.05}>5%</option>
            </select>
          </div>
        </div>
        <button onClick={handleRun} disabled={!marketContext.trim() || running} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)', opacity: !marketContext.trim() || running ? 0.5 : 1 }}>
          <Play size={13} />
          {running ? 'Solomon is analyzing…' : 'Run Trading Cycle'}
        </button>
      </div>

      {/* Analyzing */}
      {running && (
        <div className="flex flex-col items-center gap-3 rounded-xl p-8 mb-5" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Solomon is analyzing the market…</p>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Checking balance · evaluating signal · applying risk rules</p>
        </div>
      )}

      {/* Error */}
      {errorMsg && !running && (
        <div className="flex items-start gap-3 rounded-xl p-4 mb-5" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid var(--color-error)' }}>
          <AlertTriangle size={15} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>Trading cycle failed</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{errorMsg}</p>
            {errorMsg.includes('uv sync') && (
              <code className="block mt-2 text-xs px-3 py-1.5 rounded" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)' }}>
                uv sync --extra trading-coinbase
              </code>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {result && !running && (
        <div className="rounded-xl p-5 mb-5" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={13} style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Solomon's Decision</span>
            <span className="ml-auto text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{new Date(result.created_at * 1000).toLocaleString()}</span>
          </div>
          <pre className="text-sm whitespace-pre-wrap rounded-lg p-4" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>
            {result.agent_response}
          </pre>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Past Trading Cycles</h2>
          </div>
          <div className="flex flex-col gap-2">
            {history.map(h => <TradeHistoryRow key={h.run_id || h.id} run={h} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CADFeature {
  type: string;
  description: string;
  size: string | null;
}

interface CADAngle {
  description: string;
  degrees: number;
}

interface CADExtraction {
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  material: string | null;
  features: CADFeature[];
  angles: CADAngle[];
  notes: string;
  confidence: number;
}

interface ExtractionResult {
  image_id: string;
  image_name: string;
  image_data_url: string;
  extraction: CADExtraction;
}

interface HistoryEntry {
  id: string;
  image_name: string;
  image_data_url: string;
  original_extraction: CADExtraction;
  corrected_extraction: CADExtraction;
  confirmed_at: number;
}

type Phase = 'idle' | 'extracting' | 'reviewing' | 'saving' | 'confirmed' | 'error';

const FEATURE_TYPES = ['hole', 'notch', 'fillet', 'chamfer', 'thread', 'slot', 'boss', 'rib', 'pocket', 'other'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceLabel(c: number): { text: string; color: string } {
  if (c >= 0.8) return { text: 'High', color: '#34d399' };
  if (c >= 0.5) return { text: 'Medium', color: '#f59e0b' };
  return { text: 'Low', color: '#f87171' };
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DimField({
  label, value, onChange,
}: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.1"
          placeholder="—"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
          style={{
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        />
        <span className="text-xs shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>mm</span>
      </div>
    </div>
  );
}

function FeatureRow({
  feature, index, onChange, onRemove,
}: {
  feature: CADFeature;
  index: number;
  onChange: (i: number, f: CADFeature) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-2">
        <select
          value={feature.type}
          onChange={(e) => onChange(index, { ...feature, type: e.target.value })}
          className="rounded-md px-2 py-1 text-xs outline-none"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          {FEATURE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Size (e.g. Ø6mm)"
          value={feature.size ?? ''}
          onChange={(e) => onChange(index, { ...feature, size: e.target.value || null })}
          className="rounded-md px-2 py-1 text-xs outline-none w-28"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        />
        <button
          onClick={() => onRemove(index)}
          className="ml-auto p-1 rounded-md"
          style={{ color: 'var(--color-text-tertiary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <input
        type="text"
        placeholder="Description"
        value={feature.description}
        onChange={(e) => onChange(index, { ...feature, description: e.target.value })}
        className="w-full rounded-md px-2 py-1 text-xs outline-none"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function VisionToCADPage() {
  const [activeTab, setActiveTab] = useState<'sketch' | 'trading'>('sketch');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [edited, setEdited] = useState<CADExtraction | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history on mount
  useEffect(() => {
    setHistoryLoading(true);
    fetch(`${getBase()}/v1/vision-to-cad/history`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [phase]);

  const uploadImage = useCallback(async (file: File) => {
    setPhase('extracting');
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${getBase()}/v1/vision-to-cad/extract`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: ExtractionResult = await res.json();
      setResult(data);
      setEdited(JSON.parse(JSON.stringify(data.extraction)));
      setPhase('reviewing');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setPhase('error');
    }
  }, []);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPEG, PNG, WebP, or GIF).');
      setPhase('error');
      return;
    }
    uploadImage(file);
  }, [uploadImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const saveConfirmed = useCallback(async (corrected: CADExtraction) => {
    if (!result) return;
    setPhase('saving');
    try {
      const res = await fetch(`${getBase()}/v1/vision-to-cad/feedback`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_id: result.image_id,
          image_name: result.image_name,
          image_data_url: result.image_data_url,
          original_extraction: result.extraction,
          corrected_extraction: corrected,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPhase('confirmed');
      setTimeout(() => {
        setPhase('idle');
        setResult(null);
        setEdited(null);
      }, 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setPhase('error');
    }
  }, [result]);

  // Editing helpers
  const patchEdited = (patch: Partial<CADExtraction>) =>
    setEdited((prev) => prev ? { ...prev, ...patch } : prev);

  const updateFeature = (i: number, f: CADFeature) =>
    setEdited((prev) => {
      if (!prev) return prev;
      const features = [...prev.features];
      features[i] = f;
      return { ...prev, features };
    });

  const removeFeature = (i: number) =>
    setEdited((prev) => {
      if (!prev) return prev;
      return { ...prev, features: prev.features.filter((_, idx) => idx !== i) };
    });

  const addFeature = () =>
    setEdited((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        features: [...prev.features, { type: 'hole', description: '', size: null }],
      };
    });

  const conf = edited ? confidenceLabel(edited.confidence) : { text: '', color: '' };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderUpload = () => (
    <div className="mb-8">
      <div
        className="rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all"
        style={{
          border: `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border)'}`,
          background: dragging ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
          minHeight: 240,
          padding: '2.5rem',
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
        >
          <ImageIcon size={24} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Drop a sketch or photo here
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            JPEG · PNG · WebP · GIF · up to 20 MB
          </div>
        </div>
        <div
          className="px-4 py-2 rounded-lg text-xs font-medium"
          style={{
            background: 'var(--color-accent-subtle)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-accent)',
          }}
        >
          Choose file
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );

  const renderExtracting = () => (
    <div
      className="rounded-2xl flex flex-col items-center justify-center gap-4 mb-8"
      style={{
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        minHeight: 240,
      }}
    >
      <div className="relative">
        <div
          className="w-14 h-14 rounded-full border-2 animate-spin"
          style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }}
        />
        <Eye
          size={18}
          className="absolute inset-0 m-auto"
          style={{ color: 'var(--color-accent)' }}
        />
      </div>
      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        Solomon is analyzing the sketch…
      </div>
      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        Extracting dimensions, features, and geometry
      </div>
    </div>
  );

  const renderReview = () => {
    if (!result || !edited) return null;
    const isSaving = phase === 'saving';
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Review Extraction
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Confidence:
            </span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: `${conf.color}20`,
                color: conf.color,
                border: `1px solid ${conf.color}40`,
              }}
            >
              {conf.text} ({Math.round(edited.confidence * 100)}%)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: image */}
          <div
            className="rounded-xl overflow-hidden flex items-center justify-center"
            style={{
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              minHeight: 300,
            }}
          >
            <img
              src={result.image_data_url}
              alt={result.image_name}
              className="max-w-full max-h-[400px] object-contain"
            />
          </div>

          {/* Right: editable params */}
          <div className="flex flex-col gap-3">
            {/* Dimensions */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-xs font-semibold mb-3 uppercase tracking-wide"
                style={{ color: 'var(--color-text-tertiary)' }}>
                Dimensions
              </div>
              <div className="grid grid-cols-3 gap-3">
                <DimField label="Width" value={edited.width_mm} onChange={(v) => patchEdited({ width_mm: v })} />
                <DimField label="Height" value={edited.height_mm} onChange={(v) => patchEdited({ height_mm: v })} />
                <DimField label="Depth" value={edited.depth_mm} onChange={(v) => patchEdited({ depth_mm: v })} />
              </div>
            </div>

            {/* Material */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-xs font-semibold mb-3 uppercase tracking-wide"
                style={{ color: 'var(--color-text-tertiary)' }}>
                Material
              </div>
              <input
                type="text"
                placeholder="e.g. Aluminium 6061, Steel, PLA…"
                value={edited.material ?? ''}
                onChange={(e) => patchEdited({ material: e.target.value || null })}
                className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
                style={{
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
            </div>

            {/* Features */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-text-tertiary)' }}>
                  Features ({edited.features.length})
                </div>
                <button
                  onClick={addFeature}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
                  style={{
                    background: 'var(--color-accent-subtle)',
                    color: 'var(--color-accent)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <Plus size={11} /> Add
                </button>
              </div>
              {edited.features.length === 0 ? (
                <div className="text-xs py-2 text-center"
                  style={{ color: 'var(--color-text-tertiary)' }}>
                  No features detected — add them manually
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {edited.features.map((f, i) => (
                    <FeatureRow
                      key={i}
                      feature={f}
                      index={i}
                      onChange={updateFeature}
                      onRemove={removeFeature}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-xs font-semibold mb-3 uppercase tracking-wide"
                style={{ color: 'var(--color-text-tertiary)' }}>
                Notes
              </div>
              <textarea
                rows={3}
                placeholder="Any additional notes or corrections…"
                value={edited.notes}
                onChange={(e) => patchEdited({ notes: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                style={{
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => saveConfirmed(edited)}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              opacity: isSaving ? 0.6 : 1,
            }}
          >
            <CheckCircle size={15} />
            {isSaving ? 'Saving…' : 'Confirm & Save'}
          </button>
          <button
            onClick={() => { setPhase('idle'); setResult(null); setEdited(null); }}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-colors"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <XCircle size={15} /> Discard
          </button>
          <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
            Saved examples train future extractions
          </span>
        </div>
      </div>
    );
  };

  const renderConfirmed = () => (
    <div
      className="rounded-2xl flex flex-col items-center justify-center gap-3 mb-8"
      style={{
        border: '1px solid var(--color-border)',
        background: 'var(--color-accent-subtle)',
        minHeight: 160,
      }}
    >
      <CheckCircle size={28} style={{ color: '#34d399' }} />
      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        Saved — Solomon has a new example
      </div>
    </div>
  );

  const renderError = () => (
    <div
      className="rounded-2xl flex flex-col items-center justify-center gap-3 mb-8"
      style={{
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        minHeight: 160,
      }}
    >
      <AlertTriangle size={24} style={{ color: '#f87171' }} />
      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{error}</div>
      <button
        onClick={() => setPhase('idle')}
        className="px-4 py-1.5 rounded-lg text-xs font-medium"
        style={{
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
      >
        Try again
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Full render
  // ---------------------------------------------------------------------------

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
              <Layers size={20} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                Vision to CAD
              </h1>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Solomon · Sketch extraction + feedback loop
              </p>
            </div>
          </div>
          <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {activeTab === 'sketch'
              ? 'Upload a sketch or photo. Solomon will extract dimensions, features, and geometry — you confirm or correct, and every correction becomes a training example.'
              : 'Describe current market conditions. Solomon will verify your balance, evaluate the signal, and place a spot trade only when risk-management conditions are met.'}
          </p>
        </header>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 rounded-lg w-fit" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {([
            { id: 'sketch', label: 'Sketch → CAD', Icon: Layers },
            { id: 'trading', label: 'Trading', Icon: TrendingUp },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-all"
              style={{
                background: activeTab === id ? 'var(--color-bg)' : 'transparent',
                color: activeTab === id ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                boxShadow: activeTab === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <Icon size={14} style={{ color: activeTab === id ? 'var(--color-accent)' : undefined }} />
              {label}
            </button>
          ))}
        </div>

        {/* Trading tab */}
        {activeTab === 'trading' && <TradingTab />}

        {/* Sketch → CAD tab */}
        {activeTab === 'sketch' && phase === 'idle' && renderUpload()}
        {activeTab === 'sketch' && phase === 'extracting' && renderExtracting()}
        {activeTab === 'sketch' && (phase === 'reviewing' || phase === 'saving') && renderReview()}
        {activeTab === 'sketch' && phase === 'confirmed' && renderConfirmed()}
        {activeTab === 'sketch' && phase === 'error' && renderError()}

        {/* Sketch history */}
        {activeTab === 'sketch' && <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Confirmed Examples
            </h2>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {history.length} saved
            </span>
          </div>

          {historyLoading ? (
            <div className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
              Loading…
            </div>
          ) : history.length === 0 ? (
            <div
              className="rounded-xl py-8 text-center text-sm"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px dashed var(--color-border)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              No examples yet — confirmed extractions appear here
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {history.map((entry) => {
                const ex = entry.corrected_extraction;
                const dims = [
                  ex.width_mm != null && `W ${ex.width_mm}`,
                  ex.height_mm != null && `H ${ex.height_mm}`,
                  ex.depth_mm != null && `D ${ex.depth_mm}`,
                ].filter(Boolean).join(' · ');
                return (
                  <div
                    key={entry.id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <div
                      className="h-32 flex items-center justify-center overflow-hidden"
                      style={{ background: 'var(--color-bg-tertiary)' }}
                    >
                      <img
                        src={entry.image_data_url}
                        alt={entry.image_name}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-medium truncate mb-1"
                        style={{ color: 'var(--color-text)' }}>
                        {entry.image_name}
                      </div>
                      {dims && (
                        <div className="text-xs mb-1 font-mono"
                          style={{ color: 'var(--color-accent)' }}>
                          {dims} mm
                        </div>
                      )}
                      {ex.material && (
                        <div className="text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {ex.material}
                        </div>
                      )}
                      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {formatDate(entry.confirmed_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>}

        {/* Roadmap (collapsible) */}
        <button
          onClick={() => setRoadmapOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl mb-3 text-sm"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span className="font-medium">Implementation Roadmap</span>
          {roadmapOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {roadmapOpen && <Roadmap />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roadmap (kept as a collapsible reference)
// ---------------------------------------------------------------------------

const phases = [
  {
    number: 1, week: 'Week 1', title: 'Foundation', icon: Box,
    color: 'var(--color-accent)',
    items: [
      'Install CadQuery (Python library for CAD generation)',
      'Set up OpenSCAD integration for parametric design',
      'Create a vision-to-geometry parser that extracts dimensions, angles, and shapes from images',
    ],
  },
  {
    number: 2, week: 'Week 2', title: 'Vision Pipeline', icon: Eye,
    color: '#a78bfa',
    items: [
      'Use Claude vision to identify CAD features (holes, edges, curves, dimensions)',
      'Build a converter that translates visual geometry → CAD parameters',
      'Grow the confirmed-examples library using this feedback interface',
    ],
  },
  {
    number: 3, week: 'Week 3', title: 'CAD Generation Engine', icon: FileCode,
    color: '#34d399',
    items: [
      'Write generation templates for common shapes (boxes, cylinders, brackets, etc.)',
      'Integrate parametric design to output .STEP, .DWG, and .STL formats',
      'Build a quality-check layer to validate generated files before delivery',
    ],
  },
  {
    number: 4, week: 'Week 4', title: 'Testing & Refinement', icon: FlaskConical,
    color: '#f59e0b',
    items: [
      "Test on your sketches and Liberty's design work",
      'Iterate on accuracy and output formats',
      'Document for regular use',
    ],
  },
];

const outputFormats = [
  { ext: '.STEP', desc: 'Industry-standard solid model — works in SolidWorks, Fusion 360, FreeCAD' },
  { ext: '.DWG', desc: 'AutoCAD native format for 2D drawings and shop prints' },
  { ext: '.STL', desc: 'Mesh format ready for 3D printing and CNC preview' },
];

function Roadmap() {
  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {phases.map((phase) => {
          const Icon = phase.icon;
          return (
            <div
              key={phase.number}
              className="rounded-xl p-5"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
                  <Icon size={16} style={{ color: phase.color }} />
                </div>
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                    Phase {phase.number} · {phase.week}
                  </div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {phase.title}
                  </div>
                </div>
                <span
                  className="ml-auto text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{
                    background: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-tertiary)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <Clock size={10} /> Pending
                </span>
              </div>
              <ul className="space-y-2">
                {phase.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Circle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }} />
                    <span style={{ color: 'var(--color-text-secondary)' }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div
        className="rounded-xl p-5 mb-4"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Wrench size={16} style={{ color: 'var(--color-accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Output Formats</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {outputFormats.map((f) => (
            <div
              key={f.ext}
              className="rounded-lg px-4 py-3"
              style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-sm font-mono font-bold mb-1" style={{ color: 'var(--color-accent)' }}>
                {f.ext}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl p-5 flex items-start gap-4 mb-6"
        style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-border)' }}
      >
        <CheckCircle size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
        <div>
          <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Ready when you are
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            One-time approval to start, then feedback on test outputs at the end of each phase.
            Solomon will handle the rest — no external subscriptions, no cloud fees, no vendor lock-in.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 ml-auto">
          <Cpu size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>All open-source</span>
        </div>
      </div>
    </div>
  );
}
