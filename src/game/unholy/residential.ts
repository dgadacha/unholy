import * as THREE from 'three';
import type { Vec3 } from '../../formats/bsp';
import { BlockBuilder } from '../build/BlockBuilder';
import type { SurfaceKind } from '../../renderer/materials/Procedural';

/** Residential details share the same collision builder as the architecture. */
export class Residential {
  readonly signs = new THREE.Group();
  /**
   * Sources fixes du decor. Chacune porte son intensite de reference et sa
   * facon de faiblir : une lampe de secours sur batterie s'eteint par a-coups
   * quand la charge tombe, un tube qui a mal vieilli bat vite, et la plupart
   * ne font rien. Sans cette distinction, tout le batiment clignotait au meme
   * rythme, ce qui se lit comme un effet et non comme une panne.
   */
  readonly lamps: { light: THREE.PointLight; phase: number; base: number; fault: 'battery' | 'starter' | 'none' }[] = [];
  constructor(private b: BlockBuilder, private visual: boolean) {}

  box(a: Vec3, c: Vec3, kind: SurfaceKind = 'wood', tint = '#514032', solid = true): void {
    this.b.block(a, c, { kind, tint, solid });
  }

  /** Plane facing south, readable from the corridor, with world-space lettering. */
  sign(text: string, x: number, y: number, z: number, width = 44, height = 18, facing: 'north' | 'south' = 'south'): void {
    if (!this.visual) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#242d29'; ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = '#b4aa85'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 176);
    ctx.fillStyle = '#e2d9b9'; ctx.font = 'bold 74px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 100, 470);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 }));
    mesh.rotation.x = facing === 'south' ? Math.PI / 2 : -Math.PI / 2; mesh.position.set(x, y, z);
    this.signs.add(mesh);
  }

  frame(at: number, y: number, z: number): void {
    for (const x of [at - 46, at + 40]) this.box([x, y - 3, z], [x + 6, y + 3, z + 114]);
    this.box([at - 46, y - 3, z + 112], [at + 46, y + 3, z + 120]);
  }

