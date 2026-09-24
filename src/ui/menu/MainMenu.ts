import '../styles/menu.css';
import type { ModernRenderSettings, RenderSettingsStore } from '../../renderer/RenderSettings';
import { SETTING_ROWS, type SettingRow } from './SettingsRows';
import { DEFAULT_MATCH, MATCH_ROWS, type MatchRow, type MatchRules } from './MatchRows';
import type { MenuAudio } from './MenuAudio';

/**
 * Menu principal.
 *
 * La composition est celle de Quake III : le titre en haut, les entrees au
 * centre en capitales, une ligne discrete en bas, et le decor du jeu rendu
 * derriere.
 * Ce qui change, c'est la finition : le decor est rendu en temps reel derriere
 * le menu, la navigation repond au clavier comme a la souris, et les pages
 * glissent l'une vers l'autre au lieu de se remplacer.
 *
 * Le menu ne decide de rien : il annonce l'entree choisie et laisse le jeu
 * agir. C'est ce qui permet de le relire sans suivre le jeu entier.
 */

export interface MenuEntry {
  id: string;
  label: string;
  /** Ligne secondaire sous l'entree, pour une precision courte. */
  note?: string;
  /** Entree de second rang : plus petite, elle ne concurrence pas les autres. */
  minor?: boolean;
}

interface MenuPage {
  id: string;
  title?: string;
  /** Contenu libre place avant les entrees, par exemple la carte a jouer. */
  header?: string;
  /** Page de reglages : ses lignes viennent de la table, pas des entrees. */
  settings?: boolean;
  /** Page de preparation de partie : mode, adversaires, limites. */
  match?: boolean;
  entries: MenuEntry[];
}

/**
 * Pages du menu. Aucune entree morte : tout repond.
 *
 * Le jeu ne propose qu'un decor et qu'une operation : il n'y a donc ni choix de
 * carte, ni liste de dossiers de donnees. Ce qui reste du moteur d'origine,
 * banc de mesure et lecture des cartes de Quake III, est un outil et vit sur sa
 * propre page.
 */
