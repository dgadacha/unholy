import * as THREE from 'three';
import { Contents, type Vec3 } from '../../formats/bsp';
import { CollisionWorld } from '../collision';
import { BlockBuilder } from '../build/BlockBuilder';
import type { Level, SpawnPoint } from '../level';

/**
 * L'immeuble.
 *
 * Un immeuble residentiel de quatre etages, condamne, sans courant, encercle
 * par les forces de l'ordre. C'est le seul decor du jeu, et il est fabrique par
 * le code : chaque bloc pose en meme temps ce qu'on voit et ce qui arrete le
 * joueur, donc il n'y a ni editeur, ni compilateur de carte, ni fichier de
 * donnees a cote.
 *
 * Le plan tient en peu de choses, et chaque espace penche pour un camp :
 *
 * Un long couloir par etage, qui traverse le batiment de part en part. C'est
 * l'espace des militaires : longue ligne de tir, groupe qui se couvre.
 *
 * Deux appartements par etage, au nord du couloir, decoupes en petites pieces
 * avec des portes et des angles morts. C'est l'espace des demons : de la, on
 * approche sans etre vu.
 *
 * Une cage d'escalier au sud-ouest, ouverte sur toute la hauteur : le seul
 * endroit ou les deux camps voient loin verticalement.
 *
 * Un reseau de ventilation ferme aux militaires : une gaine par etage le long
 * du couloir, une colonne au sud-est qui relie les quatre etages. Ce n'est pas
 * un teleporteur, on y rampe, et cela s'entend a travers les cloisons.
 */

/** Hauteur d'un etage, du sol au sol suivant. */
const PITCH = 192;
/** Epaisseur des dalles et des cloisons. */
const SLAB = 32;
/** Hauteur libre d'une piece : le plafond compte, les demons y marchent. */
const ROOM = PITCH - SLAB;
/** Nombre d'etages. */
export const FLOORS = 4;

/** Emprise interieure du batiment. */
const X0 = -768;
const X1 = 768;
const Y0 = -704;
const Y1 = 704;

/** Demi-largeur du couloir central. */
const HALL = 96;
/** Emprise de la cage d'escalier, au sud-ouest, et sa porte sur le couloir. */
const STAIR_X0 = -768;
const STAIR_X1 = -352;
const STAIR_DOOR = -568;
/** Ou la gaine du couloir s'arrete, avant la colonne verticale. */
const DUCT_EAST = 640;
/** Passage de porte : large et haut de quoi passer en courant. */
const DOOR_W = 80;
const DOOR_H = 112;
/** Section interieure d'une gaine de ventilation. */
const VENT = 72;

/** Axe de la colonne de ventilation, et la tremie qu'elle demande. */
const SHAFT_X = DUCT_EAST + VENT / 2 + 8;
const SHAFT_Y = -HALL + VENT / 2 + 8;
const SHAFT_HOLE = {
  x0: SHAFT_X - VENT / 2 - 12,
  x1: SHAFT_X + VENT / 2 + 12,
  y0: SHAFT_Y - VENT / 2 - 12,
  y1: SHAFT_Y + VENT / 2 + 12,
};

/**
 * Teintes du batiment : du beton, du platre sale, du bois, du metal.
 *
 * Elles sont franchement sombres, et c'est mesure : sous le faisceau, une
 * teinte moyenne remonte a plus de deux cents niveaux des que le mur est a
 * moins de deux metres, et le couloir devient un tunnel blanc. A ces valeurs,
 * une cloison proche reste lisible sans ecraser le reste de l'image.
 */
const CONCRETE = '#232220';
const PLASTER = '#332e28';
const WOOD = '#241c15';
const DOORWAY = '#191512';
const DUCT = '#2b2e31';
const GLASS = '#8fb6d8';

type Kind = 'floor' | 'rock' | 'metal' | 'trim' | 'grate' | 'glow' | 'water';

class Building {
  readonly builder: BlockBuilder;

