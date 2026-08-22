// A simple seeded random generator so the "random" layout is
// consistent every time you reload — real randomness would make
// the dashboard look different on every refresh, which is annoying
// to debug against.
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export const ALTITUDE_RINGS = [110, 165, 220] // px radius for 3 LEO shells

export function generateObjects() {
  const rnd = seededRandom(42)
  const objects = []

  for (let i = 0; i < 40; i++) {
    const isSatellite = i < 27
    const ring = ALTITUDE_RINGS[Math.floor(rnd() * ALTITUDE_RINGS.length)]

    objects.push({
      id: isSatellite ? `SAT-${1000 + i}` : `DEB-${2000 + i}`,
      type: isSatellite ? 'satellite' : 'debris',
      angle: rnd() * Math.PI * 2,        // starting position on the ring
      radius: ring + (rnd() - 0.5) * 14, // slight jitter off the exact ring
      speed: (rnd() * 0.4 + 0.15) * (rnd() > 0.5 ? 1 : -1), // orbit direction/speed
    })
  }

  return objects
}