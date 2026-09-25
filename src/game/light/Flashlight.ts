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
/**
 * Demi-angle du cone, en radians. Il est plus large que le rond utile : le
 * dessin du faisceau vient de son profil, pose ci-dessous, et le cone n'est
 * plus que la limite au-dela de laquelle il n'y a rien.
 */
const CONE = 0.44;
/**
 * Puissance du faisceau, en candelas, et vitesse de sa decroissance.
 *
 * Les deux se lisent ensemble : la puissance fixe ce que rend une surface
 * proche, la decroissance dit de combien le fond s'assombrit. Le critere est
 * la surface proche, parce que c'est elle qui sature, et qu'une surface
 * saturee n'a plus de matiere. Releve a ces valeurs, sur la meme cloison :
 * deux cents niveaux sur deux cent cinquante-cinq a un metre, cent dix a
 * quatre metres, trente-cinq au fond d'un couloir de quatorze. C'est cette
 * decroissance qui donne sa longueur au couloir ; sans elle, le fond et le nez
 * du canon sont eclaires pareil, et le couloir devient un decor plat.
 */
const POWER = 18000;
/**
 * Decroissance. Le carre de la distance serait juste, et illisible : la portee
 * utile tomberait a deux metres. Cette valeur est le compromis assume entre
 * la physique et un couloir qu'on peut parcourir.
 */
const DECAY = 1.2;
/** Retard du faisceau sur le regard, en fractions par seconde. */
const FOLLOW = 14;
/** Decalage sous l'axe du regard et sur le cote, en unites. */
const DROP = 6;
const SIDE = 5;

/**
 * Profil du faisceau : ce qui distingue une lampe d'un projecteur de rendu.
 *
 * Une lampe reelle a un coeur assez plat, un debord bien plus faible qui
 * s'etale loin, et pas de bord. Un projecteur, lui, donne un disque d'un seul
 * niveau : c'est ce que l'image montrait, une tache blanche sans structure.
 *
 * Le profil est projete comme une gelatine, donc une seule lumiere et une
 * seule carte d'ombre suffisent : le relief du faisceau ne coute rien de plus
 * qu'une texture de deux cent cinquante-six pixels de cote.
 *
 * Les valeurs sont des facteurs lineaires, et non des couleurs a l'ecran :
 * elles multiplient directement l'eclairement.
 */
/*
 * Le coeur est etroit et le debord large : c'est ce qui separe une lampe d'arme
 * d'un projecteur. Un cone unique de vingt-cinq degres donnait une tache qui
 * couvrait la moitie de l'ecran a un metre cinquante, sans centre ni bord ; le
 * profil ci-dessous garde la meme ouverture mais n'y met le plein que sur un
 * cinquieme du rayon, le reste servant de debord a un dixieme de l'intensite.
 * Le debord n'est pas un reste : c'est lui qui montre qu'il y a un couloir
 * autour de ce qu'on vise.
 */
const BEAM_PROFILE: [number, number][] = [
  [0, 1],
  [0.14, 0.94],
  [0.22, 0.68],
  [0.3, 0.34],
  [0.38, 0.24],
  [0.5, 0.18],
  [0.7, 0.12],
  [0.88, 0.05],
  [1, 0],
];

/** Taille de la gelatine, en pixels. Le profil est doux : peu suffit. */
const BEAM_SIZE = 256;

/**
 * Dessine la gelatine du faisceau.
 *
 * Deux details tiennent l'illusion. Le profil, d'abord, qui donne le coeur et
 * le debord. Un leger defaut ensuite : le verre d'une lampe portee n'est ni
 * propre ni centre, et quelques taches de quelques pour cent suffisent a ce
 * que l'oeil cesse de lire un cercle calcule. Sans elles, le faisceau reste
 * un disque parfait, et un disque parfait se remarque.
 */
function beamTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = BEAM_SIZE;
  canvas.height = BEAM_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();

  context.fillStyle = '#000';
  context.fillRect(0, 0, BEAM_SIZE, BEAM_SIZE);

  const half = BEAM_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  for (const [stop, value] of BEAM_PROFILE) {
    const level = Math.round(value * 255);
    gradient.addColorStop(stop, `rgb(${level}, ${level}, ${level})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, BEAM_SIZE, BEAM_SIZE);

  /*
   * Defauts du verre : des taches sombres tres etalees, posees hors du centre
   * pour ne pas creuser le coeur. Leur contraste se compte en pour cent ; une
   * seule serait visible, trois se lisent comme de la salissure.
   */
  context.globalCompositeOperation = 'multiply';
  const blemishes: [number, number, number, number][] = [
    [0.36, 0.3, 0.34, 0.1],
    [0.68, 0.62, 0.3, 0.07],
    [0.55, 0.28, 0.22, 0.05],
  ];
  for (const [x, y, radius, strength] of blemishes) {
    const spot = context.createRadialGradient(
      x * BEAM_SIZE,
      y * BEAM_SIZE,
      0,
      x * BEAM_SIZE,
      y * BEAM_SIZE,
      radius * BEAM_SIZE,
    );
    const level = Math.round((1 - strength) * 255);
    spot.addColorStop(0, `rgb(${level}, ${level}, ${level})`);
    spot.addColorStop(1, 'rgb(255, 255, 255)');
    context.fillStyle = spot;
    context.fillRect(0, 0, BEAM_SIZE, BEAM_SIZE);
  }

  const texture = new THREE.CanvasTexture(canvas);
  /*
   * Aucune conversion de couleur : ces pixels ne sont pas une image, ce sont
   * les facteurs du profil. Les lire en sRGB assombrirait le debord de moitie.
   */
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

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
    this.light = new THREE.SpotLight(new THREE.Color('#eaf2ff'), 0, RANGE, CONE, 1, DECAY);
    /*
     * Le relief du faisceau est dans sa gelatine, pas dans le cone : la
     * penombre est donc au maximum, pour que le cone lui-meme n'ajoute aucun
     * bord, et le profil fait le reste.
     */
    this.light.map = beamTexture();
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
    this.light.map?.dispose();
    this.light.dispose();
  }
}
