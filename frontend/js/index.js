import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import getStarfield from "./getStarfield.js";
import { drawThreeGeo } from "./threeGeoJSON.js";
import { initSatelliteLayer } from "./satelliteDisplay.js";

const GLOBE_RADIUS = 2;
const ATMOSPHERE_SCALE = 1.15;
const GLOBE_VISUAL_RADIUS = GLOBE_RADIUS * ATMOSPHERE_SCALE;
const BASE_ROTATION_SPEED = 0.0045; // idle rotation, radians/frame
const SCROLL_IMPULSE_SCALE = 0.0001;
const MAX_ROTATION_SPEED = 0.2;
const SPEED_RECOVERY_RATE = 0.02; // how fast velocity eases back to base speed

const DESKTOP_CAMERA_POSITION = new THREE.Vector3(0, 1.4, 5.4);
const DESKTOP_HERO_SHIFT_X = 2.3;
const DESKTOP_LOOK_RATIO = DESKTOP_CAMERA_POSITION.y / DESKTOP_CAMERA_POSITION.z;

// Mobile hero text is centered (no room for a side-by-side split), so the
// globe only needs a gentle offset instead of desktop's hard right-shift.
const MOBILE_BREAKPOINT = 700;
const MOBILE_HERO_SHIFT_X = 0;
const MOBILE_VIEWPORT_MARGIN = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 100);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.domElement.id = "globe-canvas";
document.body.prepend(renderer.domElement);

// Canvas size is CSS-driven (narrower in desktop explore mode, shorter on
// mobile — see #globe-canvas in style.css), so read the actual rendered box
// rather than window.innerWidth/innerHeight. `setSize(..., false)` avoids
// Three.js writing an inline style that would override the CSS rule.
function syncRendererSize() {
  const { width, height } = renderer.domElement.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
}
syncRendererSize();

// getBoundingClientRect() forces a layout read, so only resync during an
// active resize/transition window, not every frame forever.
let resizeSyncUntil = 0;
function requestResizeSync(durationMs = 1200) {
  resizeSyncUntil = performance.now() + durationMs;
}

// Disabled by default (landing page drives the camera itself); explore mode
// hands control to this so the globe becomes draggable/zoomable.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 10;
controls.enabled = false;

const globeGroup = new THREE.Group(); // everything that spins/slides together
scene.add(globeGroup);

const heroEl = document.querySelector(".hero");

// Globe sits right of the hero text, sliding to center by a full scroll of hero height.
let heroShiftX = DESKTOP_HERO_SHIFT_X;

// On a narrow phone frustum, the desktop's fixed offset can push the globe
// off-screen — pull the camera back until it comfortably fits instead.
// Also sets heroShiftX as a side effect (every caller needs both together).
function computeHeroCameraPosition() {
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;

  if (!isMobile) {
    heroShiftX = DESKTOP_HERO_SHIFT_X;
    return DESKTOP_CAMERA_POSITION.clone();
  }

  // Full-viewport ratio, not camera.aspect: this solves for the landing
  // page's full-bleed framing, but camera.aspect can be mid-transition
  // (e.g. exitExploreMode() while the canvas is still short on mobile) and
  // would otherwise land the tween at the wrong distance.
  const heroAspect = window.innerWidth / window.innerHeight;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const neededHalfWidth = GLOBE_VISUAL_RADIUS + MOBILE_HERO_SHIFT_X + MOBILE_VIEWPORT_MARGIN;
  const distance = neededHalfWidth / (Math.tan(verticalFov / 2) * heroAspect);

  heroShiftX = MOBILE_HERO_SHIFT_X;
  return new THREE.Vector3(0, distance * DESKTOP_LOOK_RATIO, distance);
}

// Instant version — initial load and landing-page resizes. Exiting explore
// mode uses animateExitTransition() instead so it doesn't jump-cut.
function updateCameraFraming() {
  camera.position.copy(computeHeroCameraPosition());
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

const satelliteLayer = initSatelliteLayer({ globeGroup, globeRadius: GLOBE_RADIUS, controls });
satelliteLayer.loadCatalogOnce(); // load right away so satellites are already orbiting on the landing page

function buildGlobeShell() {
  const sphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 32, 16);

  const graticuleMaterial = new THREE.LineBasicMaterial({
    color: 0x3e7094,
    transparent: true,
    opacity: 0.08,
  });
  const graticule = new THREE.LineSegments(new THREE.EdgesGeometry(sphereGeometry, 1), graticuleMaterial);
  globeGroup.add(graticule);

  // Opaque inner shell blocks the far side from showing through the near side.
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x030712,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(sphereGeometry, shellMaterial);
  shell.scale.setScalar(0.99);
  globeGroup.add(shell);

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

// SCROLL-DRIVEN SPIN — scroll nudges rotation faster/slower, eases back to idle.
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

// EXPLORE MODE — swaps the scroll-driven camera for free OrbitControls
// dragging/zooming while style.css slides the page content away.
let exploreMode = false;
const exploreToggles = document.querySelectorAll(".explore-toggle"); // hero + bottom CTA
const exploreExit = document.getElementById("explore-exit");

// Matches --explore-transition-duration in style.css so this finishes exactly
// when the surrounding CSS transitions do.
const EXPLORE_TRANSITION_MS = 1200;
let exploreExitTween = null;
let exploreEnterTween = null;

// Explore mode assumes globeGroup.position.x === 0 (OrbitControls always
// targets world origin). Entering via the hero CTA mid-parallax breaks that
// assumption, so ease it back to 0 on entry too.
function animateEnterTransition() {
  exploreEnterTween = {
    globeXFrom: globeGroup.position.x,
    globeXTo: 0,
    startTime: performance.now(),
  };
}

// Quaternion slerp (not lerped XYZ, not decoupled phi/theta) for the camera
// direction: a straight lerp can swing through the globe, and phi/theta goes
// numerically unstable looking straight down — slerp has neither failure mode.
function animateExitTransition() {
  const cameraTo = computeHeroCameraPosition(); // also updates heroShiftX as a side effect

  exploreExitTween = {
    fromDistance: camera.position.length(),
    toDistance: cameraTo.length(),
    fromQuat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), camera.position.clone().normalize()),
    toQuat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cameraTo.clone().normalize()),
    globeXFrom: globeGroup.position.x,
    globeXTo: heroShiftX,
    startTime: performance.now(),
  };
}

