import * as THREE from 'three';

/**
 * Lampe tactique montee sur l'arme.
 *
 * L'immeuble n'a plus de courant : ce faisceau est presque tout ce que le
 * militaire voit. La consequence est voulue, et c'est la mecanique du jeu :
 * regarder devant, c'est ne pas surveiller le plafond ; eclairer une porte,
 * c'est laisser un angle mort derriere soi.
 *
 * Elle porte une ombre. Sans carte d'ombre, le cone traverserait les cloisons
 * et eclairerait la piece voisine : il n'y aurait plus de nuit, et plus de jeu.
 * C'est la depense de rendu la plus justifiee du projet.
 *
 * Le faisceau ne colle pas exactement au regard. Il part legerement en dessous
 * et sur le cote, comme une lampe vissee sous un canon, et il rattrape le
 * regard avec un retard court : une lampe qui suit l'oeil au pixel donne
 * l'impression d'un casque, pas d'une arme tenue a la main.
 */

/** Portee du faisceau, en unites de carte. */
const RANGE = 1600;
/** Demi-angle du cone, en radians : serre, comme une lampe d'arme. */
const CONE = 0.36;
/**
 * Puissance du faisceau, en candelas.
 *
 * Choisie sur mesure, et le critere est la surface proche : c'est elle qui
 * sature. A cette valeur, une cloison a un metre se lit vers cent trente
 * niveaux sur deux cent cinquante-cinq, un plafond a deux metres vers
 * quatre-vingts, et le couloir en fuite garde une tache lisible. Au double, la
 * cloison proche passe a cent quatre-vingt-dix et le couloir devient un tunnel
 * blanc ; a la moitie, on n'eclaire plus qu'un rond de sol.
 */
const POWER = 12000;
/** Retard du faisceau sur le regard, en fractions par seconde. */
const FOLLOW = 14;
/** Decalage sous l'axe du regard et sur le cote, en unites. */
const DROP = 6;
const SIDE = 5;

export class Flashlight {
  readonly light: THREE.SpotLight;

  private readonly aim = new THREE.Vector3(1, 0, 0);
  private readonly wanted = new THREE.Vector3(1, 0, 0);
  private readonly right = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private enabled = false;
  private attached = false;

  constructor(quality = 1024) {
    /*
     * Penombre large : une lampe d'arme n'a pas de bord net, et un disque
     * parfaitement decoupe sur un mur trahit le projecteur de rendu.
     */
    this.light = new THREE.SpotLight(new THREE.Color('#eaf2ff'), 0, RANGE, CONE, 0.72, 1.1);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(quality, quality);
    this.light.shadow.camera.near = 8;
    this.light.shadow.camera.far = RANGE;
    /*
     * Le biais compense la profondeur d'une surface vue de tres pres : sans
     * lui, le sol sous les pieds se raye de bandes sombres des que le faisceau
     * l'effleure.
     */
    this.light.shadow.bias = -0.0012;
    this.light.shadow.normalBias = 1.5;
    this.light.visible = false;
  }

  /** Accroche la lampe et sa cible a la scene. */
  attach(scene: THREE.Object3D): void {
    if (this.attached) return;
    scene.add(this.light);
    scene.add(this.light.target);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.light.removeFromParent();
    this.light.target.removeFromParent();
    this.attached = false;
  }

  get on(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.light.visible = on;
    this.light.intensity = on ? POWER : 0;
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** Puissance du faisceau : reglee une fois, elle sert aussi a la mise au point. */
  setIntensity(value: number): void {
    if (this.enabled) this.light.intensity = value;
  }

  /**
   * Suit l'oeil et la direction de visee. La lampe est posee un peu en arriere
   * du point de vue : placee exactement dessus, elle eclairerait le mur que le
   * joueur touche et laisserait une tache blanche plein ecran.
   */
  update(eye: THREE.Vector3, direction: THREE.Vector3, delta: number): void {
    if (!this.enabled) return;

    this.wanted.copy(direction).normalize();
    const rate = Math.min(1, delta * FOLLOW);
    this.aim.lerp(this.wanted, rate).normalize();

    // Repere de l'arme : la droite du regard, a plat.
    this.right.set(this.aim.y, -this.aim.x, 0);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();

    this.origin
      .copy(eye)
      .addScaledVector(this.aim, -12)
      .addScaledVector(this.right, SIDE)
      .add(new THREE.Vector3(0, 0, -DROP));
    this.light.position.copy(this.origin);
    this.light.target.position.copy(this.origin).addScaledVector(this.aim, RANGE);
    this.light.target.updateMatrixWorld();
  }

  dispose(): void {
    this.detach();
    this.light.dispose();
  }
}
