import * as satellite from 'satellite.js'

function eciDistanceKm(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Propagate one object across a window of future times, return array of {hoursFromNow, eci}
function propagateSeries(tle, startDate, hours, stepMinutes) {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
  const series = []
  const steps = Math.floor((hours * 60) / stepMinutes)

  for (let i = 0; i <= steps; i++) {
    const t = new Date(startDate.getTime() + i * stepMinutes * 60000)
    const pv = satellite.propagate(satrec, t)
    if (pv.position) {
      series.push({ hoursFromNow: (i * stepMinutes) / 60, eci: pv.position })
    }
  }
  return series
}
const CLOSE_APPROACH_CUTOFF_KM = 150
const DOCKED_THRESHOLD_KM = 3 // treat pairs closer than this at every step as one physical structure

export function detectConjunctions(tles, lookaheadHours, stepMinutes = 15) {
  const now = new Date()

  const seriesById = {}
  tles.forEach((tle) => {
    seriesById[tle.id] = propagateSeries(tle, now, lookaheadHours, stepMinutes)
  })

  const conjunctions = []

  for (let i = 0; i < tles.length; i++) {
    for (let j = i + 1; j < tles.length; j++) {
      const a = tles[i], b = tles[j]
      const seriesA = seriesById[a.id], seriesB = seriesById[b.id]
      if (!seriesA.length || !seriesB.length) continue

      let minDist = Infinity
      let maxDist = -Infinity
      let minHours = 0

      const steps = Math.min(seriesA.length, seriesB.length)
      for (let k = 0; k < steps; k++) {
        const dist = eciDistanceKm(seriesA[k].eci, seriesB[k].eci)
        if (dist < minDist) {
          minDist = dist
          minHours = seriesA[k].hoursFromNow
        }
        if (dist > maxDist) maxDist = dist
      }

      // If it never separates beyond DOCKED_THRESHOLD_KM, it's one physical
      // structure (docked spacecraft, station modules) — not a conjunction event.
      const isPermanentlyAttached = maxDist < DOCKED_THRESHOLD_KM
      console.log(`${a.id} vs ${b.id}: closest ${minDist.toFixed(1)}km at ${minHours.toFixed(1)}h`)
      if (minDist <= CLOSE_APPROACH_CUTOFF_KM && !isPermanentlyAttached) {
        const risk = Math.max(0, 1 - minDist / CLOSE_APPROACH_CUTOFF_KM)
        conjunctions.push({
          id: `${a.id}__${b.id}`,
          a, b,
          missDistanceKm: minDist.toFixed(2),
          tcaHours: minHours.toFixed(1),
          risk,
          level: risk > 0.66 ? 'high' : risk > 0.33 ? 'medium' : 'low',
        })
      }
    }
  }

  return conjunctions.sort((x, y) => y.risk - x.risk)
}

export const LEVEL_COLOR = { high: '#f43f5e', medium: '#fbbf24', low: '#2dd4bf' }
export const LEVEL_LABEL = { high: 'HIGH', medium: 'MED', low: 'LOW' }