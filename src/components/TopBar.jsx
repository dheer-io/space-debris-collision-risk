import { useClock } from '../hooks/useClock'

function formatTimestamp(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
}

export function TopBar({ objectCount }) {
  const now = useClock()

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900">
      <div className="flex items-baseline gap-3">
        <span className="text-xl font-bold tracking-wide">PS-04 // ORBITAL WATCH</span>
        <span className="text-xs text-slate-500 font-mono">CONJUNCTION RISK DASHBOARD</span>
      </div>

      <div className="flex items-center gap-5">
        <span className="text-sm font-mono text-teal-400">{formatTimestamp(now)}</span>
        <div className="flex items-center gap-2 bg-slate-800 px-3 py-1 rounded text-xs font-mono text-slate-400">
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          TRACKING {objectCount} OBJECTS
        </div>
      </div>
    </div>
  )
}