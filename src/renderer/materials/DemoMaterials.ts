import * as THREE from 'three';
import { surfaceTextures, type SurfaceKind } from './Procedural';
import { hasPhoto, photoLevel, photoRepeat } from './PhotoSurfaces';

/**
 * Couleur a donner au materiau pour qu'une surface photographiee finisse a la
 * clarte que le decor demande.
 *
 * La teinte est divisee par la clarte moyenne de l'image : une photo claire
 * est ainsi rabattue, une photo sombre relevee, et c'est la teinte qui decide
 * du resultat. Les deux erreurs a eviter sont symetriques : appliquer la
 * teinte telle quelle assombrit deux fois, la neutraliser pousse toutes les
 * surfaces au blanc et le couloir passe en plein jour.
 */
function photoColor(kind: SurfaceKind, tint: string): THREE.Color {
  const color = new THREE.Color(tint);
  return color.multiplyScalar(1 / Math.max(0.05, photoLevel(kind)));
}

/** Reglages partages par tous les materiaux de la carte. */
export const RenderConfig = {
  /** Une texture couvre 128 unites de carte. */
  textureScale: 1 / 128,
  lightMapIntensity: 1.6,
  normalScale: 1,
  environmentIntensity: 0.35,
};

export interface SurfaceOptions {
  tint?: string;
  repeat?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  metalness?: number;
}

/** Materiau d'une surface fabriquee par le code. */
export function surfaceMaterial(kind: SurfaceKind, options: SurfaceOptions = {}): THREE.MeshStandardMaterial {
  const tint = options.tint ?? defaultTint(kind);
  const textures = surfaceTextures(kind, tint);
  const repeat = options.repeat ?? 1;

  const photo = hasPhoto(kind);
  const map = textures.map.clone();
  const normalMap = textures.normalMap.clone();
  const roughnessMap = textures.roughnessMap.clone();
  const tiling = repeat * (photo ? photoRepeat(kind) : 1);
  for (const texture of [map, normalMap, roughnessMap]) {
    texture.repeat.set(tiling, tiling);
    texture.needsUpdate = true;
  }
  map.colorSpace = THREE.SRGBColorSpace;

  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    /*
     * Une surface peinte par le code porte deja sa teinte dans ses pixels. Une
     * surface photographiee, non : la teinte devient alors la couleur du
     * materiau. Elle est ramenee a luminance constante avant d'etre appliquee,
     * de sorte qu'elle deplace la couleur sans assombrir l'image : un gris
     * neutre ne change rien, un vert de palier verdit le mur sans l'eteindre.
     */
    color: photo ? photoColor(kind, tint) : '#ffffff',
    normalScale: new THREE.Vector2(RenderConfig.normalScale, RenderConfig.normalScale),
    metalness: options.metalness ?? metalnessFor(kind),
    roughness: 1,
    emissive: new THREE.Color(options.emissive ?? '#000000'),
    emissiveIntensity: options.emissiveIntensity ?? 1,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });
}

function defaultTint(kind: SurfaceKind): string {
  switch (kind) {
    case 'plaster': return '#867c69';
    case 'wood': return '#584333';
    case 'fabric': return '#454b41';
    case 'tile': return '#8b8779';
    case 'metal':
      return '#6a707a';
    case 'floor':
      return '#5d5a55';
    case 'trim':
      return '#8a5b34';
    case 'rock':
      return '#4a443d';
    case 'grate':
      return '#3f444b';
    case 'glow':
      return '#ffb14e';
    case 'water':
      return '#2d5f70';
    case 'ceiling':
      return '#8d8878';
    case 'glass':
      return '#41535a';
  }
}

/*
 * Un metal pur ne diffuse rien : il ne renvoie que ce qui l'entoure. Sans
 * sonde de reflet, une valeur haute rend le decor noir. On reste donc au
 * milieu, et les reflets viennent s'ajouter quand ils sont actifs.
 */
function metalnessFor(kind: SurfaceKind): number {
  switch (kind) {
    case 'metal':
    case 'trim':
    case 'grate':
      return 0.35;
    case 'glow':
      return 0.1;
    case 'water':
      return 0.4;
    default:
      return 0.15;
  }
}
