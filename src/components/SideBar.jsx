export function Sidebar({ showSat, showDebris, onToggleSat, onToggleDebris }) {
  return (
    <div className="w-56 border-r border-slate-800 bg-slate-950 p-5">
      <div className="text-xs font-mono text-slate-500 tracking-wide mb-3">
        OBJECT LAYERS
      </div>

      <LayerToggle
        label="Satellites"
        count={27}
        color="bg-teal-400"
        active={showSat}
        onClick={onToggleSat}
      />
      <LayerToggle
        label="Debris"
        count={13}
        color="bg-violet-400"
        active={showDebris}
        onClick={onToggleDebris}
      />
    </div>
  )
}

function LayerToggle({ label, count, color, active, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded mb-2 cursor-pointer border
        ${active ? 'bg-slate-800 border-slate-700' : 'border-transparent'}`}
    >
      <span className={`w-2 h-2 rounded-full ${color} ${active ? 'opacity-100' : 'opacity-30'}`} />
      <span className={`text-sm ${active ? 'text-white' : 'text-slate-500'}`}>{label}</span>
      <span className="ml-auto text-xs font-mono text-slate-500">{count}</span>
    </div>
  )
}