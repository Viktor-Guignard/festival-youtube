/* Mise en ligne YouTube du festival — page statique, tout se passe dans le navigateur. */
(function () {
  'use strict';

  const API = 'https://www.googleapis.com/youtube/v3/';
  const ENVOI = 'https://www.googleapis.com/upload/youtube/v3/videos';
  const PORTEE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl';
  const EXT_VIDEO = ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mxf', '.mpg', '.mpeg'];
  // Taille d'un morceau envoyé : doit être un multiple de 256 Ko.
  const REGLAGES = window.FYP_REGLAGES = Object.assign({ morceau: 16 * 1024 * 1024, attente: 2000 }, window.FYP_REGLAGES);

  const E = {
    jeton: null, expire: 0, clientJeton: null, chaine: null,
    entetes: [], films: [], fichiers: [], elements: [],
    enCours: false, arretDemande: false, modeleModifie: { titre: false, desc: false },
  };
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ mémoire locale
  const memoire = {
    lire(cle, defaut) { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch (e) { return defaut; } },
    ecrire(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* navigation privée */ } },
  };
  const faits = () => memoire.lire('fyp_faits', {});
  const sessions = () => memoire.lire('fyp_sessions', {});

  // ---------------------------------------------------------------- affichage
  function message(id, texte, genre) {
    const zone = $(id);
    zone.textContent = texte || '';
    zone.className = 'message' + (genre ? ' ' + genre : '');
  }
  function taille(octets) {
    const unites = ['o', 'Ko', 'Mo', 'Go'];
    let i = 0;
    while (octets >= 1024 && i < unites.length - 1) { octets /= 1024; i++; }
    return (i >= 2 && octets < 100 ? octets.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(octets)) + ' ' + unites[i];
  }
  function creer(balise, proprietes, enfants) {
    const el = document.createElement(balise);
    Object.assign(el, proprietes || {});
    (enfants || []).forEach((e) => el.append(e));
    return el;
  }
  const VISIBILITE = { private: 'Privée', unlisted: 'Non répertoriée', public: 'Publique' };

  // -------------------------------------------------------------- erreurs API
  const RAISONS = {
    quotaExceeded: "Le quota quotidien de l'accès Google est épuisé. Il se remet à zéro vers 9 h, heure de Paris.",
    dailyLimitExceeded: "Le quota quotidien de l'accès Google est épuisé. Il se remet à zéro vers 9 h, heure de Paris.",
    rateLimitExceeded: 'Trop de demandes en peu de temps. Attendez quelques minutes.',
    uploadLimitExceeded: 'YouTube limite le nombre de vidéos par jour pour cette chaîne. Réessayez dans 24 heures.',
    youtubeSignupRequired: "Ce compte Google n'a pas de chaîne YouTube.",
    invalidTitle: 'YouTube refuse ce titre (vide, trop long, ou contenant < ou >).',
    invalidDescription: 'YouTube refuse cette description (trop longue, ou contenant < ou >).',
    invalidTags: 'YouTube refuse ces mots-clés.',
    insufficientPermissions: "L'autorisation accordée ne suffit pas. Reconnectez-vous en acceptant toutes les autorisations demandées.",
    forbidden: "YouTube refuse l'opération pour ce compte.",
  };
  const FATALES = ['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded', 'youtubeSignupRequired', 'insufficientPermissions'];

  function erreurApi(statut, corps) {
    let raison = '', detail = '';
    try {
      const d = typeof corps === 'string' ? JSON.parse(corps) : corps;
      raison = d.error.errors[0].reason || '';
      detail = d.error.message || '';
    } catch (e) { /* réponse sans détail */ }
    const err = new Error(RAISONS[raison] || detail || ('YouTube a répondu avec le code ' + statut + '.'));
    err.statut = statut; err.raison = raison; err.fatale = FATALES.includes(raison);
    return err;
  }

  // ---------------------------------------------------------------- connexion
  function demanderJeton() {
    return new Promise((resoudre, rejeter) => {
      const id = $('client-id').value.trim();
      if (!id) return rejeter(new Error("Indiquez d'abord l'identifiant client Google."));
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        return rejeter(new Error("Le service de connexion Google n'est pas chargé. Vérifiez votre connexion ou désactivez le bloqueur de publicités, puis rechargez la page."));
      }
      memoire.ecrire('fyp_client', id);
      E.clientJeton = google.accounts.oauth2.initTokenClient({
        client_id: id, scope: PORTEE,
        callback: (r) => {
          if (r.error || !r.access_token) return rejeter(new Error('Connexion refusée : ' + (r.error_description || r.error || 'aucune autorisation reçue')));
          E.jeton = r.access_token;
          E.expire = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          resoudre();
        },
        error_callback: (e) => rejeter(new Error(e && e.type === 'popup_closed' ? 'Fenêtre de connexion fermée.' : 'La fenêtre de connexion Google ne s\'est pas ouverte. Autorisez les fenêtres surgissantes pour cette page.')),
      });
      E.clientJeton.requestAccessToken();
    });
  }

  // Quand le jeton a expiré en cours de route : on attend un clic (obligatoire pour rouvrir la fenêtre Google).
  let attenteReconnexion = null;
  function reconnecter() {
    if (!attenteReconnexion) {
      attenteReconnexion = new Promise((resoudre) => {
        $('reconnexion').classList.add('visible');
        $('btn-reconnexion').onclick = async () => {
          try {
            await demanderJeton();
            $('reconnexion').classList.remove('visible');
            attenteReconnexion = null;
            resoudre();
          } catch (e) { message('msg-envoi', e.message, 'erreur'); }
        };
      });
    }
    return attenteReconnexion;
  }
  async function jetonValide() {
    if (!E.jeton || Date.now() > E.expire - 120000) await reconnecter();
    return E.jeton;
  }

  async function api(methode, chemin, parametres, corps) {
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

  async function connexion() {
    message('msg-connexion', '');
    try {
      await demanderJeton();
      const rep = await api('GET', 'channels', { part: 'snippet', mine: 'true' });
      if (!rep.items || !rep.items.length) throw erreurApi(403, { error: { errors: [{ reason: 'youtubeSignupRequired' }] } });
      E.chaine = rep.items[0];
      $('etat-connexion').textContent = 'connecté à la chaîne « ' + E.chaine.snippet.title + ' »';
      $('etat-connexion').className = 'etat ok';
      $('btn-connexion').textContent = 'Changer de compte';
      await chargerPlaylists();
    } catch (e) {
      message('msg-connexion', e.message, 'erreur');
    }
    majBoutons();
  }

  async function chargerPlaylists() {
    const choix = $('playlist');
    const precedent = choix.value;
    choix.length = 1;
    let page = '';
    do {
      const rep = await api('GET', 'playlists', Object.assign({ part: 'snippet', mine: 'true', maxResults: '50' }, page ? { pageToken: page } : {}));
      (rep.items || []).forEach((p) => choix.append(new Option(p.snippet.title, p.id)));
      page = rep.nextPageToken || '';
    } while (page);
    choix.value = precedent;
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
      lignes = lignes.map((l) => l.map((c) => String(c == null ? '' : c).trim())).filter((l) => l.some((c) => c));
      if (lignes.length < 2) throw new Error('Ce tableau ne contient aucune ligne de film.');
      const largeur = Math.max(...lignes.map((l) => l.length));
      E.entetes = Array.from({ length: largeur }, (_, i) => lignes[0][i] || 'Colonne ' + (i + 1));
      E.films = lignes.slice(1).map((l, i) => ({ num: i + 1, valeurs: E.entetes.map((_, c) => l[c] || '') }));
      $('etat-tableau').textContent = fichier.name + ' — ' + E.films.length + ' film' + (E.films.length > 1 ? 's' : '');
      $('etat-tableau').className = 'etat ok';
      preparerColonnes();
    } catch (e) {
      E.entetes = []; E.films = [];
      $('colonnes').hidden = true;
      $('etat-tableau').textContent = 'aucun tableau'; $('etat-tableau').className = 'etat';
      message('msg-tableau', 'Impossible de lire ce tableau : ' + e.message, 'erreur');
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
    const remplir = (id, choisi, facultatif) => {
      const liste = $(id);
      liste.length = 0;
      if (facultatif) liste.append(new Option('— aucune —', ''));
      E.entetes.forEach((e, i) => liste.append(new Option(e, String(i))));
      liste.value = choisi >= 0 ? String(choisi) : (facultatif ? '' : '0');
    };
    remplir('col-titre', deviner(['titre', 'projet', 'film', 'nom']), false);
    remplir('col-desc', deviner(['description', 'synopsis', 'resume', 'pitch']), true);
    remplir('col-tags', deviner(['mots-cles', 'mots cles', 'tags', 'mots']), true);
    E.modeleModifie = { titre: false, desc: false };
    majModeles();
    const puces = $('puces');
    puces.textContent = '';
    E.entetes.forEach((e) => puces.append(creer('button', {
      type: 'button', textContent: '{' + e + '}', title: 'Ajouter cette colonne au modèle de la description',
      onclick: () => { $('modele-desc').value += '{' + e + '}'; E.modeleModifie.desc = true; construire(); },
    })));
    $('colonnes').hidden = false;
  }

  function majModeles() {
    const nom = (id) => ($(id).value === '' ? '' : '{' + E.entetes[Number($(id).value)] + '}');
    if (!E.modeleModifie.titre) $('modele-titre').value = nom('col-titre');
    if (!E.modeleModifie.desc) $('modele-desc').value = nom('col-desc');
  }

  function appliquer(modele, film) {
    return modele.replace(/\{([^{}]+)\}/g, (tout, nom) => {
      const i = E.entetes.findIndex((e) => sansAccent(e).trim() === sansAccent(nom).trim());
      return i >= 0 ? film.valeurs[i] : tout;
    }).replace(/[ \t]+\n/g, '\n').trim();
  }

  // ------------------------------------------------------------------- vidéos
  const cleFichier = (f) => [f.name, f.size, f.lastModified].join('|');
  function numeroDe(nom) {
    const m = String(nom).match(/^\s*(\d{1,4})(?!\d)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function ajouterFichiers(liste) {
    const connus = new Set(E.fichiers.map(cleFichier));
    Array.from(liste).forEach((f) => {
      const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (EXT_VIDEO.includes(ext) && !connus.has(cleFichier(f))) { E.fichiers.push(f); connus.add(cleFichier(f)); }
    });
    construire();
  }

  // ------------------------------------------------------------------- aperçu
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
      const dossier = (fichier.webkitRelativePath || '').split('/').slice(-2, -1)[0] || '';
      const num = numeroDe(fichier.name) ?? numeroDe(dossier);
      let film = num != null ? E.films[num - 1] : null;
      if (!film && E.films.length) {
        const sansExt = fichier.name.replace(/\.[^.]+$/, '');
        film = parNom.get(normaliser(sansExt)) || null;
      }
      return { fichier, cle: cleFichier(fichier), film: film || null, num: film ? film.num : num };
    }).sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9) || a.fichier.name.localeCompare(b.fichier.name, 'fr', { numeric: true }));

    const compte = {};
    E.elements.forEach((el) => { if (el.film) compte[el.film.num] = (compte[el.film.num] || 0) + 1; });
    const rang = {};
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
      el.barre = creer('i');
      el.etat = creer('div');
      el.zoneBarre = creer('div', { className: 'barre', hidden: true }, [el.barre]);
      ecrireEtat(el);
      corps.append(creer('tr', {}, [
        creer('td', {}, [el.case]),
        creer('td', { textContent: el.num != null ? String(el.num).padStart(3, '0') : '—' }),
        creer('td', { className: 'fichier' }, [el.fichier.name, creer('div', { className: 'taille', textContent: taille(el.fichier.size) })]),
        creer('td', { textContent: el.titre }),
        creer('td', { className: 'desc', textContent: el.description.length > 140 ? el.description.slice(0, 140) + '…' : el.description, title: el.description }),
        creer('td', {}, [el.etat, el.zoneBarre]),
      ]));
    });
    const relies = E.elements.filter((el) => el.film).length;
    const avecVideo = new Set(E.elements.filter((el) => el.film).map((el) => el.film.num));
    const morceaux = [];
    if (E.elements.length) morceaux.push(relies + ' vidéo' + (relies > 1 ? 's' : '') + ' reliée' + (relies > 1 ? 's' : '') + ' au tableau');
    if (E.elements.length - relies) morceaux.push((E.elements.length - relies) + ' sans ligne');
    if (E.films.length && E.elements.length) morceaux.push((E.films.length - avecVideo.size) + ' ligne(s) du tableau sans vidéo');
    $('etat-apercu').textContent = morceaux.join(' · ');
    $('etat-videos').textContent = E.fichiers.length ? E.fichiers.length + ' vidéo' + (E.fichiers.length > 1 ? 's' : '') + ', ' + taille(E.fichiers.reduce((s, f) => s + f.size, 0)) : 'aucune vidéo';
    $('etat-videos').className = 'etat' + (E.fichiers.length ? ' ok' : '');
    $('zone-apercu').hidden = !E.elements.length;
    $('aide-apercu').hidden = !!E.elements.length;
    $('btn-vider').hidden = !E.fichiers.length;
    majBoutons();
  }

  function ecrireEtat(el, texte, genre) {
    el.etat.textContent = '';
    if (texte) { el.etat.textContent = texte; el.etat.className = genre || ''; return; }
    if (el.fait) {
      el.etat.className = 'ok';
      el.etat.append('Déjà en ligne : ', creer('a', { href: 'https://youtu.be/' + el.fait.id, target: '_blank', rel: 'noopener', textContent: 'voir' }));
    } else if (el.probleme) { el.etat.textContent = el.probleme; el.etat.className = 'alerte'; }
    else { el.etat.textContent = 'Prêt'; el.etat.className = ''; }
  }

  function majBoutons() {
    const coches = E.elements.filter((el) => el.case && el.case.checked && !el.case.disabled);
    const total = coches.reduce((s, el) => s + el.fichier.size, 0);
    $('btn-envoyer').textContent = coches.length
      ? 'Mettre en ligne ' + coches.length + ' vidéo' + (coches.length > 1 ? 's' : '') + ' (' + taille(total) + ')'
      : 'Mettre en ligne';
    $('btn-envoyer').disabled = E.enCours || !coches.length || !E.jeton;
    const cochables = E.elements.filter((el) => el.case && !el.case.disabled);
    $('tout-cocher').checked = cochables.length > 0 && cochables.every((el) => el.case.checked);
    $('tout-cocher').disabled = E.enCours || !cochables.length;
    if (!E.enCours) {
      $('progression').textContent = coches.length && !E.jeton ? 'Connectez-vous à YouTube (étape 1) pour activer le bouton.' : '';
    }
    const nbFaits = Object.keys(faits()).length;
    const cochesPub = document.querySelectorAll('#lignes-publication input:checked').length;
    $('btn-actualiser').disabled = !nbFaits || !E.jeton;
    $('btn-publier').disabled = !cochesPub || !E.jeton || E.enCours;
    $('btn-rapport').disabled = !nbFaits;
  }

  // --------------------------------------------------------- envoi d'une vidéo
  function requete({ methode, url, entetes, corps, surProgression }) {
    return new Promise((resoudre, rejeter) => {
      const x = new XMLHttpRequest();
      x.open(methode, url);
      Object.entries(entetes || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
      if (surProgression) x.upload.onprogress = (e) => surProgression(e.loaded);
      x.onload = () => resoudre({ statut: x.status, texte: x.responseText, entete: (n) => x.getResponseHeader(n) });
      x.onerror = x.ontimeout = () => { const e = new Error('Connexion interrompue'); e.reseau = true; rejeter(e); };
      x.send(corps || null);
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
        if (rep.statut === 308) { adresse = connue.adresse; position = recus(rep) || 0; }
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
      const s = sessions(); s[el.cle] = { adresse, fiche, date: Date.now() }; memoire.ecrire('fyp_sessions', s);
    }

    let echecs = 0, surPlace = 0;
    surProgression(position);
    while (true) {
      if (position >= total && total > 0) {
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

  async function toutEnvoyer() {
    const file = E.elements.filter((el) => el.case.checked && !el.case.disabled);
    if (!file.length || E.enCours) return;
    const reglages = { visibilite: $('visibilite').value, categorie: $('categorie').value, enfants: $('enfants').value === 'oui', playlist: $('playlist').value };
    if (reglages.visibilite === 'public' && !confirm('Les ' + file.length + ' vidéos seront publiques dès la fin de leur envoi, sans vérification. Continuer ?')) return;

    E.enCours = true; E.arretDemande = false;
    $('btn-arreter').hidden = false; $('btn-arreter').disabled = false;
    document.querySelectorAll('#s-apercu input[type=checkbox], #s-tableau select, #s-tableau input, #s-tableau textarea, #s-videos input').forEach((c) => { c.disabled = true; });
    message('msg-envoi', '');
    majBoutons();
    const totalOctets = file.reduce((s, el) => s + el.fichier.size, 0);
    let octetsFinis = 0, reussies = 0, arret = '';

    for (let i = 0; i < file.length; i++) {
      const el = file[i];
      if (E.arretDemande) break;
      el.zoneBarre.hidden = false;
      try {
        const video = await envoyer(el, reglages, (n) => {
          const pct = el.fichier.size ? Math.floor(n * 100 / el.fichier.size) : 100;
          el.barre.style.width = pct + '%';
          ecrireEtat(el, 'Envoi… ' + pct + ' %');
          $('progression').textContent = 'Vidéo ' + (i + 1) + ' sur ' + file.length + ' — ' + taille(octetsFinis + n) + ' sur ' + taille(totalOctets);
        });
        const f = faits();
        f[el.cle] = { id: video.id, titre: el.titre, fichier: el.fichier.name, num: el.num,
                      visibilite: (video.status && video.status.privacyStatus) || reglages.visibilite, date: Date.now() };
        memoire.ecrire('fyp_faits', f);
        const s = sessions(); delete s[el.cle]; memoire.ecrire('fyp_sessions', s);
        el.fait = f[el.cle]; el.case.checked = false; el.case.disabled = true; el.zoneBarre.hidden = true;
        ecrireEtat(el);
        reussies++;
        if (reglages.playlist) {
          try {
            await api('POST', 'playlistItems', { part: 'snippet' }, { snippet: { playlistId: reglages.playlist, resourceId: { kind: 'youtube#video', videoId: video.id } } });
          } catch (e) {
            el.etat.append(creer('div', { className: 'alerte', textContent: 'Non ajoutée à la playlist : ' + e.message }));
            if (e.fatale) { arret = e.message; break; }
          }
        }
      } catch (e) {
        el.zoneBarre.hidden = true;
        ecrireEtat(el, 'Échec : ' + e.message, 'erreur');
        if (e.fatale) { arret = e.message; break; }
      }
      octetsFinis += el.fichier.size;
      afficherPublication();
    }

    E.enCours = false;
    $('btn-arreter').hidden = true;
    document.querySelectorAll('#s-tableau select, #s-tableau input, #s-tableau textarea, #s-videos input').forEach((c) => { c.disabled = false; });
    E.elements.forEach((el) => { el.case.disabled = !!(el.probleme || el.fait); });
    const reste = file.length - reussies;
    $('progression').textContent = '';
    message('msg-envoi',
      reussies + ' vidéo' + (reussies > 1 ? 's' : '') + ' mise' + (reussies > 1 ? 's' : '') + ' en ligne sur ' + file.length + '.'
      + (arret ? ' Arrêt : ' + arret : (E.arretDemande && reste ? ' Arrêté à votre demande.' : ''))
      + (reste ? ' Les vidéos restantes sont toujours cochées : cliquez à nouveau pour continuer.' : ''),
      arret ? 'erreur' : (reste ? '' : 'ok'));
    afficherPublication();
    majBoutons();
  }

  // -------------------------------------------------------------- publication
  function afficherPublication() {
    const liste = Object.entries(faits()).sort((a, b) => (a[1].num ?? 1e9) - (b[1].num ?? 1e9) || a[1].date - b[1].date);
    const coches = new Set(Array.from(document.querySelectorAll('#lignes-publication input:checked')).map((c) => c.value));
    const corps = $('lignes-publication');
    corps.textContent = '';
    liste.forEach(([cle, v]) => {
      const publique = v.visibilite === 'public';
      corps.append(creer('tr', {}, [
        creer('td', {}, [creer('input', { type: 'checkbox', value: cle, checked: coches.has(cle) && !publique, disabled: publique, onchange: majBoutons })]),
        creer('td', { textContent: v.titre }),
        creer('td', {}, [creer('a', { href: 'https://youtu.be/' + v.id, target: '_blank', rel: 'noopener', textContent: 'youtu.be/' + v.id })]),
        creer('td', { textContent: VISIBILITE[v.visibilite] || v.visibilite, className: publique ? 'ok' : '' }),
        creer('td', { textContent: new Date(v.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }),
      ]));
    });
    $('zone-publication').hidden = !liste.length;
    $('etat-publication').textContent = liste.length ? liste.length + ' vidéo' + (liste.length > 1 ? 's' : '') : 'aucune pour le moment';
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

  async function actualiser() {
    message('msg-publication', '');
    try {
      const f = faits();
      const etats = await etatsYoutube(Object.values(f).map((v) => v.id));
      let disparues = 0;
      Object.values(f).forEach((v) => { if (etats[v.id]) v.visibilite = etats[v.id].privacyStatus; else { v.visibilite = 'introuvable'; disparues++; } });
      memoire.ecrire('fyp_faits', f);
      afficherPublication();
      message('msg-publication', 'État actualisé.' + (disparues ? ' ' + disparues + ' vidéo(s) introuvable(s) sur la chaîne (supprimées, ou autre compte).' : ''), disparues ? '' : 'ok');
    } catch (e) { message('msg-publication', e.message, 'erreur'); }
  }

  async function publier() {
    const cles = Array.from(document.querySelectorAll('#lignes-publication input:checked')).map((c) => c.value);
    if (!cles.length) return;
    if (!confirm('Rendre ' + cles.length + ' vidéo' + (cles.length > 1 ? 's' : '') + ' publique' + (cles.length > 1 ? 's' : '') + ' sur YouTube ?')) return;
    message('msg-publication', 'Publication en cours…');
    const f = faits();
    let publiees = 0, restees = 0, echecs = 0, arret = '';
    try {
      const etats = await etatsYoutube(cles.map((c) => f[c].id));
      for (const cle of cles) {
        const v = f[cle];
        const actuel = etats[v.id];
        if (!actuel) { v.visibilite = 'introuvable'; echecs++; continue; }
        // On renvoie l'état actuel en ne changeant que la visibilité, pour ne rien réinitialiser.
        const statut = { privacyStatus: 'public' };
        ['embeddable', 'license', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia'].forEach((k) => { if (actuel[k] !== undefined) statut[k] = actuel[k]; });
        try {
          const rep = await api('PUT', 'videos', { part: 'status' }, { id: v.id, status: statut });
          v.visibilite = (rep.status && rep.status.privacyStatus) || 'public';
          if (v.visibilite === 'public') publiees++; else restees++;
        } catch (e) { echecs++; if (e.fatale) { arret = e.message; break; } }
        memoire.ecrire('fyp_faits', f);
      }
    } catch (e) { arret = e.message; }
    memoire.ecrire('fyp_faits', f);
    afficherPublication();
    message('msg-publication',
      publiees + ' vidéo' + (publiees > 1 ? 's' : '') + ' rendue' + (publiees > 1 ? 's' : '') + ' publique' + (publiees > 1 ? 's' : '') + '.'
      + (restees ? ' ' + restees + (restees > 1 ? " n'ont pas changé : YouTube les garde" : " n'a pas changé : YouTube la garde")
        + " en privé. C'est le cas tant que Google n'a pas validé l'accès technique (voir le mode d'emploi)." : '')
      + (echecs ? ' ' + echecs + ' échec(s).' : '') + (arret ? ' Arrêt : ' + arret : ''),
      restees || echecs || arret ? 'erreur' : 'ok');
  }

  function rapport() {
    const champ = (t) => '"' + String(t ?? '').replace(/"/g, '""') + '"';
    const lignes = [['Numéro', 'Fichier', 'Titre', 'Lien', 'Visibilité', 'Mise en ligne'].map(champ).join(';')];
    Object.values(faits()).sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9)).forEach((v) => lignes.push([
      v.num != null ? String(v.num).padStart(3, '0') : '', v.fichier, v.titre, 'https://youtu.be/' + v.id,
      VISIBILITE[v.visibilite] || v.visibilite, new Date(v.date).toLocaleString('fr-FR'),
    ].map(champ).join(';')));
    const lien = creer('a', { href: URL.createObjectURL(new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: 'videos-en-ligne.csv' });
    document.body.append(lien); lien.click(); lien.remove();
  }

  // --------------------------------------------------------------- démarrage
  $('client-id').value = memoire.lire('fyp_client', '');
  $('btn-connexion').onclick = connexion;
  $('choix-tableau').onchange = (e) => { if (e.target.files[0]) chargerTableau(e.target.files[0]); e.target.value = ''; };
  $('choix-dossier').onchange = $('choix-fichiers').onchange = (e) => { ajouterFichiers(e.target.files); e.target.value = ''; };
  $('btn-vider').onclick = () => { E.fichiers = []; construire(); };
  ['col-titre', 'col-desc', 'col-tags'].forEach((id) => { $(id).onchange = () => { majModeles(); construire(); }; });
  $('modele-titre').oninput = () => { E.modeleModifie.titre = true; construire(); };
  $('modele-desc').oninput = () => { E.modeleModifie.desc = true; construire(); };
  $('tout-cocher').onchange = (e) => { E.elements.forEach((el) => { if (!el.case.disabled) { el.case.checked = e.target.checked; el.coche = e.target.checked; } }); majBoutons(); };
  $('tout-cocher-pub').onchange = (e) => { document.querySelectorAll('#lignes-publication input:not(:disabled)').forEach((c) => { c.checked = e.target.checked; }); majBoutons(); };
  $('btn-envoyer').onclick = toutEnvoyer;
  $('btn-arreter').onclick = () => { E.arretDemande = true; $('btn-arreter').disabled = true; };
  $('btn-actualiser').onclick = actualiser;
  $('btn-publier').onclick = publier;
  $('btn-rapport').onclick = rapport;
  window.addEventListener('beforeunload', (e) => { if (E.enCours) { e.preventDefault(); e.returnValue = ''; } });
  afficherPublication();
})();
