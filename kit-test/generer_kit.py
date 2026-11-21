# -*- coding: utf-8 -*-
"""
Fabrique le kit de test : 53 vidéos factices de 10 secondes et leur tableau Excel.

Tout est fictif (titres, réalisateurs, adresses, liens). Chaque vidéo est différente
des autres (couleur de fond et numéro à l'écran), car YouTube refuse les doublons.

Usage :  python3 generer_kit.py DOSSIER_DE_TRAVAIL
Besoin de : ffmpeg, Pillow, openpyxl.
"""
import colorsys
import os
import subprocess
import sys
import zipfile

import openpyxl
from PIL import Image, ImageDraw, ImageFont

NOMBRE = 53
DUREE = 10
ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "kit-test-53-videos.zip")
POLICE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
POLICE_FINE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

TITRES = [
    "Le Phare des brumes", "Trois minutes avant l'aube", "La Valise orange", "Courant d'air",
    "Le Dernier Ticket", "Sous le préau", "Papier froissé", "L'Heure du thé froid", "Ligne 12",
    "Les Mains du boulanger", "Nuage en bocal", "Le Voisin du dessus", "Sel et poivre",
    "La Clé sous le pot", "Demi-tour", "Un cerf-volant sur le toit", "Marée basse à midi",
    "Le Compteur", "Répondeur plein", "La Piste aux hérissons", "Minuit moins une",
    "Les Chaussettes dépareillées", "Fréquence 88", "Le Jardin d'en face", "Trajet retour",
    "L'Ascenseur capricieux", "Encre bleue", "La Dernière Marche", "Petit déjeuner pour deux",
    "Le Chant du radiateur", "Parapluie emprunté", "Quai numéro 3", "La Recette de Lucienne",
    "Sans les roulettes", "Le Banc du fond", "Orage de poche", "Les Lunettes de Marcel",
    "Station fermée", "Un dimanche à carreaux", "La Photocopieuse du deuxième", "Bocal à souvenirs",
    "La Fenêtre du troisième", "Pile ou face", "Les Correspondances", "Tournesol d'hiver",
    "Le Lacet défait", "Café allongé", "La Carte postale en retard", "Rond-point",
    "Le Cinquantième", "Après la limite", "Une de plus", "Le Mot de la fin",
]
PRENOMS = ["Camille", "Noé", "Inès", "Lucas", "Jade", "Théo", "Lina", "Hugo", "Zoé", "Malo", "Élise", "Sacha", "Agathe"]
NOMS = ["Lefèvre", "Marchand", "Rivière", "Colin", "Besson", "Fontaine", "Perrin", "Aubert", "Maillard", "Charpentier", "Roussel"]
GENRES = ["comédie", "drame", "documentaire", "animation", "expérimental", "fantastique", "portrait"]
ACCROCHES = [
    "Une rencontre de hasard change le cours d'une journée ordinaire.",
    "Un objet oublié réveille un souvenir que personne n'attendait.",
    "Deux inconnus partagent trois minutes et une décision à prendre.",
    "Un quartier, une rumeur, et quelqu'un qui décide d'aller voir.",
    "Tout commence par un retard, et finit ailleurs que prévu.",
    "Un geste simple, répété chaque matin, prend soudain un autre sens.",
    "Il fallait bien que quelqu'un pose la question.",
]


def nettoyer(nom):
    for c in '\\/:*?"<>|':
        nom = nom.replace(c, " ")
    return " ".join(nom.split()).strip(" .")


def fiche(i):
    titre = TITRES[i - 1]
    realisateur = "%s %s" % (PRENOMS[i % len(PRENOMS)], NOMS[(i * 3) % len(NOMS)])
    genre = GENRES[i % len(GENRES)]
    description = (
        "%s\n\nRéalisation : %s\nGenre : %s — durée : %d secondes\n\n"
        "Vidéo d'essai n° %03d, entièrement fictive, créée pour tester la mise en ligne. À supprimer après le test."
        % (ACCROCHES[i % len(ACCROCHES)], realisateur, genre, DUREE, i)
    )
    return {
        "num": i,
        "titre": titre,
        "titre_youtube": "ESSAI %03d – %s" % (i, titre),
        "realisateur": realisateur,
        "genre": genre,
        "description": description,
        "tags": "essai, court métrage, %s" % genre,
        "dossier": "%03d - %s" % (i, nettoyer(titre)),
    }


def image(f, chemin):
    teinte = ((f["num"] - 1) * 360.0 / NOMBRE) / 360.0
    sombre = f["num"] % 2 == 0
    r, v, b = colorsys.hls_to_rgb(teinte, 0.16 if sombre else 0.90, 0.55)
    fond = (int(r * 255), int(v * 255), int(b * 255))
    encre = (248, 249, 244) if sombre else (31, 27, 28)
    img = Image.new("RGB", (1280, 720), fond)
    d = ImageDraw.Draw(img)
    d.text((640, 250), "%03d" % f["num"], font=ImageFont.truetype(POLICE, 300), fill=encre, anchor="mm")
    d.text((640, 470), f["titre"], font=ImageFont.truetype(POLICE, 52), fill=encre, anchor="mm")
    d.text((640, 545), "VIDÉO D'ESSAI FICTIVE  ·  %d SECONDES  ·  NE PAS DIFFUSER" % DUREE,
           font=ImageFont.truetype(POLICE_FINE, 26), fill=encre, anchor="mm")
    d.rectangle((0, 0, 1279, 13), fill=(229, 40, 36))
    img.save(chemin)
    return "white" if sombre else "0x1F1B1C"


