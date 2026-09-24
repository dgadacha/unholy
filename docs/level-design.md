# Immeuble — passe résidentielle

Intention : confinement d'un immeuble de quarantaine, dans l'esprit de REC 2. Le plan garde quatre niveaux jouables et huit appartements, avec un axe de progression immédiatement identifiable.

- **Couloir** : ligne de tir continue, portes numérotées, soubassements peints, carrelage ancien, boîtes aux lettres au rez. Chaque niveau a une couleur de repérage. Les batteries de secours produisent des zones de lumière intermittente.
- **Appartements** : entrée principale et porte de service reliées par le séjour. Cette boucle permet de contourner un groupe en passant par les pièces adjacentes. Canapés, cuisines, lits et mobilier créent des angles morts sous des plafonds dégagés.
- **Escalier** : trois doubles volées jusqu'au dernier niveau, garde-corps, fenêtres et vide central de 60 unités. Le dernier palier n'a plus de volée qui monte dans le toit. Le vide central constitue un axe vertical d'embuscade.
- **Démons** : navigation par les murs, les plafonds et le vide central de l’escalier. Les tunnels, conduits, grilles et volumes PLAYERCLIP associés sont supprimés ; les anciennes ouvertures sont rebouchées.
- **Objectif** : reste dans la pièce du fond de l'appartement est au dernier niveau. Les nouvelles fenêtres ne sont plus doublées d'un mur opaque : les projecteurs peuvent éclairer l'intérieur.

La passe utilise de la géométrie procédurale et des matériaux résidentiels (plâtre, parquet, tissu, carrelage). Elle ne met pas en œuvre les équipes, la récupération d'artefact ou les capacités démoniaques encore manquantes dans le prototype.

## Vérification

`npm test` contrôle couloirs, accès principaux et secondaires, boucles des séjours, escaliers jusqu'au dernier niveau, vide central, points d'apparition et fermeture des anciennes ouvertures et dégagement des plafonds. `npm run build` valide TypeScript et la compilation.

`http://127.0.0.1:5214/tools/building-preview.html` fournit quatre points de vue fixes ainsi qu'une mesure du fusil et un bouton de recul. Le fusil est cadré à l'épaule, sa crosse et sa poignée sortant du cadre ; il n'y a pas de modèle de bras ajouté.

## Échelle humaine

Le plan de construction est converti avec un facteur uniforme de 0,625, appliqué au rendu, aux collisions, aux lumières et aux points d'apparition. Le joueur conserve son gabarit de 56 unités et ses yeux à 50 unités du sol. Avec une taille de référence de 1,80 m : portes ≈ 2,25 m, plafonds ≈ 3,21 m, dossier de canapé ≈ 0,90 m. L'aperçu utilise la hauteur debout réelle et les mêmes coordonnées converties que le jeu.
