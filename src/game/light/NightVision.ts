import * as THREE from 'three';

/** Active IR illuminator: geometry still occludes the beam. Green output is postprocessed. */
export class NightVision {
  readonly light = new THREE.SpotLight('#ffffff', 5500, 1100, 1.05, 0.65, 1);
  constructor() {
    this.light.name = 'night-vision-illuminator';
    this.light.visible = false;
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 2;
    this.light.shadow.camera.far = 1100;
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.4;
  }
  attach(scene: THREE.Scene): void {
    scene.add(this.light, this.light.target);
  }
  update(eye: THREE.Vector3, direction: THREE.Vector3, enabled: boolean): void {
    this.light.visible = enabled;
    if (!enabled) return;
    this.light.position.copy(eye);
    this.light.target.position.copy(eye).addScaledVector(direction, 500);
    this.light.target.updateMatrixWorld();
  }
}
