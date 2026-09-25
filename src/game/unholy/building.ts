import * as THREE from 'three';
import { type Vec3 } from '../../formats/bsp';
import { BUILDING_SCALE, buildingPoint } from './scale';
import { CollisionWorld, PLAYER_MINS } from '../collision';
import { BlockBuilder } from '../build/BlockBuilder';
import { Residential } from './residential';
import type { SurfaceKind } from '../../renderer/materials/Procedural';
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
 * Les demons utilisent les murs, les plafonds et le vide de la cage.
 */

/**
 * Plancher de lumiere : la part plate, et celle du ciel et du sol.
 *
 * Reglees en regardant l'image, et non en lisant des niveaux : les releves
 * ponctuels tombaient sur des coins sombres et annoncaient une image deux fois
 * plus claire qu'elle ne l'etait. Au quadruple, le couloir ressemble a un
 * bureau mal eclaire ; a la moitie, seul le rond de la lampe de secours existe
 * et le reste redevient un ecran eteint.
 *
 * Elles ont ete divisees par six le jour ou les surfaces sont passees de la
 * peinture au code a la photographie : une matiere photographiee renvoie plus
 * et porte son propre contraste, si bien que le meme plancher de lumiere
 * donnait le plein jour. Un reglage d'eclairage ne survit pas au changement
 * des matieres qu'il eclaire.
 */
const AMBIENT_FLOOR = 3.5;
const SKY_FLOOR = 4.5;

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
/** Passage de porte : large et haut de quoi passer en courant. */
const DOOR_W = 80;
const DOOR_H = 112;
/**
 * Teintes du batiment : du beton, du platre sale, du bois, du metal.
 *
 * Elles sont franchement sombres, et c'est mesure : sous le faisceau, une
 * teinte moyenne remonte a plus de deux cents niveaux des que le mur est a
 * moins de deux metres, et le couloir devient un tunnel blanc. A ces valeurs,
 * une cloison proche reste lisible sans ecraser le reste de l'image.
 */
const CONCRETE = '#232220';
const PLASTER = '#817764';
const WOOD = '#594632';
const DOORWAY = '#191512';
const GLASS = '#8fb6d8';
/** Ce que la nuit dehors laisse voir a travers une vitre sale. */
const GLASS_GLOW = '#1c2f44';

