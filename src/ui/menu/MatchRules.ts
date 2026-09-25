import type { BotSkill } from '../../game/bots/BotBrain';

/**
 * Regles de la partie.
 *
 * Elles ne se reglent plus : le jeu n'a qu'un decor, qu'un format et qu'une
 * arme, et l'ecran qui demandait le nombre d'adversaires, leur niveau et la
 * duree venait du moteur d'origine, ou l'on montait une partie a la carte.
 * Ici il ne faisait que retarder l'entree dans l'immeuble.
 *
 * Elles restent ecrites ici parce que l'arene en a besoin, et parce qu'elles
 * redeviendront reglables le jour ou il y aura deux camps a equilibrer.
 */
export interface MatchRules {
  bots: number;
  skill: BotSkill;
  /** Frags a atteindre, zero pour aucune limite. */
  fragLimit: number;
  /** Duree, en secondes, zero pour aucune limite. */
  timeLimit: number;
}

/*
 * Aucun adversaire, pour l'instant.
 *
 * Les combattants de l'arene heritee tirent dans le noir sans avoir de corps :
 * ils n'ont ni les modeles des demons, qui n'existent pas encore, ni leur
 * facon de se deplacer. Entrer dans l'immeuble pour y etre abattu par un fusil
 * invisible n'apprend rien. La poignee `__unholy.match` les remet pour essayer
 * le combat.
 */
export const DEFAULT_MATCH: MatchRules = {
  bots: 0,
  skill: 3,
  fragLimit: 20,
  timeLimit: 600,
};
