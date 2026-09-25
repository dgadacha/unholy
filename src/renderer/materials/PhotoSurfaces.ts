import * as THREE from 'three';
import type { SurfaceTextures } from './Procedural';

/**
 * Surfaces photographiees.
 *
 * Le reste du decor est peint par le code : du bruit, quelques courbes, et une
 * teinte. C'est ce qui permet au jeu de tourner sans aucun fichier exterieur,
 * et c'est suffisant pour un carrelage ou une cloison vus a deux metres. Mais
 * un immeuble se regarde de pres, a la lampe, et le bruit se lit alors pour ce
 * qu'il est : du bruit. Les quatre surfaces qu'on voit le plus viennent donc
 * d'images.
 *
 * Une image ne fournit que la couleur. Le relief et la rugosite sont deduits
 * d'elle des qu'elle arrive : le creux d'un joint est sombre, la crete d'un
 * enduit est claire, et cette approximation tient tant que la source n'a pas
 * d'ombres cuites. Aucune n'en a.
 */

/** Les surfaces qui viennent d'une image, et le fichier de chacune. */
const PHOTOS: Record<string, string> = {
  plaster: '/textures/wall.jpg',
  tile: '/textures/floor.jpg',
  floor: '/textures/floor.jpg',
  ceiling: '/textures/ceiling.jpg',
  glass: '/textures/glass.png',
};

/**
 * Force du relief deduit, par surface.
 *
 * Un enduit est presque plat, un carrelage a des joints creuses, une dalle de
 * faux plafond a des rails saillants. Une seule valeur pour tous aurait donne
 * soit un mur en tole ondulee, soit un carrelage lisse.
 */
const RELIEF: Record<string, number> = {
  plaster: 1.1,
  tile: 3.4,
  floor: 3.4,
  ceiling: 2.6,
  glass: 0.6,
};

/**
 * Plage de rugosite, du plus clair au plus sombre de l'image.
 *
 * La lumiere de la lampe frise ces surfaces : c'est la rugosite qui decide si
 * elle y laisse une tache large et mate, ou un reflet net. Un carrelage use
 * brille la ou il est poli et boit la lumiere dans ses joints, d'ou une plage
 * large ; un enduit ne brille nulle part.
 */
const ROUGHNESS: Record<string, [number, number]> = {
  plaster: [0.92, 0.99],
  tile: [0.42, 0.86],
  floor: [0.42, 0.86],
  ceiling: [0.8, 0.96],
  glass: [0.12, 0.45],
};

/**
 * Combien de fois l'image se repete sur la surface que couvrait une texture
 * peinte par le code.
 *
 * Les images n'ont pas toutes la meme emprise reelle : celle du sol porte neuf
 * carreaux, celle du plafond neuf dalles, celle du mur n'a pas de motif du
 * tout. Sans ce reglage, le carrelage sortait a un metre de cote et le faux
 * plafond a trois metres. Ce chiffre suit donc l'image : changer le carrelage
 * pour un autre qui ne porte pas le meme nombre de carreaux change la taille
 * des carreaux au sol, et c'est ici qu'on la rattrape.
 */
const REPEAT: Record<string, number> = {
  plaster: 0.8,
  tile: 2.1,
  floor: 2.1,
  ceiling: 1.2,
  glass: 0.5,
};

/** Emprise de l'image, en repetitions de la texture de reference. */
export function photoRepeat(kind: string): number {
  return REPEAT[kind] ?? 1;
}

/**
 * Luminance moyenne de chaque image, mesuree une fois pour toutes.
 *
 * Elle sert a rendre la teinte demandee par le decor : le materiau est colore
 * par la teinte divisee par cette moyenne, de sorte que la surface finit a la
 * clarte voulue, la photo n'apportant que sa variation. Sans cela, un mur
 * peint clair et une photo de mur clair se multipliaient mal : soit le couloir
 * virait au plein jour, soit il retombait dans le noir.
 */
const LEVEL: Record<string, number> = {
  plaster: 0.6,
  tile: 0.63,
  floor: 0.63,
  ceiling: 0.64,
  glass: 0.13,
};

/** Clarte moyenne de l'image d'une surface, de zero a un. */
export function photoLevel(kind: string): number {
  return LEVEL[kind] ?? 0.5;
}

const cache = new Map<string, SurfaceTextures>();
const loader = new THREE.TextureLoader();

/** Vrai si cette surface est photographiee plutot que peinte par le code. */
export function hasPhoto(kind: string): boolean {
  return kind in PHOTOS;
}

/**
 * Textures d'une surface photographiee.
 *
 * La couleur est rendue tout de suite, encore vide : le chargement d'une image
 * est asynchrone, et le decor, lui, se monte en une fois. Le relief et la
 * rugosite arrivent avec elle, quelques dixiemes de seconde plus tard, et les
 * materiaux qui la portent se mettent a jour seuls puisqu'ils partagent ces
 * objets.
 */
