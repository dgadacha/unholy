/**
 * Banc de mesure du faisceau, charge depuis la console du navigateur.
 *
 * Regler une lampe en regardant des captures ne suffit pas : un disque un peu
 * trop vif et un disque brule se ressemblent a l'oeil, et la difference se
 * joue sur vingt niveaux. Ce fichier lit donc les pixels rendus, a des poses
 * reproductibles, et rend des nombres comparables d'un essai a l'autre.
 *
 * Il ne sert qu'au developpement et n'est jamais importe par le jeu.
 *
 *   const banc = await import('/tools/beam-harness.js');
 *   await banc.ouvrir();
 *   banc.serie();
 */

const UNITS_PER_METRE = 40;

let session = null;
let three = null;
let scratch = null;
let context = null;
let origin = null;

/** Prepare le banc : niveau charge, vue au point de depart, lecture prete. */
export async function ouvrir() {
  const start = Date.now();
  while (!window.__unholy?.session && Date.now() - start < 10000) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const handle = window.__unholy;
  if (!handle?.session) throw new Error('le jeu n\'est pas pret');
  session = handle.session;
  three = await import('/node_modules/.vite/deps/three.js');

  if (session.level?.name !== 'immeuble') await handle.building();
  avancer(30);

  const canvas = session.renderer.webgl.domElement;
  scratch = document.createElement('canvas');
  scratch.width = 320;
  scratch.height = Math.round((320 * canvas.height) / canvas.width);
  context = scratch.getContext('2d', { willReadFrequently: true });

  origin = {
    x: session.eye.x,
    y: session.eye.y,
    z: session.eye.z,
    yaw: session.input.yaw,
    pitch: session.input.pitch,
  };
  return { niveau: session.level?.name, lampe: session.flashlight.on, depart: origin };
}

/**
 * Fait tourner la simulation a la main.
 *
 * Le panneau du navigateur suspend les images des qu'il est masque : sans
 * cela, rien n'avancerait entre deux mesures et on lirait toujours la meme.
 */
export function avancer(frames = 1, turn = 0) {
  for (let i = 0; i < frames; i++) {
    if (turn) session.input.yaw -= turn;
    session.update(1 / 60);
  }
}

/** Revient au point de depart, pour que deux essais soient comparables. */
export function repos() {
  session.place(origin.x, origin.y, origin.z - session.state.viewHeight, origin.yaw, origin.pitch);
  avancer(6);
}

/** Luminance rendue a des points de l'ecran, de zero a deux cent cinquante-cinq. */
export function lire(points) {
  session.draw();
  context.drawImage(session.renderer.webgl.domElement, 0, 0, scratch.width, scratch.height);
  return points.map(([x, y]) => {
    const px = Math.round(x * (scratch.width - 1));
    const py = Math.round(y * (scratch.height - 1));
    const [r, g, b] = context.getImageData(px, py, 1, 1).data;
    return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  });
}

/** Se place a une distance donnee, en metres, de la surface visee. */
export function mur(metres) {
  const direction = new three.Vector3();
  session.camera.getWorldDirection(direction);
  const ray = new three.Raycaster(session.eye.clone(), direction);
  ray.far = 6000;
  const hit = ray
    .intersectObjects(session.scene.children, true)
    .find((candidate) => candidate.object.isMesh && candidate.object.visible);
  if (!hit) return null;
  const spot = hit.point.clone().addScaledVector(direction, -metres * UNITS_PER_METRE);
  session.place(spot.x, spot.y, spot.z - session.state.viewHeight, origin.yaw, origin.pitch);
  avancer(10);
  return Math.round(hit.distance);
}

/**
 * Coupe horizontale du faisceau sur le mur vise : du bord gauche au bord
 * droit, en passant par l'axe. C'est ce releve qui dit si la lampe a un coeur
 * et un debord, ou seulement un disque.
 */
export function coupe(metres = 1.2) {
  repos();
  mur(metres);
  const line = [];
  for (let i = 0; i <= 20; i++) line.push([i / 20, 0.5]);
  return lire(line);
}

/** Le plus haut niveau lu autour de l'axe : le coeur du faisceau. */
export function coeur() {
  const grid = [];
  for (const y of [0.42, 0.5, 0.58]) for (const x of [0.42, 0.5, 0.58]) grid.push([x, y]);
  return Math.max(...lire(grid));
}

/** Coeur du faisceau a plusieurs distances : la profondeur du couloir. */
export function serie(distances = [1, 2, 4, 8, 14]) {
  const out = {};
  for (const metres of distances) {
    repos();
    if (mur(metres) === null) {
      out[`${metres}m`] = null;
      continue;
    }
    out[`${metres}m`] = coeur();
  }
  repos();
  return out;
}

/** Puissance et decroissance, pour essayer un reglage sans recompiler. */
export function lampe(power, decay) {
  const light = session.flashlight.light;
  if (power !== undefined) light.intensity = power;
  if (decay !== undefined) light.decay = decay;
  return { puissance: light.intensity, decroissance: light.decay, angle: light.angle };
}

/**
 * Luminance lue sur l'arme elle-meme, la ou le modele occupe l'ecran.
 *
 * Les points sont pris dans la carcasse et sur le haut du canon, pas sur les
 * bords : un bord melange l'arme et le decor, et c'est justement la difference
 * entre les deux qu'on mesure.
 */
export function arme() {
  const points = [
    [0.72, 0.72],
    [0.78, 0.78],
    [0.84, 0.84],
    [0.68, 0.68],
  ];
  const values = lire(points);
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * Compare l'arme collee a une cloison et l'arme dans le vide : c'est le
 * releve qui dit si son eclairage depend du lieu ou s'il est peint dessus.
 */
export function retour() {
  repos();
  mur(0.8);
  const contre = arme();
  repos();
  // Vers le haut : la lampe part au plafond, rien ne revient tout de suite.
  session.input.pitch = -0.7;
  avancer(40);
  const vide = arme();
  session.input.pitch = 0;
  repos();
  return { contreUnMur: contre, versLeVide: vide };
}
