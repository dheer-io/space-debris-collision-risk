import * as THREE from "three";
import { positionLocal, color, vec3, range } from "three/tsl";

export default function getStarfield({ numStars = 500, fog = false } = {}) {
  const starGeo = new THREE.IcosahedronGeometry(0.05, 0);

  const brightnessRange = range(0.01, 1.0);
  const mat = new THREE.MeshBasicNodeMaterial({ 
    colorNode: color(0xffffff).mul(brightnessRange),
    fog,
  });

  const phi = range(0, Math.PI * 2);
  const cosTheta = range(-1, 1);
  const radius = range(49, 50);
  const theta = cosTheta.acos();
  const sphericalX = radius.mul(theta.sin()).mul(phi.cos());
  const sphericalY = radius.mul(theta.sin()).mul(phi.sin());
  const sphericalZ = radius.mul(cosTheta);
  const positionRange = vec3(sphericalX, sphericalY, sphericalZ);
  mat.positionNode = positionLocal.add(positionRange);

  const mesh = new THREE.InstancedMesh(starGeo, mat, numStars);

  return mesh;
}
