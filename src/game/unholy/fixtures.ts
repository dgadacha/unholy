import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Les reglettes du plafond.
 *
 * Tout le reste du batiment est bati par le code, bloc par bloc. Un luminaire
 * ne se prete pas a ce traitement : ce qu'on en voit est une carcasse cabossee,
 * un diffuseur jauni et des attaches, c'est-a-dire de la forme et de l'usure
 * plutot que de la geometrie. Il vient donc d'un fichier.
 *
 * Les douze exemplaires ne font qu'un seul dessin. Un luminaire exporte d'un
 * outil moderne pese quatre mille triangles, ce qui est beaucoup pour un objet
 * de trente centimetres vu de loin : les poser un par un aurait ajoute douze
 * appels de dessin et autant de copies de la meme matiere.
 */

const MODEL = '/models/fluorescent_fixture.glb';

/**
 * Redressement du modele.
 *
 * Il sort long sur z, haut sur y, comme tout ce qui vient d'un exportateur
 * glTF. Le jeu tient l'avant sur x, la gauche sur y et le haut sur z. La base
 * ci-dessous dit ou partent les trois axes du fichier, et rien d'autre.
 */
const UPRIGHT = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
);

export interface FixturePlacement {
  /** Centre du luminaire, en unites du batiment. */
  at: [number, number, number];
  /** Longueur voulue, en unites : le modele sort normalise a un. */
  length: number;
  /** Ce tube eclaire-t-il encore ? */
  lit: boolean;
}

/**
 * Ce qui, dans la carte de couleur, est de la glace et non de la tole.
 *
 * Le modele n'a qu'une seule matiere : impossible d'allumer sa glace en
 * designant une partie du maillage, elle n'existe pas separement. Mais la
 * glace est la seule chose claire du luminaire, la carcasse etant peinte et
 * salie. Un seuil sur la clarte suffit donc a la retrouver, et donne la carte
 * d'emission : le tube s'allume, la tole reste eteinte.
 */
const GLASS_FROM = 0.72;
const GLASS_TO = 0.88;

/**
 * Rassemble les poses, puis les dessine toutes ensemble quand le fichier
 * arrive. Le decor est monte en une fois et ne peut pas attendre un
 * chargement ; la carcasse apparait donc un instant apres le reste, ce qui ne
 * se voit pas puisque le joueur descend encore l'escalier d'entree.
 */
export class Fluorescents {
  readonly group = new THREE.Group();
  private readonly placements: FixturePlacement[] = [];

  constructor() {
    this.group.name = 'fluorescents';
  }

  add(placement: FixturePlacement): void {
    this.placements.push(placement);
  }

  /** Charge le modele et pose tous les exemplaires releves. */
  async mount(): Promise<void> {
    if (this.placements.length === 0) return;
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(MODEL);
    } catch (error) {
      // Sans le fichier, le plafond garde ses caissons : le jeu reste jouable.
      console.warn(`${MODEL} illisible :`, error);
      return;
    }

    const source = findMesh(gltf.scene);
    if (!source) return;

    /*
     * La geometrie est ramenee dans le repere du jeu et centree sur son
     * milieu, une fois pour toutes : les poses n'ont alors plus qu'a dire ou
     * et de quelle longueur, sans se soucier de l'orientation du fichier.
     */
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    geometry.applyMatrix4(UPRIGHT);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const span = bounds.max.x - bounds.min.x;
    geometry.translate(-center.x, -center.y, -center.z);
    if (span > 1e-6) geometry.scale(1 / span, 1 / span, 1 / span);

    const first = Array.isArray(source.material) ? source.material[0] : source.material;
    const base = first as THREE.MeshStandardMaterial;
    /*
     * Le modele sort en metal pur. Une carcasse de luminaire est peinte : a un
     * metal de un, elle ne renvoie que ce qui l'entoure, c'est-a-dire rien
     * dans un couloir noir, et le luminaire devient une silhouette bleutee.
     */
    base.metalness = 0.15;

    // Un lot par etat : une matiere ne peut pas s'allumer par exemplaire.
    const lit = base.clone() as THREE.MeshStandardMaterial;
    lit.emissive = new THREE.Color(0xffe9c8);
    lit.emissiveIntensity = 1.5;
    lit.emissiveMap = glassMask(base.map);
    lit.needsUpdate = true;

    for (const state of [false, true]) {
      const group = this.placements.filter((placement) => placement.lit === state);
      if (group.length === 0) continue;
      const mesh = new THREE.InstancedMesh(geometry, state ? lit : base, group.length);
      mesh.name = state ? 'fluorescent-lit' : 'fluorescent-dead';
      /*
       * Pas d'ombre portee : la reglette est collee au plafond, sa lampe est
       * dessous, et l'ombre qu'elle jetterait serait celle d'une boite sur une
       * dalle qu'on ne voit jamais. C'est une carte d'ombre de gagnee.
       */
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      for (const [index, placement] of group.entries()) {
        position.set(placement.at[0], placement.at[1], placement.at[2]);
        scale.setScalar(placement.length);
        matrix.compose(position, ZERO_TURN, scale);
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }
}

const ZERO_TURN = new THREE.Quaternion();

/**
 * Carte d'emission tiree de la carte de couleur : ne reste que la glace.
 *
 * La taille est reduite au passage. Le tube est une plage unie : la lire a
 * deux mille pixels de cote ne montrerait rien de plus qu'a cinq cents, et
 * couterait quatre megaoctets de memoire video pour une surface qui, allumee,
 * est de toute facon saturee.
 */
function glassMask(map: THREE.Texture | null): THREE.Texture | null {
  const image = map?.image as HTMLImageElement | undefined;
  if (!image) return null;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);

  const pixels = context.getImageData(0, 0, size, size);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const level = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    // Passage progressif : un seuil net dessinerait le contour de la glace.
    const glass = Math.max(0, Math.min(1, (level - GLASS_FROM) / (GLASS_TO - GLASS_FROM)));
    const value = Math.round(glass * 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = map?.flipY ?? true;
  texture.wrapS = map?.wrapS ?? THREE.ClampToEdgeWrapping;
  texture.wrapT = map?.wrapT ?? THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Premier maillage du fichier : ces exports n'en portent qu'un. */
function findMesh(root: THREE.Object3D): THREE.Mesh | null {
  root.updateWorldMatrix(true, true);
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!found && mesh.isMesh) found = mesh;
  });
  return found;
}