  constructor(visual: boolean) {
    this.builder = new BlockBuilder(visual);
  }

  /** Altitude du sol d'un etage, le premier a zero. */
  floorZ(floor: number): number {
    return floor * PITCH;
  }

  /** Dalle horizontale : un sol, un plafond, un palier. */
  slab(x0: number, x1: number, y0: number, y1: number, z: number, kind: Kind = 'floor', tint = CONCRETE): void {
    this.builder.block([x0, y0, z - SLAB], [x1, y1, z], { kind, tint, skip: [] });
  }

  /**
   * Dalle percee d'une tremie rectangulaire : c'est par la que passe la colonne
   * de ventilation, qui traverse les quatre etages dans l'air du couloir. Sans
   * la tremie, chaque plancher coupait la colonne, et elle ne reliait rien.
   */
  slabWithHole(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z: number,
    hole: { x0: number; x1: number; y0: number; y1: number },
    kind: Kind = 'floor',
    tint = CONCRETE,
  ): void {
    this.slab(x0, hole.x0, y0, y1, z, kind, tint);
    this.slab(hole.x1, x1, y0, y1, z, kind, tint);
    this.slab(hole.x0, hole.x1, y0, hole.y0, z, kind, tint);
    this.slab(hole.x0, hole.x1, hole.y1, y1, z, kind, tint);
  }

  /**
   * Cloison pleine, entre deux hauteurs. Le platre des cloisons prend le motif
   * a grands panneaux : celui de la pierre dessine des fissures, qui se
   * lisaient comme un defaut de texture sous le faisceau.
   */
  wall(x0: number, x1: number, y0: number, y1: number, z: number, height: number, tint = PLASTER): void {
    const kind = tint === CONCRETE ? 'rock' : 'floor';
    this.builder.block([x0, y0, z], [x1, y1, z + height], { kind, tint });
  }

  /**
   * Cloison percee d'une porte. Le vide est laisse tel quel : une porte qui
   * s'ouvre et se ferme ne servirait qu'a bloquer les demons, qui passent de
   * toute facon par le plafond.
   */
  doorWall(
    axis: 'x' | 'y',
    along0: number,
    along1: number,
    fixed0: number,
    fixed1: number,
    z: number,
    height: number,
    at: number,
    tint = PLASTER,
  ): void {
    const gap0 = at - DOOR_W / 2;
    const gap1 = at + DOOR_W / 2;
    const parts: [number, number][] = [
      [along0, gap0],
      [gap1, along1],
    ];
    for (const [a0, a1] of parts) {
      if (a1 - a0 < 1) continue;
      if (axis === 'x') this.wall(a0, a1, fixed0, fixed1, z, height, tint);
      else this.wall(fixed0, fixed1, a0, a1, z, height, tint);
    }
    // Linteau au-dessus du passage.
    const lintel = height - DOOR_H;
    if (lintel > 0) {
      if (axis === 'x') this.wall(gap0, gap1, fixed0, fixed1, z + DOOR_H, lintel, tint);
      else this.wall(fixed0, fixed1, gap0, gap1, z + DOOR_H, lintel, tint);
    }
    // Encadrement, pour que la porte se lise dans le noir quand la lampe
    // l'effleure : un chambranle plus sombre que le mur.
    const frame = 6;
    if (axis === 'x') {
      for (const a of [gap0 - frame, gap1]) {
        this.builder.block([a, fixed0 - 1, z], [a + frame, fixed1 + 1, z + DOOR_H], {
          kind: 'trim',
          tint: DOORWAY,
          solid: false,
        });
      }
    } else {
      for (const a of [gap0 - frame, gap1]) {
        this.builder.block([fixed0 - 1, a, z], [fixed1 + 1, a + frame, z + DOOR_H], {
          kind: 'trim',
          tint: DOORWAY,
          solid: false,
        });
      }
    }
  }