const PAGES: MenuPage[] = [
  {
    id: 'main',
    entries: [
      { id: 'single', label: 'Operation' },
      { id: 'settings', label: 'Settings' },
      { id: 'credits', label: 'Credits' },
      { id: 'tools', label: 'Engine tools', minor: true },
    ],
  },
  {
    id: 'single',
    title: 'Operation',
    header: 'card',
    match: true,
    entries: [
      { id: 'start', label: 'Enter the building' },
      { id: 'back', label: 'Back', minor: true },
    ],
  },
  {
    id: 'tools',
    title: 'Engine tools',
    header: 'tools',
    entries: [
      { id: 'benchmark', label: 'Benchmark', note: 'needs a Quake III map' },
      { id: 'bsp', label: 'Load the Quake III map', note: 'rendering comparisons' },
      { id: 'arena', label: 'Test arena', note: 'no data needed' },
      { id: 'back', label: 'Back', minor: true },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    settings: true,
    entries: [{ id: 'back', label: 'Back', minor: true }],
  },
  {
    id: 'credits',
    title: 'Credits',
    header: 'credits',
    entries: [{ id: 'back', label: 'Back', minor: true }],
  },
];

export class MainMenu {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly selector: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly pages = new Map<string, { element: HTMLElement; items: HTMLButtonElement[] }>();
  /** Lignes de reglage, pour les relire quand une valeur change. */
  private readonly rows = new Map<HTMLButtonElement, SettingRow>();
  /** Lignes de preparation de partie, meme principe. */
  private readonly matchLines = new Map<HTMLButtonElement, MatchRow>();
  /** Regles de la prochaine partie, telles que le menu les propose. */
  readonly rules: MatchRules = { ...DEFAULT_MATCH };
  private page = 'main';
  private index = 0;
  private visible = false;

  /** Entree validee : son identifiant, page comprise. */
  onSelect: ((page: string, entry: string) => void) | null = null;
  onSource: ((name: string) => void) | null = null;
  /** Prevenu quand un reglage change demande de reprendre la carte. */
  onReload: (() => void) | null = null;
  /** Prevenu quand les reglages ouverts en partie sont refermes. */
  onClose: (() => void) | null = null;
  /** Prevenu quand les regles de la partie changent. */
  onRules: ((rules: MatchRules) => void) | null = null;

  constructor(
    parent: HTMLElement,
    build: string,
    private readonly store?: RenderSettingsStore,
    private readonly audio?: MenuAudio,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <img class="menu__logo" src="/logo.png" alt="Unholy" />
      <div class="menu__stage">
        <div class="menu__selector"></div>
      </div>
      <div class="menu__footer">
        <span><b>Unholy</b> &middot; work in progress</span>
        <span class="menu__notes"></span>
      </div>
    `;
    parent.appendChild(this.root);

    this.stage = this.root.querySelector('.menu__stage') as HTMLElement;
    this.selector = this.root.querySelector('.menu__selector') as HTMLElement;
    this.notes = this.root.querySelector('.menu__notes') as HTMLElement;
    (this.root.querySelector('.menu__footer span') as HTMLElement).insertAdjacentHTML(
      'afterend',
      `<span class="menu__build">build ${build}</span>`,
    );

    for (const page of PAGES) this.pages.set(page.id, this.buildPage(page));
    this.showPage('main');
    window.addEventListener('keydown', this.onKey);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get currentPage(): string {
    return this.page;
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('menu--overlay');
    this.root.classList.add('menu--visible');
    this.showPage('main');
  }

  /**
   * Ouvre les reglages par-dessus la partie : sans titre, et avec un
   * assombrissement leger, pour qu'on voie encore ou l'on se trouve.
   */
  openSettings(): void {
    this.visible = true;
    this.root.classList.add('menu--visible', 'menu--overlay');
    this.showPage('settings');
  }

  get inOverlay(): boolean {
    return this.root.classList.contains('menu--overlay');
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('menu--visible');
    this.selector.classList.remove('menu__selector--visible');
  }

  /**
   * Etat des donnees de Quake III : ce qu'on en a monte, et ce que cela ouvre.
   *
   * Le jeu n'en depend pas, son decor etant fabrique par le code : seules les
   * entrees de la page des outils s'allument ou s'eteignent avec elles.
   */
  setEngineData(summary: string, mapAvailable: boolean): void {
    const line = this.root.querySelector('.menu-data') as HTMLElement | null;
    if (line) line.textContent = summary;
    const tools = this.pages.get('tools');
    for (const id of ['benchmark', 'bsp']) {
      const item = tools?.items.find((entry) => entry.dataset.entry === id);
      if (item) item.disabled = !mapAvailable;
    }
  }

  setNotes(text: string, isError = false): void {
    this.notes.textContent = text;
    this.notes.classList.toggle('menu__notes--error', isError);
  }

  /**
   * Dossiers de donnees montes, sur la page des outils : un seul a la fois.
   * Cela ne concerne plus le jeu, dont le decor ne vient d'aucun fichier.
   */
  setSources(names: string[], active: string): void {
    const box = this.root.querySelector('.menu__sources') as HTMLElement | null;
    if (!box) return;
    box.innerHTML = '';
    for (const name of names) {
      const button = document.createElement('button');
      button.className = name === active ? 'menu__source menu__source--active' : 'menu__source';
      button.textContent = name;
      button.addEventListener('click', () => {
        if (name !== active) this.onSource?.(name);
      });
      box.appendChild(button);
    }
  }

  /** Revient a la page precedente, ou rend faux quand on est a la racine. */
  back(): boolean {
    if (this.page === 'main') return false;
    this.showPage('main');
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private buildPage(page: MenuPage): { element: HTMLElement; items: HTMLButtonElement[] } {
    const element = document.createElement('div');
    element.className = 'menu-screen';
    element.dataset.page = page.id;

    if (page.title) {
      const title = document.createElement('h2');
      title.className = 'menu-screen__title';
      title.textContent = page.title;
      element.appendChild(title);
    }
    if (page.header === 'card') {
      const card = document.createElement('div');
      card.className = 'menu-card';
      card.innerHTML = `
        <div class="menu-card__map">The building</div>
        <div class="menu-card__title">Four floors, no power</div>
        <div class="menu-card__line">
          four soldiers &middot; four demons &middot; one life each
        </div>
        <div class="menu-card__line menu-card__line--soon">
          in this build: the building and the dark. The demons, the two teams and
          the one-life rule come next.
        </div>
      `;
      element.appendChild(card);
    }
    if (page.header === 'tools') {
      const box = document.createElement('div');
      box.className = 'menu-card';
      box.innerHTML = `
        <div class="menu-card__title">Reading Quake III data</div>
        <div class="menu-card__line">
          The engine still reads <b>.pk3</b> archives: it is how this renderer was
          built, and how the opponents get their bodies until they have their own.
          The game itself needs none of it.
        </div>
        <div class="menu-card__line menu-data"></div>
      `;
      element.appendChild(box);
      const sources = document.createElement('div');
      sources.className = 'menu__sources';
      box.appendChild(sources);
    }
    if (page.header === 'credits') {
      const text = document.createElement('p');
      text.className = 'menu-text';
      text.innerHTML = `
        <b>Unholy</b> — an asymmetric horror shooter. Four soldiers enter a
        condemned apartment block at night; four demons are already inside. The
        soldiers own the firing lines, the demons own the walls, the ceilings and
        the ducts.<br />
        The engine, the renderer and the material chain are written from
        scratch, in TypeScript on top of Three.js. They grew out of a study of
        <b>Quake III Arena</b>, id Software, 1999, whose archives the engine can
        still read: that data stays on your machine and never leaves it.
      `;
      element.appendChild(text);
    }

    const items: HTMLButtonElement[] = [];
    if (page.match) {
      const list = document.createElement('div');
      list.className = 'menu-settings';
      element.appendChild(list);
      for (const row of MATCH_ROWS) items.push(this.buildMatchRow(row, list));
    }
    if (page.settings) {
      const list = document.createElement('div');
      list.className = 'menu-settings';
      element.appendChild(list);
      for (const row of SETTING_ROWS) items.push(this.buildSettingRow(row, list));
    }
    for (const entry of page.entries) {
      const item = document.createElement('button');
      item.className = entry.minor ? 'menu-item menu-item--minor' : 'menu-item';
      item.dataset.entry = entry.id;
      item.innerHTML = entry.note
        ? `${entry.label}<span class="menu-item__note">${entry.note}</span>`
        : entry.label;
      item.addEventListener('mouseenter', () => {
        if (item.disabled || this.index === items.indexOf(item)) return;
        this.index = items.indexOf(item);
        this.refresh();
        this.audio?.play('move');
      });
      item.addEventListener('click', () => this.choose(items.indexOf(item)));
      items.push(item);
      element.appendChild(item);
    }

    this.stage.appendChild(element);
    return { element, items };
  }

  /**
   * Une ligne de reglage : le nom a gauche, la valeur a droite. Elle se change
   * a gauche et a droite, ou en la validant, comme au menu d'origine.
   */
  private buildSettingRow(row: SettingRow, host: HTMLElement): HTMLButtonElement {
    const line = document.createElement('button');
    line.className = 'menu-item menu-setting';
    line.dataset.entry = `set:${row.id}`;
    line.innerHTML = `
      <span class="menu-setting__label">${row.label}</span>
      <span class="menu-setting__bar"><span></span></span>
      <span class="menu-setting__value"></span>
    `;
    line.addEventListener('mouseenter', () => {
      const page = this.pages.get('settings');
      if (!page || this.index === page.items.indexOf(line)) return;
      this.index = page.items.indexOf(line);
      this.refresh();
      this.audio?.play('move');
    });
    line.addEventListener('click', (event) => {
      // Le clic droit de la souris n'arrive pas ici : un clic avance d'un
      // cran, et la molette comme les fleches font les deux sens.
      this.adjust(event.shiftKey ? -1 : 1, line);
    });
    line.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.adjust(event.deltaY > 0 ? -1 : 1, line);
    }, { passive: false });
    host.appendChild(line);
    this.rows.set(line, row);
    return line;
  }

  /**
   * Une ligne de preparation de partie. Meme dessin qu'un reglage : le nom a
   * gauche, la valeur a droite, et les fleches changent la valeur.
   */
  private buildMatchRow(row: MatchRow, host: HTMLElement): HTMLButtonElement {
    const line = document.createElement('button');
    line.className = 'menu-item menu-setting';
    line.dataset.entry = `match:${row.id}`;
    line.innerHTML = `
      <span class="menu-setting__label">${row.label}</span>
      <span class="menu-setting__bar"><span></span></span>
      <span class="menu-setting__value"></span>
    `;
    line.addEventListener('mouseenter', () => {
      const page = this.pages.get('single');
      if (!page || this.index === page.items.indexOf(line)) return;
      this.index = page.items.indexOf(line);
      this.refresh();
      this.audio?.play('move');
    });
    line.addEventListener('click', (event) => this.adjust(event.shiftKey ? -1 : 1, line));
    line.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.adjust(event.deltaY > 0 ? -1 : 1, line);
    }, { passive: false });
    host.appendChild(line);
    this.matchLines.set(line, row);
    return line;
  }

  /** Reporte les regles courantes dans les lignes de la page de partie. */
  private readMatch(): void {
    for (const [line, row] of this.matchLines) {
      const value = row.read(this.rules);
      (line.querySelector('.menu-setting__value') as HTMLElement).textContent = value.text;
      const bar = line.querySelector('.menu-setting__bar') as HTMLElement;
      const fill = bar.firstElementChild as HTMLElement;
      bar.classList.toggle('menu-setting__bar--visible', value.fill !== undefined);
      fill.style.width = `${Math.round((value.fill ?? 0) * 100)}%`;
    }
  }

  /** Change la valeur d'une ligne de reglage et la reaffiche. */
  private adjust(direction: number, line: HTMLButtonElement): void {
    const match = this.matchLines.get(line);
    if (match) {
      match.step(direction, this.rules);
      this.readMatch();
      this.audio?.play('move');
      this.onRules?.(this.rules);
      return;
    }
    const row = this.rows.get(line);
    if (!row || !this.store) return;
    row.step(direction, this.store.current, this.store);
    this.readSettings();
    this.audio?.play('move');
    if (row.reload) this.onReload?.();
  }

  /** Reporte les valeurs courantes dans les lignes de la page de reglages. */
  private readSettings(): void {
    if (!this.store) return;
    const settings: ModernRenderSettings = { ...this.store.current };
    for (const [line, row] of this.rows) {
      const value = row.read(settings, this.store);
      (line.querySelector('.menu-setting__value') as HTMLElement).textContent = value.text;
      const bar = line.querySelector('.menu-setting__bar') as HTMLElement;
      const fill = bar.firstElementChild as HTMLElement;
      bar.classList.toggle('menu-setting__bar--visible', value.fill !== undefined);
      fill.style.width = `${Math.round((value.fill ?? 0) * 100)}%`;
    }
  }

  private showPage(id: string): void {
    const target = this.pages.get(id);
    if (!target) return;
    for (const [pageId, page] of this.pages) {
      if (pageId === id) {
        page.element.className = 'menu-screen menu-screen--active';
        continue;
      }
      // La page quittee glisse du cote d'ou l'autre arrive.
      const leaving = pageId === 'main' && id !== 'main';
      page.element.className = `menu-screen ${leaving ? 'menu-screen--left' : 'menu-screen--right'}`;
    }
    this.page = id;
    if (id === 'settings') this.readSettings();
    if (id === 'single') this.readMatch();
    this.index = target.items.findIndex((item) => !item.disabled);
    if (this.index < 0) this.index = 0;
    this.refresh();
  }

  /** Souligne l'entree courante et place le selecteur devant elle. */
  private refresh(): void {
    const page = this.pages.get(this.page);
    if (!page) return;
    page.items.forEach((item, position) => {
      item.classList.toggle('menu-item--active', position === this.index && !item.disabled);
    });

    const active = page.items[this.index];
    if (!active || active.disabled || !this.visible) {
      this.selector.classList.remove('menu__selector--visible');
      return;
    }
    const bounds = active.getBoundingClientRect();
    const host = this.stage.getBoundingClientRect();
    const size = this.selector.getBoundingClientRect();
    this.selector.style.top = `${bounds.top - host.top + bounds.height / 2 - size.height / 2}px`;
    // Trois pixels d'avance quand l'entree est prise : le mouvement se sent
    // sans se voir.
    this.selector.style.left = `${bounds.left - host.left - size.width - 6}px`;
    this.selector.classList.add('menu__selector--visible');
  }

  private choose(position: number): void {
    const page = this.pages.get(this.page);
    const item = page?.items[position];
    if (!page || !item) return;
    if (item.disabled) {
      // Le jeu repond aussi quand il ne se passe rien : c'est ce qui dit que
      // l'entree existe mais n'est pas disponible.
      this.audio?.play('deny');
      return;
    }
    this.index = position;
    this.refresh();

    const entry = item.dataset.entry ?? '';
    if (entry === 'back') {
      // Ouverts en partie, les reglages se referment sur le jeu et non sur le
      // menu principal.
      if (this.inOverlay) this.onClose?.();
      else this.showPage('main');
      return;
    }
    if (entry.startsWith('set:') || entry.startsWith('match:')) {
      this.adjust(1, item);
      return;
    }
    // Les entrees du menu principal qui portent le nom d'une page y menent.
    if (this.page === 'main' && this.pages.has(entry)) {
      this.showPage(entry);
      return;
    }
    this.onSelect?.(this.page, entry);
  }

  private move(direction: number): void {
    const page = this.pages.get(this.page);
    if (!page) return;
    const count = page.items.length;
    for (let step = 1; step <= count; step++) {
      const next = (this.index + direction * step + count * step) % count;
      if (!page.items[next].disabled) {
        this.index = next;
        this.refresh();
        this.audio?.play('move');
        return;
      }
    }
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.visible) return;
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        event.preventDefault();
        this.move(-1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        event.preventDefault();
        this.move(1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        event.preventDefault();
        this.choose(this.index);
        break;
      case 'ArrowLeft':
      case 'KeyA': {
        const item = this.pages.get(this.page)?.items[this.index];
        if (item && this.rows.has(item)) {
          event.preventDefault();
          this.adjust(-1, item);
        }
        break;
      }
      case 'ArrowRight':
      case 'KeyD': {
        const item = this.pages.get(this.page)?.items[this.index];
        if (item && this.rows.has(item)) {
          event.preventDefault();
          this.adjust(1, item);
        }
        break;
      }
      case 'Escape':
        if (this.inOverlay) break;
        if (this.page !== 'main') {
          event.preventDefault();
          this.audio?.play('back');
          this.showPage('main');
        }
        break;
      default:
        break;
    }
  };
}
