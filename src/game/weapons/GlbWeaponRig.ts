import * as THREE from 'three';
import { loadOverride, type ViewModelOverride } from './ViewModelOverrides';
import type { WeaponRig } from './WeaponRig';
import { VIEWMODEL } from './ViewmodelFeel';

/**
 * Arme tenue en main venant d'un modele exporte, et non des archives du jeu.
 *
 * Le fichier n'a aucune animation : il n'y a ni pose de tir, ni canon separe,
 * ni eclat. Tout le mouvement est donc produit ici, et il tient en trois
 * choses : le recul d'un coup, le retour a la pose, et la descente quand
 * l'arme est rangee. C'est peu, et c'est suffisant : le balancement de la
 * marche et le tremblement viennent du porte-arme, qui les applique au-dessus.
 *
 * Le redressement du fichier, lui, est deja fait par la mesure de ses bornes :
 * axe du canon, sens du canon, verticale. Cette classe ne fait que l'animer.
 */

/**
 * Prise en main.
 *
 * Les armes du moteur d'origine portent leur place et leur echelle dans le tag
 * d'une main MD3 : le porte-arme les prend telles quelles. Un modele exporte
 * n'a rien de tel, et arrive normalise a une unite de long, centre sur son
 * origine, donc pose exactement sur l'oeil. Il lui faut donc une main, et
 * c'est celle du porte-arme, reglee avec le reste de ce qu'on ressent de
 * l'arme. Le nom reste exporte pour la poignee de mise au point.
 */
export const RIFLE_HOLD = VIEWMODEL.hold;

/** Recul d'un coup : retrait le long du canon, en fraction de la longueur. */
const KICK_BACK = 0.035;
/** Et le nez qui se leve, en radians. */
const KICK_RISE = 0.06;
/** Temps de retour a la pose, en secondes. */
const RECOVER = 0.13;
/** Descente quand l'arme est rangee, en fraction de sa longueur. */
const DROP_DEPTH = 1.1;
/** Duree de cette descente, en secondes. */
const DROP_TIME = 0.2;

export class GlbWeaponRig implements WeaponRig {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Group();

  private readonly model: THREE.Object3D;
  /** Age du dernier coup, et du rangement ; negatif quand il n'y en a pas. */
  private shotAge = 100;
  private dropAge = -1;

  private constructor(model: THREE.Object3D, muzzleAt: THREE.Vector3) {
    this.model = model;
    this.group.name = 'glb-weapon';
    /*
     * La main : le modele est agrandi a la longueur voulue et tenu en avant,
     * a droite et en bas. Le porte-arme mesure ensuite la silhouette a partir
     * de la, donc cette pose doit etre posee avant qu'il n'echantillonne.
     */
    this.applyHold();
    this.group.add(this.model);
    /*
     * Le bout du canon est pris sur le modele redresse : le plus loin devant,
     * au milieu du reste. C'est de la que partent les balles et l'eclat, donc
     * une erreur de quelques centimetres se voit a l'ecran.
     */
    this.muzzle.position.copy(muzzleAt);
    this.model.add(this.muzzle);
    this.update(0);
  }

  static async load(override: ViewModelOverride): Promise<GlbWeaponRig | null> {
    const model = await loadOverride(override);
    if (!model) return null;

    // Le modele est deja ramene a une longueur de un, canon vers l'avant.
    const box = new THREE.Box3().setFromObject(model);
    return new GlbWeaponRig(model, barrelEnd(model, box));
  }

  /**
   * Pose la main sur le groupe. Les valeurs sont dans un objet modifiable :
   * c'est ainsi qu'on les regle en mesurant la silhouette a l'ecran plutot
   * qu'en devinant, et le porte-arme n'a pas besoin de le savoir.
   */
  applyHold(): void {
    const hold = RIFLE_HOLD;
    this.group.scale.setScalar(hold.length);
    /*
     * La position d'un groupe est exprimee dans le repere de son parent, pas
     * dans le sien : elle ne se divise donc pas par l'echelle. Divisee, l'arme
     * se posait a une unite de l'oeil et la moitie passait derriere lui.
     */
    this.group.position.set(hold.forward, -hold.right, -hold.down);
    this.group.rotation.set((hold.roll * Math.PI) / 180, 0, (hold.yaw * Math.PI) / 180);
  }

  fire(): void {
    this.shotAge = 0;
  }

  drop(): void {
    this.dropAge = 0;
  }

  reset(): void {
    this.dropAge = -1;
    this.shotAge = 100;
    this.update(0);
  }

  update(delta: number): void {
    this.shotAge += delta;
    if (this.dropAge >= 0) this.dropAge += delta;

    /*
     * Recul. Il part d'un coup et revient en un huitieme de seconde, avec une
     * courbe qui s'aplatit : un retour lineaire se lit comme un ascenseur.
     */
    const kick = Math.max(0, 1 - this.shotAge / RECOVER);
    const eased = kick * kick;

    // Rangement : l'arme descend sous l'ecran, et remonte a la reprise.
    const drop = this.dropAge >= 0 ? Math.min(1, this.dropAge / DROP_TIME) : 0;

    this.model.position.set(-eased * KICK_BACK, 0, -drop * DROP_DEPTH);
    this.model.rotation.set(0, -eased * KICK_RISE, 0);
  }

  dispose(): void {
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.map?.dispose();
        standard.normalMap?.dispose();
        standard.roughnessMap?.dispose();
        standard.metalnessMap?.dispose();
        standard.dispose();
      }
    });
    this.group.clear();
  }
}

/**
 * Bout du canon, pris sur la matiere et non sur la boite.
 *
 * Le centre de la boite englobante est a mi-hauteur du fusil entier, crosse et
 * chargeur compris, soit nettement sous l'ame du canon : l'eclat de tir s'y
 * posait sous le garde-main, a cote du trou par ou sort la balle. En ne
 * gardant que la tranche avant du modele, il ne reste que le canon lui-meme,
 * et sa moyenne donne son axe.
 */
function barrelEnd(model: THREE.Object3D, box: THREE.Box3): THREE.Vector3 {
  // Tranche avant : assez mince pour n'attraper que le canon, assez epaisse
  // pour contenir des sommets sur un modele peu dense.
  const depth = (box.max.x - box.min.x) * 0.03;
  const limit = box.max.x - depth;
  const point = new THREE.Vector3();
  let sumY = 0;
  let sumZ = 0;
  let count = 0;

  model.updateWorldMatrix(true, true);
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.getAttribute('position');
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions as THREE.BufferAttribute, i);
      point.applyMatrix4(mesh.matrixWorld);
      if (point.x < limit) continue;
      sumY += point.y;
      sumZ += point.z;
      count++;
    }
  });

  if (count === 0) {
    return new THREE.Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
  }
  return new THREE.Vector3(box.max.x, sumY / count, sumZ / count);
}
