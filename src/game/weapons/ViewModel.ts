import * as THREE from 'three';
import type { ShaderLibrary } from '../../formats/shader';
import type { VirtualFileSystem } from '../../formats/pk3';
import { Md3Mesh } from '../../md3/MD3Renderer';
import type { TextureLibrary } from '../../renderer/materials/TextureLibrary';
import type { ViewmodelMotion } from '../../camera/FPSCameraEffects';
import type { WeaponId } from './WeaponDefs';
import { OriginalAssets } from './OriginalAssets';
import { OriginalWeaponRig } from './OriginalWeaponRig';
import { REFERENCE_WEAPON_FOV, weaponPreset, type WeaponViewmodelPreset } from './WeaponPreset';
import { GlbWeaponRig } from './GlbWeaponRig';
import { VIEW_MODEL_OVERRIDES } from './ViewModelOverrides';
import type { WeaponRig } from './WeaponRig';

/** Vue des armes MD3 originales. Les tags _hand pilotent poses et placement.
 * La scene separee empeche le decor de couper l'arme au premier plan.
 */

export const MODEL_DIRECTORIES: Record<WeaponId, string> = {
  gauntlet: 'gauntlet',
  machinegun: 'machinegun',
  shotgun: 'shotgun',
  grenade: 'grenadel',
  rocket: 'rocketl',
  lightning: 'lightning',
  railgun: 'railgun',
  plasma: 'plasma',
  bfg: 'bfg',
};


export interface ViewModelSettings {
  /** Champ de vision de l'arme, en degres, independant de celui du monde. */
  fov: number;
  /** Ajustement lateral du joueur, ajoute a la place prevue par l'arme. */
  trimX: number;
  /** Ajustement vertical du joueur. */
  trimY: number;
  /** Cote choisi par le joueur : l'arme peut passer a gauche ou au centre. */
  side: 'center' | 'right' | 'left';
  visible: boolean;
}

export const DEFAULT_VIEW_MODEL_SETTINGS: ViewModelSettings = {
  fov: REFERENCE_WEAPON_FOV,
  trimX: 0,
  trimY: 0,
  side: 'right',
  visible: true,
};

/** Eclairage lu dans la carte, exprime dans le repere de la vue. */
export interface ViewModelEnvironment {
  ambient: THREE.Color;
  directional: THREE.Color;
  /** Direction d'ou vient la lumiere, dans le repere de la camera. */
  direction: THREE.Vector3;
}

interface WeaponModel {
  group: THREE.Object3D;
  md3: Md3Mesh | null;
  rig: WeaponRig;
  /**
   * Echantillon de sommets, dans le repere du porte-arme. La silhouette se
   * mesure sur eux et non sur la boite englobante : pres de l'oeil, une boite
   * autour d'un objet en diagonale deborde largement de ce qu'on voit, et
   * dimensionner dessus donne une arme deux fois trop petite.
   */
  points: Float32Array;
  /** Point du canon, dans le repere du modele normalise. */
  muzzle: THREE.Vector3;
  /**
   * Part d'ecran imposee par le fichier, quand ses proportions ne sont pas
   * celles du modele du jeu. Sans valeur, c'est le reglage de l'arme qui
   * decide.
   */
  occupancy?: number;
}

export class ViewModel {
  /** Scene propre a l'arme : le monde n'y figure pas. */
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(REFERENCE_WEAPON_FOV, 1, 0.5, 200);

  /** Chaine des points d'accroche, de la racine au modele. */
  private readonly root = new THREE.Group();
  private readonly positionAnchor = new THREE.Group();
  /** Reception apres une chute : l'arme s'enfonce puis revient. */
  private readonly landingAnchor = new THREE.Group();
  private readonly bobAnchor = new THREE.Group();
  private readonly swayAnchor = new THREE.Group();
  private readonly recoilAnchor = new THREE.Group();
  /** Changement de base et prise en main : avant du modele vers l'avant de la vue. */
  private readonly holder = new THREE.Group();
  private readonly holderBase = new THREE.Quaternion();
  /** Point du canon : eclat, fumee, lumiere. Jamais la source du tir. */
  private readonly muzzleAnchor = new THREE.Object3D();

