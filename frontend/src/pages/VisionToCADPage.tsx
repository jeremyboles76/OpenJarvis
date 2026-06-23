import { Eye, Box, Layers, CheckCircle, Circle, Clock, Wrench, Cpu, FileCode, FlaskConical } from 'lucide-react';

const phases = [
  {
    number: 1,
    week: 'Week 1',
    title: 'Foundation',
    icon: Box,
    status: 'upcoming',
    color: 'var(--color-accent)',
    items: [
      'Install CadQuery (Python library for CAD generation)',
      'Set up OpenSCAD integration for parametric design',
      'Create a vision-to-geometry parser that extracts dimensions, angles, and shapes from images',
    ],
  },
  {
    number: 2,
    week: 'Week 2',
    title: 'Vision Pipeline',
    icon: Eye,
    status: 'upcoming',
    color: '#a78bfa',
    items: [
      'Train a lightweight object detection model to identify CAD features (holes, edges, curves, dimensions)',
      'Build a converter that translates visual geometry → CAD parameters',
      'Add measurement extraction from sketches (use reference objects for scale)',
    ],
  },
  {
    number: 3,
    week: 'Week 3',
    title: 'CAD Generation Engine',
    icon: FileCode,
    status: 'upcoming',
    color: '#34d399',
    items: [
      'Write generation templates for common shapes (boxes, cylinders, brackets, etc.)',
      'Integrate parametric design to output .STEP, .DWG, and .STL formats',
      'Build a quality-check layer to validate generated files before delivery',
    ],
  },
  {
    number: 4,
    week: 'Week 4',
    title: 'Testing & Refinement',
    icon: FlaskConical,
    status: 'upcoming',
    color: '#f59e0b',
    items: [
      "Test on your sketches and Liberty's design work",
      'Iterate on accuracy and output formats',
      'Document for regular use',
    ],
  },
];

const stats = [
  { label: 'Total Cost', value: '$0', sub: 'All open-source' },
  { label: 'Timeline', value: '4 weeks', sub: 'Phased rollout' },
  { label: 'Output Formats', value: '3', sub: '.STEP · .DWG · .STL' },
  { label: 'Your Involvement', value: 'Minimal', sub: 'Approve + feedback' },
];

const outputFormats = [
  { ext: '.STEP', desc: 'Industry-standard solid model — works in SolidWorks, Fusion 360, FreeCAD' },
  { ext: '.DWG', desc: 'AutoCAD native format for 2D drawings and shop prints' },
  { ext: '.STL', desc: 'Mesh format ready for 3D printing and CNC preview' },
];

export function VisionToCADPage() {
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
                Solomon · Implementation Roadmap
              </p>
            </div>
          </div>
          <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            A 4-week plan to give Solomon the ability to convert images, sketches, and photos into
            production-ready CAD files — entirely with open-source tooling at zero cost.
          </p>
        </header>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-4 py-3"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-xl font-bold mb-0.5" style={{ color: 'var(--color-text)' }}>
                {s.value}
              </div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {s.label}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {s.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Phase cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {phases.map((phase) => {
            const Icon = phase.icon;
            return (
              <div
                key={phase.number}
                className="rounded-xl p-5"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="p-2 rounded-lg shrink-0"
                      style={{ background: 'var(--color-bg-tertiary)' }}
                    >
                      <Icon size={16} style={{ color: phase.color }} />
                    </div>
                    <div>
                      <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                        Phase {phase.number} · {phase.week}
                      </div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        {phase.title}
                      </div>
                    </div>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                    style={{
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-tertiary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <Clock size={10} className="inline mr-1 -mt-0.5" />
                    Pending
                  </span>
                </div>
                <ul className="space-y-2">
                  {phase.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Circle
                        size={14}
                        className="shrink-0 mt-0.5"
                        style={{ color: 'var(--color-text-tertiary)' }}
                      />
                      <span style={{ color: 'var(--color-text-secondary)' }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Output formats */}
        <div
          className="rounded-xl p-5 mb-8"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Output Formats
            </h2>
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

        {/* Approval banner */}
        <div
          className="rounded-xl p-5 flex items-start gap-4"
          style={{
            background: 'var(--color-accent-subtle)',
            border: '1px solid var(--color-border)',
          }}
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
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              All open-source
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