  /**
   * Cloison percee de trous rectangulaires.
   *
   * Le constructeur ne sait pas creuser : un bloc est plein. Un passage se fait
   * donc en posant les morceaux autour du vide, et c'est ce que fait cette
   * aide. Sans elle, une bouche de ventilation collee sur un mur plein ne
   * menait nulle part, ce que la mesure a fini par dire.
   */
  pierced(
    axis: 'x' | 'y',
    along0: number,
    along1: number,
    fixed0: number,
    fixed1: number,
    z: number,
    height: number,
    holes: { at: number; width: number; bottom: number; tall: number }[],
    tint = PLASTER,
  ): void {
    const put = (a0: number, a1: number, zz: number, hh: number): void => {
      if (a1 - a0 < 1 || hh < 1) return;
      if (axis === 'x') this.wall(a0, a1, fixed0, fixed1, zz, hh, tint);
      else this.wall(fixed0, fixed1, a0, a1, zz, hh, tint);
    };
    const sorted = [...holes].sort((a, b) => a.at - b.at);
    let cursor = along0;
    for (const hole of sorted) {
      const h0 = hole.at - hole.width / 2;
      const h1 = hole.at + hole.width / 2;
      put(cursor, h0, z, height);
      // Sous le trou et au-dessus : la cloison reste, seule la baie est vide.
      put(h0, h1, z, hole.bottom - z);
      put(h0, h1, hole.bottom + hole.tall, height - (hole.bottom + hole.tall - z));
      cursor = h1;
    }
    put(cursor, along1, z, height);
  }

  /**
   * Fenetre dans une facade : un trou dans le mur, ferme par une vitre. La
   * vitre arrete les corps mais laisse passer la lumiere, et c'est par la que
   * les projecteurs des helicopteres entrent dans le batiment.
   */
  windowWall(
    axis: 'x' | 'y',
    along0: number,
    along1: number,
    fixed0: number,
    fixed1: number,
    z: number,
    height: number,
    holes: number[],
    holeWidth = 128,
  ): void {
    const sill = 48;
    const top = sill + 104;
    const edges: number[] = [along0];
    for (const at of holes) {
      edges.push(at - holeWidth / 2, at + holeWidth / 2);
    }
    edges.push(along1);
    // Trumeaux entre les baies.
    for (let i = 0; i < edges.length; i += 2) {
      const a0 = edges[i];
      const a1 = edges[i + 1];
      if (a1 - a0 < 1) continue;
      if (axis === 'x') this.wall(a0, a1, fixed0, fixed1, z, height, CONCRETE);
      else this.wall(fixed0, fixed1, a0, a1, z, height, CONCRETE);
    }
    // Allege, imposte et vitre de chaque baie.
    for (const at of holes) {
      const a0 = at - holeWidth / 2;
      const a1 = at + holeWidth / 2;
      if (axis === 'x') {
        this.wall(a0, a1, fixed0, fixed1, z, sill, CONCRETE);
        this.wall(a0, a1, fixed0, fixed1, z + top, height - top, CONCRETE);
        this.builder.block([a0, fixed0 + 12, z + sill], [a1, fixed1 - 12, z + top], {
          kind: 'water',
          tint: GLASS,
          opacity: 0.18,
          shadow: false,
        });
      } else {
        this.wall(fixed0, fixed1, a0, a1, z, sill, CONCRETE);
        this.wall(fixed0, fixed1, a0, a1, z + top, height - top, CONCRETE);
        this.builder.block([fixed0 + 12, a0, z + sill], [fixed1 - 12, a1, z + top], {
          kind: 'water',
          tint: GLASS,
          opacity: 0.18,
          shadow: false,
        });
      }
    }
  }

