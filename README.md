# Mise en ligne YouTube du festival

Une page web qui prend les vidéos de votre ordinateur et les met en ligne sur votre chaîne YouTube, avec le titre et la description tirés de votre tableau Excel. Rien à installer : la page s'ouvre dans Chrome ou Edge.

## À savoir avant de commencer

- **La page a été testée avec un faux YouTube, pas avec le vrai.** Faites d'abord un essai avec une seule vidéo.
- **Les vidéos risquent de rester bloquées en privé.** YouTube garde en privé les vidéos envoyées par un accès technique que Google n'a pas encore contrôlé. Si c'est le cas pour vous, la page vous le dira au moment de publier. La demande de contrôle se fait auprès de Google et peut prendre plusieurs semaines.
- **Un quota quotidien limite le nombre d'envois.** S'il est atteint, la page s'arrête et l'indique. Il se remet à zéro chaque matin vers 9 h.

## 1. Mettre la page en ligne sur GitHub (une fois)

1. Créez un compte sur https://github.com (gratuit).
2. Créez un dépôt : bouton **New**, donnez-lui un nom (exemple : `festival-youtube`), laissez-le **Public**, puis **Create repository**.
3. Dans le dépôt, cliquez sur **uploading an existing file** et glissez-y tout le contenu de ce dossier : `index.html`, `app.js` et le dossier `vendor`. Validez avec **Commit changes**.
4. Ouvrez **Settings**, puis **Pages**. Sous « Branch », choisissez `main` et `/ (root)`, puis **Save**.
5. Après une minute ou deux, la page est à l'adresse `https://VOTRE-NOM.github.io/festival-youtube/`.

Le dépôt est public, mais il ne contient aucune donnée : ni vos vidéos, ni votre tableau, ni vos accès.

## 2. Créer l'accès technique Google (une fois, environ 20 minutes)

Sans lui, aucune page n'a le droit d'agir sur votre chaîne. Les noms des menus de Google changent parfois : cherchez l'intitulé le plus proche.

1. Allez sur https://console.cloud.google.com avec le compte Google de la chaîne, et créez un projet (exemple : « Festival »).
2. Menu **API et services**, puis **Bibliothèque** : cherchez **YouTube Data API v3** et cliquez sur **Activer**.
3. Menu **Écran de consentement OAuth** (ou « Google Auth Platform ») :
   - type d'utilisateurs : **Externe** ;
   - nom de l'application et adresses e-mail : les vôtres ;
   - laissez l'état de publication sur **Test** ;
   - dans **Utilisateurs tests**, ajoutez l'adresse du compte Google de la chaîne.
4. Menu **Identifiants** (ou « Clients »), puis **Créer des identifiants** et **ID client OAuth** :
   - type d'application : **Application Web** ;
   - dans **Origines JavaScript autorisées**, ajoutez `https://VOTRE-NOM.github.io` (sans rien après, sans barre oblique finale) ;
   - validez et copiez l'**ID client**, qui se termine par `.apps.googleusercontent.com`.

Cet identifiant n'est pas un mot de passe. Il se colle dans la page, qui le retient pour les fois suivantes.

## 3. Utiliser la page

1. **Connexion** : collez l'ID client, cliquez sur **Se connecter à YouTube** et choisissez le compte de la chaîne. Google affiche un avertissement « application non validée » : cliquez sur **Paramètres avancés**, puis sur **Accéder à…**, et acceptez les autorisations.
2. **Tableau** : choisissez votre Excel. La page devine les colonnes du titre, de la description et des mots-clés ; corrigez-les si besoin. Le volet « Composer le titre et la description » permet d'assembler plusieurs colonnes, par exemple `{Description}` suivi de `Réalisation : {Réalisateur}`.
3. **Vidéos** : choisissez le dossier `YOUTUBE` créé par le programme de téléchargement. Chaque vidéo est reliée à sa ligne grâce au numéro au début de son nom (`007 - …` correspond à la 7e ligne de film du tableau).
4. **Réglages** : visibilité (Privée par défaut), playlist, catégorie.
5. **Aperçu** : vérifiez, pour chaque fichier, le titre et la description qui seront utilisés. Décochez ce que vous ne voulez pas envoyer, puis cliquez sur **Mettre en ligne**.
6. **Publication** : après avoir regardé les vidéos sur YouTube, cochez-les et cliquez sur **Passer en public**.

## Bon à savoir

- **Laissez l'onglet ouvert** pendant l'envoi. Les vidéos partent l'une après l'autre.
- **En cas de coupure**, relancez : l'envoi d'un fichier reprend où il s'était arrêté, et une vidéo déjà en ligne n'est jamais envoyée deux fois.
- **Au bout d'une heure environ**, Google demande de se reconnecter : un bandeau apparaît en bas de page, un clic suffit et l'envoi continue.
- **La liste des vidéos mises en ligne** est gardée dans le navigateur de cet ordinateur. Utilisez toujours le même navigateur, et exportez la liste en CSV pour en garder une copie.
- **Même tableau que pour le téléchargement** : ne supprimez pas et ne triez pas ses lignes, sinon les numéros ne correspondent plus.
- Un fichier sans numéro est relié par son nom s'il est identique au titre d'une ligne. Sinon il apparaît comme « Aucune ligne du tableau ne correspond » et n'est pas envoyé.

La lecture des tableaux Excel utilise la bibliothèque SheetJS (licence Apache 2.0), fournie dans le dossier `vendor`.
