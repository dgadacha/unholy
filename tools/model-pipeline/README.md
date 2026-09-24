# Armes originales et variantes HD

Le jeu charge les MD3 des PK3 locaux : corps, canon, flash et tags animés
`_hand`. Les poses de tir proviennent des animations Q3, avec la rotation et
l'arrêt progressif du canon de la mitrailleuse. Les projectiles, explosions,
traînées et impacts utilisent également les médias originaux. Leur affichage
est adapté à Three.js ; ce n'est pas une reproduction exacte du renderer Q3.

## Textures

Depuis la racine du projet :

```sh
npm run textures:weapons
```

Cette commande étend le script HD existant aux peaux MD3 et aux images des
effets. Elle conserve les couleurs des effets et leur alpha, et suit les
dépendances des shaders animés. Les entrées déjà générées sont conservées ;
`-- --force` permet de les recalculer. Le moteur par défaut est Lanczos :
il améliore le filtrage et la résolution, sans inventer de nouveaux détails.
Les textures sources servent de repli lorsqu'une variante HD est absente.

## Raffiner un modèle

Prérequis : Python 3 et NumPy (déjà utilisés localement pour la génération).

```sh
npm run models:enhance -- --model models/weapons2/machinegun/machinegun.md3
```

L'outil crée une copie dans
`public/generated/models/models/weapons2/machinegun/machinegun.md3`
et un rapport `.report.json`. Il ne modifie pas les PK3 et n'active pas la
variante automatiquement dans le jeu.

Chaque niveau subdivise les triangles en quatre. Les nouveaux sommets
suivent légèrement les normales des zones lisses ; les sommets existants,
les coutures UV et les bords ouverts restent en place. Tous les frames et
les tags d'attache sont conservés. La limite MD3 de 4096 sommets par surface
est vérifiée. La première variante de la mitrailleuse passe de 171 à 684
triangles.

Options : `--levels 0|1|2`, `--strength 0..1` et
`--max-displacement 0..1` (défaut : 0,125 unité Q3 par niveau avant
quantification MD3). `--strength 0` produit une subdivision linéaire.

C'est un raffinement géométrique conservateur, pas une reconstruction HD :
il n'ajoute ni pièces mécaniques ni détails sculptés. Comparer les silhouettes
et les animations avant d'utiliser une copie. Deux niveaux coûtent seize fois
plus de triangles ; un niveau suffit pour un premier essai.

## Vérification

```sh
npm test
python3 -m unittest discover -s tools/model-pipeline -p 'test_*.py'
npm run build
```

Avec le serveur local et les PK3, ouvrir `/tools/weapons-smoke.html` pour
charger les neuf armes, vérifier leurs poses et rendre leurs effets dans
WebGL. Les boutons permettent ensuite de comparer leurs tirs.