  hall(floor: number, z: number): void {
    const colors = ['#4b554b', '#5b5343', '#4b555e', '#55434a'];
    // Low painted panelling, split around every apartment entrance.
    const gaps = [-672, -256, 256, 672];
    let cursor = -768;
    for (const at of [...gaps, 812]) {
      if (at - 44 > cursor) {
        this.box([cursor, 92, z], [at - 44, 96, z + 43], 'plaster', colors[floor]);
        this.box([cursor, 89, z + 43], [at - 44, 96, z + 46]);
        this.box([cursor, 89, z], [at - 44, 96, z + 5]);
      }
      cursor = at + 44;
    }
    for (const [i, at] of gaps.entries()) {
      this.frame(at, 94, z);
      this.sign(`${floor + 1}${i < 2 ? 'A' : 'B'}${i % 2 === 0 ? ' · S' : ''}`, at + 66, 88, z + 82, 30, 13);
      // Bell and worn doormat outside the threshold.
      this.box([at + 49, 88, z + 60], [at + 56, 93, z + 69], 'metal', '#554f3e', false);
      this.box([at - 38, 58, z + 0.1], [at + 38, 90, z + 0.6], 'fabric', '#393025', false);
    }
    // Ceiling mouldings and transverse beams break the endless tunnel rhythm.
    this.box([-768, 85, z + 151], [768, 96, z + 160], 'plaster', '#777160', false);
    for (const x of [-520, 0, 520]) {
      this.box([x - 5, -8, z + 151], [x + 5, 86, z + 160], 'plaster', '#69604f', false);
      this.box([x - 23, 29, z + 153], [x + 23, 43, z + 157], 'metal', '#393b36', false);
    }
    this.sign(floor === 0 ? 'RDC' : `NIV. 0${floor}`, -70, 87, z + 91, 80, 26);
    // Battery-powered wall light: one small pool per floor, with long dark intervals.
    this.b.block([-101, 83, z + 122], [-39, 93, z + 130], { kind: 'glow', emissive: '#829b77', solid: false, shadow: false });
    if (this.visual) {
      const light = new THREE.PointLight('#afbea0', 90, 400, 1);
      light.position.set(-70, 55, z + 115);
      this.signs.add(light); this.lamps.push({ light, phase: floor * 2.3, base: 90, fault: 'battery' });
    }
    this.neons(floor, z);
    // Ground-floor mailboxes; upper floors retain uncluttered escape routes.
    if (floor === 0) {
      for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
        const x = -470 + col * 30;
        this.box([x, 75, z + 48 + row * 25], [x + 27, 92, z + 70 + row * 25], 'metal', '#4d5146');
        this.box([x + 5, 73, z + 64 + row * 25], [x + 21, 75, z + 66 + row * 25], 'wood', '#141611', false);
      }
    }
  }

  /**
   * Tubes du plafond : un sur trois eclaire encore.
   *
   * Le tube vivant change de place d'un etage a l'autre, si bien qu'aucun
   * etage n'a la meme zone sure ni le meme angle mort, et qu'on ne peut pas
   * apprendre un seul couloir pour les connaitre tous. Les deux autres
   * restent en place, eteints : un plafond vide n'aurait pas dit qu'il y avait
   * eu de la lumiere ici.
   */
  neons(floor: number, z: number): void {
    const tubes = [-540, -40, 520];
    const alive = tubes[floor % tubes.length];
    for (const x of tubes) {
      const on = x === alive;
      // Boitier, puis le tube lui-meme, en retrait dessous.
      this.box([x - 62, 4, z + 146], [x + 62, 34, z + 152], 'metal', '#3f423b', false);
      this.b.block([x - 54, 9, z + 143], [x + 54, 29, z + 146.5], {
        kind: 'glow',
        emissive: on ? '#77887c' : '#1c1f1b',
        solid: false,
        shadow: false,
      });
      if (!on || !this.visual) continue;
      const light = new THREE.PointLight('#cfe2d6', 62, 380, 1.15);
      light.position.set(x, 20, z + 132);
      this.signs.add(light);
      // Un tube sur deux a un starter fatigue : celui du dernier etage bat.
      this.lamps.push({
        light,
        phase: floor * 1.7,
        base: 62,
        fault: floor % 2 === 1 ? 'starter' : 'none',
      });
    }
  }

  /**
   * Ce que la nuit du dehors laisse entrer par les baies de la cage.
   *
   * La cage d'escalier est le seul endroit ou les deux camps se voient sur
   * toute la hauteur, et c'est aussi un vide ou l'on tombe. Noire, elle ne
   * s'annonce pas : on y entre et on chute. Cette lueur froide ne montre rien
   * de plus qu'elle-meme, les nez de marches et le bord du vide, ce qui suffit
   * a comprendre qu'il y a un trou avant d'y etre.
   *
   * Elle ne clignote pas : ce n'est pas une lampe, c'est le ciel.
   */
  stairWindows(z: number): void {
    if (!this.visual) return;
    /*
     * Mille huit cents candelas pour une lueur : les unites du moteur sont
     * physiques, et une lampe de couloir en vaut deja quatre-vingt-dix a un
     * metre. Ici la source est le ciel derriere une baie, a plusieurs metres
     * des marches qu'elle doit dessiner, et la decroissance mange le reste.
     */
    const light = new THREE.PointLight('#5a7ea8', 1800, 900, 1.25);
    light.position.set(-560, -640, z + 96);
    this.signs.add(light);
  }

  apartment(x0: number, x1: number, z: number, floor: number): void {
    const fabric = ['#505b49', '#615046', '#46565c', '#4c3936'][floor];
    // Sofa against the outer side wall: a short blind corner, with open space above.
    const sx = x0 + 28;
    this.box([sx, 264, z + 8], [sx + 66, 358, z + 23], 'fabric', fabric);
    this.box([sx, 260, z + 18], [sx + 16, 362, z + 45], 'fabric', fabric);
    for (const y of [260, 346]) this.box([sx, y, z + 18], [sx + 70, y + 16, z + 33], 'fabric', fabric);
    // Coffee table, kept out of both entrance paths.
    this.box([sx + 75, 277, z + 18], [sx + 134, 339, z + 23]);
    for (const x of [sx + 80, sx + 123]) for (const y of [282, 329]) this.box([x, y, z], [x + 5, y + 5, z + 18]);
    // A dead television opposite the sofa, and a small cabinet below it.
    this.box([x0 + 228, 276, z], [x0 + 258, 346, z + 30]);
    this.box([x0 + 238, 280, z + 34], [x0 + 244, 342, z + 76], 'wood', '#191b19');
    this.box([x0 + 237, 284, z + 38], [x0 + 238, 338, z + 72], 'plaster', '#252d30', false);
    // Kitchen cupboards and worktop against the opposite wall.
    this.box([x1 - 60, 200, z], [x1 - 8, 346, z + 44], 'wood', '#535348');
    this.box([x1 - 64, 196, z + 44], [x1 - 6, 350, z + 48], 'tile', '#827c6a');
    this.box([x1 - 50, 220, z + 48], [x1 - 16, 265, z + 50], 'metal', '#292e2d', false);
    for (const y of [205, 256, 307]) this.box([x1 - 36, y, z + 99], [x1 - 8, y + 45, z + 145], 'wood', '#535348');
    // Bedroom: bed, pillow, blanket, wardrobe; central doors stay free.
    this.box([x0 + 45, 605, z + 5], [x0 + 192, 688, z + 20]);
    this.box([x0 + 47, 607, z + 20], [x0 + 190, 686, z + 29], 'fabric', '#8a8371');
    this.box([x0 + 78, 607, z + 29], [x0 + 185, 686, z + 32], 'fabric', fabric, false);
    this.box([x0 + 51, 620, z + 29], [x0 + 76, 674, z + 36], 'fabric', '#a09b86', false);
    this.box([x0 + 28, 449, z], [x0 + 77, 522, z + 118]);
    // Dining table in the second back room; offset away from the objective.
    const tx = x1 - 195;
    this.box([tx, 625, z + 38], [tx + 100, 679, z + 44]);
    for (const x of [tx + 5, tx + 89]) for (const y of [630, 668]) this.box([x, y, z], [x + 6, y + 6, z + 38]);
    // Frame, wall picture and skirting give human scale without blocking movement.
    this.box([x0 + 190, 129, z + 62], [x0 + 254, 134, z + 108], 'wood', '#30271e', false);
    this.box([x0 + 197, 134, z + 69], [x0 + 247, 135, z + 101], 'plaster', '#6f7663', false);
    this.box([x0, 694, z], [x1, 704, z + 6]);
  }

  stairs(z: number, last: boolean): void {
    // Short balustrade segments follow each tread; the middle stays open vertically.
    if (!last) for (let i = 0; i < 6; i++) {
      const y = -316 - i * 40;
      for (const [x, height] of [[-612, (i + 1) * 16], [-512, 192 - i * 16]]) {
        this.box([x, y - 2, z + height], [x + 4, y + 2, z + height + 43], 'metal', '#33342e');
        this.box([x - 2, y - 20, z + height + 41], [x + 6, y + 20, z + height + 46]);
      }
    }
    this.box([-754, -702, z + 33], [-366, -697, z + 75], 'plaster', '#515b4f', false);
    this.sign(`${Math.round(z / 192) + 1}  ↑`, -558, -696, z + 157, 62, 34, 'north');
  }
}
