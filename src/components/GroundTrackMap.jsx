const WIDTH = 600
const HEIGHT = 300

function project(lat, lon) {
  const x = ((lon + 180) / 360) * WIDTH
  const y = ((90 - lat) / 180) * HEIGHT
  return { x, y }
}

export function GroundTrackMap({ objects, showSat, showDebris }) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-3xl mx-auto bg-slate-900 rounded">
      {[...Array(12)].map((_, i) => (
        <line
          key={`v${i}`}
          x1={(i * WIDTH) / 12} y1="0"
          x2={(i * WIDTH) / 12} y2={HEIGHT}
          stroke="#1e293b" strokeWidth="0.5"
        />
      ))}
      {[...Array(6)].map((_, i) => (
        <line
          key={`h${i}`}
          x1="0" y1={(i * HEIGHT) / 6}
          x2={WIDTH} y2={(i * HEIGHT) / 6}
          stroke="#1e293b" strokeWidth="0.5"
        />
      ))}
      <line x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="#334155" strokeWidth="1" />

      {objects.map((obj) => {
        if (obj.type === 'satellite' && !showSat) return null
        if (obj.type === 'debris' && !showDebris) return null
        const { x, y } = project(obj.latitude, obj.longitude)
        const color = obj.type === 'satellite' ? '#2dd4bf' : '#a78bfa'
        return <circle key={obj.id} cx={x} cy={y} r={obj.type === 'satellite' ? 3 : 2} fill={color} />
      })}
    </svg>
  )
}