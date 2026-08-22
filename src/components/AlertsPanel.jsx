import { LEVEL_COLOR, LEVEL_LABEL } from '../datas/detectConjunctions'

export function AlertsPanel({ conjunctions, lookahead, threshold, onLookaheadChange, onThresholdChange }) {
  return (
    <div className="w-80 border-l border-slate-800 bg-slate-950 p-5">
      <div className="text-xs font-mono text-slate-500 tracking-wide mb-1">CONJUNCTION ALERTS</div>
      <div className="text-xs text-slate-500 mb-4">
        {conjunctions.length} within {lookahead}h, risk ≥ {threshold.toFixed(2)}
      </div>

      <div className="mb-5">
        <div className="flex justify-between text-xs font-mono text-slate-500 mb-1">
          <span>LOOK-AHEAD</span><span className="text-teal-400">{lookahead}h</span>
        </div>
        <input
          type="range" min="6" max="72" step="1"
          value={lookahead}
          onChange={(e) => onLookaheadChange(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div className="mb-5">
        <div className="flex justify-between text-xs font-mono text-slate-500 mb-1">
          <span>RISK THRESHOLD</span><span className="text-amber-400">{threshold.toFixed(2)}</span>
        </div>
        <input
          type="range" min="0" max="0.9" step="0.05"
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {conjunctions.length === 0 && (
        <div className="text-xs text-slate-600 text-center py-6">No events match current filters.</div>
      )}

      {conjunctions.map((c) => (
        <div key={c.id} className="bg-slate-900 border border-slate-800 rounded p-3 mb-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-mono">{c.a.id} × {c.b.id}</span>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
              style={{ color: LEVEL_COLOR[c.level], borderColor: LEVEL_COLOR[c.level] }}
            >
              {LEVEL_LABEL[c.level]}
            </span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>TCA: {c.tcaHours}h</span>
            <span>Miss: {c.missDistanceKm}km</span>
            <span>{(c.risk * 100).toFixed(0)}%</span>
          </div>
        </div>
      ))}
    </div>
  )
}