type Kind = SurfaceKind;

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
  /**
   * Une dalle porte deux pieces : son dessus est le sol d'un etage, son
   * dessous est le plafond de l'etage d'en dessous. Les faux plafonds du
   * couloir sortaient donc en carrelage, comme le sol.
   */
  slab(x0: number, x1: number, y0: number, y1: number, z: number, kind: Kind = 'floor', tint = CONCRETE): void {
    this.builder.block([x0, y0, z - SLAB], [x1, y1, z], { kind, tint, skip: ['z-'] });
    /*
     * Le faux plafond, colle sous la dalle. Il ne porte que sa face du
     * dessous et n'arrete rien : c'est la dalle qui tient le joueur.
     *
     * Une dalle porte deux pieces a la fois, son dessus est le sol d'un
     * etage et son dessous le plafond de l'etage d'en dessous, et les deux
     * n'ont aucune raison d'etre de la meme matiere. Les couloirs sortaient
     * donc avec un faux plafond en carrelage de sol.
     */
    this.builder.block([x0, y0, z - SLAB], [x1, y1, z - SLAB + 1], {
      kind: 'ceiling',
      tint,
      solid: false,
      skip: ['z+', 'x+', 'x-', 'y+', 'y-'],
    });
  }

  /**
   * Cloison pleine, entre deux hauteurs. Le platre des cloisons prend le motif
   * a grands panneaux : celui de la pierre dessine des fissures, qui se
   * lisaient comme un defaut de texture sous le faisceau.
   */
  wall(x0: number, x1: number, y0: number, y1: number, z: number, height: number, tint = PLASTER): void {
    const kind = 'plaster';
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
   * Cloison percee de trous rectangulaires : portes, portes de service,
   * fenetres.
   *
   * Le constructeur ne sait pas creuser, un bloc etant plein. Un passage se
   * fait donc en posant les morceaux autour du vide, et c'est ce que fait cette
   * aide. Sans elle, une ouverture n'etait qu'un encadrement pose sur un mur
   * plein, ce que seule la mesure disait : a l'ecran, la porte avait l'air
   * d'une porte.
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
        this.builder.block([at - 3, fixed0 + 10, z + sill], [at + 3, fixed1 - 10, z + top], { kind: 'wood', tint: '#605744' });
        this.builder.block([a0, fixed0 + 10, z + 100], [a1, fixed1 - 10, z + 105], { kind: 'wood', tint: '#605744' });
        this.wall(a0, a1, fixed0, fixed1, z, sill, CONCRETE);
        this.wall(a0, a1, fixed0, fixed1, z + top, height - top, CONCRETE);
        this.builder.block([a0, fixed0 + 12, z + sill], [a1, fixed1 - 12, z + top], {
          kind: 'glass',
          tint: GLASS,
          /*
           * La vitre porte la nuit du dehors : c'est ce qui la rend visible
           * depuis une piece noire, et ce sur quoi se decoupe ce qui passe
           * devant. Sans cette lueur, la crasse photographiee et l'opacite se
           * multipliaient jusqu'a l'effacer, et l'appartement n'avait plus
           * de fenetre du tout.
           */
          emissive: GLASS_GLOW,
          opacity: 0.55,
          shadow: false,
        });
      } else {
        this.wall(fixed0, fixed1, a0, a1, z, sill, CONCRETE);
        this.wall(fixed0, fixed1, a0, a1, z + top, height - top, CONCRETE);
        this.builder.block([fixed0 + 12, a0, z + sill], [fixed1 - 12, a1, z + top], {
          kind: 'glass',
          tint: GLASS,
          /*
           * La vitre porte la nuit du dehors : c'est ce qui la rend visible
           * depuis une piece noire, et ce sur quoi se decoupe ce qui passe
           * devant. Sans cette lueur, la crasse photographiee et l'opacite se
           * multipliaient jusqu'a l'effacer, et l'appartement n'avait plus
           * de fenetre du tout.
           */
          emissive: GLASS_GLOW,
          opacity: 0.55,
          shadow: false,
        });
      }
    }
  }

  /** Two opposed flights, twelve closed risers each, around an open stairwell. */
  stairFloor(zStart: number): void {
    const steps = 12, rise = 8, tread = 20;
    const front = -296, back = front - steps * tread;
    const landing = (y0: number, y1: number, z: number): void => {
      this.slab(STAIR_X0, STAIR_X1, y0, y1, z, 'plaster', '#655f53');
      this.builder.block([STAIR_X0, y0, z], [STAIR_X1, y1, z + 0.1], { kind: 'tile', tint: '#777365', solid: false });
    };
    landing(front, -HALL - SLAB, zStart);
    landing(Y0, back, zStart + 96);
    this.builder.slopedSlab(-736, -608, back, front, zStart + 96, zStart, 16);
    this.builder.slopedSlab(-512, -384, back, front, zStart + 96, zStart + 192, 16);
    for (let i = 0; i < steps; i++) {
      const westY = front - (i + 1) * tread;
      const eastY = back + i * tread;
      const westZ = zStart + (i + 1) * rise;
      const eastZ = zStart + 96 + (i + 1) * rise;
      for (const [x0, x1, y0, z] of [[-736, -608, westY, westZ], [-512, -384, eastY, eastZ]]) {
        this.builder.block([x0, y0, z - rise], [x1, y0 + tread, z], { kind: 'plaster', tint: '#726e63' });
      }
    }
  }

}

/**
 * Un appartement : une entree sur le couloir, un sejour, deux pieces au fond
 * contre la facade. Les cloisons laissent des passages, jamais une pièce
 * fermee : un appartement doit se traverser, sans quoi les demons n'y
 * contournent rien.
 */
