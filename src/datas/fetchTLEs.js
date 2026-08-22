const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'

export async function fetchTLEs() {
  const res = await fetch(CELESTRAK_URL)
  if (!res.ok) throw new Error('Failed to fetch TLE data')
  const text = await res.text()
  return parseTLEText(text)
}

// TLE format: every satellite is 3 lines — name, line1, line2
function parseTLEText(text) {
  const lines = text.trim().split('\n').map((l) => l.trim())
  const satellites = []

  for (let i = 0; i < lines.length; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (name && line1 && line2) {
      satellites.push({ name, line1, line2 })
    }
  }

  return satellites
}