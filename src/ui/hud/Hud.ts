import type { UIComponent, UIManager } from '../core/UIManager';
import type { UIState } from '../core/UIState';
import { AmmoPanel } from './AmmoPanel';
import { Crosshair } from './Crosshair';
import { MatchPanel } from './MatchPanel';
import { Obituaries } from './Obituaries';
import { Scoreboard } from './Scoreboard';
import { StatusPanel } from './StatusPanel';
import { WeaponBar } from './WeaponBar';

/**
 * Assemble le HUD de jeu. La disposition suit une regle simple : les valeurs
 * vitales aux deux coins du bas, la partie en haut a droite, et le centre
 * laisse libre autour du reticule.
 *
 * Ce qui n'est pas la compte autant : ni barre de vie, ni cadre, ni compteur de
 * vitesse sous le reticule. Un couloir noir ou l'on ecoute avant d'avancer
 * n'admet pas d'ecran de bord ; ce qui doit se voir, c'est ce qui manque.
 */

/**
 * Voile de blessure au bord de l'image.
 *
 * Le chiffre de sante est dans un coin, et un joueur qui recule devant quelque
 * chose ne regarde pas les coins. Les bords de l'image, eux, se voient sans
 * qu'on les regarde.
 */
class DamageVeil implements UIComponent {
  readonly element: HTMLElement;
  private last = '';

  constructor(private readonly state: UIState) {
    this.element = document.createElement('div');
    this.element.className = 'hud-veil';
  }

  update(): void {
    const { healthLevel, player } = this.state.current;
    // Mort, le voile s'efface : l'ecran de fin prend le relais.
    const level = player.alive ? healthLevel : 'ok';
    if (level === this.last) return;
    this.last = level;
    this.element.classList.toggle('hud-veil--warning', level === 'warning');
    this.element.classList.toggle('hud-veil--critical', level === 'critical');
  }
}

export function createHud(manager: UIManager): Scoreboard {
  const { state, settings, events } = manager;

  manager.mount(new StatusPanel(state, settings), 'bottom-left');
  manager.mount(new AmmoPanel(state, settings), 'bottom-right');
  manager.mount(new MatchPanel(state, settings), 'top-right');
  manager.mount(new Obituaries(settings, events), 'top-left');
  manager.mount(new Crosshair(settings, events), 'center');
  manager.mount(new WeaponBar(state, settings, events), 'bottom-center');
  manager.mountLayer(new DamageVeil(state));

  /*
   * Le tableau des scores est rendu au jeu : il s'ouvre sur une touche tenue
   * et reste affiche a la fin de la partie.
   */
  const scoreboard = new Scoreboard(state);
  manager.mount(scoreboard, 'center');
  events.on('matchEnd', () => scoreboard.setFinal(true));
  events.on('matchStart', () => scoreboard.setFinal(false));
  return scoreboard;
}
