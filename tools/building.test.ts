import assert from 'node:assert/strict';
import { Contents, type Vec3 } from '../src/formats/bsp';
import { PlayerMove, createMoveState, type MoveInput } from '../src/game/physics';
import { buildBuilding } from '../src/game/unholy/building';

/**
 * L'immeuble : ce qui doit pouvoir etre parcouru.
 *
 * Le decor est fabrique par le code, et chacun de ses defauts a ete trouve par
 * la mesure, jamais a l'oeil : une bouche de ventilation collee sur un mur
 * plein, une dalle posee deux fois, une porte de cage d'escalier percee dans un
 * mur pose plein juste apres, un palier qui s'arretait a cinquante unites du
 * mur et par lequel on tombait dans la cage. Tous se voient de la meme facon,
 * en demandant au decor si l'on passe.
 *
 * L'essai monte donc l'immeuble sans rendu et l'arpente de deux facons : par
 * des traces, pour la topologie, et par le deplacement du joueur lui-meme, pour
 * ce qui se franchit a pied.
 */

const level = buildBuilding(false);
const world = level.collision;

/** Ce qui arrete un militaire, et ce qui arrete un demon. */
const MILITAIRE = Contents.SOLID | Contents.PLAYERCLIP | Contents.BODY;
const DEMON = Contents.SOLID | Contents.BODY;

/** Gabarit du joueur debout, et celui d'un demon dans une gaine. */
const MINS: Vec3 = [-15, -15, -24];
const MAXS: Vec3 = [15, 15, 32];
const SMALL_MINS: Vec3 = [-12, -12, -12];
const SMALL_MAXS: Vec3 = [12, 12, 12];
const POINT: Vec3 = [0, 0, 0];

/** Mesures du plan, reprises telles quelles : l'essai doit casser si elles bougent. */
const PITCH = 192;
const FLOORS = 4;
const DUCT_Z = (floor: number): number => floor * PITCH + 160 - 72 - 8 + 36;
const DUCT_Y = -96 + 36 + 8;
const SHAFT_X = 640 + 36 + 8;
const STAIR_DOOR = -568;

function standing(x: number, y: number, z: number): boolean {
  return !world.trace([x, y, z], [x, y, z], MINS, MAXS, MILITAIRE).startSolid;
}

function crawl(from: Vec3, to: Vec3, mask: number): number {
  return world.trace(from, to, SMALL_MINS, SMALL_MAXS, mask).fraction;
}

function floorUnder(x: number, y: number, from: number): number | null {
  const trace = world.trace([x, y, from], [x, y, from - 1024], POINT, POINT, MILITAIRE);
  if (trace.startSolid || trace.fraction >= 1) return null;
  return trace.endPosition[2];
}

/** Marche tout droit depuis un point, et rend ou l'on arrive. */
function walk(x: number, y: number, z: number, yaw: number, seconds: number): { origin: Vec3; onGround: boolean } {
  const mover = new PlayerMove(world);
  const state = createMoveState([x, y, z]);
  state.onGround = true;
  const input: MoveInput = { forward: 127, right: 0, up: 0, jump: false, crouch: false, yaw, pitch: 0 };
  const ticks = Math.round(seconds * 125);
  for (let tick = 0; tick < ticks; tick++) mover.step(state, input, 1 / 125);
  return { origin: [...state.origin] as Vec3, onGround: state.onGround };
}

const SOUTH = -Math.PI / 2;
const NORTH = Math.PI / 2;
const EAST = 0;

// Chaque etage a son sol a sa place, et son couloir est libre d'un bout a
// l'autre : c'est la que les militaires tiennent la longueur.
for (let floor = 0; floor < FLOORS; floor++) {
  const z = floor * PITCH + 32;
  const found = floorUnder(0, 0, z + 40);
  // La trace s'arrete a un cheveu de la surface : c'est la marge du moteur.
  assert.ok(
    found !== null && Math.abs(found - floor * PITCH) < 1,
    `le sol de l'etage ${floor + 1} doit etre a ${floor * PITCH}, trouve ${found}`,
  );
  for (const x of [-700, -256, 0, 256, 600]) {
    assert.ok(standing(x, 0, z), `le couloir de l'etage ${floor + 1} doit etre libre en x=${x}`);
  }
  // Les deux appartements, jusqu'a leurs pieces du fond.
  for (const x of [-448, 448]) {
    assert.ok(standing(x, 300, z), `le sejour de l'appartement ${x < 0 ? 'ouest' : 'est'} doit etre libre`);
    // Bien au large du refend qui separe les deux pieces du fond : a soixante
    // unites, le gabarit du joueur le touchait deja.
    assert.ok(standing(x - 120, 560, z), 'la piece du fond doit etre libre');
  }
}

