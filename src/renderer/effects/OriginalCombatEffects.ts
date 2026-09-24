import * as THREE from 'three';
import { Md3Mesh } from '../../md3/MD3Renderer';
import { OriginalAssets, animateEffect, prepareEffectBlend, type EffectSkin } from '../../game/weapons/OriginalAssets';
import { ORIGINAL_DIRECTORIES } from '../../game/weapons/OriginalWeaponRig';
import type { WeaponId } from '../../game/weapons/WeaponDefs';
import type { DynamicLightManager } from '../lighting/DynamicLightManager';

const IMPACTS: Record<string, [string, string, number, number]> = {
  machinegun: ['models/weaphits/bullet.md3', 'bulletExplosion', 0.6, 8],
  shotgun: ['models/weaphits/bullet.md3', 'bulletExplosion', 0.6, 4],
  lightning: ['models/weaphits/crackle.md3', '', 0.15, 12],
  railgun: ['models/weaphits/ring02.md3', 'railExplosion', 0.6, 24],
  plasma: ['models/weaphits/ring02.md3', 'plasmaExplosion', 0.6, 16],
  rocket: ['', 'rocketExplosion', 1, 64],
  grenade: ['', 'grenadeExplosion', 0.6, 64],
  bfg: ['', 'bfgExplosion', 0.6, 32],
};
const PROJECTILES: Partial<Record<WeaponId, string>> = {
  rocket: 'models/ammo/rocket/rocket.md3', grenade: 'models/ammo/grenade1.md3', bfg: 'models/weaphits/bfg.md3',
};
interface LocalEffect {
  object: THREE.Object3D; age: number; duration: number; size: number;
  skin?: EffectSkin; md3?: Md3Mesh; velocity?: THREE.Vector3; gravity?: number;
  fade?: boolean; grow?: boolean; material?: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
}

/** Effets bases sur les medias de cg_weapons.c. Reservations bornees et ressources partagees. */
export class OriginalCombatEffects {
  readonly root = new THREE.Group();
  enabled = false;
  ready: Promise<void> = Promise.resolve();
  private generation = 0;
  private skins = new Map<string, EffectSkin>();
  private models = new Map<string, Md3Mesh>();
  private live: LocalEffect[] = [];
  private camera = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(1, 0, 0);
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  constructor(private lights: DynamicLightManager) { this.root.name = 'original-weapon-effects'; }

  configure(assets: OriginalAssets | null): void {
    this.clear(); this.enabled = !!assets;
    const generation = ++this.generation;
    for (const model of this.models.values()) model.dispose();
    this.models.clear(); this.skins.clear();
    if (!assets) { this.ready = Promise.resolve(); return; }
    this.ready = (async () => {
      const skins = ['smokePuff', 'railCore', 'railDisc', 'lightningBoltNew', 'sprites/plasma1',
        'gfx/damage/bullet_mrk', 'gfx/damage/burn_med_mrk', 'gfx/damage/plasma_mrk',
        ...Object.values(IMPACTS).map(value => value[1]).filter(Boolean)];
      const models = [...Object.values(PROJECTILES), 'models/weapons2/shells/m_shell.md3',
        'models/weapons2/shells/s_shell.md3', ...Object.values(IMPACTS).map(value => value[0]).filter(Boolean),
        ...Object.values(ORIGINAL_DIRECTORIES).map(dir => `models/weapons2/${dir}/${dir}_flash.md3`)];
      await Promise.all(skins.map(async key => {
        const skin = await assets.skin(key);
        if (skin && generation === this.generation) this.skins.set(key, skin);
      }));
      await Promise.all([...new Set(models)].map(async key => {
        const impact = Object.values(IMPACTS).find(value => value[0] === key);
        const mesh = await assets.mesh(key, key.includes('_flash') || !!impact, impact?.[1] || undefined);
        if (!mesh) return;
        if (generation !== this.generation) { mesh.dispose(); return; }
        this.models.set(key, mesh);
      }));
    })().catch(error => console.warn('Original weapon assets:', error));
  }

