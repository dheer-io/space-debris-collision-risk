import * as satellite from 'satellite.js'

// Converts a TLE into a live geodetic position (lat, lon, altitude)
// at a given moment in time.
export function propagateToGeodetic(tle, date) {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
  const positionAndVelocity = satellite.propagate(satrec, date)

  if (!positionAndVelocity.position) return null // decayed/invalid orbit

  const gmst = satellite.gstime(date)
  const geodetic = satellite.eciToGeodetic(positionAndVelocity.position, gmst)

  return {
    latitude: satellite.degreesLat(geodetic.latitude),
    longitude: satellite.degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
    eci: positionAndVelocity.position, // keep raw ECI for distance calcs later
  }
}