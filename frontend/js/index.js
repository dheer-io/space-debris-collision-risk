import * as THREE from "three";
import getStarfield from "./getStarfield.js";
import { drawThreeGeo } from "./threeGeoJSON.js";

const GLOBE_RADIUS = 2;
const ATMOSPHERE_SCALE = 1.15;
const GLOBE_VISUAL_RADIUS = GLOBE_RADIUS * ATMOSPHERE_SCALE;
const BASE_ROTATION_SPEED = 0.0045; // idle rotation, radians/frame
const SCROLL_IMPULSE_SCALE = 0.00015;
const MAX_ROTATION_SPEED = 0.2;
const SPEED_RECOVERY_RATE = 0.02; // how fast velocity eases back to base speed

// Desktop camera framing — unchanged from before.
const DESKTOP_CAMERA_POSITION = new THREE.Vector3(0, 1.4, 5.4);
const DESKTOP_HERO_SHIFT_X = 2.3;
const DESKTOP_LOOK_RATIO = DESKTOP_CAMERA_POSITION.y / DESKTOP_CAMERA_POSITION.z;

// Mobile (portrait) breakpoint and framing. The hero text is centered on
// mobile (no room for a side-by-side split), so the globe only needs a
// gentle offset rather than the desktop's hard right-shift.
const MOBILE_BREAKPOINT = 700;
const MOBILE_HERO_SHIFT_X = 0.5;
const MOBILE_VIEWPORT_MARGIN = 0.4;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.id = "globe-canvas";
document.body.prepend(renderer.domElement);

// Everything that makes up the globe lives in this group so it can spin —
// and slide — as one piece.
const globeGroup = new THREE.Group();
scene.add(globeGroup);

const heroEl = document.querySelector(".hero");

// In the hero, the globe sits off to the right of the text; by the time
// you've scrolled a full hero-height (i.e. into the "Problem" section) it
// has slid back to center.
let heroShiftX = DESKTOP_HERO_SHIFT_X;

// A portrait phone's frustum is much narrower (in world units) than a
// desktop window's at the same distance — the same fixed offset that looks
// right on desktop can push most of the globe off-screen on a phone, or the
// globe itself can be wider than the frustum. So on narrow screens we pull
// the camera back until the globe plus its hero-side shift both comfortably
// fit, instead of reusing the desktop framing as-is.
function updateCameraFraming() {
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;

  if (!isMobile) {
    camera.position.copy(DESKTOP_CAMERA_POSITION);
    heroShiftX = DESKTOP_HERO_SHIFT_X;
  } else {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const neededHalfWidth = GLOBE_VISUAL_RADIUS + MOBILE_HERO_SHIFT_X + MOBILE_VIEWPORT_MARGIN;
    const distance = neededHalfWidth / (Math.tan(verticalFov / 2) * camera.aspect);

    camera.position.set(0, distance * DESKTOP_LOOK_RATIO, distance);
    heroShiftX = MOBILE_HERO_SHIFT_X;
  }

  camera.lookAt(0, 0, 0);
}

function getHeroScrollProgress() {
  const heroHeight = heroEl?.offsetHeight || window.innerHeight;
  return THREE.MathUtils.clamp(window.scrollY / heroHeight, 0, 1);
}

updateCameraFraming();

buildGlobeShell();
scene.add(getStarfield({ numStars: 1000, fog: false }));
loadLandmasses();
loadCountryBorders();

function buildGlobeShell() {
  const sphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 32, 16);

  // Latitude/longitude grid, brightened so the globe's orientation is visible.
  const graticuleMaterial = new THREE.LineBasicMaterial({
    color: 0x3e7094,
    transparent: true,
    opacity: 0.08,
  });
  const graticule = new THREE.LineSegments(
    new THREE.EdgesGeometry(sphereGeometry, 1),
    graticuleMaterial
  );
  globeGroup.add(graticule);

  // Fully opaque inner shell: blocks the far side of the globe from showing
  // through the near side (opaque objects render, and write depth, before
  // any transparent geometry like the coastline/border lines).
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x030712,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(sphereGeometry, shellMaterial);
  shell.scale.setScalar(0.99);
  globeGroup.add(shell);

  // Soft rim-light "atmosphere" so the globe's silhouette reads clearly
  // against the black background.
  const atmosphereMaterial = new THREE.MeshBasicMaterial({
    color: 0x4d9fff,
    transparent: true,
    opacity: 0.03,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const atmosphere = new THREE.Mesh(sphereGeometry, atmosphereMaterial);
  atmosphere.scale.setScalar(ATMOSPHERE_SCALE);
  globeGroup.add(atmosphere);
}

function loadLandmasses() {
  fetch("../geojson/ne_110m_land.json")
    .then((response) => response.json())
    .then((geojson) => {
      const landmasses = drawThreeGeo({
        json: geojson,
        radius: GLOBE_RADIUS,
        materialOptions: { color: 0xffffff },
      });
      globeGroup.add(landmasses);
    });
}

function loadCountryBorders() {
  fetch("../geojson/countries.json")
    .then((response) => response.json())
    .then((geojson) => {
      const borders = drawThreeGeo({
        json: geojson,
        radius: GLOBE_RADIUS,
        materialOptions: { color: 0xffffff, linewidth: 1, opacity: 0.2 },
      });
      globeGroup.add(borders);
    });
}

// SCROLL-DRIVEN SPIN
// Scrolling down nudges the globe to spin faster forward; scrolling up nudges
// it backward. Either way it eases back to a slow idle spin once you stop.
let rotationVelocity = BASE_ROTATION_SPEED;
let lastScrollY = window.scrollY;

function handleScroll() {
  const currentScrollY = window.scrollY;
  const scrollDelta = currentScrollY - lastScrollY;
  lastScrollY = currentScrollY;

  rotationVelocity = THREE.MathUtils.clamp(
    rotationVelocity + scrollDelta * SCROLL_IMPULSE_SCALE,
    -MAX_ROTATION_SPEED,
    MAX_ROTATION_SPEED
  );
}
window.addEventListener("scroll", handleScroll, { passive: true });

function animate() {
  globeGroup.rotation.y += rotationVelocity;
  rotationVelocity += (BASE_ROTATION_SPEED - rotationVelocity) * SPEED_RECOVERY_RATE;

  const heroProgress = THREE.MathUtils.smoothstep(getHeroScrollProgress(), 0, 1);
  globeGroup.position.x = THREE.MathUtils.lerp(heroShiftX, 0, heroProgress);

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

function handleWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);

  updateCameraFraming();
}
window.addEventListener("resize", handleWindowResize);
window.addEventListener("orientationchange", handleWindowResize);