  private add(effect: LocalEffect): void {
    if (this.live.length >= 128) this.remove(0);
    this.live.push(effect); this.root.add(effect.object);
  }
  private remove(index: number): void {
    const effect = this.live[index];
    this.root.remove(effect.object);
    effect.md3?.dispose(); effect.material?.dispose();
    this.live.splice(index, 1);
  }
  private cloneModel(path: string): Md3Mesh | null {
    const template = this.models.get(path);
    if (!template) return null;
    const mesh = new Md3Mesh(template.model);
    mesh.materials.forEach((material, i) => {
      // Garder le programme d'interpolation MD3 propre a cette instance.
      // Material.copy serialise userData : les textures restent des ressources partagees.
      const source = Object.create(template.materials[i]) as THREE.MeshStandardMaterial;
      source.userData = {};
      material.copy(source);
      material.userData.effectSkin = template.materials[i].userData.effectSkin;
      prepareEffectBlend(material);
    });
    return mesh;
  }
  private sprite(name: string, position: THREE.Vector3, size: number, duration: number,
    fade = false, grow = false, color = 0xffffff): LocalEffect | null {
    const skin = this.skins.get(name); if (!skin) return null;
    const material = new THREE.SpriteMaterial({ map: skin.frames[0], color,
      blending: skin.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false,
      transparent: true, rotation: Math.random() * Math.PI * 2, toneMapped: false });
    const frameUniforms = { next: { value: skin.frames[0] }, mix: { value: 0 } };
    material.userData.frameUniforms = frameUniforms;
    material.onBeforeCompile = shader => {
      shader.uniforms.q3NextFrame = frameUniforms.next;
      shader.uniforms.q3FrameMix = frameUniforms.mix;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D q3NextFrame;\nuniform float q3FrameMix;')
        .replace('#include <map_fragment>', 'diffuseColor *= mix(texture2D(map, vMapUv), texture2D(q3NextFrame, vMapUv), q3FrameMix);');
    };
    material.customProgramCacheKey = () => 'q3-sprite-animmap';
    const object = new THREE.Sprite(material); object.position.copy(position); object.scale.setScalar(size * 2);
    const effect = { object, material, skin, age: 0, duration, size, fade, grow };
    this.add(effect); return effect;
  }

  flash(weapon: WeaponId, position: THREE.Vector3, direction: THREE.Vector3, drawFlash = true): void {
    const dir = ORIGINAL_DIRECTORIES[weapon];
    const md3 = drawFlash ? this.cloneModel(`models/weapons2/${dir}/${dir}_flash.md3`) : null;
    if (md3) {
      md3.group.position.copy(position); md3.group.quaternion.setFromUnitVectors(this.axis, direction);
      md3.group.rotateX((Math.random() * 20 - 10) * Math.PI / 180);
      this.add({ object: md3.group, md3, age: 0, duration: 0.02, size: 1 });
    }
    if (weapon === 'machinegun' || weapon === 'shotgun') this.casing(weapon, position, direction);
  }

