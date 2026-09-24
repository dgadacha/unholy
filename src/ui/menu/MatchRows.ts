import { SKILL_NAMES, type BotSkill } from '../../game/bots/BotBrain';

/**
 * Reglages de l'operation, ceux que l'ecran de preparation propose.
 *
 * Le format du jeu n'est pas un reglage : quatre militaires, quatre demons,
 * une seule vie. Il est donc annonce par la fiche de l'operation, et les lignes
 * ne gardent que ce qui se regle vraiment aujourd'hui, le nombre
 * d'adversaires, leur niveau et la duree. Une ligne qui ne fait rien n'a pas sa
 * place ici.
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
 * Aucun adversaire par defaut, pour l'instant.
 *
 * Les combattants de l'arene heritee tirent dans le noir sans avoir de corps :
 * ils n'ont ni les modeles des demons, qui n'existent pas encore, ni leur
 * facon de se deplacer. Entrer dans l'immeuble pour y etre abattu par un
 * fusil invisible n'apprend rien. La ligne reste reglable : c'est ainsi qu'on
 * les remet pour essayer le combat.
 */
export const DEFAULT_MATCH: MatchRules = {
  bots: 0,
  skill: 3,
  fragLimit: 20,
  timeLimit: 600,
};

export interface MatchRow {
  id: string;
  label: string;
  read: (rules: MatchRules) => { text: string; fill?: number };
  step: (direction: number, rules: MatchRules) => void;
}

const TIME_LIMITS = [0, 300, 600, 900, 1200, 1800];

function cycle(values: number[], current: number, direction: number): number {
  const index = values.indexOf(current);
  const base = index < 0 ? 0 : index;
  return values[(base + direction + values.length) % values.length];
}

export const MATCH_ROWS: MatchRow[] = [
  {
    id: 'bots',
    label: 'Opponents',
    read: (rules) => ({ text: String(rules.bots), fill: rules.bots / 11 }),
    step: (direction, rules) => {
      rules.bots = Math.max(0, Math.min(11, rules.bots + direction));
    },
  },
  {
    id: 'skill',
    label: 'Skill',
    read: (rules) => ({ text: SKILL_NAMES[rules.skill].toLowerCase(), fill: (rules.skill - 1) / 4 }),
    step: (direction, rules) => {
      const next = Math.max(1, Math.min(5, rules.skill + direction));
      rules.skill = next as BotSkill;
    },
  },
  {
    id: 'timeLimit',
    label: 'Time limit',
    read: (rules) => ({
      text: rules.timeLimit > 0 ? `${Math.round(rules.timeLimit / 60)} min` : 'none',
    }),
    step: (direction, rules) => {
      rules.timeLimit = cycle(TIME_LIMITS, rules.timeLimit, direction);
    },
  },
];
