import * as THREE from 'three';
import { Contents, type Vec3 } from '../../formats/bsp';
import { boxBrush, type CollisionBrush } from '../collision';
import { surfaceMaterial, RenderConfig } from '../../renderer/materials/DemoMaterials';
import type { SurfaceKind } from '../../renderer/materials/Procedural';

/**
 * Pose un decor bloc par bloc.
 *
 * Un bloc pose en meme temps sa geometrie et son volume de collision : ce qu'on
 * voit est exactement ce qui arrete le joueur, et il n'y a pas de fichier de
 * carte a compiler. Les faces de meme materiau sont regroupees en un seul
 * maillage, de sorte qu'un immeuble entier coute quelques dizaines d'appels de
 * dessin.
 *
 * C'est le constructeur de l'arene de mise au point et celui du niveau du jeu :
 * les deux decors sortent du meme outil.
 */

interface BlockOptions {
  kind: SurfaceKind;
  tint?: string;
  emissive?: string;
  /** Faces a ne pas dessiner, par exemple le dessous d'une dalle. */
  skip?: Face[];
  contents?: number;
  /** Bloc traversable : decor, eau, volume de declenchement. */
  solid?: boolean;
  opacity?: number;
  /** Bloc qui ne porte pas d'ombre : une grille laisse passer la lumiere. */
  shadow?: boolean;
}

type Face = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';

interface Batch {
  material: THREE.Material;
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Ce lot porte-t-il une ombre ? */
  shadow: boolean;
}

export class BlockBuilder {
  private readonly batches = new Map<string, Batch>();
  readonly brushes: CollisionBrush[] = [];
  readonly lights: THREE.Light[] = [];

  /**
   * Sans rendu, seuls les volumes de collision sont poses.
   *
   * Les materiaux sont peints dans un canevas, que seul un navigateur
   * fournit : c'est ce qui rendait le decor impossible a verifier dans un
   * essai. Un decor monte de cette facon ne se dessine pas, mais il s'arpente,
   * et c'est tout ce qu'un essai demande.
   */
  constructor(private readonly visual = true) {}

  block(mins: Vec3, maxs: Vec3, options: BlockOptions): void {
    if (!this.visual) {
      if (options.solid !== false) {
        this.brushes.push(boxBrush(mins, maxs, options.contents ?? Contents.SOLID));
      } else if (options.contents) {
        this.brushes.push(boxBrush(mins, maxs, options.contents));
      }
      return;
    }
    const key = `${options.kind}:${options.tint ?? ''}:${options.emissive ?? ''}:${options.opacity ?? 1}:${options.shadow === false ? 'n' : 'y'}`;
    let batch = this.batches.get(key);
    if (!batch) {
      const material = surfaceMaterial(options.kind, {
        tint: options.tint,
        emissive: options.emissive,
        emissiveIntensity: options.emissive ? 1.4 : 1,
        transparent: (options.opacity ?? 1) < 1,
        opacity: options.opacity ?? 1,
      });
      batch = { material, positions: [], normals: [], uvs: [], shadow: options.shadow !== false };
      this.batches.set(key, batch);
    }
    this.pushBox(batch, mins, maxs, options.skip ?? []);

    if (options.solid !== false) {
      this.brushes.push(boxBrush(mins, maxs, options.contents ?? Contents.SOLID));
    } else if (options.contents) {
      this.brushes.push(boxBrush(mins, maxs, options.contents));
    }
  }

  /*
   * Une lampe de l'arene. L'attenuation est lineaire, comme dans le jeu
   * d'origine : une decroissance en carre de la distance, physiquement juste,
   * demanderait des intensites enormes et laisserait le decor dans le noir des
   * qu'on s'eloigne d'un metre.
   */
  light(position: Vec3, color: string, intensity: number, distance: number): void {
    const light = new THREE.PointLight(new THREE.Color(color), intensity, distance, 1);
    light.position.set(position[0], position[1], position[2]);
    this.lights.push(light);
  }

  /** Six quadrilateres, avec des coordonnees de texture a l'echelle du monde. */
  private pushBox(batch: Batch, mins: Vec3, maxs: Vec3, skip: Face[]): void {
    const faces: { face: Face; normal: Vec3; corners: Vec3[]; axes: [number, number] }[] = [
      {
        face: 'z+',
        normal: [0, 0, 1],
        corners: [
          [mins[0], mins[1], maxs[2]],
          [maxs[0], mins[1], maxs[2]],
          [maxs[0], maxs[1], maxs[2]],
          [mins[0], maxs[1], maxs[2]],
        ],
        axes: [0, 1],
      },
      {
        face: 'z-',
        normal: [0, 0, -1],
        corners: [
          [mins[0], maxs[1], mins[2]],
          [maxs[0], maxs[1], mins[2]],
          [maxs[0], mins[1], mins[2]],
          [mins[0], mins[1], mins[2]],
        ],
        axes: [0, 1],
      },
      {
        face: 'x+',
        normal: [1, 0, 0],
        corners: [
          [maxs[0], mins[1], mins[2]],
          [maxs[0], maxs[1], mins[2]],
          [maxs[0], maxs[1], maxs[2]],
          [maxs[0], mins[1], maxs[2]],
        ],
        axes: [1, 2],
      },
      {
        face: 'x-',
        normal: [-1, 0, 0],
        corners: [
          [mins[0], maxs[1], mins[2]],
          [mins[0], mins[1], mins[2]],
          [mins[0], mins[1], maxs[2]],
          [mins[0], maxs[1], maxs[2]],
        ],
        axes: [1, 2],
      },
      {
        face: 'y+',
        normal: [0, 1, 0],
        corners: [
          [maxs[0], maxs[1], mins[2]],
          [mins[0], maxs[1], mins[2]],
          [mins[0], maxs[1], maxs[2]],
          [maxs[0], maxs[1], maxs[2]],
        ],
        axes: [0, 2],
      },
      {
        face: 'y-',
        normal: [0, -1, 0],
        corners: [
          [mins[0], mins[1], mins[2]],
          [maxs[0], mins[1], mins[2]],
          [maxs[0], mins[1], maxs[2]],
          [mins[0], mins[1], maxs[2]],
        ],
        axes: [0, 2],
      },
    ];

    for (const entry of faces) {
      if (skip.includes(entry.face)) continue;
      const [u, v] = entry.axes;
      const quad = entry.corners;
      const order = [0, 1, 2, 0, 2, 3];
      for (const index of order) {
        const corner = quad[index];
        batch.positions.push(corner[0], corner[1], corner[2]);
        batch.normals.push(entry.normal[0], entry.normal[1], entry.normal[2]);
        batch.uvs.push(corner[u] * RenderConfig.textureScale, corner[v] * RenderConfig.textureScale);
      }
    }
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const batch of this.batches.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, batch.material);
      mesh.castShadow = batch.shadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const light of this.lights) group.add(light);
    return group;
  }
}
