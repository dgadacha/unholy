import type * as THREE from 'three';

/**
 * Ce que le porte-arme demande a une arme tenue en main.
 *
 * Deux sortes d'armes cohabitent. Celles du moteur d'origine sont des MD3 avec
 * leurs poses, leur canon qui tourne et leur eclat de tir ; celle du jeu est un
 * modele exporte d'un outil moderne, sans animation, dont le mouvement est
 * produit par le code. Le porte-arme n'a pas a savoir laquelle il tient : il
 * demande un objet a dessiner, un point de canon, et quatre verbes.
 */
export interface WeaponRig {
  /** Objet a poser dans la scene de l'arme. */
  readonly group: THREE.Object3D;
  /** Bout du canon : le depart du tir et de l'eclat. */
  readonly muzzle: THREE.Object3D;
  /** Un coup part. */
  fire(): void;
  /** L'arme est rangee : elle descend hors de l'ecran. */
  drop(): void;
  /** L'arme est reprise en main, a sa pose de repos. */
  reset(): void;
  update(delta: number): void;
  dispose?(): void;
}