// Le couloir se traverse en courant, sans rien accrocher.
const hall = walk(-700, 0, 32, EAST, 6);
assert.ok(hall.origin[0] > 560, `le couloir doit se traverser, on s'arrete a x=${hall.origin[0].toFixed(0)}`);
assert.ok(hall.onGround, 'on doit rester au sol dans le couloir');

// Les portes d'appartement s'ouvrent depuis le couloir : sans le percement du
// mur, on restait dans le couloir a heurter le platre.
for (const x of [-256, 256]) {
  const inside = walk(x, 60, 32, NORTH, 1.6);
  assert.ok(
    inside.origin[1] > 300,
    `la porte de l'appartement en x=${x} doit s'ouvrir, on s'arrete a y=${inside.origin[1].toFixed(0)}`,
  );
}

// La cage d'escalier : la porte du couloir, puis un etage gravi par les deux
// demi-volees. Le palier bas doit rattraper le mur, faute de quoi on tombe.
const throughDoor = walk(STAIR_DOOR, -60, 32, SOUTH, 1.4);
assert.ok(
  throughDoor.origin[1] < -200,
  `la porte de la cage doit s'ouvrir, on s'arrete a y=${throughDoor.origin[1].toFixed(0)}`,
);
const firstFlight = walk(-690, -250, 32, SOUTH, 4);
assert.ok(
  firstFlight.onGround && firstFlight.origin[2] > 100,
  `la demi-volee ouest doit monter et porter, on finit a z=${firstFlight.origin[2].toFixed(0)}`,
);
const secondFlight = walk(-430, -620, firstFlight.origin[2], NORTH, 4);
assert.ok(
  Math.abs(secondFlight.origin[2] - (PITCH + 24)) < 12,
  `la demi-volee est doit deboucher a l'etage, on finit a z=${secondFlight.origin[2].toFixed(0)}`,
);

/*
 * Le reseau de ventilation. C'est la seule asymetrie du decor, et elle doit
 * tenir des deux cotes : le demon passe partout dans le reseau, le militaire
 * est arrete a chaque bouche.
 */
for (let floor = 0; floor < FLOORS; floor++) {
  const z = DUCT_Z(floor);
  assert.equal(
    crawl([-700, DUCT_Y, z], [600, DUCT_Y, z], DEMON),
    1,
    `la gaine de l'etage ${floor + 1} doit se parcourir en entier`,
  );
  for (const at of [-256, 96, 448]) {
    assert.equal(
      crawl([at, DUCT_Y + 140, z], [at, DUCT_Y, z], DEMON),
      1,
      `le demon doit entrer par la bouche en x=${at}`,
    );
    assert.ok(
      crawl([at, DUCT_Y + 140, z], [at, DUCT_Y, z], MILITAIRE) < 0.9,
      `le militaire doit etre arrete par la bouche en x=${at}`,
    );
  }
  for (const at of [-448, 448]) {
    assert.equal(
      crawl([at, DUCT_Y + 20, z], [at, 260, z], DEMON),
      1,
      `l'antenne vers l'appartement en x=${at} doit deboucher`,
    );
    assert.ok(
      crawl([at, 260, z], [at, DUCT_Y + 20, z], MILITAIRE) < 0.9,
      `le militaire ne doit pas pouvoir remonter l'antenne en x=${at}`,
    );
  }
  assert.equal(
    crawl([560, DUCT_Y, z], [SHAFT_X, DUCT_Y, z], DEMON),
    1,
    `la gaine de l'etage ${floor + 1} doit rejoindre la colonne`,
  );
}

// La colonne relie les quatre etages : sans les tremies dans les planchers,
// chaque dalle la coupait net.
assert.equal(
  crawl([SHAFT_X, DUCT_Y, DUCT_Z(0)], [SHAFT_X, DUCT_Y, DUCT_Z(FLOORS - 1)], DEMON),
  1,
  'la colonne de ventilation doit relier le rez au dernier etage',
);

// Le decor est sans courant : la vue doit le savoir pour allumer la lampe.
assert.equal(level.darkness, true, "l'immeuble doit se declarer sans courant");
assert.ok(level.spawns.length >= 8, 'huit combattants doivent avoir ou apparaitre');

console.log("PASS immeuble : couloirs, appartements, cage d'escalier et reseau de ventilation");