function apartment(b: Building, x0: number, x1: number, z: number, doorAt: number): void {
  const yFront = HALL + SLAB;
  const yBack = Y1;
  const midY = yFront + (yBack - yFront) * 0.45;
  const midX = (x0 + x1) / 2;

  // Deux portes sur le couloir ; le reste de la cloison est plein.
  b.slab(x0, x1, yFront, yBack, z, 'wood', WOOD);
  b.pierced('x', x0, x1, HALL, yFront, z, ROOM, [
    { at: doorAt, width: DOOR_W, bottom: z, tall: DOOR_H },
    { at: x0 < 0 ? -672 : 672, width: DOOR_W, bottom: z, tall: DOOR_H },
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
  const decor = new Residential(builder, visual);
  const top = FLOORS * PITCH;

  // Enveloppe : quatre facades et le toit, pleines sur toute la hauteur. Les
  // baies sont percees etage par etage dans les facades nord et pignons.
  builder.block([STAIR_X1, Y0 - SLAB, -SLAB], [X1 + SLAB, Y0, top + SLAB], { kind: 'plaster', tint: CONCRETE });
  builder.block([X0 - SLAB, Y0 - SLAB, -SLAB], [X0, Y1 + SLAB, top + SLAB], { kind: 'plaster', tint: CONCRETE });
  builder.block([X1, Y0 - SLAB, -SLAB], [X1 + SLAB, Y1 + SLAB, top + SLAB], { kind: 'plaster', tint: CONCRETE });

  builder.block([X0 - SLAB, Y0 - SLAB, top + SLAB], [X1 + SLAB, Y1 + SLAB * 2, top + SLAB * 2], {
    kind: 'plaster',
    tint: CONCRETE,
  });

  for (let floor = 0; floor < FLOORS; floor++) {
    const z = b.floorZ(floor);
    b.windowWall('x', X0 - SLAB, STAIR_X1, Y0 - SLAB, Y0, z, ROOM, [-660, -460], 96);
    decor.stairWindows(z);
    // Spandrel between the stairwell windows; no floor across the vertical void.
    b.wall(X0 - SLAB, STAIR_X1, Y0 - SLAB, Y0, z + ROOM, SLAB, CONCRETE);

    // Couloir : sol, plafond, et ses deux murs. Celui du sud est aveugle ;
    // celui du nord porte les portes des deux
    // appartements.
    b.slab(X0, X1, -HALL, HALL, z, 'tile', '#777365');
    b.pierced('x', X0, X1, -HALL - SLAB, -HALL, z, ROOM, [
      { at: STAIR_DOOR, width: DOOR_W, bottom: z, tall: DOOR_H },
    ]);

    // Deux appartements au nord, de part et d'autre d'un refend central.
    apartment(b, X0, -64, z, -256);
    apartment(b, 64, X1, z, 256);
    b.wall(-64, 64, HALL, Y1 + SLAB, z, ROOM, PLASTER);

    // Cage d'escalier au sud-ouest : ouverte sur toute la hauteur, donc ni sol
    // ni plafond ici. Une volee par etage, alternee, et un palier qui donne sur
    // le couloir.
    if (floor < FLOORS - 1) b.stairFloor(z);
    else b.slab(STAIR_X0, STAIR_X1, -296, -HALL - SLAB, z, 'plaster', '#655f53');
    decor.hall(floor, z);
    decor.apartment(X0, -64, z, floor);
    decor.apartment(64, X1, z, floor);
    decor.stairs(z, floor === FLOORS - 1);
    // Fond de la cage, au niveau du rez : le reste de son emprise, en dehors
    // du palier que la volee a deja pose.
    if (floor === 0) b.slab(STAIR_X0, STAIR_X1, Y0, -296, 0, 'floor', CONCRETE);
    // Cloison entre la cage et la masse batie, sur toute la hauteur.
    if (floor === 0) {
      builder.block([STAIR_X1, Y0, -SLAB], [STAIR_X1 + SLAB, -HALL - SLAB, top], {
        kind: 'plaster',
        tint: CONCRETE,
      });
    }

    // Masse batie au sud du couloir : pleine, c'est elle qui donne au couloir
    // son mur aveugle.
    builder.block([STAIR_X1 + SLAB, Y0, z - SLAB], [X1, -HALL - SLAB, z + PITCH - SLAB], {
      kind: 'plaster',
      tint: CONCRETE,
    });

  }

  // Plafond du dernier etage : la seule dalle qui ne sert de plancher a
  // personne, donc la seule a poser en plus.
  b.slab(X0, X1, Y0, Y1 + SLAB, top, 'plaster', PLASTER);

  // Entree au rez-de-chaussee, a l'ouest : c'est par la que l'unite penetre
  // dans le batiment, et par la qu'elle doit ressortir.
  builder.block([X0 - SLAB, -HALL, -SLAB], [X0, HALL, ROOM], { kind: 'plaster', tint: DOORWAY, solid: false });
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
   * Lumiere.
   *
   * L'alimentation est defaillante, pas coupee. La difference tient en une
   * phrase : sans lampe on doit distinguer les volumes, avec la lampe les
   * details, et jamais l'inverse. Une ambiante a zero donnait un couloir ou
   * un mur, une porte et un plafond se valaient tous les trois, et une mort
   * venue du plafond y paraissait injuste plutot qu'effrayante.
   *
   * Le plancher vient donc surtout du ciel et du sol, et non d'une ambiante
   * plate : une lumiere d'hemisphere eclaire selon l'orientation de la
   * surface, si bien qu'un plafond, un mur et un plancher ne rendent pas le
   * meme niveau. C'est cette difference, et non la clarte, qui fait lire
   * l'architecture. La part plate reste tres basse, juste de quoi qu'une
   * surface verticale ne tombe pas a zero.
   */
  const root = builder.build();
  root.add(decor.signs);
  root.add(decor.fixtures.group);
  // Les reglettes arrivent un instant apres le decor : elles viennent d'un
  // fichier, et le niveau, lui, se monte d'un bloc.
  void decor.fixtures.mount();
  root.add(new THREE.AmbientLight(new THREE.Color('#16242f'), AMBIENT_FLOOR));
  root.add(new THREE.HemisphereLight(new THREE.Color('#16242f'), new THREE.Color('#15110c'), SKY_FLOOR));

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
      for (const { light, phase, base, fault } of decor.lamps) {
        if (fault === 'none') continue;
        if (fault === 'battery') {
          // Batterie a bout : de longues minutes franches, puis des a-coups.
          const cycle = (time + phase) % 13;
          light.intensity = cycle > 10 ? (Math.sin(time * 37 + phase) > 0.15 ? base * 0.72 : base * 0.03) : base;
          continue;
        }
        // Starter fatigue : il bat vite et se rallume mal, sans jamais mourir.
        const beat = Math.sin(time * 21 + phase) * Math.sin(time * 6.3 + phase * 2);
        light.intensity = beat > -0.25 ? base : base * (0.08 + Math.random() * 0.2);
      }
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
    { origin: [-400, 300, b.floorZ(1) + 32], yaw: -Math.PI / 2 },
    { origin: [400, 300, b.floorZ(2) + 32], yaw: -Math.PI / 2 },
    { origin: [-400, 300, b.floorZ(3) + 32], yaw: -Math.PI / 2 },
    { origin: [400, 200, b.floorZ(3) + 32], yaw: Math.PI },
  ];

  // Scale geometry and collision together; the player retains the engine's
  // standing hull (56) and eye height above the floor (50).
  root.scale.setScalar(BUILDING_SCALE);
  root.traverse(object => {
    if (object instanceof THREE.PointLight || object instanceof THREE.SpotLight) {
      object.distance *= BUILDING_SCALE;
      object.shadow.camera.near *= BUILDING_SCALE;
      object.shadow.camera.far *= BUILDING_SCALE;
      object.shadow.camera.updateProjectionMatrix();
    }
  });
  root.updateMatrixWorld(true);
  const scaledBrushes = builder.brushes.map(brush =>
    ({ ...brush, mins: buildingPoint(brush.mins), maxs: buildingPoint(brush.maxs),
      sides: brush.sides.map(side => ({ ...side, dist: side.dist * BUILDING_SCALE })) }));
  const scaledSpawns = spawns.map(spawn => ({
    ...spawn,
    origin: [spawn.origin[0] * BUILDING_SCALE, spawn.origin[1] * BUILDING_SCALE,
      (spawn.origin[2] - 32) * BUILDING_SCALE - PLAYER_MINS[2] + 0.125] as Vec3,
  }));

  return {
    name: 'immeuble',
    root,
    collision: new CollisionWorld(scaledBrushes),
    spawns: scaledSpawns,
    playerSpawn: scaledSpawns[0],
    ambient: new THREE.Color('#080a0e'),
    skyColor: new THREE.Color('#05070c'),
    animated,
    // Sous le rez-de-chaussee, il n'y a rien : c'est une chute sans retour.
    floor: -512,
    darkness: true,
    menuView: { ...MENU_VIEW, origin: [MENU_VIEW.origin[0] * BUILDING_SCALE, MENU_VIEW.origin[1] * BUILDING_SCALE, 50] },
  };
}

/**
 * Fond du menu : le couloir du rez-de-chaussee, pris de son extremite ouest.
 *
 * C'est le decor du jeu lui-meme derriere les entrees, et non une image : on
 * voit le couloir s'enfoncer dans le noir, et
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
