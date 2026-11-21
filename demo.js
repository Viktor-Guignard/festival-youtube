/* Mode démonstration : un faux YouTube qui vit dans la page.
   Rien n'est envoyé sur Internet. Sert à s'exercer et à voir à quoi ressemble un blocage. */
(function () {
  'use strict';

  const CLE = 'fyp_demo_videos';
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const lire = () => { try { return JSON.parse(localStorage.getItem(CLE)) || {}; } catch (e) { return {}; } };

  function creer() {
    const etat = { sessions: {}, n: 0, envoyees: 0, limite: '' };
    let videos = lire();
    const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(videos)); } catch (e) { /* stockage indisponible */ } };
    const erreur = (statut, raison, message) => ({
      statut, texte: JSON.stringify({ error: { code: statut, message, errors: [{ reason: raison, message }] } }),
    });

    // Refus simulé selon le choix fait dans le bandeau noir.
    function refus() {
      const [genre, seuil] = etat.limite.split('-');
      if (genre === 'quota' && etat.envoyees >= Number(seuil)) {
        return erreur(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.');
      }
      if (genre === 'chaine' && etat.envoyees >= Number(seuil)) {
        return erreur(400, 'uploadLimitExceeded', 'The user has exceeded the number of videos they may upload.');
      }
      return null;
    }

    function statutDe(v) {
      return { privacyStatus: v.visibilite, uploadStatus: 'processed', selfDeclaredMadeForKids: v.enfants,
               embeddable: true, license: 'youtube', publicStatsViewable: true };
    }

    async function requete(o) {
      const reponse = (statut, texte, entetes) => ({ statut, texte: texte || '', entete: (n) => (entetes || {})[n.toLowerCase()] ?? null });
      await attendre(40);
      const id = new URL(o.url).searchParams.get('upload_id');
      if (o.methode === 'POST') {
        const r = refus();
        if (r) return reponse(r.statut, r.texte);
        const sid = 'demo' + Date.now().toString(36) + (++etat.n);
        etat.sessions[sid] = { fiche: JSON.parse(o.corps), total: Number(o.entetes['X-Upload-Content-Length']), recu: 0 };
        return reponse(200, '', { location: 'https://demonstration.invalid/upload?upload_id=' + sid });
      }
      const s = etat.sessions[id];
      if (!s) return reponse(404, '');
      const plage = () => (s.recu ? { range: 'bytes=0-' + (s.recu - 1) } : {});
      const fini = () => {
        const vid = 'DEMO' + Math.random().toString(36).slice(2, 9).toUpperCase();
        videos[vid] = { titre: s.fiche.snippet.title, visibilite: s.fiche.status.privacyStatus, enfants: !!s.fiche.status.selfDeclaredMadeForKids };
        etat.envoyees++;
        sauver();
        delete etat.sessions[id];
        return reponse(200, JSON.stringify({ id: vid, snippet: s.fiche.snippet, status: statutDe(videos[vid]) }));
      };
      const cr = (o.entetes || {})['Content-Range'] || '';
      if (/^bytes \*\//.test(cr)) return s.recu >= s.total ? fini() : reponse(308, '', plage());
      const m = cr.match(/bytes (\d+)-(\d+)\//);
      const debut = Number(m[1]), fin = Number(m[2]);
      for (let i = 1; i <= 4; i++) {
        await attendre(60);
        if (o.surProgression) o.surProgression(Math.round((fin - debut + 1) * i / 4));
      }
      if (debut !== s.recu) return reponse(308, '', plage());
      s.recu = fin + 1;
      return s.recu >= s.total ? fini() : reponse(308, '', plage());
    }

    async function api(methode, chemin, parametres, corps) {
      await attendre(70);
      const ok = (donnees) => ({ statut: 200, donnees });
      if (chemin === 'channels') return ok({ items: [{ id: 'UC-demo', snippet: { title: 'Chaîne de démonstration' } }] });
      if (chemin === 'playlists') return ok({ items: [{ id: 'PL-demo-1', snippet: { title: 'Sélection officielle (démonstration)' } },
                                                       { id: 'PL-demo-2', snippet: { title: 'Essais (démonstration)' } }] });
      if (chemin === 'playlistItems') return ok({});
      if (chemin === 'videos' && methode === 'GET') {
        return ok({ items: String(parametres.id).split(',').filter((i) => videos[i]).map((i) => ({ id: i, status: statutDe(videos[i]) })) });
      }
      if (chemin === 'videos' && methode === 'PUT') {
        const v = videos[corps.id];
        if (!v) return erreur(404, 'videoNotFound', 'The video cannot be found.');
        if (etat.limite !== 'prive') v.visibilite = corps.status.privacyStatus;
        sauver();
        return ok({ id: corps.id, status: statutDe(v) });
      }
      if (chemin === 'videos' && methode === 'DELETE') {
        if (!videos[parametres.id]) return erreur(404, 'videoNotFound', 'The video cannot be found.');
        delete videos[parametres.id];
        sauver();
        return ok({});
      }
      return erreur(404, 'notFound', 'Not found.');
    }

    return { requete, api, regler: (limite) => { etat.limite = limite || ''; etat.envoyees = 0; } };
  }

  window.FYP_DEMO = { creer };
})();
