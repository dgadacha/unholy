import * as THREE from 'three';
import { parseAnimationConfig } from '../../formats/md3';
import { Md3Mesh } from '../../md3/MD3Renderer';
import { OriginalAssets, animateEffect } from './OriginalAssets';
import type { WeaponId } from './WeaponDefs';

export const ORIGINAL_DIRECTORIES: Record<WeaponId, string> = {
  gauntlet: 'gauntlet', machinegun: 'machinegun', shotgun: 'shotgun', grenade: 'grenadel',
  rocket: 'rocketl', lightning: 'lightning', railgun: 'railgun', plasma: 'plasma', bfg: 'bfg',
};

/** CG_MapTorsoToWeaponFrame : idle 0, attack 1..6, drop 6..14. */
export function weaponFrames(age: number, fps: number, dropping = false) {
  const first = dropping ? 6 : 1, count = dropping ? 9 : 6;
  const cursor = Math.max(0, age * fps);
  if (cursor >= count) return { a: dropping ? 14 : 0, b: dropping ? 14 : 0, mix: 0 };
  const a = first + Math.floor(cursor);
  return { a, b: Math.min(first + count - 1, a + 1), mix: cursor % 1 };
}

/** CG_MachinegunSpinAngle : 0,9 deg/ms, puis roue libre pendant une seconde. */
export class BarrelSpin {
  private angle = 0;
  private time = 0;
  private spinning = false;
  update(now: number, firing: boolean): number {
    const delta = Math.max(0, now - this.time) * 1000;
    const coast = Math.min(delta, 1000);
    const value = this.angle + (this.spinning ? delta * 0.9 : coast * 0.5 * (0.9 + (1000 - coast) / 1000));
    if (this.spinning !== firing) { this.angle = value % 360; this.time = now; this.spinning = firing; }
    return THREE.MathUtils.degToRad(value);
  }
}

export class OriginalWeaponRig {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Group();
  /** Les MD3 du jeu portent leur eclat de tir dans le modele lui-meme. */
  readonly hasOwnFlash = true;
  private readonly barrelMount = new THREE.Group();
  private readonly spin = new BarrelSpin();
  private readonly matrix = new THREE.Matrix4();
  private time = 0;
  private firedAt = -100;
  private attackAge = 100;
  private dropAge = -1;
  private constructor(readonly id: WeaponId, readonly hand: Md3Mesh, readonly gun: Md3Mesh,
    readonly barrel: Md3Mesh | null, readonly flash: Md3Mesh | null, readonly attackFps: number) {
    this.group.name = `original-${id}`;
    this.group.add(gun.group);
    gun.group.add(this.barrelMount, this.muzzle);
    if (barrel) this.barrelMount.add(barrel.group);
    if (flash) { this.muzzle.add(flash.group); flash.group.visible = false; }
    this.update(0);
  }

  static async load(assets: OriginalAssets, id: WeaponId): Promise<OriginalWeaponRig | null> {
    const directory = ORIGINAL_DIRECTORIES[id], base = `models/weapons2/${directory}/${directory}`;
    const [gun, handModel, barrel, flash, config] = await Promise.all([
      assets.mesh(`${base}.md3`), assets.model(`${base}_hand.md3`),
      assets.mesh(`${base}_barrel.md3`), assets.mesh(`${base}_flash.md3`, true),
      assets.vfs.readText('models/players/sarge/animation.cfg'),
    ]);
    const fallback = handModel ?? await assets.model('models/weapons2/shotgun/shotgun_hand.md3');
    if (!gun || !fallback) { gun?.dispose(); barrel?.dispose(); flash?.dispose(); return null; }
    const animation = parseAnimationConfig(config ?? '')[id === 'gauntlet' ? 8 : 7];
    return new OriginalWeaponRig(id, new Md3Mesh(fallback), gun, barrel, flash, animation?.fps ?? 20);
  }

  fire(): void {
    this.firedAt = this.time;
    // Les tirs automatiques ne recommencent pas sans cesse la premiere pose.
    if (this.attackAge * this.attackFps >= 6) this.attackAge = 0;
    if (this.flash) this.flash.group.rotation.x = (Math.random() * 20 - 10) * Math.PI / 180;
  }
  drop(): void { this.dropAge = 0; }
  reset(): void { this.dropAge = -1; this.attackAge = 100; this.firedAt = -100; this.update(0); }

  update(delta: number): void {
    this.time += delta;
    this.attackAge += delta;
    if (this.dropAge >= 0) this.dropAge += delta;
    const pose = weaponFrames(this.dropAge >= 0 ? this.dropAge : this.attackAge,
      this.dropAge >= 0 ? 40 : this.attackFps, this.dropAge >= 0);
    this.hand.setFrames(pose.a, pose.b, pose.mix);
    if (this.hand.tagMatrix('tag_weapon', this.matrix)) this.matrix.decompose(this.gun.group.position, this.gun.group.quaternion, this.gun.group.scale);
    if (this.gun.tagMatrix('tag_barrel', this.matrix)) this.matrix.decompose(this.barrelMount.position, this.barrelMount.quaternion, this.barrelMount.scale);
    if (this.gun.tagMatrix('tag_flash', this.matrix)) this.matrix.decompose(this.muzzle.position, this.muzzle.quaternion, this.muzzle.scale);
    const firing = this.time - this.firedAt < (this.id === 'gauntlet' ? 0.4 : 0.11);
    if (this.barrel) this.barrel.group.rotation.x = this.spin.update(this.time, firing);
    if (this.flash) {
      this.flash.group.visible = this.time - this.firedAt < (this.id === 'lightning' || this.id === 'gauntlet' ? 0.11 : 0.02);
      animateEffect(this.flash, this.time - this.firedAt, 0.02);
    }
  }
}