  /** Eclairage propre a la scene de l'arme. */
  private readonly ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
  private readonly keyLight = new THREE.DirectionalLight(0xfff0dd, 2.2);
  private readonly fillLight = new THREE.DirectionalLight(0x9fc4ff, 0.8);

  private readonly cache = new Map<WeaponId, WeaponModel | null>();
  private current: WeaponModel | null = null;
  private disposed = false;
  private currentId: WeaponId | null = null;
  private loading: WeaponId | null = null;
  private preset: WeaponViewmodelPreset = weaponPreset('machinegun');

  private settings: ViewModelSettings = { ...DEFAULT_VIEW_MODEL_SETTINGS };
  private aspect = 16 / 9;
  private readonly restPosition = new THREE.Vector3();
  private readonly localMuzzle = new THREE.Vector3();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPoint = new THREE.Vector3();

  constructor(
    private readonly vfs: VirtualFileSystem | null,
    private readonly textures: TextureLibrary | null,
    /** Scripts du jeu : ils disent si une peau se decoupe, ou non. */
    private readonly shaders: ShaderLibrary | null = null,
  ) {
    this.scene.name = 'viewmodel';

    // Base : l'avant du modele, porte par l'axe des x du repere des cartes,
    // regarde vers l'avant de la vue, et le haut reste en haut.
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    );
    this.holder.quaternion.setFromRotationMatrix(basis);
    this.holderBase.copy(this.holder.quaternion);

    this.root.name = 'viewmodel-root';
    this.positionAnchor.name = 'position-anchor';
    this.landingAnchor.name = 'landing-anchor';
    this.bobAnchor.name = 'bob-anchor';
    this.swayAnchor.name = 'sway-anchor';
    this.recoilAnchor.name = 'recoil-anchor';
    this.muzzleAnchor.name = 'muzzle-anchor';

    this.recoilAnchor.add(this.holder);
    this.swayAnchor.add(this.recoilAnchor);
    this.bobAnchor.add(this.swayAnchor);
    this.landingAnchor.add(this.bobAnchor);
    this.positionAnchor.add(this.landingAnchor);
    this.root.add(this.positionAnchor);
    this.scene.add(this.root);
    this.holder.add(this.muzzleAnchor);

    /*
     * Eclairage propre a l'arme. La scene du monde n'etant pas rendue ici, le
     * modele a besoin de ses propres sources : une ambiance, une lumiere
     * principale legerement en hauteur, et un rappel plus froid a l'oppose
     * pour detacher la silhouette du fond. Les couleurs et les intensites
     * suivent ensuite l'eclairage de la carte.
     */
    this.keyLight.position.set(-0.4, 1, 0.6);
    this.fillLight.position.set(0.8, -0.2, -0.6);
    this.scene.add(this.ambientLight, this.keyLight, this.fillLight);

