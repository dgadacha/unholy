import * as THREE from 'three';

/** Lightweight first-person gloves and sleeves, in the normalized rifle frame. */
export function operatorArms(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'operator-arms';
  const glove = new THREE.MeshStandardMaterial({ color: '#292b25', roughness: 0.94 });
  const sleeve = new THREE.MeshStandardMaterial({ color: '#555849', roughness: 1 });
  const seam = new THREE.MeshStandardMaterial({ color: '#3b3d32', roughness: 1 });
  const up = new THREE.Vector3(0, 1, 0);
  function limb(a: number[], b: number[], r0: number, r1: number, material: THREE.Material): void {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, from.distanceTo(to), 10), material);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, to.sub(from).normalize());
    group.add(mesh);
  }
  function palm(x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), glove);
    mesh.scale.set(0.048, 0.045, 0.06); mesh.position.set(x, y, z); group.add(mesh);
    for (let i = 0; i < 4; i++) {
      limb([x + 0.028, y - 0.027, z + 0.035 - i * 0.02], [x + 0.034, y + 0.026, z + 0.026 - i * 0.02], 0.012, 0.011, glove);
    }
  }
  // Support hand around the vertical foregrip; sleeve continues below frame.
  palm(0.20, 0.005, 0.005);
  limb([0.18, 0.018, -0.04], [-0.26, 0.22, -0.46], 0.045, 0.082, sleeve);
  limb([0.15, 0.037, -0.07], [0.12, 0.052, -0.10], 0.05, 0.052, seam);
  // Firing hand on the pistol grip.
  palm(-0.16, -0.014, -0.105);
  limb([-0.18, -0.014, -0.15], [-0.56, -0.16, -0.4], 0.046, 0.09, sleeve);
  limb([-0.20, -0.022, -0.166], [-0.235, -0.035, -0.19], 0.05, 0.05, seam);
  return group;
}
