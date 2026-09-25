import assert from 'node:assert/strict';
import { Contents, type Vec3 } from '../src/formats/bsp';
import { PLAYER_MINS, PLAYER_MAXS, VIEW_HEIGHT } from '../src/game/collision';
import { PlayerMove, createMoveState } from '../src/game/physics';
import { buildBuilding, FLOORS } from '../src/game/unholy/building';
import { BUILDING_SCALE as SCALE, buildingPoint } from '../src/game/unholy/scale';

const level = buildBuilding(false);
const world = level.collision;
const MILITARY = Contents.SOLID | Contents.PLAYERCLIP | Contents.BODY;
const DEMON = Contents.SOLID | Contents.BODY;
const SMALL_MIN: Vec3 = [-12, -12, -12];
const SMALL_MAX: Vec3 = [12, 12, 12];
const ZERO: Vec3 = [0, 0, 0];
const PITCH = 192 * SCALE;
const ground = (x: number, y: number, floor = 0): Vec3 => [x * SCALE, y * SCALE, floor * PITCH - PLAYER_MINS[2] + 0.125];
const standing = (p: Vec3) => !world.trace(p, p, PLAYER_MINS, PLAYER_MAXS, MILITARY).startSolid;
const clear = (a: Vec3, b: Vec3) => world.trace(a, b, PLAYER_MINS, PLAYER_MAXS, MILITARY).fraction === 1;
const crawl = (a: Vec3, b: Vec3, mask = DEMON) => world.trace(buildingPoint(a), buildingPoint(b), SMALL_MIN, SMALL_MAX, mask).fraction;

for (let floor = 0; floor < FLOORS; floor++) {
  const z = floor * 192;
  assert.ok(clear(ground(-700, 24, floor), ground(600, 24, floor)), 'full-height soldier can cross the corridor');
  for (const x of [-672, -256, 256, 672]) {
    assert.ok(clear(ground(x, 45, floor), ground(x, 170, floor)), `door ${x}, floor ${floor + 1} clears the real player hull`);
  }
  for (const [x0, x1] of [[-672, -256], [256, 672]]) {
    assert.ok(clear(ground(x0, 175, floor), ground(x1, 175, floor)), 'furnished apartment loop stays open');
  }
  assert.ok(clear(ground(-568, -60, floor), ground(-568, -230, floor)), 'stairwell door stays open');
  const floorHit = world.trace([0, 0, floor * PITCH + 40], [0, 0, floor * PITCH - 8], ZERO, ZERO, MILITARY);
  assert.ok(Math.abs(floorHit.endPosition[2] - floor * PITCH) < 0.2, 'floor collision matches scaled floor');

  /*
   * Le demon passe par les murs, les plafonds et le vide de l'escalier, et par
   * rien d'autre : il n'y a plus de reseau de ventilation. Ce qui se verifie
   * donc est l'inverse de ce qu'on verifiait avant. D'un cote, le mur des
   * appartements est plein sur toute sa hauteur, y compris la ou une antenne
   * passait. De l'autre, le plafond du couloir est degage d'un bout a l'autre :
   * plus aucune gaine n'y pend, et c'est la route du demon.
   */
  for (const x of [-448, 448]) {
    assert.ok(crawl([x, 60, z + 126], [x, 170, z + 126]) < 1, 'apartment wall is solid at ceiling height');
  }
  const corridorTop = world.trace(buildingPoint([674, -62, z + 40]), buildingPoint([674, -62, z - 8]), ZERO, ZERO, DEMON);
  assert.ok(Math.abs(corridorTop.endPosition[2] - floor * PITCH) < 0.2, 'the corridor floor is continuous end to end');
  assert.equal(crawl([-700, -62, z + 126], [700, -62, z + 126]), 1, 'the corridor ceiling is clear for the whole length');
}
assert.equal(crawl([-560, -410, 128], [-560, -410, 650]), 1, 'central stair void stays open');

// Walk the actual standing player through every stair turn without jumping.
const mover = new PlayerMove(world);
const state = createMoveState(ground(-690, -230));
state.onGround = true;
function walkTo(x: number, y: number): void {
  const tx = x * SCALE, ty = y * SCALE;
  for (let tick = 0; tick < 125 * 8; tick++) {
    const dx = tx - state.origin[0], dy = ty - state.origin[1];
    if (Math.hypot(dx, dy) < 3) return;
    mover.step(state, { forward: 127, right: 0, up: 0, jump: false, crouch: false, yaw: Math.atan2(dy, dx), pitch: 0 }, 1 / 125);
  }
  assert.fail(`stair traversal blocked at ${state.origin}, heading for ${tx},${ty}`);
}
for (let floor = 0; floor < FLOORS - 1; floor++) {
  walkTo(-690, -230); walkTo(-690, -620); walkTo(-430, -620); walkTo(-430, -230);
  for (let tick = 0; tick < 125; tick++) mover.step(state, {
    forward: 0, right: 0, up: 0, jump: false, crouch: false, yaw: 0, pitch: 0,
  }, 1 / 125);
  assert.ok(Math.abs(state.origin[2] - ((floor + 1) * PITCH - PLAYER_MINS[2])) < 1, `next landing reached: ${state.origin}, floor ${floor}`);
}
for (const spawn of level.spawns) assert.ok(standing(spawn.origin), 'spawn clears walls, furniture and ceiling');

// Scale regression: eye above sofa; standard door and ceiling at human proportions.
const eyeHeight = VIEW_HEIGHT - PLAYER_MINS[2];
const sofa = world.trace(buildingPoint([-732, 310, 90]), buildingPoint([-732, 310, 0]), ZERO, ZERO, MILITARY);
assert.ok(sofa.fraction < 1 && sofa.endPosition[2] < eyeHeight * 0.65, 'sofa back stays below chest height');
assert.ok(112 * SCALE > PLAYER_MAXS[2] - PLAYER_MINS[2] && 112 * SCALE < eyeHeight * 1.5, 'human-scale doorway');
assert.ok(160 * SCALE / eyeHeight >= 1.8 && 160 * SCALE / eyeHeight <= 2.2, 'residential ceiling proportions');
assert.equal(level.darkness, true);
assert.ok(level.spawns.length >= 8);
console.log('PASS scaled building: human proportions, doors, apartment loops, continuous stairs, spawns, sealed openings and unobstructed ceilings');

assert.ok(level.playerSpawn && level.playerSpawn.origin[2] < 33, 'fixed human entry is at the ground floor');
const { pickSpawn } = await import('../src/game/level');
for (let i = 0; i < 12; i++) assert.equal(pickSpawn(level, i), level.playerSpawn, 'human entry never picks an upper floor');
// Trace across the under-slab at mid-flight: real sloping collision, not its bounding box.
const underside = world.trace(buildingPoint([-690, -416, 0]), buildingPoint([-690, -416, 80]), ZERO, ZERO, MILITARY);
assert.ok(Math.abs(underside.endPosition[2] - 32 * SCALE) < 0.2, 'waist slab has a continuous sloping underside');
console.log('PASS stair structure and fixed ground-floor player entry');