def video(f, travail):
    png = os.path.join(travail, "%03d.png" % f["num"])
    barre = image(f, png)
    dossier = os.path.join(travail, "kit-test-53-videos", "YOUTUBE", f["dossier"])
    os.makedirs(dossier, exist_ok=True)
    sortie = os.path.join(dossier, f["dossier"] + ".mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-loop", "1", "-framerate", "25", "-i", png,
        "-f", "lavfi", "-i", "color=c=%s:s=160x10:r=25" % barre,
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-filter_complex", "[0][1]overlay=x='mod(t*128,1280)':y=680[v]",
        "-map", "[v]", "-map", "2:a", "-t", str(DUREE),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", sortie,
    ], check=True)
    return sortie


def tableau(fiches, chemin):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.title = "Films"
    feuille.append(["Horodateur", "Titre", "Réalisateur", "Description", "Mots-clés", "Durée",
                    "Lien YouTube d'origine (fictif)", "Lien SwissTransfer version YouTube (fictif)",
                    "Lien SwissTransfer version cinéma (fictif)", "E-mail (fictif)"])
    for f in fiches:
        i = f["num"]
        feuille.append([
            "%02d/11/2026 %02d:%02d" % (1 + (i - 1) // 3, 9 + i % 9, (i * 7) % 60),
            f["titre_youtube"], f["realisateur"], f["description"], f["tags"], "0:%02d" % DUREE,
            "https://exemple.test/films/%03d" % i,
            "https://www.swisstransfer.com/d/00000000-0000-4000-8000-%012d" % i,
            "https://www.swisstransfer.com/d/00000000-0000-4000-9000-%012d" % i,
            "participant%03d@exemple.test" % i,
        ])
    for lettre, largeur in zip("ABCDEFGHIJ", (18, 40, 22, 60, 34, 8, 36, 62, 62, 30)):
        feuille.column_dimensions[lettre].width = largeur
    classeur.save(chemin)


LISEZMOI = """KIT DE TEST - 53 VIDÉOS FACTICES
================================

Ce kit sert à essayer la page de mise en ligne YouTube sans toucher aux vrais films.
Tout y est fictif : titres, réalisateurs, adresses e-mail et liens.

CONTENU
- films-test.xlsx : le tableau, 53 lignes (une par vidéo).
- YOUTUBE\\ : 53 sous-dossiers numérotés, chacun avec une vidéo de 10 secondes.
  Chaque vidéo est différente (couleur et numéro à l'écran), car YouTube refuse les doublons.

COMMENT S'EN SERVIR
1. Décompressez ce fichier zip sur votre ordinateur.
2. Ouvrez la page de mise en ligne et connectez-vous à votre CHAÎNE DE TEST (pas celle du festival).
3. Étape « Tableau » : choisissez films-test.xlsx.
4. Étape « Vidéos » : choisissez le dossier YOUTUBE.
5. Laissez la visibilité sur « Privée » et lancez la mise en ligne.
6. À la fin, lisez le « Bilan » : il indique combien de vidéos sont passées et, s'il y a eu
   un blocage, à quelle vidéo et pour quelle raison.
7. Supprimez ensuite les vidéos de test avec le bouton prévu à l'étape 6 de la page.

LES LIENS DU TABLEAU SONT FACTICES
Les liens SwissTransfer ne mènent à aucun fichier. Si vous donnez ce tableau au programme de
téléchargement, il les signalera comme « lien expiré ou supprimé » : c'est normal.
"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    travail = os.path.abspath(sys.argv[1])
    racine = os.path.join(travail, "kit-test-53-videos")
    os.makedirs(racine, exist_ok=True)
    fiches = [fiche(i) for i in range(1, NOMBRE + 1)]
    assert len(TITRES) == NOMBRE and len(set(TITRES)) == NOMBRE
    for f in fiches:
        video(f, travail)
    tableau(fiches, os.path.join(racine, "films-test.xlsx"))
    with open(os.path.join(racine, "LISEZMOI.txt"), "w", encoding="utf-8-sig", newline="\r\n") as fichier:
        fichier.write(LISEZMOI)
    with zipfile.ZipFile(SORTIE, "w", zipfile.ZIP_DEFLATED) as z:
        for dossier, _, noms in sorted(os.walk(racine)):
            for nom in sorted(noms):
                chemin = os.path.join(dossier, nom)
                z.write(chemin, os.path.relpath(chemin, travail))
    print("Kit créé : %s (%.1f Mo)" % (SORTIE, os.path.getsize(SORTIE) / 1e6))


if __name__ == "__main__":
    main()
