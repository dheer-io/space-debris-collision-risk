import { useState, useEffect } from 'react'
import { detectConjunctions } from './datas/detectConjunctions'
import { propagateToGeodetic } from './datas/propagate'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/SideBar'
import { GroundTrackMap } from './components/GroundTrackMap'
import { RadarPlot } from './components/RadarPlot'
import { AlertsPanel } from './components/AlertsPanel'

function extractNoradId(line1) {
  return line1.slice(2, 7).trim()
}

// CelesTrak returns an HTML error/rate-limit page instead of TLE text when
// it blocks us. TLE text always starts with a satellite name, never '<'.
function assertValidTLEText(text, label) {
  if (text.trim().startsWith('<')) {
    throw new Error(`${label} request was rate-limited or blocked by CelesTrak (got HTML, not TLE data)`)
  }
}

// Cache raw TLE text in sessionStorage so repeated dev hot-reloads
// don't re-hit CelesTrak every single time and risk rate-limiting.
async function fetchTLETextCached(url, cacheKey) {
  const cached = sessionStorage.getItem(cacheKey)
  if (cached) return cached

  const text = await fetch(url).then((r) => r.text())
  sessionStorage.setItem(cacheKey, text)
  return text
}

function App() {
  const [rawTLEs, setRawTLEs] = useState([])
  const [conjunctions, setConjunctions] = useState([])
  const [showSat, setShowSat] = useState(true)
  const [showDebris, setShowDebris] = useState(true)
  const [lookahead, setLookahead] = useState(24)
  const [threshold, setThreshold] = useState(0.3)

  const [objects, setObjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('ground') // 'ground' | 'radar'

  useEffect(() => {
    async function loadData() {
      try {
        const stationText = await fetchTLETextCached(
          'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
          'tle-stations'
        )
        const debrisText = await fetchTLETextCached(
          'https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-1408-debris&FORMAT=tle',
          'tle-debris'
        )

        assertValidTLEText(stationText, 'Stations')
        assertValidTLEText(debrisText, 'Debris')

        const parse = (text) => {
          const lines = text.trim().split('\n').map((l) => l.trim())
          const out = []
          for (let i = 0; i < lines.length; i += 3) {
            if (lines[i] && lines[i + 1] && lines[i + 2]) {
              out.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] })
            }
          }
          return out
        }

        const now = new Date()
        const satTLEs = parse(stationText).map((t) => ({ ...t, type: 'satellite' }))
        const debTLEs = parse(debrisText).slice(0, 20).map((t) => ({ ...t, type: 'debris' }))

        const allTLEs = [...satTLEs, ...debTLEs].map((t) => ({
          ...t,
          id: `${t.name.trim()}-${extractNoradId(t.line1)}`,
        }))
        setRawTLEs(allTLEs)

        const propagated = [...satTLEs, ...debTLEs]
          .map((tle) => {
            const geo = propagateToGeodetic(tle, now)
            if (!geo) return null
            return { id: `${tle.name.trim()}-${extractNoradId(tle.line1)}`, type: tle.type, ...geo }
          })
          .filter(Boolean)

        setObjects(propagated)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  useEffect(() => {
    if (rawTLEs.length === 0) return
    const results = detectConjunctions(rawTLEs, lookahead)
    setConjunctions(results)
  }, [rawTLEs, lookahead])

  const visibleConjunctions = conjunctions.filter(
    (c) => c.risk >= threshold && parseFloat(c.tcaHours) <= lookahead
  )

  if (loading) return <div className="min-h-screen bg-slate-950 text-white p-6">Loading orbital data...</div>
  if (error) return <div className="min-h-screen bg-slate-950 text-white p-6">Error: {error}</div>

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <TopBar objectCount={objects.length} />
      <div className="flex">
        <Sidebar
          showSat={showSat}
          showDebris={showDebris}
          onToggleSat={() => setShowSat((v) => !v)}
          onToggleDebris={() => setShowDebris((v) => !v)}
        />
        <div className="flex-1 p-6 flex flex-col items-center justify-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setView('ground')}
              className={`px-3 py-1 text-xs font-mono rounded border ${
                view === 'ground' ? 'border-teal-400 text-teal-400' : 'border-slate-700 text-slate-500'
              }`}
            >
              GROUND TRACK
            </button>
            <button
              onClick={() => setView('radar')}
              className={`px-3 py-1 text-xs font-mono rounded border ${
                view === 'radar' ? 'border-teal-400 text-teal-400' : 'border-slate-700 text-slate-500'
              }`}
            >
              RADAR VIEW
            </button>
          </div>

          {view === 'ground' ? (
            <GroundTrackMap objects={objects} showSat={showSat} showDebris={showDebris} />
          ) : (
            <RadarPlot objects={objects} showSat={showSat} showDebris={showDebris} />
          )}
        </div>
        <AlertsPanel
          conjunctions={visibleConjunctions}
          lookahead={lookahead}
          threshold={threshold}
          onLookaheadChange={setLookahead}
          onThresholdChange={setThreshold}
        />
      </div>
    </div>
  )
}

export default App