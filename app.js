/* Mise en ligne YouTube du festival — page statique, tout se passe dans le navigateur. */
(function () {
  'use strict';

  const API = 'https://www.googleapis.com/youtube/v3/';
  const ENVOI = 'https://www.googleapis.com/upload/youtube/v3/videos';
  const PORTEE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl';
  const VERSION = 'Version bêta 2 du 21 novembre 2026';
  const EXT_VIDEO = ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mxf', '.mpg', '.mpeg'];
  // Taille d'un morceau envoyé : doit être un multiple de 256 Ko.
  const REGLAGES = window.FYP_REGLAGES = Object.assign({ morceau: 16 * 1024 * 1024, attente: 2000 }, window.FYP_REGLAGES);

  const E = {
    jeton: null, expire: 0, chaine: null, demo: null,
    entetes: [], films: [], fichiers: [], elements: [], kit: false,
    enCours: false, arretDemande: false, modeleModifie: { titre: false, desc: false },
  };
  const chemins = new WeakMap();   // chemin d'origine des fichiers glissés-déposés
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ mémoire locale
  const memoire = {
    lire(cle, defaut) { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch (e) { return defaut; } },
    ecrire(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ } },
  };
  // La démonstration a sa propre mémoire, pour ne jamais se mélanger aux vraies vidéos.
  const prefixe = () => (E.demo ? 'fyp_demo_' : 'fyp_');
  const faits = () => memoire.lire(prefixe() + 'faits', {});
  const ecrireFaits = (f) => memoire.ecrire(prefixe() + 'faits', f);
  const sessions = () => memoire.lire(prefixe() + 'sessions', {});
  const ecrireSessions = (s) => memoire.ecrire(prefixe() + 'sessions', s);
  const lireTest = () => memoire.lire(prefixe() + 'test', {});
  const ecrireTest = (t) => memoire.ecrire(prefixe() + 'test', t);
  const preferences = () => memoire.lire('fyp_preferences', {});
  function retenir(valeurs) { memoire.ecrire('fyp_preferences', Object.assign(preferences(), valeurs)); }

  // ---------------------------------------------------------------- affichage
  function message(id, texte, genre) {
    const zone = $(id);
    zone.textContent = texte || '';
    zone.className = 'notice' + (genre ? ' is-' + genre : '');
  }
  function etat(id, texte, genre) {
    $(id).textContent = texte;
    $(id).className = 'status' + (genre ? ' is-' + genre : '');
  }
  function taille(octets) {
    const unites = ['o', 'Ko', 'Mo', 'Go'];
    let i = 0;
    while (octets >= 1024 && i < unites.length - 1) { octets /= 1024; i++; }
    return (i >= 2 && octets < 100 ? octets.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(octets)) + ' ' + unites[i];
  }
  function duree(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
    return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' min';
  }
  const pluriel = (n, mot, fin) => n + ' ' + mot + (n > 1 ? (fin || 's') : '');
  const numero = (n) => (n != null ? String(n).padStart(3, '0') : '—');
  function creer(balise, proprietes, enfants) {
    const el = document.createElement(balise);
    Object.assign(el, proprietes || {});
    (enfants || []).forEach((e) => el.append(e));
    return el;
  }
  function enregistrer(nom, contenu, type) {
    const lien = creer('a', { href: URL.createObjectURL(new Blob([contenu], { type })), download: nom });
    document.body.append(lien); lien.click(); lien.remove();
  }
  const VISIBILITE = { private: 'Privée', unlisted: 'Non répertoriée', public: 'Publique', introuvable: 'Introuvable' };
  const TRAITEMENT = { uploaded: 'En cours de traitement', processed: 'Prête', failed: 'Échec du traitement', rejected: 'Refusée', deleted: 'Supprimée' };
  const REFUS = { duplicate: 'doublon d\'une autre vidéo', length: 'vidéo trop longue', copyright: 'droits d\'auteur', claim: 'droits d\'auteur',
                  inappropriate: 'contenu jugé inapproprié', termsOfUse: 'conditions d\'utilisation', legal: 'motif légal',
                  trademark: 'marque déposée', uploaderAccountClosed: 'compte fermé', uploaderAccountSuspended: 'compte suspendu' };

  // ------------------------------------------------------------------ journal
  const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const JOUR = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });
  function ligneJournal(entree) {
    const ligne = creer('div', {}, [creer('span', { className: 't', textContent: JOUR.format(entree.t) + ' ' + HEURE.format(entree.t) + '  ' }),
                                    creer('span', { className: entree.g || '', textContent: entree.m })]);
    $('journal').append(ligne);
  }
  function journal(texte, genre) {
    const entree = { t: Date.now(), g: genre || '', m: texte };
    const tout = memoire.lire(prefixe() + 'journal', []);
    tout.push(entree);
    memoire.ecrire(prefixe() + 'journal', tout.slice(-600));
    ligneJournal(entree);
    $('journal').scrollTop = $('journal').scrollHeight;
  }
  function afficherJournal() {
    $('journal').textContent = '';
    memoire.lire(prefixe() + 'journal', []).forEach(ligneJournal);
    $('journal').scrollTop = $('journal').scrollHeight;
  }

  // -------------------------------------------------------------- erreurs API
  const RAISONS = {
    quotaExceeded: "Le quota quotidien de l'accès Google est épuisé. Il se remet à zéro vers 9 h, heure de Paris.",
    dailyLimitExceeded: "Le quota quotidien de l'accès Google est épuisé. Il se remet à zéro vers 9 h, heure de Paris.",
    rateLimitExceeded: 'Trop de demandes en peu de temps. Attendez quelques minutes.',
    userRateLimitExceeded: 'Trop de demandes en peu de temps. Attendez quelques minutes.',
    uploadLimitExceeded: 'YouTube limite le nombre de vidéos par jour pour cette chaîne. Réessayez dans 24 heures.',
    youtubeSignupRequired: "Ce compte Google n'a pas de chaîne YouTube. Créez-en une, puis reconnectez-vous.",
    invalidTitle: 'YouTube refuse ce titre (vide, trop long, ou contenant < ou >).',
    invalidDescription: 'YouTube refuse cette description (trop longue, ou contenant < ou >).',
    invalidTags: 'YouTube refuse ces mots-clés (trop longs ou trop nombreux).',
    invalidCategoryId: 'YouTube refuse cette catégorie.',
    insufficientPermissions: "L'autorisation accordée ne suffit pas. Reconnectez-vous en acceptant toutes les autorisations demandées.",
    accessNotConfigured: "L'API « YouTube Data API v3 » n'est pas activée dans votre projet Google Cloud (voir le tutoriel).",
    forbidden: "YouTube refuse l'opération pour ce compte.",
    videoNotFound: 'Vidéo introuvable sur cette chaîne.',
    playlistNotFound: 'Playlist introuvable.',
  };
  const FATALES = ['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded', 'youtubeSignupRequired', 'insufficientPermissions', 'accessNotConfigured'];
  const QUOTA = ['quotaExceeded', 'dailyLimitExceeded'];

  function erreurApi(statut, corps) {
    let raison = '', detail = '';
    try {
      const d = typeof corps === 'string' ? JSON.parse(corps) : corps;
      raison = (d.error.errors && d.error.errors[0] && d.error.errors[0].reason) || d.error.status || '';
      detail = d.error.message || '';
    } catch (e) { /* réponse sans détail */ }
    const err = new Error(RAISONS[raison] || detail || ('YouTube a répondu avec le code ' + statut + '.'));
    err.statut = statut; err.raison = raison; err.detail = detail; err.fatale = FATALES.includes(raison);
    return err;
  }
  const brut = (e) => (e.raison || e.statut ? ' [réponse de YouTube : ' + [e.statut, e.raison].filter(Boolean).join(' ') + (e.detail ? ' — ' + e.detail : '') + ']' : '');

  // ---------------------------------------------------------------- connexion
  function verifierIdentifiant(id) {
    if (!id) return "Indiquez d'abord l'identifiant client Google.";
    if (/^AIza/.test(id)) return "Ceci est une clé API : elle ne permet pas d'envoyer des vidéos. Il faut un « ID client OAuth », qui se termine par .apps.googleusercontent.com (voir le tutoriel).";
    if (/^GOCSPX-/.test(id)) return "Ceci est le « code secret » du client, pas son identifiant. Collez l'ID client, qui se termine par .apps.googleusercontent.com.";
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) return "Cet identifiant n'a pas la bonne forme : un ID client se termine par .apps.googleusercontent.com.";
    return '';
  }

  function demanderJeton() {
    return new Promise((resoudre, rejeter) => {
      const id = $('client-id').value.trim();
      const souci = verifierIdentifiant(id);
      if (souci) return rejeter(new Error(souci));
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        return rejeter(new Error("Le service de connexion Google n'est pas chargé. Vérifiez votre connexion ou désactivez le bloqueur de publicités, puis rechargez la page."));
      }
      memoire.ecrire('fyp_client', id);
      const client = google.accounts.oauth2.initTokenClient({
        client_id: id, scope: PORTEE,
        callback: (r) => {
          if (r.error || !r.access_token) {
            return rejeter(new Error(r.error === 'access_denied'
              ? "Autorisation refusée. Si Google indique que l'accès est bloqué, ajoutez ce compte aux « utilisateurs tests » (voir le tutoriel)."
              : 'Connexion refusée : ' + (r.error_description || r.error || 'aucune autorisation reçue')));
          }
          E.jeton = r.access_token;
          E.expire = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          resoudre();
        },
        error_callback: (e) => rejeter(new Error(e && e.type === 'popup_closed' ? 'Fenêtre de connexion fermée avant la fin.'
          : "La fenêtre de connexion Google ne s'est pas ouverte. Autorisez les fenêtres surgissantes pour cette page.")),
      });
      client.requestAccessToken();
    });
  }

  // Quand le jeton a expiré en cours de route : on attend un clic (obligatoire pour rouvrir la fenêtre Google).
  let attenteReconnexion = null;
  function reconnecter() {
    if (!attenteReconnexion) {
      journal('Connexion Google expirée : en attente de reconnexion.', 'warn');
      attenteReconnexion = new Promise((resoudre) => {
        $('reconnexion').classList.add('is-visible');
        $('btn-reconnexion').onclick = async () => {
          try {
            await demanderJeton();
            $('reconnexion').classList.remove('is-visible');
            attenteReconnexion = null;
            journal('Reconnecté.', 'ok');
            resoudre();
          } catch (e) { message('msg-envoi', e.message, 'error'); }
        };
      });
    }
    return attenteReconnexion;
  }
  async function jetonValide() {
    if (E.demo) return 'demonstration';
    if (!E.jeton || Date.now() > E.expire - 120000) await reconnecter();
    return E.jeton;
  }

  async function api(methode, chemin, parametres, corps) {
    if (E.demo) {
      const r = await E.demo.api(methode, chemin, parametres || {}, corps);
      if (r.statut >= 400) throw erreurApi(r.statut, r.texte);
      return r.donnees;
    }
    const url = new URL(API + chemin);
    Object.entries(parametres || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    for (let essai = 0; ; essai++) {
      const jeton = await jetonValide();
      const rep = await fetch(url, {
        method: methode,
        headers: Object.assign({ Authorization: 'Bearer ' + jeton }, corps ? { 'Content-Type': 'application/json' } : {}),
        body: corps ? JSON.stringify(corps) : undefined,
      });
      if (rep.status === 401 && essai < 2) { E.jeton = null; continue; }
      const texte = await rep.text();
      if (!rep.ok) throw erreurApi(rep.status, texte);
      return texte ? JSON.parse(texte) : {};
    }
  }

  async function ouvrirChaine() {
    const rep = await api('GET', 'channels', { part: 'snippet', mine: 'true' });
    if (!rep.items || !rep.items.length) throw erreurApi(403, { error: { errors: [{ reason: 'youtubeSignupRequired' }] } });
    E.chaine = rep.items[0];
    $('confirme-test').checked = false;   // nouvelle connexion : la confirmation est à refaire
    etat('etat-connexion', 'connecté à « ' + E.chaine.snippet.title + ' »', 'ok');
    $('btn-connexion').textContent = 'Changer de compte';
    journal('Connecté à la chaîne « ' + E.chaine.snippet.title + ' ».', 'ok');
    await chargerPlaylists();
  }

  async function connexion() {
    message('msg-connexion', '');
    try {
      await demanderJeton();
      await ouvrirChaine();
    } catch (e) {
      message('msg-connexion', e.message, 'error');
      journal('Connexion impossible : ' + e.message + brut(e), 'err');
    }
    majBoutons();
  }

  async function chargerPlaylists() {
    const choix = $('playlist');
    const voulu = choix.value || preferences().playlist || '';
    choix.length = 1;
    let page = '';
    do {
      const rep = await api('GET', 'playlists', Object.assign({ part: 'snippet', mine: 'true', maxResults: '50' }, page ? { pageToken: page } : {}));
      (rep.items || []).forEach((p) => choix.append(new Option(p.snippet.title, p.id)));
      page = rep.nextPageToken || '';
    } while (page);
    choix.value = voulu;
    if (choix.selectedIndex < 0) choix.value = '';
  }

  // ------------------------------------------------------------ démonstration
  async function entrerEnDemo() {
    if (!window.FYP_DEMO) return;
    E.demo = window.FYP_DEMO.creer();
    E.jeton = 'demonstration'; E.expire = Infinity;
    try { sessionStorage.setItem('fyp_demo', '1'); } catch (e) { /* sans importance */ }
    $('demo-bar').hidden = false;
    $('btn-exemple').hidden = false;
    $('btn-demo').hidden = true;
    $('btn-connexion').disabled = true;
    $('client-id').disabled = true;
    E.demo.regler($('demo-limite').value);
    message('msg-connexion', 'Mode démonstration : aucun compte Google n\'est utilisé et rien n\'est envoyé à YouTube.', 'warn');
    afficherJournal();
    construire();   // la liste des vidéos de démonstration s'affiche tout de suite
    try { await ouvrirChaine(); } catch (e) { message('msg-connexion', e.message, 'error'); }
    majBoutons();
  }
  function quitterDemo() {
    try { sessionStorage.removeItem('fyp_demo'); } catch (e) { /* sans importance */ }
    location.href = location.pathname;
  }

  async function chargerExemple() {
    message('msg-tableau', '');
    try {
      const rep = await fetch('kit-test/films-test.xlsx');
      if (!rep.ok) throw new Error('fichier d\'exemple introuvable');
      await chargerTableau(new File([await rep.arrayBuffer()], 'films-test.xlsx'));
      // Fausses vidéos : même nom que celles du kit, contenu vide. Elles ne quittent pas la page.
      const colTitre = Number($('col-titre').value || 0);
      E.fichiers = E.films.map((f) => {
        const nom = numero(f.num) + ' - ' + f.valeurs[colTitre].replace(/^ESSAI \d+\s*[–-]\s*/, '').replace(/[\\/:*?"<>|]/g, ' ') + '.mp4';
        return new File([new Uint8Array(30000 + f.num * 400)], nom, { type: 'video/mp4', lastModified: 1700000000000 });
      });
      journal('Exemple chargé : ' + E.films.length + ' films et autant de fausses vidéos.');
      construire();
    } catch (e) {
      message('msg-tableau', "Impossible de charger l'exemple (" + e.message + "). Téléchargez plutôt le kit de test depuis le tutoriel.", 'error');
    }
  }

  // ------------------------------------------------------------------ tableau
  function sansAccent(texte) {
    return String(texte).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function normaliser(texte) { return (sansAccent(texte).match(/[a-z0-9]+/g) || []).join(' '); }

  async function chargerTableau(fichier) {
    message('msg-tableau', '');
    try {
      const tampon = await fichier.arrayBuffer();
      const classeur = /\.csv$/i.test(fichier.name)
        ? XLSX.read(new TextDecoder('utf-8').decode(tampon).replace(/^﻿/, ''), { type: 'string', raw: true })
        : XLSX.read(tampon, { type: 'array' });
      const feuille = classeur.Sheets[classeur.SheetNames[0]];
      let lignes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: '', raw: false, blankrows: false });
      lignes = lignes.map((l) => l.map((c) => String(c == null ? '' : c).replace(/\r\n?/g, '\n').trim())).filter((l) => l.some((c) => c));
      if (lignes.length < 2) throw new Error('ce tableau ne contient aucune ligne de film.');
      const largeur = Math.max(...lignes.map((l) => l.length));
      E.entetes = Array.from({ length: largeur }, (_, i) => lignes[0][i] || 'Colonne ' + (i + 1));
      E.films = lignes.slice(1).map((l, i) => ({ num: i + 1, valeurs: E.entetes.map((_, c) => l[c] || '') }));
      etat('etat-tableau', fichier.name + ' · ' + pluriel(E.films.length, 'film'), 'ok');
      preparerColonnes();
      journal('Tableau chargé : ' + fichier.name + ', ' + pluriel(E.films.length, 'film') + '.');
    } catch (e) {
      E.entetes = []; E.films = [];
      $('colonnes').hidden = true;
      etat('etat-tableau', 'aucun tableau');
      message('msg-tableau', 'Impossible de lire ce tableau : ' + e.message, 'error');
    }
    construire();
  }

  function deviner(mots) {
    const estLien = (i) => E.films.some((f) => /^https?:\/\//i.test(f.valeurs[i]));
    for (const mot of mots) {
      const i = E.entetes.findIndex((e, k) => sansAccent(e).includes(mot) && !estLien(k));
      if (i >= 0) return i;
    }
    return -1;
  }

  function preparerColonnes() {
    const pref = preferences();
    const retenue = (nom) => (nom == null ? -2 : (nom === '' ? -1 : E.entetes.indexOf(nom)));
    const remplir = (id, devine, cle, facultatif) => {
      const liste = $(id);
      liste.length = 0;
      if (facultatif) liste.append(new Option('— aucune —', ''));
      E.entetes.forEach((e, i) => liste.append(new Option(e, String(i))));
      // La colonne choisie la dernière fois est reprise si ce tableau la contient encore.
      let choisi = retenue(pref[cle]);
      if (choisi === -2 || (choisi === -1 && !facultatif)) choisi = devine;
      if (choisi < 0 && pref[cle] !== '' ) choisi = devine;
      liste.value = choisi >= 0 ? String(choisi) : (facultatif ? '' : '0');
    };
    remplir('col-titre', deviner(['titre', 'projet', 'film', 'nom']), 'colTitre', false);
    remplir('col-desc', deviner(['description', 'synopsis', 'resume', 'pitch']), 'colDesc', true);
    remplir('col-tags', deviner(['mots-cles', 'mots cles', 'tags', 'mots']), 'colTags', true);

    // Un modèle composé à la main est repris si toutes ses colonnes existent dans ce tableau.
    const utilisable = (m) => typeof m === 'string' && m && (m.match(/\{([^{}]+)\}/g) || []).every((p) => indexColonne(p.slice(1, -1)) >= 0);
    E.modeleModifie = { titre: utilisable(pref.modeleTitre), desc: utilisable(pref.modeleDesc) };
    if (E.modeleModifie.titre) $('modele-titre').value = pref.modeleTitre;
    if (E.modeleModifie.desc) $('modele-desc').value = pref.modeleDesc;
    majModeles();

    const puces = $('puces');
    puces.textContent = '';
    E.entetes.forEach((e) => puces.append(creer('button', {
      type: 'button', textContent: '{' + e + '}',
      onclick: () => { const z = $('modele-desc'); z.value += (z.value && !/\n$/.test(z.value) ? '\n' : '') + '{' + e + '}'; E.modeleModifie.desc = true; retenirModeles(); construire(); },
    })));
    $('colonnes').hidden = false;
  }

  function majModeles() {
    const nom = (id) => ($(id).value === '' ? '' : '{' + E.entetes[Number($(id).value)] + '}');
    if (!E.modeleModifie.titre) $('modele-titre').value = nom('col-titre');
    if (!E.modeleModifie.desc) $('modele-desc').value = nom('col-desc');
  }
  // Seul un choix fait à la main est retenu, colonne par colonne.
  const CLES_COLONNES = { 'col-titre': 'colTitre', 'col-desc': 'colDesc', 'col-tags': 'colTags' };
  function retenirColonne(id) {
    retenir({ [CLES_COLONNES[id]]: $(id).value === '' ? '' : E.entetes[Number($(id).value)] });
  }
  function retenirModeles() {
    retenir({ modeleTitre: E.modeleModifie.titre ? $('modele-titre').value : null,
              modeleDesc: E.modeleModifie.desc ? $('modele-desc').value : null });
  }

  const indexColonne = (nom) => E.entetes.findIndex((e) => sansAccent(e).trim() === sansAccent(nom).trim());
  function appliquer(modele, film) {
    return modele.replace(/\{([^{}]+)\}/g, (tout, nom) => {
      const i = indexColonne(nom);
      return i >= 0 ? film.valeurs[i] : tout;
    }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ------------------------------------------------------------------- vidéos
  const cleFichier = (f) => [f.name, f.size, f.lastModified].join('|');
  function numeroDe(nom) {
    const m = String(nom).match(/^\s*(\d{1,4})(?!\d)/);
    return m ? parseInt(m[1], 10) : null;
  }
  const dossierDe = (f) => ((f.webkitRelativePath || chemins.get(f) || '').split('/').filter(Boolean).slice(-2, -1)[0] || '');

  function ajouterFichiers(liste) {
    const connus = new Set(E.fichiers.map(cleFichier));
    let ajoutes = 0, ignores = 0;
    Array.from(liste).forEach((f) => {
      const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (!EXT_VIDEO.includes(ext)) { ignores++; return; }
      if (!connus.has(cleFichier(f))) { E.fichiers.push(f); connus.add(cleFichier(f)); ajoutes++; }
    });
    if (ajoutes || ignores) journal(pluriel(ajoutes, 'vidéo') + ' ajoutée' + (ajoutes > 1 ? 's' : '') + (ignores ? ' (' + pluriel(ignores, 'fichier') + ' ignoré' + (ignores > 1 ? 's' : '') + ' : pas des vidéos)' : '') + '.');
    construire();
  }

  // Glisser-déposer : parcourt les dossiers déposés.
  async function fichiersDeposes(donnees) {
    const racines = Array.from(donnees.items || []).map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!racines.length) return Array.from(donnees.files || []);
    const trouves = [];
    async function parcourir(entree) {
      if (entree.isFile) {
        const f = await new Promise((ok, non) => entree.file(ok, non));
        chemins.set(f, entree.fullPath || '');
        trouves.push(f);
      } else if (entree.isDirectory) {
        const lecteur = entree.createReader();
        for (;;) {
          const lot = await new Promise((ok, non) => lecteur.readEntries(ok, non));
          if (!lot.length) break;
          for (const e of lot) await parcourir(e);
        }
      }
    }
    for (const r of racines) await parcourir(r);
    return trouves;
  }

  // ------------------------------------------------------------------- aperçu
  const ESSAI = /^ESSAI \d+/;
  // Avec le kit de test, l'envoi attend que la chaîne de test soit confirmée dans l'encadré bêta.
  const attenteConfirmation = () => E.kit && !E.demo && !$('confirme-test').checked;
  function construire() {
    if (E.enCours) return;
    const dejaFaits = faits();
    const colTitre = Number($('col-titre').value || 0);
    const parNom = new Map();
    E.films.forEach((f) => {
      const n = normaliser(f.valeurs[colTitre] || '');
      if (n) parNom.set(n, parNom.has(n) ? null : f);  // null : nom porté par deux films, on ne devine pas
    });

    E.elements = E.fichiers.map((fichier) => {
      const num = numeroDe(fichier.name) ?? numeroDe(dossierDe(fichier));
      let film = num != null ? E.films[num - 1] : null;
      if (!film && E.films.length) film = parNom.get(normaliser(fichier.name.replace(/\.[^.]+$/, ''))) || null;
      return { fichier, cle: cleFichier(fichier), film: film || null, num: film ? film.num : num };
    }).sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9) || a.fichier.name.localeCompare(b.fichier.name, 'fr', { numeric: true }));

    E.kit = E.films.length > 0 && E.films.filter((f) => ESSAI.test(f.valeurs[colTitre] || '')).length >= E.films.length * 0.8;
    const compte = {}, rang = {};
    E.elements.forEach((el) => { if (el.film) compte[el.film.num] = (compte[el.film.num] || 0) + 1; });
    E.elements.forEach((el) => {
      el.fait = dejaFaits[el.cle] || null;
      el.titre = ''; el.description = ''; el.tags = []; el.probleme = '';
      if (!el.film) { el.probleme = E.films.length ? 'Aucune ligne du tableau ne correspond' : 'Chargez le tableau'; return; }
      el.titre = appliquer($('modele-titre').value, el.film);
      if (compte[el.film.num] > 1) { rang[el.film.num] = (rang[el.film.num] || 0) + 1; el.titre += ' (' + rang[el.film.num] + ')'; }
      el.description = appliquer($('modele-desc').value, el.film);
      const colTags = $('col-tags').value;
      el.tags = colTags === '' ? [] : el.film.valeurs[Number(colTags)].split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      if (!el.titre) el.probleme = 'Titre vide';
      else if (el.titre.length > 100) el.probleme = 'Titre trop long (' + el.titre.length + ' caractères, 100 au maximum)';
      else if (/[<>]/.test(el.titre)) el.probleme = 'Le titre contient < ou >, que YouTube refuse';
      else if (el.description.length > 5000) el.probleme = 'Description trop longue (' + el.description.length + ' caractères, 5000 au maximum)';
      else if (/[<>]/.test(el.description)) el.probleme = 'La description contient < ou >, que YouTube refuse';
      else if (el.tags.join(',').length > 480) el.probleme = 'Mots-clés trop longs (500 caractères au maximum en tout)';
      else if (el.fichier.size === 0) el.probleme = 'Fichier vide';
    });
    afficherApercu();
    afficherPublication();
  }

  function afficherApercu() {
    const corps = $('lignes-apercu');
    corps.textContent = '';
    E.elements.forEach((el) => {
      const pret = !el.probleme && !el.fait;
      el.case = creer('input', { type: 'checkbox', checked: pret && el.coche !== false, disabled: !pret, onchange: () => { el.coche = el.case.checked; majBoutons(); } });
      el.case.setAttribute('aria-label', 'Envoyer ' + el.fichier.name);
      el.barre = creer('i');
      el.etat = creer('div');
      el.zoneBarre = creer('div', { className: 'bar', hidden: true }, [el.barre]);
      ecrireEtat(el);
      corps.append(creer('tr', {}, [
        creer('td', {}, [el.case]),
        creer('td', { className: 'num', textContent: numero(el.num) }),
        creer('td', { className: 'file' }, [el.fichier.name, creer('div', { className: 'size', textContent: taille(el.fichier.size) })]),
        creer('td', { textContent: el.titre }),
        creer('td', { className: 'desc', title: el.description }, [creer('div', { textContent: el.description })]),
        creer('td', { className: 'state' }, [el.etat, el.zoneBarre]),
      ]));
    });
    const relies = E.elements.filter((el) => el.film).length;
    const avecVideo = new Set(E.elements.filter((el) => el.film).map((el) => el.film.num));
    const morceaux = [];
    if (E.elements.length) morceaux.push(pluriel(relies, 'vidéo') + ' reliée' + (relies > 1 ? 's' : ''));
    if (E.elements.length - relies) morceaux.push((E.elements.length - relies) + ' sans ligne');
    if (E.films.length && E.elements.length && E.films.length - avecVideo.size) morceaux.push(pluriel(E.films.length - avecVideo.size, 'ligne') + ' sans vidéo');
    etat('etat-apercu', morceaux.join(' · '), E.elements.length && relies === E.elements.length ? 'ok' : (E.elements.length ? 'warn' : ''));
    etat('etat-videos', E.fichiers.length ? pluriel(E.fichiers.length, 'vidéo') + ' · ' + taille(E.fichiers.reduce((s, f) => s + f.size, 0)) : 'aucune vidéo', E.fichiers.length ? 'ok' : '');
    $('zone-apercu').hidden = !E.elements.length;
    $('aide-apercu').hidden = !!E.elements.length;
    $('btn-vider').hidden = !E.fichiers.length;
    majBoutons();
  }

  function ecrireEtat(el, texte, genre) {
    el.etat.textContent = '';
    if (texte) { el.etat.textContent = texte; el.etat.className = genre ? 'is-' + genre + '-text' : ''; return; }
    if (el.fait) {
      el.etat.className = 'is-ok-text';
      el.etat.append('En ligne : ', creer('a', { href: lienVideo(el.fait.id), target: '_blank', rel: 'noopener', textContent: 'voir' }));
    } else if (el.probleme) { el.etat.textContent = el.probleme; el.etat.className = 'is-warn-text'; }
    else { el.etat.textContent = 'Prête'; el.etat.className = ''; }
  }
  const lienVideo = (id) => (E.demo ? '#demonstration-' + id : 'https://youtu.be/' + id);

  function majBoutons() {
    const coches = E.elements.filter((el) => el.case && el.case.checked && !el.case.disabled);
    const total = coches.reduce((s, el) => s + el.fichier.size, 0);
    $('btn-envoyer').textContent = coches.length ? 'Mettre en ligne ' + pluriel(coches.length, 'vidéo') + ' (' + taille(total) + ')' : 'Mettre en ligne';
    $('btn-envoyer').disabled = E.enCours || !coches.length || !E.chaine || attenteConfirmation();
    const cochables = E.elements.filter((el) => el.case && !el.case.disabled);
    $('tout-cocher').checked = cochables.length > 0 && cochables.every((el) => el.case.checked);
    $('tout-cocher').disabled = E.enCours || !cochables.length;
    if (!E.enCours) {
      $('progression').textContent = !coches.length ? '' : (!E.chaine ? 'Connectez-vous à YouTube (étape 01) pour activer le bouton.'
        : (attenteConfirmation() ? 'Kit de test reconnu : confirmez d\'abord, dans l\'encadré noir en haut de page, que la chaîne connectée est votre chaîne de test.' : ''));
    }
    majTest();

    const lignes = Array.from(document.querySelectorAll('#lignes-publication input'));
    const choisies = lignes.filter((c) => c.checked);
    const aPublier = choisies.filter((c) => c.dataset.visibilite !== 'public' && c.dataset.visibilite !== 'introuvable').length;
    $('btn-actualiser').disabled = !lignes.length || !E.chaine || E.enCours;
    $('btn-publier').disabled = !aPublier || !E.chaine || E.enCours;
    $('btn-publier').textContent = aPublier ? 'Passer en public (' + aPublier + ')' : 'Passer en public';
    $('btn-supprimer').disabled = !choisies.length || !E.chaine || E.enCours;
    $('btn-supprimer').textContent = choisies.length ? 'Supprimer de YouTube (' + choisies.length + ')' : 'Supprimer de YouTube';
    $('btn-rapport').disabled = !lignes.length;
    $('tout-cocher-pub').checked = lignes.length > 0 && choisies.length === lignes.length;
  }

  // --------------------------------------------------------- envoi d'une vidéo
  function requete(o) {
    if (E.demo) return E.demo.requete(o);
    return new Promise((resoudre, rejeter) => {
      const x = new XMLHttpRequest();
      x.open(o.methode, o.url);
      Object.entries(o.entetes || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
      if (o.surProgression) x.upload.onprogress = (e) => o.surProgression(e.loaded);
      x.onload = () => resoudre({ statut: x.status, texte: x.responseText, entete: (n) => x.getResponseHeader(n) });
      x.onerror = x.ontimeout = () => { const e = new Error('Connexion interrompue'); e.reseau = true; rejeter(e); };
      x.send(o.corps || null);
    });
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  function recus(rep) {
    const plage = rep.entete('Range');
    const m = plage && plage.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) + 1 : null;
  }

  async function envoyer(el, reglages, surProgression) {
    const fichier = el.fichier;
    const total = fichier.size;
    const type = fichier.type || 'application/octet-stream';
    const fiche = JSON.stringify({
      snippet: { title: el.titre, description: el.description, tags: el.tags, categoryId: reglages.categorie },
      status: { privacyStatus: reglages.visibilite, selfDeclaredMadeForKids: reglages.enfants },
    });

    let adresse = null, position = 0;
    const connue = sessions()[el.cle];
    if (connue && connue.fiche === fiche && Date.now() - connue.date < 5 * 24 * 3600 * 1000) {
      // Un envoi de ce fichier avait commencé : on demande à YouTube où il s'était arrêté.
      try {
        const rep = await requete({ methode: 'PUT', url: connue.adresse, entetes: { 'Content-Range': 'bytes */' + total } });
        if (rep.statut === 308) { adresse = connue.adresse; position = recus(rep) || 0; journal('   reprise à ' + taille(position) + ' sur ' + taille(total)); }
        else if (rep.statut === 200 || rep.statut === 201) return JSON.parse(rep.texte);
      } catch (e) { /* session perdue : on repart de zéro */ }
    }
    if (!adresse) {
      for (let essai = 0; ; essai++) {
        const jeton = await jetonValide();
        const rep = await requete({
          methode: 'POST', url: ENVOI + '?uploadType=resumable&part=snippet,status',
          entetes: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json; charset=UTF-8',
                     'X-Upload-Content-Length': String(total), 'X-Upload-Content-Type': type },
          corps: fiche,
        });
        if (rep.statut === 401 && essai < 2) { E.jeton = null; continue; }
        if (rep.statut !== 200) throw erreurApi(rep.statut, rep.texte);
        adresse = rep.entete('Location');
        if (!adresse) throw new Error("YouTube n'a pas indiqué où envoyer le fichier.");
        break;
      }
      const s = sessions(); s[el.cle] = { adresse, fiche, date: Date.now() }; ecrireSessions(s);
    }

    let echecs = 0, surPlace = 0;
    surProgression(position);
    for (;;) {
      if (position >= total) {
        // Tout est parti mais la réponse finale manque : on la redemande.
        const rep = await requete({ methode: 'PUT', url: adresse, entetes: { 'Content-Range': 'bytes */' + total } });
        if (rep.statut === 200 || rep.statut === 201) return JSON.parse(rep.texte);
        throw erreurApi(rep.statut, rep.texte);
      }
      const fin = Math.min(position + REGLAGES.morceau, total);
      let rep;
      try {
        const jeton = await jetonValide();
        const debut = position;
        rep = await requete({
          methode: 'PUT', url: adresse,
          entetes: { Authorization: 'Bearer ' + jeton, 'Content-Type': type, 'Content-Range': 'bytes ' + position + '-' + (fin - 1) + '/' + total },
          corps: fichier.slice(position, fin),
          surProgression: (n) => surProgression(Math.min(debut + n, total)),
        });
      } catch (e) {
        if (!e.reseau) throw e;
        rep = { statut: 0, texte: '', entete: () => null };
      }
      if (rep.statut === 200 || rep.statut === 201) return JSON.parse(rep.texte);
      if (rep.statut === 308) {
        const nouvelle = recus(rep) ?? position;
        surPlace = nouvelle > position ? 0 : surPlace + 1;
        if (surPlace > 5) throw new Error("L'envoi n'avance plus. Relancez plus tard : il reprendra où il s'est arrêté.");
        position = nouvelle; echecs = 0;
        surProgression(position);
        continue;
      }
      if (rep.statut === 401) { E.jeton = null; continue; }
      if (rep.statut === 0 || rep.statut >= 500 || rep.statut === 429) {
        // Coupure ou panne passagère : on attend, puis on redemande à YouTube ce qu'il a reçu.
        if (++echecs > 8) throw new Error("Connexion trop instable. Relancez plus tard : l'envoi reprendra où il s'est arrêté.");
        journal('   ' + (rep.statut ? 'réponse ' + rep.statut + ' de YouTube' : 'connexion coupée') + ', nouvel essai (' + echecs + ' sur 8)', 'warn');
        await pause(Math.min(REGLAGES.attente * Math.pow(2, echecs - 1), 60000));
        try {
          const point = await requete({ methode: 'PUT', url: adresse, entetes: { 'Content-Range': 'bytes */' + total } });
          if (point.statut === 200 || point.statut === 201) return JSON.parse(point.texte);
          if (point.statut === 308) { position = recus(point) || 0; surProgression(position); }
        } catch (e) { /* toujours coupé : nouvel essai au tour suivant */ }
        continue;
      }
      throw erreurApi(rep.statut, rep.texte);
    }
  }

  // ----------------------------------------------------------- envoi du lot
  const jourPacifique = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(ms);
  const envoyeesAujourdhui = () => Object.values(faits()).filter((v) => jourPacifique(v.date) === jourPacifique(Date.now())).length;

  function verrouiller(oui) {
    document.querySelectorAll('#s-tableau select, #s-tableau input, #s-tableau textarea, #s-tableau button, #s-videos input, #s-videos button, #s-reglages select, #demo-limite')
      .forEach((c) => { c.disabled = oui; });
  }

  async function toutEnvoyer() {
    const file = E.elements.filter((el) => el.case.checked && !el.case.disabled);
    if (!file.length || E.enCours) return;
    const reglages = { visibilite: $('visibilite').value, categorie: $('categorie').value, enfants: $('enfants').value === 'oui', playlist: $('playlist').value };
    if (reglages.visibilite === 'public' && !confirm('Les ' + file.length + ' vidéos seront publiques dès la fin de leur envoi, sans vérification. Continuer ?')) return;

    E.enCours = true; E.arretDemande = false;
    $('btn-arreter').hidden = false; $('btn-arreter').disabled = false;
    $('bilan').hidden = true;
    $('barre-globale').hidden = false;
    E.elements.forEach((el) => { el.case.disabled = true; });
    verrouiller(true);
    message('msg-envoi', '');
    majBoutons();

    const totalOctets = file.reduce((s, el) => s + el.fichier.size, 0);
    const debut = Date.now();
    const bilan = { demandees: file.length, reussies: 0, echecs: [], arret: null, playlistRatees: 0 };
    let octetsFinis = 0;
    journal(VERSION + (E.demo ? ' (démonstration)' : '') + '.');
    journal('— Début : ' + pluriel(file.length, 'vidéo') + ' à mettre en ligne (' + taille(totalOctets) + '), visibilité ' + VISIBILITE[reglages.visibilite].toLowerCase() + '. Déjà envoyées aujourd\'hui par cette page : ' + envoyeesAujourdhui() + '.');

    for (let i = 0; i < file.length; i++) {
      const el = file[i];
      if (E.arretDemande) break;
      el.zoneBarre.hidden = false;
      journal('Envoi ' + (i + 1) + '/' + file.length + ' : ' + el.fichier.name + ' (' + taille(el.fichier.size) + ') → « ' + el.titre + ' »');
      try {
        const video = await envoyer(el, reglages, (n) => {
          const pct = el.fichier.size ? Math.floor(n * 100 / el.fichier.size) : 100;
          el.barre.style.width = pct + '%';
          ecrireEtat(el, 'Envoi… ' + pct + ' %');
          const partis = octetsFinis + n, ecoule = Date.now() - debut;
          $('barre-globale').firstElementChild.style.width = (totalOctets ? partis * 100 / totalOctets : 0) + '%';
          $('progression').textContent = 'Vidéo ' + (i + 1) + ' sur ' + file.length + ' · ' + taille(partis) + ' sur ' + taille(totalOctets)
            + (ecoule > 5000 && partis > 0 && partis < totalOctets ? ' · encore ' + duree(ecoule * (totalOctets - partis) / partis) + ' environ' : '');
        });
        const f = faits();
        f[el.cle] = { id: video.id, titre: el.titre, fichier: el.fichier.name, num: el.num,
                      visibilite: (video.status && video.status.privacyStatus) || reglages.visibilite,
                      traitement: (video.status && video.status.uploadStatus) || 'uploaded', date: Date.now() };
        ecrireFaits(f);
        const s = sessions(); delete s[el.cle]; ecrireSessions(s);
        el.fait = f[el.cle]; el.case.checked = false; el.zoneBarre.hidden = true;
        ecrireEtat(el);
        bilan.reussies++;
        journal('   ✔ en ligne : ' + video.id, 'ok');
        if (reglages.playlist) {
          try {
            await api('POST', 'playlistItems', { part: 'snippet' }, { snippet: { playlistId: reglages.playlist, resourceId: { kind: 'youtube#video', videoId: video.id } } });
          } catch (e) {
            bilan.playlistRatees++;
            el.etat.append(creer('div', { className: 'is-warn-text', textContent: 'Non ajoutée à la playlist : ' + e.message }));
            journal('   ✖ non ajoutée à la playlist : ' + e.message + brut(e), 'err');
            if (e.fatale) { bilan.arret = { erreur: e, num: el.num, rang: i + 1, apresEnvoi: true }; break; }
          }
        }
      } catch (e) {
        el.zoneBarre.hidden = true;
        ecrireEtat(el, 'Échec : ' + e.message, 'error');
        journal('   ✖ refusée : ' + e.message + brut(e), 'err');
        bilan.echecs.push({ num: el.num, titre: el.titre, message: e.message });
        if (e.fatale) { bilan.arret = { erreur: e, num: el.num, rang: i + 1 }; break; }
      }
      octetsFinis += el.fichier.size;
      afficherPublication();
    }

    E.enCours = false;
    $('btn-arreter').hidden = true;
    $('barre-globale').hidden = true;
    verrouiller(false);
    if (E.demo) { $('btn-connexion').disabled = true; $('client-id').disabled = true; }
    E.elements.forEach((el) => { el.case.disabled = !!(el.probleme || el.fait); });
    bilan.duree = Date.now() - debut;
    bilan.arreteParVous = E.arretDemande && !bilan.arret && bilan.reussies + bilan.echecs.length < file.length;
    bilan.restantes = file.length - bilan.reussies;
    $('progression').textContent = '';
    afficherBilan(bilan);
    afficherPublication();
    majBoutons();
  }

  function afficherBilan(b) {
    const aujourdhui = envoyeesAujourdhui();
    const zone = $('bilan');
    zone.textContent = '';
    zone.append(creer('h3', { textContent: 'Bilan de cet envoi' }));
    const chiffre = (valeur, libelle, mauvais) => creer('li', { className: mauvais ? 'is-bad' : '' }, [creer('strong', { textContent: valeur }), libelle]);
    zone.append(creer('ul', { className: 'report-figures' }, [
      chiffre(b.reussies + ' / ' + b.demandees, 'vidéos mises en ligne'),
      chiffre(String(b.restantes), 'restent à envoyer', b.restantes > 0),
      chiffre(String(aujourdhui), 'envoyées aujourd\'hui par cette page'),
      chiffre(duree(b.duree), 'durée'),
    ]));
    let verdict, genre = 'ok';
    if (b.arret) {
      const e = b.arret.erreur;
      genre = 'error';
      const ou = b.arret.apresEnvoi ? 'après la vidéo n° ' + numero(b.arret.num) : 'à la vidéo n° ' + numero(b.arret.num) + ' (la ' + b.arret.rang + (b.arret.rang === 1 ? 're' : 'e') + ' de cet envoi)';
      if (QUOTA.includes(e.raison)) {
        verdict = 'Blocage ' + ou + ' : le quota quotidien de l\'accès Google est épuisé. Cet accès a laissé passer ' + pluriel(aujourdhui, 'vidéo') + ' aujourd\'hui. Il se remet à zéro vers 9 h, heure de Paris.';
      } else if (e.raison === 'uploadLimitExceeded') {
        verdict = 'Blocage ' + ou + ' : c\'est la limite quotidienne de la chaîne, pas celle de l\'accès Google. La chaîne a accepté ' + pluriel(aujourdhui, 'vidéo') + ' aujourd\'hui par cette page. Réessayez dans 24 heures.';
      } else {
        verdict = 'Arrêt ' + ou + ' : ' + e.message;
      }
      zone.append(creer('p', {}, [creer('strong', { textContent: verdict })]));
      zone.append(creer('p', { className: 'muted', textContent: 'Réponse exacte de YouTube : ' + [e.statut, e.raison, e.detail].filter(Boolean).join(' · ') }));
    } else if (b.arreteParVous) {
      genre = 'warn';
      zone.append(creer('p', {}, [creer('strong', { textContent: 'Arrêté à votre demande. Aucune limite rencontrée jusque-là.' })]));
    } else if (b.echecs.length) {
      genre = 'warn';
      zone.append(creer('p', {}, [creer('strong', { textContent: pluriel(b.echecs.length, 'vidéo') + ' en échec, sans blocage général : ' + b.echecs.map((x) => 'n° ' + numero(x.num)).join(', ') + '. Le détail est dans le journal.' })]));
    } else {
      zone.append(creer('p', {}, [creer('strong', { textContent: 'Tout est passé : aucune limite rencontrée sur ces ' + b.demandees + ' vidéos.' })]));
    }
    if (b.restantes > 0) zone.append(creer('p', { textContent: 'Les vidéos restantes sont toujours cochées : cliquez à nouveau sur « Mettre en ligne » pour continuer. Aucune vidéo déjà en ligne ne sera renvoyée.' }));
    if (b.playlistRatees) zone.append(creer('p', { className: 'is-warn-text', textContent: pluriel(b.playlistRatees, 'vidéo') + ' en ligne mais non ajoutée' + (b.playlistRatees > 1 ? 's' : '') + ' à la playlist.' }));
    zone.hidden = false;
    if (E.kit) {
      const t = lireTest();
      t.envois = (t.envois || []).concat([{ date: Date.now(), demandees: b.demandees, reussies: b.reussies, echecs: b.echecs.length,
        arret: b.arret ? { num: b.arret.num, rang: b.arret.rang, statut: b.arret.erreur.statut || 0, raison: b.arret.erreur.raison || '',
                           detail: b.arret.erreur.detail || '', message: b.arret.erreur.message } : null,
        arreteParVous: !!b.arreteParVous, duree: b.duree, aujourdhui }]);
      ecrireTest(t);
    }
    message('msg-envoi', pluriel(b.reussies, 'vidéo') + ' mise' + (b.reussies > 1 ? 's' : '') + ' en ligne sur ' + b.demandees + '.' + (b.arret ? ' Arrêt : ' + b.arret.erreur.message : ''), genre);
    journal('— Fin : ' + b.reussies + ' sur ' + b.demandees + ' en ligne en ' + duree(b.duree) + (b.arret ? '. Blocage : ' + (b.arret.erreur.raison || b.arret.erreur.message) : '') + '. Envoyées aujourd\'hui par cette page : ' + aujourdhui + '.', b.arret ? 'err' : 'ok');
  }

  // -------------------------------------------------------------- publication
  function afficherPublication() {
    const liste = Object.entries(faits()).sort((a, b) => (a[1].num ?? 1e9) - (b[1].num ?? 1e9) || a[1].date - b[1].date);
    const coches = new Set(Array.from(document.querySelectorAll('#lignes-publication input:checked')).map((c) => c.value));
    const corps = $('lignes-publication');
    corps.textContent = '';
    liste.forEach(([cle, v]) => {
      const coche = creer('input', { type: 'checkbox', value: cle, checked: coches.has(cle), onchange: majBoutons });
      coche.dataset.visibilite = v.visibilite;
      coche.setAttribute('aria-label', 'Sélectionner ' + v.titre);
      const refusee = v.traitement === 'rejected' || v.traitement === 'failed';
      corps.append(creer('tr', {}, [
        creer('td', {}, [coche]),
        creer('td', { className: 'num', textContent: numero(v.num) }),
        creer('td', { textContent: v.titre }),
        creer('td', {}, [E.demo ? creer('span', { className: 'muted', textContent: v.id })
                                : creer('a', { href: lienVideo(v.id), target: '_blank', rel: 'noopener', textContent: 'youtu.be/' + v.id })]),
        creer('td', { textContent: VISIBILITE[v.visibilite] || v.visibilite, className: v.visibilite === 'public' ? 'is-ok-text' : (v.visibilite === 'introuvable' ? 'is-error-text' : '') }),
        creer('td', { textContent: (TRAITEMENT[v.traitement] || '—') + (v.motif ? ' : ' + (REFUS[v.motif] || v.motif) : ''), className: refusee ? 'is-error-text' : '' }),
        creer('td', { className: 'nowrap', textContent: new Date(v.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }),
      ]));
    });
    $('zone-publication').hidden = !liste.length;
    const publiques = liste.filter(([, v]) => v.visibilite === 'public').length;
    etat('etat-publication', liste.length ? pluriel(liste.length, 'vidéo') + (publiques ? ' · ' + pluriel(publiques, 'publique') : '') : 'aucune pour le moment', liste.length ? 'ok' : '');
    majBoutons();
  }

  async function etatsYoutube(ids) {
    const etats = {};
    for (let i = 0; i < ids.length; i += 50) {
      const rep = await api('GET', 'videos', { part: 'status', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
      (rep.items || []).forEach((v) => { etats[v.id] = v.status; });
    }
    return etats;
  }
  function reporter(v, statut) {
    v.visibilite = statut.privacyStatus;
    v.traitement = statut.uploadStatus || v.traitement;
    v.motif = statut.rejectionReason || statut.failureReason || '';
  }

  async function actualiser() {
    message('msg-publication', 'Interrogation de YouTube…');
    try {
      const f = faits();
      const etats = await etatsYoutube(Object.values(f).map((v) => v.id));
      let disparues = 0, refusees = 0;
      Object.values(f).forEach((v) => {
        if (etats[v.id]) { reporter(v, etats[v.id]); if (v.traitement === 'rejected' || v.traitement === 'failed') refusees++; }
        else { v.visibilite = 'introuvable'; disparues++; }
      });
      ecrireFaits(f);
      afficherPublication();
      message('msg-publication', 'État actualisé.'
        + (refusees ? ' ' + pluriel(refusees, 'vidéo') + ' refusée' + (refusees > 1 ? 's' : '') + ' par YouTube après l\'envoi (voir la colonne « Traitement »).' : '')
        + (disparues ? ' ' + pluriel(disparues, 'vidéo') + ' introuvable' + (disparues > 1 ? 's' : '') + ' sur cette chaîne (supprimée, ou autre compte) : cochez-les et cliquez sur « Supprimer » pour les retirer de la liste.' : ''),
        refusees || disparues ? 'warn' : 'ok');
      journal('État actualisé : ' + Object.keys(f).length + ' vidéos' + (refusees ? ', ' + refusees + ' refusée(s)' : '') + (disparues ? ', ' + disparues + ' introuvable(s)' : '') + '.');
    } catch (e) {
      message('msg-publication', e.message, 'error');
      journal('Actualisation impossible : ' + e.message + brut(e), 'err');
    }
  }

  const clesCochees = () => Array.from(document.querySelectorAll('#lignes-publication input:checked')).map((c) => c.value);

  async function publier() {
    const f = faits();
    const cles = clesCochees().filter((c) => f[c] && f[c].visibilite !== 'public' && f[c].visibilite !== 'introuvable');
    if (!cles.length) return;
    if (!confirm('Rendre ' + pluriel(cles.length, 'vidéo') + ' publique' + (cles.length > 1 ? 's' : '') + ' sur YouTube ?')) return;
    message('msg-publication', 'Publication en cours…');
    journal('— Passage en public de ' + pluriel(cles.length, 'vidéo') + '.');
    let publiees = 0, restees = 0, echecs = 0, arret = '';
    try {
      const etats = await etatsYoutube(cles.map((c) => f[c].id));
      for (const cle of cles) {
        const v = f[cle];
        const actuel = etats[v.id];
        if (!actuel) { v.visibilite = 'introuvable'; echecs++; journal('   ✖ ' + v.titre + ' : introuvable', 'err'); continue; }
        // On renvoie l'état actuel en ne changeant que la visibilité, pour ne rien réinitialiser.
        const statut = { privacyStatus: 'public' };
        ['embeddable', 'license', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia'].forEach((k) => { if (actuel[k] !== undefined) statut[k] = actuel[k]; });
        try {
          const rep = await api('PUT', 'videos', { part: 'status' }, { id: v.id, status: statut });
          reporter(v, Object.assign({}, actuel, rep.status || { privacyStatus: 'public' }));
          if (v.visibilite === 'public') { publiees++; journal('   ✔ publique : ' + v.titre, 'ok'); }
          else { restees++; journal('   ✖ restée ' + (VISIBILITE[v.visibilite] || v.visibilite).toLowerCase() + ' : ' + v.titre, 'warn'); }
        } catch (e) {
          echecs++;
          journal('   ✖ ' + v.titre + ' : ' + e.message + brut(e), 'err');
          if (e.fatale) { arret = e.message; break; }
        }
        ecrireFaits(f);
      }
    } catch (e) { arret = e.message; journal('Publication interrompue : ' + e.message + brut(e), 'err'); }
    ecrireFaits(f);
    if ((publiees || restees) && cles.some((c) => f[c] && ESSAI.test(f[c].titre))) {
      const t = lireTest();
      t.publication = { date: Date.now(), publiees, restees, resultat: restees ? 'prive' : 'ok' };
      ecrireTest(t);
    }
    afficherPublication();
    message('msg-publication',
      pluriel(publiees, 'vidéo') + ' rendue' + (publiees > 1 ? 's' : '') + ' publique' + (publiees > 1 ? 's' : '') + '.'
      + (restees ? ' ' + restees + (restees > 1 ? " n'ont pas changé : YouTube les garde" : " n'a pas changé : YouTube la garde")
        + " en privé. C'est le signe que Google n'a pas encore validé l'accès technique (voir le tutoriel, « Lire le résultat »)." : '')
      + (echecs ? ' ' + pluriel(echecs, 'échec') + '.' : '') + (arret ? ' Arrêt : ' + arret : ''),
      restees || echecs || arret ? 'error' : 'ok');
  }

  async function supprimer() {
    const f = faits();
    const cles = clesCochees().filter((c) => f[c]);
    if (!cles.length) return;
    const reelles = cles.filter((c) => f[c].visibilite !== 'introuvable').length;
    if (!confirm('Supprimer définitivement ' + pluriel(reelles, 'vidéo') + ' de YouTube'
      + (cles.length - reelles ? ' et retirer ' + pluriel(cles.length - reelles, 'ligne') + ' introuvable' + (cles.length - reelles > 1 ? 's' : '') + ' de la liste' : '')
      + ' ?\n\nCette action est irréversible. Elle ne concerne que les vidéos cochées dans cette liste.')) return;
    message('msg-publication', 'Suppression en cours…');
    journal('— Suppression de ' + pluriel(cles.length, 'vidéo') + '.');
    let supprimees = 0, echecs = 0, arret = '';
    for (const cle of cles) {
      const v = f[cle];
      try {
        if (v.visibilite !== 'introuvable') await api('DELETE', 'videos', { id: v.id });
        delete f[cle]; supprimees++;
        journal('   ✔ supprimée : ' + v.titre, 'ok');
      } catch (e) {
        if (e.statut === 404 || e.raison === 'videoNotFound') { delete f[cle]; supprimees++; journal('   ✔ déjà absente de YouTube : ' + v.titre, 'ok'); }
        else { echecs++; journal('   ✖ ' + v.titre + ' : ' + e.message + brut(e), 'err'); if (e.fatale) { arret = e.message; break; } }
      }
      ecrireFaits(f);
    }
    ecrireFaits(f);
    construire();
    message('msg-publication', pluriel(supprimees, 'vidéo') + ' supprimée' + (supprimees > 1 ? 's' : '') + '.' + (echecs ? ' ' + pluriel(echecs, 'échec') + '.' : '') + (arret ? ' Arrêt : ' + arret : ''),
      echecs || arret ? 'error' : 'ok');
  }

  // ------------------------------------------------- encadré bêta : test des 53
  const essaisEnLigne = () => Object.values(faits()).filter((v) => ESSAI.test(v.titre) && v.visibilite !== 'introuvable');

  function etapesTest() {
    const t = lireTest();
    const relies = E.elements.filter((el) => el.film).length;
    const enLigne = essaisEnLigne();
    const envois = t.envois || [];
    const dernier = envois[envois.length - 1];
    const etapes = [];

    etapes.push(E.kit && relies >= 53
      ? { titre: 'Kit chargé', detail: E.films.length + ' lignes dans le tableau, ' + relies + ' vidéos reliées.', etat: 'done' }
      : { titre: 'Charger le kit', detail: E.kit ? 'Tableau du kit chargé. Choisissez maintenant le dossier YOUTUBE du kit (étape 03) : ' + relies + ' vidéo' + (relies > 1 ? 's' : '') + ' reliée' + (relies > 1 ? 's' : '') + ' sur 53.'
          : 'Étape 02 : choisissez films-test.xlsx. Étape 03 : choisissez le dossier YOUTUBE du kit.', etat: '' });

    if (E.demo) etapes.push({ titre: 'Démonstration', detail: 'Aucune chaîne réelle : rien n\'est envoyé à YouTube. Ce passage ne mesure pas vos vraies limites.', etat: 'done' });
    else if (!E.chaine) etapes.push({ titre: 'Se connecter à la chaîne de test', detail: 'Étape 01 : collez l\'identifiant client et connectez-vous.', etat: '' });
    else etapes.push($('confirme-test').checked
      ? { titre: 'Chaîne de test confirmée', detail: 'Connecté à « ' + E.chaine.snippet.title + ' ».', etat: 'done' }
      : { titre: 'Confirmer la chaîne de test', detail: 'Connecté à « ' + E.chaine.snippet.title + ' ». Cochez la case ci-dessous si c\'est bien votre chaîne de test.', etat: '' });

    if (!dernier) etapes.push({ titre: 'Envoyer les 53 vidéos', detail: 'Étape 05 : cliquez sur « Mettre en ligne ».', etat: '' });
    else if (dernier.arret) etapes.push({ titre: 'Envoi : blocage à la vidéo n° ' + numero(dernier.arret.num),
      detail: enLigne.length + ' vidéo' + (enLigne.length > 1 ? 's' : '') + ' d\'essai en ligne. Raison : ' + dernier.arret.message + ' Relancez l\'envoi plus tard pour faire passer les suivantes.', etat: 'bad' });
    else if (enLigne.length >= 53) etapes.push({ titre: 'Envoi : les 53 vidéos sont passées', detail: 'Aucune limite rencontrée' + (envois.length > 1 ? ' au dernier envoi (' + envois.length + ' envois en tout).' : '.'), etat: 'done' });
    else etapes.push({ titre: 'Envoi incomplet', detail: enLigne.length + ' vidéo' + (enLigne.length > 1 ? 's' : '') + ' d\'essai en ligne sur 53, sans blocage général. Relancez l\'envoi pour les suivantes.', etat: enLigne.length ? '' : 'bad' });

    const p = t.publication;
    if (!p) etapes.push({ titre: 'Tester le passage en public', detail: 'Étape 06 : cochez une seule vidéo d\'essai et cliquez sur « Passer en public ».', etat: '' });
    else if (p.resultat === 'ok') etapes.push({ titre: 'Passage en public : réussi', detail: 'La vidéo est devenue publique : votre accès Google peut publier.', etat: 'done' });
    else etapes.push({ titre: 'Passage en public : bloqué', detail: 'YouTube a gardé la vidéo en privé : l\'accès Google est bridé tant que Google ne l\'a pas contrôlé (tutoriel, chapitre 07).', etat: 'bad' });

    if (!envois.length) etapes.push({ titre: 'Nettoyer la chaîne de test', detail: 'À faire à la fin : étape 06, tout cocher, « Supprimer de YouTube ».', etat: '' });
    else if (enLigne.length) etapes.push({ titre: 'Nettoyer la chaîne de test', detail: 'Il reste ' + enLigne.length + ' vidéo' + (enLigne.length > 1 ? 's' : '') + ' d\'essai en ligne. Étape 06 : tout cocher, puis « Supprimer de YouTube ».', etat: '' });
    else etapes.push({ titre: 'Chaîne de test nettoyée', detail: 'Plus aucune vidéo d\'essai dans la liste.', etat: 'done' });

    etapes.push(t.rapport
      ? { titre: 'Rapport enregistré', detail: 'Dernier enregistrement le ' + JOUR.format(t.rapport) + ' à ' + HEURE.format(t.rapport) + '. Réenregistrez-le après chaque nouvelle étape.', etat: 'done' }
      : { titre: 'Enregistrer le rapport', detail: 'Bouton ci-dessous. Le fichier reste sur votre ordinateur : c\'est à vous de le transmettre.', etat: '' });
    return etapes;
  }

  function majTest() {
    const liste = $('test-etapes');
    if (!liste) return;
    liste.textContent = '';
    etapesTest().forEach((e, i) => liste.append(creer('li', { className: e.etat ? 'is-' + e.etat : '' }, [
      creer('span', { className: 'mark', textContent: e.etat === 'done' ? '✓' : (e.etat === 'bad' ? '!' : String(i + 1)) }),
      creer('strong', { textContent: e.titre }), creer('span', { className: 'detail', textContent: e.detail }),
    ])));
    $('chaine-test').textContent = E.demo ? '(Sans objet en démonstration.)' : (E.chaine ? 'Chaîne connectée : « ' + E.chaine.snippet.title + ' ».' : 'Aucune chaîne connectée pour le moment.');
    $('confirme-test').disabled = !!E.demo || !E.chaine || E.enCours;
  }

  function rapportTest() {
    const t = lireTest();
    t.rapport = Date.now();
    ecrireTest(t);
    const quand = (ms) => JOUR.format(ms) + ' ' + HEURE.format(ms);
    const lignes = ['RAPPORT DE TEST — Mise en ligne YouTube du festival', '',
      'Version      : ' + VERSION,
      'Date         : ' + quand(Date.now()),
      'Mode         : ' + (E.demo ? 'DÉMONSTRATION (faux YouTube, ne mesure pas les vraies limites)' : 'réel'),
      'Navigateur   : ' + navigator.userAgent,
      'Chaîne       : ' + (E.chaine ? '« ' + E.chaine.snippet.title + ' »' + (E.demo ? '' : ($('confirme-test').checked ? ' (confirmée comme chaîne de test)' : ' (NON confirmée comme chaîne de test)')) : 'non connecté'),
      'Kit de test  : ' + (E.kit ? 'reconnu, ' + E.films.length + ' lignes, ' + E.elements.filter((el) => el.film).length + ' vidéos reliées' : 'non chargé au moment du rapport'),
      '', 'ÉTAT DES ÉTAPES'];
    etapesTest().forEach((e, i) => lignes.push((i + 1) + '. [' + (e.etat === 'done' ? 'fait' : (e.etat === 'bad' ? 'PROBLÈME' : 'à faire')) + '] ' + e.titre + ' — ' + e.detail));
    lignes.push('', 'ENVOIS DU KIT');
    (t.envois || []).forEach((e, i) => lignes.push((i + 1) + '. ' + quand(e.date) + ' — ' + e.reussies + ' sur ' + e.demandees + ' en ligne en ' + duree(e.duree)
      + (e.arret ? ' — BLOCAGE à la n° ' + numero(e.arret.num) + ' (la ' + e.arret.rang + 'e de cet envoi) : ' + [e.arret.statut, e.arret.raison, e.arret.detail].filter(Boolean).join(' · ')
        : (e.arreteParVous ? ' — arrêté à la main' : (e.echecs ? ' — ' + e.echecs + ' échec(s) isolé(s)' : ' — aucune limite rencontrée')))
      + ' — envoyées ce jour-là par la page : ' + e.aujourdhui));
    if (!(t.envois || []).length) lignes.push('(aucun envoi du kit enregistré)');
    lignes.push('', 'PASSAGE EN PUBLIC',
      t.publication ? quand(t.publication.date) + ' — ' + t.publication.publiees + ' devenue(s) publique(s), ' + t.publication.restees + ' restée(s) en privé — ' + (t.publication.resultat === 'ok' ? 'l\'accès peut publier' : 'ACCÈS BRIDÉ : YouTube garde les vidéos en privé') : '(non testé)',
      '', 'VIDÉOS D\'ESSAI ENCORE EN LIGNE D\'APRÈS LA PAGE : ' + essaisEnLigne().length,
      'ENVOYÉES AUJOURD\'HUI PAR LA PAGE (jour du quota) : ' + envoyeesAujourdhui(),
      '', 'JOURNAL COMPLET');
    memoire.lire(prefixe() + 'journal', []).forEach((e) => lignes.push(quand(e.t) + '  ' + e.m));
    enregistrer('rapport-de-test.txt', '\uFEFF' + lignes.join('\r\n') + '\r\n', 'text/plain;charset=utf-8');
    journal('Rapport de test enregistré.');
    majTest();
  }

  function rapport() {
    const champ = (t) => '"' + String(t ?? '').replace(/"/g, '""') + '"';
    const lignes = [['Numéro', 'Fichier', 'Titre', 'Lien', 'Visibilité', 'Traitement', 'Mise en ligne'].map(champ).join(';')];
    Object.values(faits()).sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9)).forEach((v) => lignes.push([
      v.num != null ? numero(v.num) : '', v.fichier, v.titre, 'https://youtu.be/' + v.id,
      VISIBILITE[v.visibilite] || v.visibilite, (TRAITEMENT[v.traitement] || '') + (v.motif ? ' : ' + (REFUS[v.motif] || v.motif) : ''),
      new Date(v.date).toLocaleString('fr-FR'),
    ].map(champ).join(';')));
    enregistrer('videos-en-ligne.csv', '﻿' + lignes.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function enregistrerJournal() {
    const lignes = memoire.lire(prefixe() + 'journal', []).map((e) => JOUR.format(e.t) + ' ' + HEURE.format(e.t) + '  ' + e.m);
    enregistrer('journal-mise-en-ligne.txt', '﻿' + lignes.join('\r\n') + '\r\n', 'text/plain;charset=utf-8');
  }

  // --------------------------------------------------------------- démarrage
  $('client-id').value = memoire.lire('fyp_client', '');
  const pref = preferences();
  ['visibilite', 'categorie', 'enfants'].forEach((id) => {
    if (pref[id] && Array.from($(id).options).some((o) => o.value === pref[id])) $(id).value = pref[id];
    $(id).onchange = () => retenir({ [id]: $(id).value });
  });
  $('playlist').onchange = () => retenir({ playlist: $('playlist').value });

  $('btn-connexion').onclick = connexion;
  $('client-id').onkeydown = (e) => { if (e.key === 'Enter') connexion(); };
  $('btn-demo').onclick = entrerEnDemo;
  $('btn-quitter-demo').onclick = quitterDemo;
  $('demo-limite').onchange = () => { if (E.demo) { E.demo.regler($('demo-limite').value); journal('Démonstration : ' + $('demo-limite').selectedOptions[0].textContent + '.'); } };
  $('btn-exemple').onclick = chargerExemple;
  $('choix-tableau').onchange = (e) => { if (e.target.files[0]) chargerTableau(e.target.files[0]); e.target.value = ''; };
  $('choix-dossier').onchange = $('choix-fichiers').onchange = (e) => { ajouterFichiers(e.target.files); e.target.value = ''; };
  $('btn-vider').onclick = () => { E.fichiers = []; construire(); };
  ['col-titre', 'col-desc', 'col-tags'].forEach((id) => { $(id).onchange = () => { majModeles(); retenirColonne(id); construire(); }; });
  $('modele-titre').oninput = () => { E.modeleModifie.titre = $('modele-titre').value !== ''; if (!E.modeleModifie.titre) majModeles(); retenirModeles(); construire(); };
  $('modele-desc').oninput = () => { E.modeleModifie.desc = true; retenirModeles(); construire(); };
  $('tout-cocher').onchange = (e) => { E.elements.forEach((el) => { if (!el.case.disabled) { el.case.checked = e.target.checked; el.coche = e.target.checked; } }); majBoutons(); };
  $('tout-cocher-pub').onchange = (e) => { document.querySelectorAll('#lignes-publication input').forEach((c) => { c.checked = e.target.checked; }); majBoutons(); };
  $('btn-envoyer').onclick = toutEnvoyer;
  $('btn-arreter').onclick = () => { E.arretDemande = true; $('btn-arreter').disabled = true; journal('Arrêt demandé : la vidéo en cours se termine, puis l\'envoi s\'arrête.', 'warn'); };
  $('btn-actualiser').onclick = actualiser;
  $('btn-publier').onclick = publier;
  $('btn-supprimer').onclick = supprimer;
  $('btn-rapport').onclick = rapport;
  $('btn-journal').onclick = enregistrerJournal;
  $('btn-rapport-test').onclick = rapportTest;
  $('confirme-test').onchange = () => { if ($('confirme-test').checked && E.chaine) journal('Chaîne « ' + E.chaine.snippet.title + ' » confirmée comme chaîne de test.'); majBoutons(); };
  $('btn-raz-test').onclick = () => { if (confirm('Effacer le suivi du test (envois, passage en public, rapport) ? Les vidéos déjà en ligne et le journal ne sont pas touchés.')) { ecrireTest({}); majBoutons(); } };
  $('version').textContent = VERSION;
  $('btn-vider-journal').onclick = () => { if (confirm('Vider le journal ?')) { memoire.ecrire(prefixe() + 'journal', []); afficherJournal(); } };

  const depot = $('depot');
  ['dragenter', 'dragover'].forEach((n) => depot.addEventListener(n, (e) => { e.preventDefault(); if (!E.enCours) depot.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((n) => depot.addEventListener(n, (e) => { e.preventDefault(); depot.classList.remove('is-over'); }));
  depot.addEventListener('drop', async (e) => { if (E.enCours) return; try { ajouterFichiers(await fichiersDeposes(e.dataTransfer)); } catch (err) { message('msg-envoi', 'Impossible de lire ce qui a été déposé.', 'error'); } });
  // Un fichier lâché à côté de la zone ne doit pas remplacer la page.
  ['dragover', 'drop'].forEach((n) => window.addEventListener(n, (e) => e.preventDefault()));

  window.addEventListener('beforeunload', (e) => { if (E.enCours) { e.preventDefault(); e.returnValue = ''; } });

  afficherJournal();
  afficherPublication();
  let demoVoulue = /[?&]demo=1/.test(location.search);
  try { demoVoulue = demoVoulue || sessionStorage.getItem('fyp_demo') === '1'; } catch (e) { /* sans importance */ }
  if (demoVoulue) entrerEnDemo();
})();
