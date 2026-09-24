import * as THREE from 'three';
import { Md3Model } from '../../formats/md3';
import { Md3Mesh } from '../../md3/MD3Renderer';
import type { VirtualFileSystem } from '../../formats/pk3';
import type { ShaderLibrary } from '../../formats/shader';
import type { TextureLibrary } from '../../renderer/materials/TextureLibrary';
import { hdMaterials } from '../../renderer/materials/HDMaterialLoader';

export interface EffectSkin { frames: THREE.Texture[]; fps: number; additive: boolean; interpolate: boolean }

/** Sources Q3 locales, partagees par armes et effets. Aucun modele de remplacement. */
export class OriginalAssets {
  private models = new Map<string, Promise<Md3Model | null>>();
  private skins = new Map<string, Promise<EffectSkin | null>>();
  constructor(readonly vfs: VirtualFileSystem, readonly textures: TextureLibrary,
    readonly shaders: ShaderLibrary | null) {}

  model(path: string): Promise<Md3Model | null> {
    let pending = this.models.get(path);
    if (!pending) {
      pending = this.vfs.read(path).then(data => data ? new Md3Model(data, path) : null);
      this.models.set(path, pending);
    }
    return pending;
  }

  skin(name: string): Promise<EffectSkin | null> {
    let pending = this.skins.get(name);
    if (!pending) {
      pending = (async () => {
        await hdMaterials.open();
        const summary = this.shaders?.get(name);
        const paths = summary?.animMaps.length ? summary.animMaps : [summary?.texture ?? name];
        const frames = await Promise.all(paths.map(async path =>
          await hdMaterials.loadColor(path) ?? (await this.textures.load(path))?.map ?? null));
        if (frames.some(frame => !frame)) return null;
        return { frames: frames as THREE.Texture[], fps: summary?.animFrequency ?? 0,
          additive: summary?.additive ?? false, interpolate: (this.shaders?.definition(name)?.stages.length ?? 0) > 1 && frames.length > 1 };
      })();
      this.skins.set(name, pending);
    }
    return pending;
  }

  async mesh(path: string, effect = false, skinName?: string): Promise<Md3Mesh | null> {
    const model = await this.model(path);
    if (!model) return null;
    const mesh = new Md3Mesh(model);
    if (!effect) await mesh.loadTextures(this.textures, this.shaders);
    else {
      await Promise.all(mesh.materials.map(async (material, i) => {
        const skin = await this.skin(skinName ?? model.surfaces[i].shaders[0]);
        material.color.setHex(0x000000);
        material.emissive.setHex(0xffffff);
        material.emissiveMap = skin?.frames[0] ?? null;
        material.emissiveIntensity = 1;
        material.transparent = true;
        material.depthWrite = false;
        material.blending = skin?.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
        // L'alpha appartient a la couleur de la texture, pas a son emission.
        material.map = skin?.frames[0] ?? null;
        material.side = THREE.DoubleSide;
        material.userData.effectSkin = skin;
        prepareEffectBlend(material);
      }));
    }
    mesh.group.traverse(object => { if ((object as THREE.Mesh).isMesh) object.frustumCulled = false; });
    return mesh;
  }
}

export function animateEffect(mesh: Md3Mesh, age: number, duration: number): void {
  const frame = Math.min(mesh.model.frameCount - 1, age / duration * mesh.model.frameCount);
  mesh.setFrames(Math.floor(frame), Math.min(mesh.model.frameCount - 1, Math.floor(frame) + 1), frame % 1);
  for (const material of mesh.materials) {
    const skin = material.userData.effectSkin as EffectSkin | null;
    if (!skin) continue;
    const map = skin.frames[Math.min(skin.frames.length - 1, Math.floor(age * skin.fps))];
    material.map = material.emissiveMap = map;
    const uniforms = material.userData.effectBlend;
    if (uniforms) {
      uniforms.next.value = skin.frames[Math.min(skin.frames.length - 1, Math.floor(age * skin.fps) + 1)];
      uniforms.mix.value = skin.interpolate ? (age * skin.fps) % 1 : 0;
    }
  }
}

/** Les deux animMap successives du shader Q3 se fondent entre deux images. */
export function prepareEffectBlend(material: THREE.MeshStandardMaterial): void {
  const skin = material.userData.effectSkin as EffectSkin | null;
  if (!skin?.frames.length) return;
  const uniforms = { next: { value: skin.frames[0] }, mix: { value: 0 } };
  material.userData.effectBlend = uniforms;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.q3NextFrame = uniforms.next;
    shader.uniforms.q3FrameMix = uniforms.mix;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D q3NextFrame;\nuniform float q3FrameMix;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance,
          texture2D(q3NextFrame, vEmissiveMapUv).rgb * emissive, q3FrameMix);`);
  };
  material.customProgramCacheKey = () => 'md3-original-effect-blend';
}