    this.applySettings(this.settings);
  }

  get object(): THREE.Object3D {
    return this.root;
  }

  get hasModel(): boolean {
    return this.current !== null;
  }

  /** Point d'accroche du canon, pour les effets de tir. */
  get muzzle(): THREE.Object3D {
    return this.muzzleAnchor;
  }

  applySettings(settings: Partial<ViewModelSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.applyFov();
    this.place();
  }

  setViewport(width: number, height: number): void {
    this.aspect = height > 0 ? width / height : 1;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.place();
  }

  /**
   * Eclairage lu dans la carte. Le modele doit appartenir a la scene : dans
   * une salle rouge il se teinte, dans un couloir sombre il s'assombrit. Une
   * luminosite minimale est conservee : une arme illisible est pire qu'une
   * arme mal eclairee.
   */
  setEnvironment(environment: ViewModelEnvironment): void {
    const ambient = luminance(environment.ambient);
    const key = luminance(environment.directional);

    // La teinte de la carte est melangee a du blanc : la couleur locale doit
    // se sentir, pas repeindre l'arme.
    this.ambientLight.color.copy(environment.ambient).lerp(WHITE, 0.55);
    this.ambientLight.intensity = clamp(1.3 + ambient * 2.4, 1.3, 2.6);

    this.keyLight.color.copy(environment.directional).lerp(WHITE, 0.4);
    this.keyLight.intensity = clamp(2.0 + key * 3.0, 2.0, 3.6);
    if (environment.direction.lengthSq() > 1e-6) {
      this.keyLight.position.copy(environment.direction).normalize();
    }

    this.fillLight.intensity = clamp(0.5 + ambient * 1.2, 0.5, 1.5);
  }

  /**
   * Eclairage de l'arme dans un decor sans eclairage general.
   *
   * Les planchers d'intensite de la methode precedente viennent des cartes du
   * moteur d'origine, qui sont toutes eclairees : ils gardent une arme lisible
   * dans une salle sombre. Ici ils sont faux. Dans un immeuble sans courant, la
   * seule lumiere qui touche l'arme est celle de sa propre lampe, qui frise le
   * canon et la poignee, plus ce que la piece renvoie, c'est-a-dire presque
   * rien. Lampe eteinte, l'arme doit devenir une silhouette : c'est la
   * contrepartie de se cacher.
   */
  setDarkEnvironment(ambient: THREE.Color, beam: number): void {
    const room = luminance(ambient);

    this.ambientLight.color.copy(ambient).lerp(WHITE, 0.4);
    this.ambientLight.intensity = 0.1 + room * 1.2;

    /*
     * La lampe est vissee sous le canon : sa lumiere part vers l'avant et n'en
     * revient qu'en frisant le modele. Le point est donc place devant et sous
     * l'arme, pas au-dessus comme une lumiere de studio.
     */
    this.keyLight.color.copy(WHITE);
    this.keyLight.intensity = beam * 2.4;
    this.keyLight.position.set(0.15, -0.5, 1);

    this.fillLight.intensity = 0.04 + beam * 0.3;
  }

  /** Champ de vision applique : reglage du joueur, ecarte par l'arme. */
  private applyFov(): void {
    const fov = this.settings.fov + (this.preset.fov - REFERENCE_WEAPON_FOV);
    this.camera.fov = clamp(fov, 40, 110);
    this.camera.updateProjectionMatrix();
  }

  /** Conserve la taille MD3 et applique les ajustements du joueur. */
  private place(): void {
    // Les tags _hand contiennent deja la position et l'echelle d'origine.
    const side = this.settings.side;
    this.restPosition.set(this.settings.trimX * 10, this.settings.trimY * 10, 0);
    this.positionAnchor.position.copy(this.restPosition);
    this.holder.quaternion.copy(this.holderBase);
    this.holder.scale.set(1, side === 'left' ? -1 : 1, 1);
    if (side === 'center') this.positionAnchor.position.x -= 3;
  }

  /**
   * Silhouette projetee du modele a cette echelle : bornes en part d'image,
   * l'origine en haut a gauche. Rend rien quand le modele passe derriere le
   * plan de coupe, ce qui veut dire qu'il est trop gros.
   */
  private projectedBounds(
  ): { left: number; right: number; top: number; bottom: number } | null {
    const model = this.current;
    if (!model) return null;

    this.root.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld();
    this.holder.updateMatrixWorld(true);

    const toCamera = this.scratchMatrix
      .copy(this.camera.matrixWorldInverse)
      .multiply(this.holder.matrixWorld);

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    const point = this.scratchPoint;

    for (let index = 0; index < model.points.length; index += 3) {
      point.set(model.points[index], model.points[index + 1], model.points[index + 2]);
      point.applyMatrix4(toCamera);
      if (point.z > -this.camera.near) return null;
      point.applyMatrix4(this.camera.projectionMatrix);
      const x = (point.x + 1) / 2;
      const y = (1 - point.y) / 2;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (!Number.isFinite(left)) return null;
    return { left, right, top, bottom };
  }

  /**
   * Ou l'arme se trouve a l'ecran, en part d'image, l'origine en haut a
   * gauche. Sert a verifier trois choses : que le corps du modele reste
   * visible, que le canon rejoint la zone du viseur, et que rien ne recouvre
   * le bloc des munitions.
   */
  measure(): {
    rect: { left: number; top: number; right: number; bottom: number };
    muzzle: { x: number; y: number };
    width: number;
    height: number;
  } | null {
    if (!this.current) return null;
    const bounds = this.projectedBounds();
    if (!bounds) return null;

    const muzzle = this.muzzlePoint(new THREE.Vector3()).project(this.camera);
    return {
      rect: bounds,
      muzzle: { x: (muzzle.x + 1) / 2, y: (1 - muzzle.y) / 2 },
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    };
  }

  /** Reprend une arme depuis son fichier, cache vide : sert au reglage. */
  async reload(id: WeaponId): Promise<void> {
    const kept = this.cache.get(id);
    if (kept) this.disposeRig(kept.rig);
    this.cache.delete(id);
    if (this.current && this.currentId === id) {
      this.holder.remove(this.current.group);
      this.current = null;
    }
    this.currentId = null;
    this.loading = null;
    await this.setWeapon(id);
  }

  async setWeapon(id: WeaponId): Promise<void> {
    if (this.disposed) return;
    if (this.currentId === id) {
      if (this.loading && this.loading !== id) { this.loading = null; this.current?.rig.reset(); }
      return;
    }
    if (this.loading === id) return;
    this.loading = id;

    let model = this.cache.get(id);
    if (model === undefined) {
      model = await this.load(id);
      if (this.disposed) {
        if (model) this.disposeRig(model.rig);
        return;
      }
      this.cache.set(id, model);
    }

    if (this.loading !== id) return;
    this.loading = null;
    if (this.current) {
      this.current.rig.drop();
      this.loading = id;
      await new Promise(resolve => setTimeout(resolve, 225));
      if (this.loading !== id) return;
      this.loading = null;
    }
    this.show(id, model);

  }

  private show(id: WeaponId, model: WeaponModel | null): void {
    if (this.current) this.holder.remove(this.current.group);
    this.current = model;
    model?.rig.reset();
    this.currentId = id;
    this.preset = weaponPreset(id);
    this.applyFov();

    if (!model) {
      this.place();
      return;
    }
    // L'arme est solidaire de la camera : son ombre n'aurait pas de sens, et
    // la laisser dans les cartes d'ombre la dessinerait une fois par source.
    model.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = false;
    });
    this.holder.add(model.group);
    this.place();
    this.updateMuzzleAnchor();
  }

  /** Lance les poses et le flash MD3 du tir. */
  fire(_color: THREE.Color, _ejects: boolean): void {
    this.current?.rig.fire();
  }

  /**
   * Applique les mouvements, chacun sur son point d'accroche et pondere par
   * l'arme : une mitrailleuse ne bouge pas comme un lance-roquettes.
   */
  update(motion: ViewmodelMotion, delta = 0): void {
    this.root.visible = this.settings.visible;
    this.current?.rig.update(delta);
    // Les poses de recul viennent du MD3 _hand. Aucun recul/sway moderne ajoute.
    this.bobAnchor.rotation.set(motion.bob.y * 0.3, motion.bob.x * 0.3, motion.bob.roll * 0.3);
    this.landingAnchor.position.y = motion.landing * 6;
  }

  /** Point du canon, en coordonnees du monde de l'arme. */
  muzzlePoint(out: THREE.Vector3): THREE.Vector3 {
    this.updateMuzzleAnchor();
    this.muzzleAnchor.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.muzzleAnchor.matrixWorld);
  }

  /**
   * Replace le point du canon. Les modeles du jeu portent un repere
   * d'assemblage nomme tag_flash ; les autres n'ont que leurs bornes, et le
   * canon est alors au bout du modele.
   */
  private updateMuzzleAnchor(): void {
    if (!this.current) return;
    this.current.group.updateWorldMatrix(true, true);
    this.holder.updateWorldMatrix(true, false);
    this.current.rig.muzzle.getWorldPosition(this.localMuzzle);
    this.muzzleAnchor.position.copy(this.holder.worldToLocal(this.localMuzzle));
  }

  /**
   * Libere une arme. Les MD3 du moteur d'origine tiennent leurs maillages a
   * part ; un modele exporte sait se liberer lui-meme.
   */
  private disposeRig(rig: WeaponRig): void {
    if (rig instanceof OriginalWeaponRig) {
      rig.hand.dispose(); rig.gun.dispose(); rig.barrel?.dispose(); rig.flash?.dispose();
      return;
    }
    rig.dispose?.();
  }

  dispose(): void {
    this.disposed = true; this.loading = null;
    for (const model of this.cache.values()) if (model) this.disposeRig(model.rig);
    this.cache.clear(); this.current = null; this.scene.clear();
  }

  setVisible(visible: boolean): void {
    this.applySettings({ visible });
  }

  private async load(id: WeaponId): Promise<WeaponModel | null> {
    /*
     * Les armes du jeu viennent d'un modele exporte, celles du moteur
     * d'origine des archives de Quake III. Le modele passe d'abord : c'est
     * l'arme du jeu. Les MD3 restent le repli, et le seul chemin pour les huit
     * autres armes, qui n'ont pas encore de modele.
     */
    const override = VIEW_MODEL_OVERRIDES[id];
    if (override) {
      const glb = await GlbWeaponRig.load(override);
      if (glb) {
        return { group: glb.group, md3: null, rig: glb, muzzle: new THREE.Vector3(), points: samplePoints(glb.group) };
      }
    }
    if (!this.vfs || !this.textures) return null;
    const rig = await OriginalWeaponRig.load(new OriginalAssets(this.vfs, this.textures, this.shaders), id);
    if (!rig) return null;
    return { group: rig.group, md3: rig.gun, rig, muzzle: new THREE.Vector3(), points: samplePoints(rig.group) };
  }

}

