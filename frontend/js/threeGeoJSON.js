import * as THREE from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";

/**
 * Draws a GeoJSON object onto the surface of a sphere.
 *
 * Walks every latitude/longitude coordinate, converts it into XYZ position on
 * the sphere, and builds THREE line/point objects for each geometry found in
 * the GeoJSON. Long segments are interpolated with extra midpoints so lines
 * hug the curve of the sphere instead of cutting through it.
 */
export function drawThreeGeo({ json, radius, materialOptions }) {
  const container = new THREE.Object3D();
  container.userData.update = (elapsedTime) => {
    for (const child of container.children) {
      child.userData.update?.(elapsedTime);
    }
  };

  container.rotation.x = -Math.PI * 0.5; // align sphere's poles with the geographic axis

  const geometries = extractGeometries(json);

  for (const geometry of geometries) {
    switch (geometry.type) {
      case "Point": {
        const point = coordinateToSphereVector(geometry.coordinates, radius);
        addPoint(container, [point], materialOptions);
        break;
      }

      case "MultiPoint": {
        const points = geometry.coordinates.map((coord) =>
          coordinateToSphereVector(coord, radius)
        );
        addPoint(container, points, materialOptions);
        break;
      }

      case "LineString": {
        const points = coordinatesToSphereVectors(geometry.coordinates, radius);
        addLine(container, points, materialOptions);
        break;
      }

      case "Polygon": {
        for (const ring of geometry.coordinates) {
          const points = coordinatesToSphereVectors(ring, radius);
          addLine(container, points, materialOptions);
        }
        break;
      }

      case "MultiLineString": {
        for (const line of geometry.coordinates) {
          const points = coordinatesToSphereVectors(line, radius);
          addLine(container, points, materialOptions);
        }
        break;
      }

      case "MultiPolygon": {
        for (const polygon of geometry.coordinates) {
          for (const ring of polygon) {
            const points = coordinatesToSphereVectors(ring, radius);
            addLine(container, points, materialOptions);
          }
        }
        break;
      }

      default:
        throw new Error(`The geoJSON is not valid: unsupported geometry type "${geometry.type}".`);
    }
  }

  return container;
}

function extractGeometries(json) {
  switch (json.type) {
    case "Feature":
      return [json.geometry];
    case "FeatureCollection":
      return json.features.map((feature) => feature.geometry);
    case "GeometryCollection":
      return json.geometries;
    default:
      throw new Error("The geoJSON is not valid.");
  }
}

// Expands a ring of raw [lon, lat] coordinates, inserting interpolated
// midpoints between any two points that are too far apart on the sphere.
function coordinatesToSphereVectors(coordinates, radius) {
  const expanded = [];

  for (let i = 0; i < coordinates.length; i++) {
    const current = coordinates[i];
    const previous = coordinates[i - 1];

    if (i > 0 && needsInterpolation(previous, current)) {
      expanded.push(...interpolatePoints(previous, current));
    } else {
      expanded.push(current);
    }
  }

  return expanded.map((coord) => coordinateToSphereVector(coord, radius));
}

// Two points more than 5 degrees apart (lon or lat) need midpoints so the
// resulting line follows the sphere's curvature instead of cutting through it.
function needsInterpolation(pointA, pointB) {
  const lonDistance = Math.abs(pointA[0] - pointB[0]);
  const latDistance = Math.abs(pointA[1] - pointB[1]);
  return lonDistance > 5 || latDistance > 5;
}

// Recursively bisects [start, end] until every consecutive pair is within
// the 5-degree threshold, returning the full ordered list of points.
function interpolatePoints(start, end) {
  if (!needsInterpolation(start, end)) {
    return [start];
  }

  const midpoint = getMidpoint(start, end);
  return [...interpolatePoints(start, midpoint), ...interpolatePoints(midpoint, end)];
}

function getMidpoint(pointA, pointB) {
  return [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
}

export function coordinateToSphereVector([lon, lat], radius) {
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;

  return new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad) * radius,
    Math.cos(latRad) * Math.sin(lonRad) * radius,
    Math.sin(latRad) * radius
  );
}

function addPoint(container, points, options) {
  container.add(createSpherePoints(points, options));
}

function addLine(container, points, options) {
  container.add(createSphereLine(points, options));
}

// Exported so other modules (e.g. the satellite layer) can plot their own
// markers/paths on the globe without duplicating this setup.
export function createSpherePoints(points, options) {
  const positions = points.flatMap((p) => [p.x, p.y, p.z]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial(options);
  return new THREE.Points(geometry, material);
}

export function createSphereLine(points, options) {
  const positions = points.flatMap((p) => [p.x, p.y, p.z]);

  const lineGeometry = new LineGeometry();
  lineGeometry.setPositions(positions);

  const lineMaterial = new THREE.Line2NodeMaterial({
    color: options?.color ?? 0xffffff,
    linewidth: options?.linewidth ?? 1.2, // world units with size attenuation, pixels otherwise
    fog: true,
    transparent: options?.opacity !== undefined,
    opacity: options?.opacity ?? 1,
  });

  const line = new Line2(lineGeometry, lineMaterial);
  line.computeLineDistances();

  const dashSpeed = Math.random() * 0.0002;
  line.userData.update = (elapsedTime) => {
    lineMaterial.dashOffset = elapsedTime * dashSpeed;
  };

  return line;
}