// `behavior: "instant"` bypasses html/body's scroll-behavior:smooth, so
// scrollY actually lands on 0 in the same frame instead of racing the tween.
function resetScroll() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

function enterExploreMode() {
  exploreMode = true;
  document.body.classList.add("explore-mode");
  resetScroll();
  controls.enabled = true;
  animateEnterTransition();
  requestResizeSync(); // canvas is about to animate narrower on desktop
}

function exitExploreMode() {
  exploreMode = false;
  document.body.classList.remove("explore-mode");
  resetScroll();
  controls.enabled = false;
  exploreEnterTween = null; // in case exit happens mid-enter-transition
  animateExitTransition();
  requestResizeSync(); // canvas is about to animate back to full size
}

exploreToggles.forEach((toggle) => toggle.addEventListener("click", enterExploreMode));
exploreExit?.addEventListener("click", exitExploreMode);

// NAV — mobile menu is a plain open/closed class toggle; desktop never
// triggers it since .site-nav-toggle is display:none above 700px.
const siteNav = document.getElementById("site-nav");
const siteNavToggle = document.getElementById("site-nav-toggle");
siteNavToggle?.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("site-nav--open");
  siteNavToggle.setAttribute("aria-expanded", String(isOpen));
});
// Scoped to .site-nav-links, not all of .site-nav — #site-nav-toggle is a
// button too, and closing here after its own handler just opened it would
// fight that handler on the very same click.
// Closing on link click matters even for the explore-toggle button here —
// otherwise the menu stays open underneath once .page slides away.
document.querySelectorAll("#site-nav-links a, #site-nav-links button").forEach((el) => {
  el.addEventListener("click", () => {
    siteNav.classList.remove("site-nav--open");
    siteNavToggle?.setAttribute("aria-expanded", "false");
  });
});

// Nav has no background at rest (see style.css) — .site-nav--scrolled fades
// in a faint scrim only once there's actual page content behind the bar,
// not from scroll position 0.
const NAV_SCROLL_THRESHOLD_PX = 40;
function updateNavScrolledState() {
  siteNav?.classList.toggle("site-nav--scrolled", window.scrollY > NAV_SCROLL_THRESHOLD_PX);
}
window.addEventListener("scroll", updateNavScrolledState, { passive: true });
updateNavScrolledState();

function animate() {
  if (performance.now() < resizeSyncUntil) {
    syncRendererSize();
  }

  if (exploreMode) {
    if (exploreEnterTween) {
      const t = Math.min((performance.now() - exploreEnterTween.startTime) / EXPLORE_TRANSITION_MS, 1);
      const eased = THREE.MathUtils.smoothstep(t, 0, 1);
      globeGroup.position.x = THREE.MathUtils.lerp(exploreEnterTween.globeXFrom, exploreEnterTween.globeXTo, eased);
      if (t === 1) exploreEnterTween = null;
    }
    controls.update();
  } else {
    if (exploreExitTween) {
      const { fromDistance, toDistance, fromQuat, toQuat } = exploreExitTween;
      const t = Math.min((performance.now() - exploreExitTween.startTime) / EXPLORE_TRANSITION_MS, 1);
      const eased = THREE.MathUtils.smoothstep(t, 0, 1);

      const distance = THREE.MathUtils.lerp(fromDistance, toDistance, eased);
      const quat = fromQuat.clone().slerp(toQuat, eased);
      camera.position.set(0, 0, 1).applyQuaternion(quat).multiplyScalar(distance);
      camera.lookAt(0, 0, 0);

      globeGroup.position.x = THREE.MathUtils.lerp(exploreExitTween.globeXFrom, exploreExitTween.globeXTo, eased);

      if (t === 1) exploreExitTween = null;
    } else {
      // Matches globeXTo above (heroProgress is 0 right after exiting), so the handoff never jumps.
      const heroProgress = THREE.MathUtils.smoothstep(getHeroScrollProgress(), 0, 1);
      globeGroup.position.x = THREE.MathUtils.lerp(heroShiftX, 0, heroProgress);
    }

    globeGroup.rotation.y += rotationVelocity;
    rotationVelocity += (BASE_ROTATION_SPEED - rotationVelocity) * SPEED_RECOVERY_RATE;
  }

  satelliteLayer.update(Date.now());

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// Mobile address-bar collapse fires "resize" on height only, never width —
// gate on width so that noise doesn't yank the hero camera around.
let lastFramingWidth = window.innerWidth;

function handleWindowResize() {
  requestResizeSync();

  const widthChanged = Math.abs(window.innerWidth - lastFramingWidth) > 2;

  // Skip in explore mode (camera belongs to OrbitControls) and mid exit-tween
  // (would fight animate()'s own interpolation).
  if (!exploreMode && !exploreExitTween && widthChanged) {
    updateCameraFraming();
    lastFramingWidth = window.innerWidth;
  }
}
window.addEventListener("resize", handleWindowResize);
window.addEventListener("orientationchange", handleWindowResize);