  /**
   * Segments d'une paroi percee d'ouvertures, le long d'un axe. Une paroi de
   * gaine posee d'un seul tenant bouchait ses propres bouches : la grille etait
   * collee sur du plein, et personne ne pouvait entrer.
   */
  private segments(a0: number, a1: number, gaps: number[], width: number, place: (b0: number, b1: number) => void): void {
    let cursor = a0;
    for (const at of [...gaps].sort((x, y) => x - y)) {
      const g0 = at - width / 2;
      const g1 = at + width / 2;
      if (g1 <= a0 || g0 >= a1) continue;
      if (g0 - cursor > 1) place(cursor, g0);
      cursor = Math.max(cursor, g1);
    }
    if (a1 - cursor > 1) place(cursor, a1);
  }

  /**
   * Gaine de ventilation : quatre parois minces autour d'un vide. Le vide est
   * un vrai espace, on y rampe ; les militaires en sont exclus par les bouches,
   * pas par la gaine elle-meme.
   *
   * La paroi nord est posee en morceaux : les bouches y font de vrais trous,
   * par lesquels on passe du couloir a la gaine.
   */
  ductX(x0: number, x1: number, yCenter: number, zBottom: number, mouths: number[] = []): void {
    const y0 = yCenter - VENT / 2;
    const y1 = yCenter + VENT / 2;
    const t = 8;
    this.builder.block([x0, y0 - t, zBottom - t], [x1, y1 + t, zBottom], { kind: 'metal', tint: DUCT });
    this.builder.block([x0, y0 - t, zBottom + VENT], [x1, y1 + t, zBottom + VENT + t], { kind: 'metal', tint: DUCT });
    this.builder.block([x0, y0 - t, zBottom], [x1, y0, zBottom + VENT], { kind: 'metal', tint: DUCT });
    this.segments(x0, x1, mouths, VENT, (a0, a1) => {
      this.builder.block([a0, y1, zBottom], [a1, y1 + t, zBottom + VENT], { kind: 'metal', tint: DUCT });
    });
  }

  /** Antenne le long de l'axe des y : du couloir vers un appartement. */
  ductY(xCenter: number, y0: number, y1: number, zBottom: number): void {
    const x0 = xCenter - VENT / 2;
    const x1 = xCenter + VENT / 2;
    const t = 8;
    this.builder.block([x0 - t, y0, zBottom - t], [x1 + t, y1, zBottom], { kind: 'metal', tint: DUCT });
    this.builder.block([x0 - t, y0, zBottom + VENT], [x1 + t, y1, zBottom + VENT + t], {
      kind: 'metal',
      tint: DUCT,
    });
    this.builder.block([x0 - t, y0, zBottom], [x0, y1, zBottom + VENT], { kind: 'metal', tint: DUCT });
    this.builder.block([x1, y0, zBottom], [x1 + t, y1, zBottom + VENT], { kind: 'metal', tint: DUCT });
  }

  /**
   * Meme chose, verticale : la colonne qui relie les etages. Sa paroi ouest est
   * percee a la hauteur de la gaine de chaque etage, sinon la colonne ne
   * communique avec rien.
   */
  ductZ(xCenter: number, yCenter: number, z0: number, z1: number, junctions: number[] = []): void {
    const x0 = xCenter - VENT / 2;
    const x1 = xCenter + VENT / 2;
    const y0 = yCenter - VENT / 2;
    const y1 = yCenter + VENT / 2;
    const t = 8;
    this.segments(z0, z1, junctions, VENT, (a0, a1) => {
      this.builder.block([x0 - t, y0 - t, a0], [x0, y1 + t, a1], { kind: 'metal', tint: DUCT });
    });
    this.builder.block([x1, y0 - t, z0], [x1 + t, y1 + t, z1], { kind: 'metal', tint: DUCT });
    this.builder.block([x0, y0 - t, z0], [x1, y0, z1], { kind: 'metal', tint: DUCT });
    this.builder.block([x0, y1, z0], [x1, y1 + t, z1], { kind: 'metal', tint: DUCT });
  }