/** Repere neutre, pour un modele encore attache a rien. */
const IDENTITY = new THREE.Matrix4();

/**
 * Echantillon de sommets d'un modele, exprimes dans le repere qui l'accueille.
 * Quelques centaines de points suffisent a cerner une silhouette : le modele
 * en compte des dizaines de milliers, et la mesure tourne trente fois a chaque
 * changement de reglage.
 */
function samplePoints(model: THREE.Object3D, target = 700): Float32Array {
  model.updateWorldMatrix(true, true);
  // Mesure dans le repere du porte-arme, tags MD3 inclus.
  const inverse = new THREE.Matrix4()
    .copy(model.parent ? model.parent.matrixWorld : IDENTITY)
    .invert();

  let total = 0;
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const attribute = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
    if (attribute) total += attribute.count;
  });
  if (total === 0) return new Float32Array(0);

  const stride = Math.max(1, Math.floor(total / target));
  const collected: number[] = [];
  const point = new THREE.Vector3();

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attribute = mesh.geometry.getAttribute('position');
    if (!attribute) return;
    const toGroup = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    for (let index = 0; index < attribute.count; index += stride) {
      point.fromBufferAttribute(attribute as THREE.BufferAttribute, index);
      point.applyMatrix4(toGroup);
      collected.push(point.x, point.y, point.z);
    }
  });

  return new Float32Array(collected);
}

/** Droite et haut de la vue : de ce cote sortent les douilles. */

const WHITE = new THREE.Color(0xffffff);

function luminance(color: THREE.Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