export function photoTextures(kind: string): SurfaceTextures {
  const cached = cache.get(kind);
  if (cached) return cached;

  const path = PHOTOS[kind];
  const map = loader.load(path, (texture) => derive(kind, texture));
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  /*
   * Le relief et la rugosite sont crees vides, a un pixel : ils seront
   * remplaces par les vrais des que l'image est la. Un materiau ne supporte
   * pas qu'on lui donne une carte apres coup sans le recompiler, mais il
   * supporte tres bien qu'on change le contenu d'une carte qu'il porte deja.
   */
  const textures: SurfaceTextures = {
    map,
    normalMap: flat([128, 128, 255, 255]),
    roughnessMap: flat([255, 255, 255, 255]),
  };
  cache.set(kind, textures);
  return textures;
}

/**
 * Carte de donnees vide, deja reglee comme elle devra l'etre.
 *
 * Le reglage ne peut pas attendre l'arrivee de l'image : chaque materiau
 * travaille sur une copie de cette carte, les copies sont faites au montage du
 * decor, et une copie ne suit que la matiere de l'original, pas son filtrage.
 * Regler plus tard revient donc a ne regler que l'original, que personne ne
 * dessine. Une carte de donnees arrive en echantillonnage au plus proche et
 * sans niveaux de reduction : etalee sur un couloir, elle scintille a chaque
 * pas, et le decor se couvre d'un grain qu'on prend pour du bruit de rendu.
 */
function flat(values: number[]): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(values), 1, 1, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Lit l'image arrivee et en tire le relief et la rugosite. */
function derive(kind: string, texture: THREE.Texture): void {
  const entry = cache.get(kind);
  const image = texture.image as HTMLImageElement | undefined;
  if (!entry || !image) return;

  /*
   * L'image est ramenee a deux cent cinquante-six pixels avant d'etre lue. Le
   * relief n'a pas besoin de la resolution de la couleur : il decrit des
   * joints et des creux, pas du grain, et le calculer a pleine taille coutait
   * un million de pixels par surface pour un resultat qu'on ne distingue pas.
   */
  const size = 256;
  const scratch = document.createElement('canvas');
  scratch.width = size;
  scratch.height = size;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;

  const height = new Float32Array(size * size);
  let low = 1;
  let high = 0;
  for (let i = 0; i < height.length; i++) {
    const offset = i * 4;
    const value =
      (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255;
    height[i] = value;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  // Etale la plage : une image peu contrastee donnerait un relief invisible.
  const span = Math.max(0.02, high - low);
  for (let i = 0; i < height.length; i++) height[i] = (height[i] - low) / span;

  /*
   * Le grain de l'image n'est pas du relief.
   *
   * Une photo porte le bruit de son capteur et celui de sa compression, a la
   * taille du pixel. Pris tel quel comme hauteur, ce bruit donne une normale
   * differente a chaque pixel, et la surface se met a scintiller des qu'on
   * bouge. Un lissage court l'efface et laisse ce qu'on voulait : les joints,
   * les eclats, les creux, qui font plusieurs pixels de large.
   */
  blur(height, size);

  const strength = RELIEF[kind] ?? 2;
  const [smooth, coarse] = ROUGHNESS[kind] ?? [0.6, 0.95];

  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      // Pente locale, en bouclant sur les bords : la texture se repete.
      const left = height[y * size + ((x - 1 + size) % size)];
      const right = height[y * size + ((x + 1) % size)];
      const up = height[((y - 1 + size) % size) * size + x];
      const down = height[((y + 1) % size) * size + x];
      const dx = (left - right) * strength;
      const dy = (up - down) * strength;
      const inverse = 1 / Math.hypot(dx, dy, 1);
      const offset = index * 4;
      normal[offset] = Math.round((dx * inverse * 0.5 + 0.5) * 255);
      normal[offset + 1] = Math.round((dy * inverse * 0.5 + 0.5) * 255);
      normal[offset + 2] = Math.round((inverse * 0.5 + 0.5) * 255);
      normal[offset + 3] = 255;

      // Le clair est poli, le sombre est creuse et mat.
      const level = Math.round((coarse + (smooth - coarse) * height[index]) * 255);
      rough[offset] = level;
      rough[offset + 1] = level;
      rough[offset + 2] = level;
      rough[offset + 3] = 255;
    }
  }

  replace(entry.normalMap as THREE.DataTexture, normal, size);
  replace(entry.roughnessMap as THREE.DataTexture, rough, size);
}

/** Lissage separable sur trois points, en bouclant sur les bords. */
function blur(field: Float32Array, size: number): void {
  const pass = new Float32Array(field.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = field[y * size + ((x - 1 + size) % size)];
      const right = field[y * size + ((x + 1) % size)];
      pass[y * size + x] = (left + field[y * size + x] * 2 + right) * 0.25;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const up = pass[((y - 1 + size) % size) * size + x];
      const down = pass[((y + 1) % size) * size + x];
      field[y * size + x] = (up + pass[y * size + x] * 2 + down) * 0.25;
    }
  }
}

/**
 * Remplace le contenu d'une carte deja portee par des materiaux.
 *
 * La matiere d'une texture vit dans une source partagee par toutes ses
 * copies : la changer ici suffit a ce que le decor entier la reprenne, sans
 * avoir a retrouver qui porte quoi.
 */
function replace(texture: THREE.DataTexture, data: Uint8Array, size: number): void {
  texture.image = { data, width: size, height: size };
  texture.needsUpdate = true;
}