  /**
   * Bouche d'aeration : une grille, et derriere elle un volume qui arrete les
   * militaires sans arreter les demons. C'est le meme procede que les volumes
   * de blocage des cartes d'origine : la trace du joueur compte ce contenu
   * comme solide, celle du demon l'ignore.
   */
  ventMouth(axis: 'x' | 'y', at: number, cross: number, z: number): void {
    const half = VENT / 2;
    if (axis === 'y') {
      // Bouche percee dans un mur perpendiculaire a l'axe des y.
      this.builder.block([at - half, cross - 4, z], [at + half, cross + 4, z + VENT], {
        kind: 'grate',
        tint: DUCT,
        solid: false,
        shadow: false,
      });
      this.builder.block([at - half, cross - 12, z], [at + half, cross + 12, z + VENT], {
        kind: 'grate',
        solid: false,
        contents: Contents.PLAYERCLIP,
      });
      return;
    }
    this.builder.block([cross - 4, at - half, z], [cross + 4, at + half, z + VENT], {
      kind: 'grate',
      tint: DUCT,
      solid: false,
      shadow: false,
    });
    this.builder.block([cross - 12, at - half, z], [cross + 12, at + half, z + VENT], {
      kind: 'grate',
      solid: false,
      contents: Contents.PLAYERCLIP,
    });
  }

  /**
   * Un etage d'escalier : deux demi-volees et deux paliers, en marches de seize
   * unites, la hauteur que le deplacement franchit sans sauter.
   *
   * Une volee droite sur toute la hauteur d'un etage aurait mesure douze
   * marches de quarante, soit presque cinq metres de profondeur : elle sortait
   * de la cage. Les deux demi-volees se cotoient, l'une descend vers le sud,
   * l'autre remonte vers le nord, et on revient donc a chaque etage devant la
   * porte du couloir.
   */
  stairFloor(zStart: number): void {
    const half = PITCH / 32;
    const depth = 40;
    const westX: [number, number] = [STAIR_X0 + 32, STAIR_X0 + 192];
    const eastX: [number, number] = [STAIR_X1 - 192, STAIR_X1 - 32];

    // Palier haut, devant la porte du couloir : il recoit aussi la derniere
    // marche de la volee montante de l'etage du dessous.
    this.slab(STAIR_X0, STAIR_X1, -296, -HALL - SLAB, zStart, 'floor', CONCRETE);

    // Demi-volee descendante, cote ouest.
    for (let i = 0; i < half; i++) {
      const z = zStart + (i + 1) * 16;
      const y1 = -296 - i * depth;
      this.slab(westX[0], westX[1], y1 - depth, y1, z, 'floor', CONCRETE);
    }
    /*
     * Palier bas, au sud, qui relie les deux volees. Il va jusqu'au mur : en
     * s'arretant avant, il laissait une fente par laquelle on tombait dans la
     * cage.
     */
    const mid = zStart + half * 16;
    this.slab(STAIR_X0, STAIR_X1, Y0, -296 - half * depth, mid, 'floor', CONCRETE);
    // Demi-volee montante, cote est : elle debouche au niveau suivant.
    for (let i = 0; i < half; i++) {
      const z = mid + (i + 1) * 16;
      const y0 = -296 - half * depth + i * depth;
      this.slab(eastX[0], eastX[1], y0, y0 + depth, z, 'floor', CONCRETE);
    }
  }
}

/**
 * Un appartement : une entree sur le couloir, un sejour, deux pieces au fond
 * contre la facade. Les cloisons laissent des passages, jamais une pièce
 * fermee : un appartement doit se traverser, sans quoi les demons n'y
 * contournent rien.
 */
