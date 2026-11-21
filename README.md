# Mise en ligne YouTube du festival

Une page web qui prend les vidéos de votre ordinateur et les met en ligne sur votre chaîne YouTube, avec le titre et la description tirés de votre tableau Excel. Rien à installer : la page s'ouvre dans Chrome ou Edge.

- **L'outil** : https://viktor-guignard.github.io/festival-youtube/
- **Le tutoriel pas à pas** : https://viktor-guignard.github.io/festival-youtube/tutoriel.html
- **La démonstration, sans compte Google** : https://viktor-guignard.github.io/festival-youtube/?demo=1

## À savoir

- **La page a été testée avec un faux YouTube, pas avec le vrai.** Le premier essai réel se fait avec le kit de test, sur une chaîne à part.
- **Les vidéos peuvent rester bloquées en privé** tant que Google n'a pas contrôlé l'accès technique. Le tutoriel explique comment le vérifier avec une vidéo d'essai.
- **Un quota quotidien limite le nombre d'envois.** Quand il est atteint, la page s'arrête, l'explique, et reprend le lendemain sans doublon.

## Ce que fait l'outil

1. Connexion à la chaîne avec le compte Google de votre choix.
2. Lecture du tableau (.xlsx ou .csv) : les colonnes du titre, de la description et des mots-clés sont reconnues, et la description peut être composée à partir de plusieurs colonnes.
3. Choix du dossier des vidéos : chaque fichier est relié à sa ligne par le numéro au début de son nom (`007 - …` correspond à la 7e ligne de film).
4. Aperçu complet avant tout envoi.
5. Mise en ligne en privé, avec reprise après coupure, et bilan : nombre de vidéos passées, vidéo et raison d'un éventuel blocage.
6. Suivi des vidéos mises en ligne : état sur YouTube, passage en public, suppression des vidéos d'essai, export CSV.
7. Journal de tout ce qui a été fait, avec la réponse exacte de YouTube en cas de refus.

## Le kit de test

`kit-test/kit-test-53-videos.zip` contient 53 vidéos factices de 10 secondes, toutes différentes, et leur tableau. Tout y est fictif. Il sert à mesurer les limites réelles (quota de l'accès Google, blocage éventuel) sans toucher aux vrais films.

Pour le refabriquer (il faut ffmpeg, Pillow et openpyxl) :

```bash
python3 kit-test/generer_kit.py /chemin/vers/un/dossier/de/travail
```

## Mettre la page en ligne ailleurs

1. Copiez tout le contenu de ce dépôt dans un dépôt GitHub public.
2. Dans **Settings**, puis **Pages**, choisissez la branche `main` et le dossier `/ (root)`.
3. Dans la console Google Cloud, ajoutez l'adresse du nouveau site aux « Origines JavaScript autorisées » de l'identifiant client (voir le tutoriel, chapitre 03).

## Contenu du dépôt

| Fichier | Rôle |
|---|---|
| `index.html`, `app.js` | L'outil |
| `demo.js` | Le faux YouTube du mode démonstration |
| `tutoriel.html` | Le tutoriel |
| `assets/` | Feuilles de style, polices, logo et captures du tutoriel |
| `kit-test/` | Le kit de test, son tableau et le script qui le fabrique |
| `vendor/` | SheetJS, pour lire les tableaux Excel (licence Apache 2.0) |

## Vie privée

La page est statique. Vos vidéos, votre tableau et votre identifiant client restent dans votre navigateur ; les vidéos vont directement de votre ordinateur à YouTube. Le dépôt ne contient aucune donnée personnelle.

Habillage : direction artistique VIKTO LABS (polices Space Grotesk et Inter, licence SIL OFL).