  private casing(weapon: WeaponId, position: THREE.Vector3, direction: THREE.Vector3): void {
    const count = weapon === 'shotgun' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const path = `models/weapons2/shells/${weapon === 'shotgun' ? 's' : 'm'}_shell.md3`;
      const md3 = this.cloneModel(path); if (!md3) continue;
      md3.group.position.copy(position).addScaledVector(direction, -12);
      const right = new THREE.Vector3(direction.y, -direction.x, 0).normalize();
      this.add({ object: md3.group, md3, age: 0, duration: 2.5, size: 1, gravity: 800,
        velocity: right.multiplyScalar(70 + Math.random() * 50).add(new THREE.Vector3(0, 0, 80)) });
    }
  }

  impact(weapon: WeaponId, point: THREE.Vector3, normal = new THREE.Vector3(0, 0, 1), marks = true): void {
    const profile = IMPACTS[weapon]; if (!profile) return;
    const [path, shader, duration, radius] = profile;
    const position = point.clone().addScaledVector(normal, 1);
    if (path) {
      const md3 = this.cloneModel(path);
      if (md3) {
        md3.group.position.copy(position); md3.group.quaternion.setFromUnitVectors(this.axis, normal);
        this.add({ object: md3.group, md3, age: 0, duration, size: 1 });
      }
    } else {
      this.sprite(shader, position, radius, duration, false, true);
      this.lights.add({ position: [point.x, point.y, point.z], color: new THREE.Color(1, 0.75, 0),
        intensity: 300, radius: 300, duration: 0.5, kind: 'ambientEvent', priority: 60 });
    }
    if (marks) this.mark(weapon, position, normal, radius);
  }

  private mark(weapon: WeaponId, position: THREE.Vector3, normal: THREE.Vector3, radius: number): void {
    const name = weapon === 'machinegun' || weapon === 'shotgun' ? 'gfx/damage/bullet_mrk'
      : weapon === 'rocket' || weapon === 'grenade' || weapon === 'bfg' ? 'gfx/damage/burn_med_mrk' : 'gfx/damage/plasma_mrk';
    const skin = this.skins.get(name); if (!skin) return;
    const material = new THREE.MeshBasicMaterial({ map: skin.frames[0], transparent: true, depthWrite: false,
      blending: skin.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    if (name !== 'gfx/damage/plasma_mrk') {
      material.blending = THREE.CustomBlending;
      material.blendSrc = THREE.ZeroFactor;
      material.blendDst = THREE.OneMinusSrcColorFactor;
      material.userData.inverseMultiply = true;
      material.toneMapped = false;
    }
    const object = new THREE.Mesh(this.plane, material);
    object.position.copy(position); object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    object.rotateZ(Math.random() * Math.PI * 2); object.scale.setScalar(radius * 2);
    this.add({ object, material, age: 0, duration: 10, size: radius, fade: true });
  }

  beam(kind: 'rail' | 'lightning', from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color): void {
    const skin = this.skins.get(kind === 'rail' ? 'railCore' : 'lightningBoltNew'); if (!skin) return;
    const direction = to.clone().sub(from), length = direction.length(); if (length < 1) return;
    const width = kind === 'rail' ? 6 : 16;
    // Ruban face au regard, comme les polys du renderer Q3.
    const side = new THREE.Vector3().crossVectors(direction, this.camera.clone().sub(from)).normalize().multiplyScalar(width / 2);
    const vertices = [from.clone().add(side), from.clone().sub(side), to.clone().sub(side), to.clone().add(side)];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(v => v.toArray()), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, length / 256, 0, length / 256, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const material = new THREE.MeshBasicMaterial({ map: skin.frames[0], color: kind === 'rail' ? color : 0xffffff,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const object = new THREE.Mesh(geometry, material);
    object.addEventListener('removed', () => geometry.dispose());
    this.add({ object, material, age: 0, duration: kind === 'rail' ? 0.4 : 0.06, size: 1, fade: true });
    if (kind === 'rail') {
      for (let d = 0; d < length && d < 4096; d += Math.max(32, Math.min(length, 4096) / 48)) {
        const p = from.clone().addScaledVector(direction, d / length);
        this.sprite('railDisc', p.addScaledVector(side, Math.sin(d / 20)), 2, 0.4, true, false, color.getHex());
      }
    }
  }

  projectile(weapon: WeaponId): THREE.Object3D | null {
    const path = PROJECTILES[weapon];
    if (path) return this.models.get(path)?.group.clone(true) ?? null;
    if (weapon === 'plasma') {
      const skin = this.skins.get('sprites/plasma1'); if (!skin) return null;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: skin.frames[0], blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.scale.setScalar(32); return sprite;
    }
    return null;
  }

  trail(weapon: WeaponId, point: THREE.Vector3): void {
    if (weapon === 'bfg') return;
    if (weapon === 'plasma') { this.sprite('railDisc', point, 0.25, 0.6, true); return; }
    this.sprite('smokePuff', point, weapon === 'rocket' ? 64 : 32, weapon === 'rocket' ? 2 : 0.7, true, true);
  }

  update(delta: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.camera);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const effect = this.live[i]; effect.age += delta;
      if (effect.age >= effect.duration) { this.remove(i); continue; }
      if (effect.md3) animateEffect(effect.md3, effect.age, effect.duration);
      if (effect.material && effect.skin) {
        const frame = effect.age * effect.skin.fps;
        effect.material.map = effect.skin.frames[Math.min(effect.skin.frames.length - 1, Math.floor(frame))];
        const uniforms = effect.material.userData.frameUniforms;
        if (uniforms) {
          uniforms.next.value = effect.skin.frames[Math.min(effect.skin.frames.length - 1, Math.floor(frame) + 1)];
          uniforms.mix.value = effect.skin.interpolate ? frame % 1 : 0;
        }
      }
      const t = effect.age / effect.duration;
      if (effect.material && effect.fade) {
        effect.material.opacity = 1 - t;
        if (effect.material.userData.inverseMultiply) effect.material.color.setScalar(1 - t);
      }
      if (effect.grow) effect.object.scale.setScalar(effect.size * 2 * (0.3 + t));
      if (effect.velocity) {
        effect.velocity.z -= (effect.gravity ?? 0) * delta;
        effect.object.position.addScaledVector(effect.velocity, delta);
        effect.object.rotateX(delta * 8);
      }
    }
  }
  clear(): void { while (this.live.length) this.remove(this.live.length - 1); }
  get count(): number { return this.live.length; }
}
