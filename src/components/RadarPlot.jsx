import { useMemo } from 'react'
import { ALTITUDE_RINGS, generateObjects } from '../datas/objects'

const CENTER = 300
const MIN_RADIUS = 70   // near Earth's surface
const MAX_RADIUS = 260  // outer edge of plot

// Map real altitude to a radius on our fixed-size plot.
// Most LEO objects sit 300-2000km up, so we scale within that band.
function altitudeToRadius(altitudeKm) {
  const clamped = Math.min(Math.max(altitudeKm, 200), 2000)
  const t = (clamped - 200) / (2000 - 200) // 0..1
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS)
}

// Longitude -180..180 maps to a full circle, 0..2π
function longitudeToAngle(lon) {
  return ((lon + 180) / 360) * Math.PI * 2
}

export function RadarPlot({ objects, showSat, showDebris }) {
  return (
    <svg viewBox="0 0 600 600" className="w-full max-w-xl mx-auto">
      {[MIN_RADIUS, (MIN_RADIUS + MAX_RADIUS) / 2, MAX_RADIUS].map((r) => (
        <circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#1e293b" strokeWidth="1" />
      ))}

      <circle cx={CENTER} cy={CENTER} r="42" fill="#0b2438" stroke="#2dd4bf" strokeWidth="0.5" strokeOpacity="0.4" />

      {objects.map((obj) => {
        if (obj.type === 'satellite' && !showSat) return null
        if (obj.type === 'debris' && !showDebris) return null

        const angle = longitudeToAngle(obj.longitude)
        const radius = altitudeToRadius(obj.altitudeKm)
        const x = CENTER + Math.cos(angle) * radius
        const y = CENTER + Math.sin(angle) * radius
        const color = obj.type === 'satellite' ? '#2dd4bf' : '#a78bfa'

        return <circle key={obj.id} cx={x} cy={y} r={obj.type === 'satellite' ? 3 : 2.2} fill={color} />
      })}
    </svg>
  )
}