function apartment(b: Building, x0: number, x1: number, z: number, doorAt: number, ventAt: number): void {
  const yFront = HALL + SLAB;
  const yBack = Y1;
  const midY = yFront + (yBack - yFront) * 0.45;
  const midX = (x0 + x1) / 2;

  // Sol en bois, et mur sur le couloir perce de deux choses : la porte
  // d'entree, et le passage de l'antenne de ventilation sous le plafond. Le
  // plafond, lui, est le plancher de l'etage du dessus : il n'est pose qu'une
  // fois, par lui.
  b.slab(x0, x1, yFront, yBack, z, 'floor', WOOD);
  const ductGap = { at: ventAt, width: VENT + 16, bottom: z + ROOM - VENT - 16, tall: VENT + 16 };
  b.pierced('x', x0, x1, HALL, yFront, z, ROOM, [
    { at: doorAt, width: DOOR_W, bottom: z, tall: DOOR_H },
    ductGap,
  ]);

  // Refend qui separe le sejour des chambres, avec deux passages.
  b.doorWall('x', x0, midX - 40, midY, midY + 24, z, ROOM, (x0 + midX) / 2);
  b.doorWall('x', midX + 40, x1, midY, midY + 24, z, ROOM, (midX + x1) / 2);
  // Cloison entre les deux pieces du fond.
  b.wall(midX - 20, midX + 20, midY, yBack, z, ROOM);

  // Facade : deux baies par piece du fond, une par sejour.
  b.windowWall('x', x0, x1, yBack, yBack + SLAB, z, ROOM, [
    x0 + (x1 - x0) * 0.25,
    x0 + (x1 - x0) * 0.75,
  ]);

  void midX;
}

/**
 * Trace l'immeuble et rend un niveau jouable.
 *
 * Sans rendu, le decor se monte quand meme : seuls les volumes de collision
 * sont poses, et le niveau s'arpente sans navigateur. C'est ce que fait
 * l'essai, qui verifie qu'on passe la ou il faut passer.
 */
