/**
 * Ce qui fait qu'une arme est tenue, et non affichee.
 *
 * Toutes les amplitudes du porte-arme sont ici, dans un objet modifiable : la
 * prise en main, l'inertie du regard, le balancement de la marche, la
 * respiration, le recul, le faisceau de la lampe et l'eclairage du modele. Le
 * reglage se fait donc en jouant, depuis la console, et non en recompilant.
 *
 * Les valeurs sont volontairement petites. Une arme qui se balance beaucoup
 * gene la visee et se remarque ; ce qu'on cherche est l'inverse : que le joueur
 * sente une masse au bout de ses bras sans pouvoir dire ce qui bouge.
 */

export const VIEWMODEL = {
  /**
   * Prise en main, en unites de carte. Le modele arrive normalise a une unite
   * de long : la longueur ci-dessous est celle qu'on lui donne dans le monde,
   * et les decalages placent son centre par rapport a l'oeil.
   */
  hold: {
    length: 20,
    /*
     * Cadrage de hanche, regle en regardant l'image. Deux exigences qui se
     * contredisent : l'arme doit sortir du cadre par le coin bas-droit, sinon
     * elle flotte, et elle doit laisser voir le couloir, sinon elle encombre.
     * Loin et poussee dans le coin satisfait les deux : la crosse est coupee,
     * la carcasse et l'optique se lisent, et le couloir reste degage. Plus pres,
     * l'optique devient le centre de l'ecran ; moins pousse, l'arme decolle des
     * bords et redevient une image.
     */
    forward: 22,
    right: 12.5,
    down: 11.5,
    /** Ouverture vers l'interieur, en degres, et inclinaison. */
    yaw: 20,
    roll: 4,
  },

  /**
   * Inertie du regard. L'arme suit la vue avec un retard : c'est ce qui donne
   * la masse. Le moteur calcule deja l'ecart amorti, ces facteurs disent
   * seulement de combien il deplace et tourne l'arme.
   */
  sway: {
    /**
     * Deplacement lateral et vertical, en unites de carte par unite d'ecart.
     *
     * Les facteurs sont gros parce que l'ecart rendu par le moteur est petit :
     * un mouvement de souris franc vaut huit millemes. Il faut deux unites de
     * deplacement pour que le retard se lise a l'ecran, d'ou cet ordre de
     * grandeur. Les bornes ci-dessous tiennent les mouvements brusques.
     */
    shift: 150,
    lift: 120,
    /** Rotation, en radians par unite d'ecart. */
    yaw: 16,
    pitch: 12,
    /**
     * Bornes : au-dela, un mouvement de souris brusque sortirait l'arme. Elles
     * sont posees au-dessus de ce qu'un demi-tour normal produit, sinon elles
     * mordent tout le temps et un geste violent se lit comme un geste lent.
     */
    maxShift: 3,
    maxTurn: 0.16,
  },

  /** Balancement de la marche : le pas se sent, il ne se voit pas. */
  bob: {
    shift: 26,
    lift: 34,
    roll: 0.5,
  },

  /**
   * Respiration a l'arret. Deux periodes lentes et incommensurables : une
   * respiration parfaitement periodique se repere, et devient une horloge.
   */
  breath: {
    /** Amplitude, en unites de carte. */
    amount: 0.16,
    /** Periodes, en secondes. */
    slow: 3.7,
    fast: 2.3,
    /** Micro-rotation, en radians. */
    turn: 0.004,
  },

  /**
   * Visee epaulee.
   *
   * L'arme monte a l'oeil et l'optique vient sur l'axe du regard. Ce n'est pas
   * qu'une pose : c'est un marche. Le joueur vise mieux, mais son champ se
   * resserre d'un tiers et l'arme occupe le bas de l'image. Dans un immeuble
   * ou les demons arrivent par les murs et les plafonds, retrecir ce qu'on
   * voit est un risque, et c'est ce qui rend le geste interessant.
   */
  aim: {
    /**
     * Distance de l'optique a l'oeil, en unites de carte, et garde laissee
     * derriere la crosse. La plus grande des deux l'emporte : la garde suffit
     * en general, la distance n'etant qu'un plancher pour les armes courtes.
     */
    distance: 13,
    clearance: 12,
    /**
     * Descente du point vise sous le sommet de l'optique, en part de la
     * hauteur de l'arme. A zero, on vise le dessus du boitier ; en augmentant,
     * on descend dans l'optique, ce qui n'a de sens que si sa glace est
     * reellement percee.
     */
    sightDrop: 0,
    /** Montee a l'epaule et retour, en secondes. */
    raise: 0.13,
    lower: 0.1,
    /** Champ de vision du monde une fois epaule, en degres. */
    worldFov: 62,
    /**
     * Et celui de l'arme, en part du sien. Il ne suit pas le monde : resserrer
     * la camera de l'arme ne rapproche pas le decor, elle grossit l'arme, qui
     * couvrait alors l'ecran entier. Ce qui amene l'optique a l'oeil est la
     * pose, pas l'objectif ; il ne reste ici qu'un rien de resserrement, pour
     * que le geste ne soit pas parfaitement plat.
     */
    weaponZoom: 0.94,
    /** Ce qui reste des mouvements une fois epaule. */
    motion: 0.35,
    /** Taille du point rouge dans l'optique, en unites de la scene de l'arme. */
    dot: 0.5,
  },

  /** Recul : ce que fait l'arme, pas ce que fait la visee. */
  recoil: {
    /** Retrait le long du canon et soulevement, en unites de carte. */
    back: 2.2,
    lift: 0.7,
    /** Cabrage, en radians. */
    pitch: 0.09,
    /** Ecart lateral tire au hasard a chaque coup, en radians. */
    scatter: 0.02,
  },

  /**
   * Eclairage du modele. Il n'a pas a etre juste, il a a etre coherent : ce
   * qui eclaire l'arme est sa propre lampe, les sources du niveau quand on
   * passe dessous, et un tres faible remplissage froid pour que les volumes ne
   * tombent pas dans le noir absolu.
   */
  light: {
    /** Remplissage permanent : il n'eclaire pas, il empeche le noir pur. */
    fill: 0.16,
    /** Part de la lampe qui revient sur le modele. */
    beam: 2.4,
    /** Part des sources du niveau. */
    world: 1.6,
    /** Eclat du depart de coup, et sa duree en secondes. */
    flash: 5,
    flashTime: 0.06,
    /** Taille de l'eclat dessine, en unites de la scene de l'arme. */
    flashScale: 7,
  },
};

export type ViewmodelFeel = typeof VIEWMODEL;

/** Interrupteurs de mise au point : chaque effet se coupe seul. */
export const VIEWMODEL_SWITCHES = {
  sway: true,
  bob: true,
  breath: true,
  recoil: true,
  light: true,
};