export function buildBuilding(visual = true): Level {
  const b = new Building(visual);
  const builder = b.builder;
  const top = FLOORS * PITCH;

  // Enveloppe : quatre facades et le toit, pleines sur toute la hauteur. Les
  // baies sont percees etage par etage dans les facades nord et pignons.
  builder.block([X0 - SLAB, Y0 - SLAB, -SLAB], [X1 + SLAB, Y0, top + SLAB], { kind: 'rock', tint: CONCRETE });
  builder.block([X0 - SLAB, Y0 - SLAB, -SLAB], [X0, Y1 + SLAB, top + SLAB], { kind: 'rock', tint: CONCRETE });
  builder.block([X1, Y0 - SLAB, -SLAB], [X1 + SLAB, Y1 + SLAB, top + SLAB], { kind: 'rock', tint: CONCRETE });
  builder.block([X0 - SLAB, Y1 + SLAB, -SLAB], [X1 + SLAB, Y1 + SLAB * 2, top + SLAB], {
    kind: 'rock',
    tint: CONCRETE,
  });
  builder.block([X0 - SLAB, Y0 - SLAB, top + SLAB], [X1 + SLAB, Y1 + SLAB * 2, top + SLAB * 2], {
    kind: 'rock',
    tint: CONCRETE,
  });

  for (let floor = 0; floor < FLOORS; floor++) {
    const z = b.floorZ(floor);

    // Couloir : sol, plafond, et ses deux murs. Celui du sud est aveugle, avec
    // les bouches de la gaine ; celui du nord porte les portes des deux
    // appartements.
    b.slabWithHole(X0, X1, -HALL, HALL, z, SHAFT_HOLE, 'floor', CONCRETE);
    b.pierced('x', X0, X1, -HALL - SLAB, -HALL, z, ROOM, [
      { at: STAIR_DOOR, width: DOOR_W, bottom: z, tall: DOOR_H },
    ]);

    // Deux appartements au nord, de part et d'autre d'un refend central.
    apartment(b, X0, -64, z, -256, -448);
    apartment(b, 64, X1, z, 256, 448);
    b.wall(-64, 64, HALL, Y1 + SLAB, z, ROOM, PLASTER);

    // Cage d'escalier au sud-ouest : ouverte sur toute la hauteur, donc ni sol
    // ni plafond ici. Une volee par etage, alternee, et un palier qui donne sur
    // le couloir.
    b.stairFloor(z);
    // Fond de la cage, au niveau du rez : le reste de son emprise, en dehors
    // du palier que la volee a deja pose.
    if (floor === 0) b.slab(STAIR_X0, STAIR_X1, Y0, -296, 0, 'floor', CONCRETE);
    // Cloison entre la cage et la masse batie, sur toute la hauteur.
    if (floor === 0) {
      builder.block([STAIR_X1, Y0, -SLAB], [STAIR_X1 + SLAB, -HALL - SLAB, top], {
        kind: 'rock',
        tint: CONCRETE,
      });
    }

    // Masse batie au sud du couloir : pleine, c'est elle qui donne au couloir
    // son mur aveugle.
    builder.block([STAIR_X1 + SLAB, Y0, z - SLAB], [X1, -HALL - SLAB, z + PITCH - SLAB], {
      kind: 'rock',
      tint: CONCRETE,
    });

    /*
     * Reseau de ventilation. Il court sous le plafond du couloir, cote sud, a
     * la vue de tous : un immeuble condamne a ses gaines apparentes, et cela
     * evite d'avoir a creuser la maconnerie. Les militaires le voient donc, et
     * cela ne leur sert a rien : ils ne peuvent pas y entrer.
     */
    const ductBottom = z + ROOM - VENT - 8;
    const ductY = -HALL + VENT / 2 + 8;
    const mouths = [-256, 96, 448];
    const branches = [-448, 448];
    b.ductX(X0, DUCT_EAST, ductY, ductBottom, [...mouths, ...branches]);
    // Trois bouches sur le couloir : de quoi entendre sans savoir laquelle.
    for (const at of mouths) b.ventMouth('y', at, ductY + VENT / 2, ductBottom);

    // Antenne vers chaque appartement : elle traverse le mur du couloir a la
    // meme hauteur et debouche au plafond du sejour.
    for (const at of branches) {
      b.ductY(at, ductY + VENT / 2, HALL + 128, ductBottom);
      b.ventMouth('y', at, HALL + 120, ductBottom);
    }

    // Bouche sur la colonne verticale, a l'est.
    b.ventMouth('x', ductY, DUCT_EAST, ductBottom);
  }

  /*
   * Colonne verticale a l'est du couloir : posee une fois pour toute la
   * hauteur, percee au niveau de la gaine de chaque etage.
   */
  b.ductZ(
    SHAFT_X,
    SHAFT_Y,
    -SLAB,
    top,
    Array.from({ length: FLOORS }, (_, floor) => b.floorZ(floor) + ROOM - VENT - 8 + VENT / 2),
  );

  // Plafond du dernier etage : la seule dalle qui ne sert de plancher a
  // personne, donc la seule a poser en plus.
  b.slabWithHole(X0, X1, Y0, Y1 + SLAB, top, SHAFT_HOLE, 'floor', PLASTER);

  // Entree au rez-de-chaussee, a l'ouest : c'est par la que l'unite penetre
  // dans le batiment, et par la qu'elle doit ressortir.
  builder.block([X0 - SLAB, -HALL, -SLAB], [X0, HALL, ROOM], { kind: 'rock', tint: DOORWAY, solid: false });
  builder.block([X0, -HALL, -SLAB], [X0 + 24, HALL, -SLAB + 4], {
    kind: 'glow',
    emissive: '#1d6b3a',
    solid: false,
    shadow: false,
  });

  // L'artefact, au quatrieme, dans la piece du fond de l'appartement est.
  const artifactZ = b.floorZ(FLOORS - 1);
  builder.block([560, 520, artifactZ + 24], [624, 584, artifactZ + 88], {
    kind: 'glow',
    emissive: '#c8452b',
    solid: false,
    shadow: false,
  });

  /*
   * Lumiere. Le courant est coupe : pas de soleil, pas de plafonnier, une
   * ambiante juste assez haute pour que le noir ne soit pas un ecran eteint.
   * Tout le reste vient des lampes des militaires et des projecteurs dehors.
   */
  const root = builder.build();
  root.add(new THREE.AmbientLight(new THREE.Color('#0a0d12'), Math.PI * 0.35));
  root.add(
    new THREE.HemisphereLight(new THREE.Color('#12202e'), new THREE.Color('#05060a'), Math.PI * 0.18),
  );

  /*
   * Projecteurs des helicopteres. Deux faisceaux tournent autour du batiment,
   * a des hauteurs et des vitesses differentes, et entrent par les fenetres
   * quand ils passent devant. Ils portent une ombre : sans elle, le faisceau
   * traverserait les murs et il n'y aurait plus de nuit du tout.
   */
  const searchlights = [
    { light: spotlight('#dff0ff', 900), radius: 2600, height: 1500, speed: 0.22, phase: 0 },
    { light: spotlight('#cfe4ff', 700), radius: 2200, height: 900, speed: -0.15, phase: 2.1 },
  ];
  for (const entry of searchlights) {
    root.add(entry.light);
    root.add(entry.light.target);
  }

  const animated: Level['animated'] = [
    (time) => {
      for (const entry of searchlights) {
        const angle = entry.phase + time * entry.speed;
        entry.light.position.set(
          Math.cos(angle) * entry.radius,
          Math.sin(angle) * entry.radius,
          entry.height,
        );
        // Le faisceau vise le batiment un peu plus bas que sa source, pour
        // balayer les facades et non le toit.
        entry.light.target.position.set(
          Math.cos(angle) * 200,
          Math.sin(angle) * 200,
          entry.height * 0.25,
        );
        entry.light.target.updateMatrixWorld();
      }
    },
  ];

  const spawns: SpawnPoint[] = [
    // L'unite entre par l'ouest du rez-de-chaussee.
    { origin: [X0 + 96, 0, 32], yaw: 0 },
    { origin: [X0 + 96, -48, 32], yaw: 0 },
    { origin: [X0 + 160, 48, 32], yaw: 0 },
    { origin: [X0 + 160, -48, 32], yaw: 0 },
    // Les demons attendent plus haut, un par etage.
    { origin: [-400, 400, b.floorZ(1) + 32], yaw: -Math.PI / 2 },
    { origin: [400, 400, b.floorZ(2) + 32], yaw: -Math.PI / 2 },
    { origin: [-400, 400, b.floorZ(3) + 32], yaw: -Math.PI / 2 },
    { origin: [400, 200, b.floorZ(3) + 32], yaw: Math.PI },
  ];

  return {
    name: 'immeuble',
    root,
    collision: new CollisionWorld(builder.brushes),
    spawns,
    ambient: new THREE.Color('#080a0e'),
    skyColor: new THREE.Color('#05070c'),
    animated,
    // Sous le rez-de-chaussee, il n'y a rien : c'est une chute sans retour.
    floor: -512,
    darkness: true,
    menuView: MENU_VIEW,
  };
}

/**
 * Fond du menu : le couloir du rez-de-chaussee, pris de son extremite ouest.
 *
 * C'est le decor du jeu lui-meme derriere les entrees, et non une image : on
 * voit la gaine filer sous le plafond, le couloir s'enfoncer dans le noir, et
 * de temps en temps un projecteur passer au loin. Le menu n'a pas a connaitre
 * ces coordonnees, c'est le niveau qui les donne.
 */
const MENU_VIEW = {
  origin: [-690, 24, 44] as Vec3,
  yaw: (6 * Math.PI) / 180,
  pitch: (3 * Math.PI) / 180,
};

/** Projecteur exterieur : cone large, ombre portee, pas de decroissance douce. */
function spotlight(color: string, intensity: number): THREE.SpotLight {
  const light = new THREE.SpotLight(new THREE.Color(color), intensity, 6000, Math.PI * 0.09, 0.35, 0.9);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 64;
  light.shadow.camera.far = 6000;
  light.shadow.bias = -0.0006;
  return light;
}
