# S1 Web

Synthé web inspiré du Roland S-1 (projet non affilié à Roland).

## Démarrer

```bash
npm install
npm run dev     # http://localhost:5173
npm run test    # tests DSP (Vitest)
npm run check   # vérification des types
npm run build   # build de production dans dist/
```

## Architecture

- `src/dsp/` : DSP pur, sans DOM ni Web Audio (oscillateur PolyBLEP, filtre ZDF 24 dB, ADSR RC, voix, allocation).
- `src/worklet/` : processeur AudioWorklet qui assemble le DSP.
- `src/audio/` : AudioContext, chargement du worklet, clavier.
- `src/ui/` : composants Svelte.

Le serveur doit envoyer les en-têtes COOP/COEP (déjà configurés pour `dev` et `preview` dans `vite.config.ts`, à reproduire chez l'hébergeur).

## Avancement

Phases 0 à 5b terminées : voix soustractive, panneau en sliders, tiroirs (Bend/Mod, effets), clavier à l'écran,
polyphonie 4 voix, LFO, portamento, effets, Web MIDI, séquenceur 64 pas (pas à pas et temps réel), motion recording,
arpégiateur, synchro tempo du delay et du LFO, boucle de pas, transposition, probabilité globale, métronome et décompte,
OSC Draw, OSC Chop, Riser, D-MOTION (pad XY et inclinaison du téléphone), bruit Pink/White, Fine Tune, pan et expression MIDI.
À venir : 7 (patterns, .PRM, partage, déploiement).

## Séquenceur

- Clic sur un pas vide : ajoute une note (C5 ou la note du pas précédent). Clic sur un pas plein : le sélectionne ; 2e clic : l'efface.
- Rec à l'arrêt : les notes jouées (clavier à l'écran, ordinateur, MIDI) s'écrivent dans le pas sélectionné ;
  des notes tenues ensemble forment un accord (4 max). La sélection avance au relâchement.
- Rec pendant la lecture : notes quantifiées au pas le plus proche (gate = durée tenue), et mouvements de sliders,
  de molette MIDI ou de pitch bend enregistrés en motion sur le pas en cours (8 paramètres + pitch bend).
  À l'arrêt, un mouvement de slider s'enregistre sur le pas sélectionné.
- Loop : clic sur les pas à rejouer en boucle (plusieurs possibles, non contigus).
- Pas sélectionné : Copier, Coller, Insérer (les suivants reculent), Doubler le pattern.
- Par pas : gate, vélocité, probabilité, sub-steps (1 à 4 parties), tie. Gate 100 = liaison vers le pas suivant.

## MIDI

Bouton « Connecter MIDI » (Chrome / Edge ; Safari ne prend pas en charge Web MIDI). Reçoit, comme le S-1 :
notes (sans vélocité), pitch bend, CC1 molette, CC64 sustain, CC65 portamento et les CC des potards
(table « Knob assignments » du manuel). Canal par défaut : Omni ; le S-1 écoute sur le canal 3.

## Écarts connus avec le S-1

Référence : manuel officiel S-1 v1.02 (https://static.roland.com/manuals/s-1_manual_v102/eng/).

- Valeurs par défaut = patch INIT de la machine. Roland ne les publie pas : elles viennent du fichier `InitPatch.prm`
  (backup d'un pattern initialisé) de l'éditeur open source [S1Utility](https://github.com/denzlobin/S1Utility).
- Temps d'enveloppe (A, D, R) : calés sur les mesures sur machine publiées par S1Utility (protocole -60 dB).
- Kybd (suivi clavier du filtre) : associé à l'Env, comme sur la machine (fonction SHIFT du potard Filter ENV) :
  le suivi est proportionnel au réglage Env (Env à 0 = aucun suivi ; Kybd 255 + Env max = suivi exact).
  Courbe en racine carrée calée à l'oreille. Pivot : C4 (non documenté).
- Portamento : 0 à 4,5 s (manuel : 0..255 sans unité ; maximum estimé à l'écoute de la machine).
- Plage en Hz du LFO : non publiée, calibration maison.
- Désaccord de l'Unison : non documenté, fixé à ±8 et ±3 cents.
- Effets : routage d'après le schéma de signal du manuel (Chorus en insert, Delay en send, Reverb en send après le Delay).
  Réglages des 4 chorus et des 7 types de reverb faits à l'oreille d'après leur description ; reverb synthétique (convolution).
- Delay Time : correspondance 0..255 → 1..740 ms mesurée sur machine (S1Utility). Feedback, Reverb Time, bend filtre : calibrations maison.
- Delay Level Mode (Pre / Post) : valeur par défaut de la machine inconnue, Pre retenu.
- Molette : ajoute le LFO principal à la hauteur, dosé par Mod depth (le manuel évoque aussi une cible filtre, non implémentée).
- Séquenceur : plage de tempo 40 à 300 BPM (non publiée). Shuffle 0..50 interprété comme le retard des pas pairs en % d'un pas.
  La vélocité est enregistrée mais les voix n'y sont pas sensibles (le manuel ne documente aucune sensibilité).
  L'arpégiateur enchaîne ses notes legato ; le portamento Auto ne s'y applique qu'avec ENV TRG = Gate (manuel).
- Motions : rejouées depuis le thread principal à chaque pas (les sliders suivent), donc avec une gigue de quelques ms ;
  valeur appliquée au début du pas, sans interpolation (le manuel ne précise pas ce point).
- Les notes jouées et celles du séquenceur partagent les voix : une même note jouée des deux côtés peut être coupée par l'autre.
- Valeurs par défaut du métronome (Rec, niveau 50) et du décompte (Off) : non documentées.
- LFO Sync : le manuel donne la plage (8_1 à 1/128) mais pas la liste exacte ; liste reconstituée, 1/4 par défaut.
- Draw / Chop : le manuel décrit le comportement, pas l'algorithme. Draw relit le cycle dessiné Multiply fois par période
  (effet de synchro) ; Chop multiplie les pas coupés par 1 - Overtone/100. Courbe de Multiply et Comb (1.0 à 32.0) : maison.
  Forme INIT décodée du .PRM (triangle) ; masques Chop : bit n = pas n+1, 1 = l'onde passe (S1Utility).
- Riser : bruit filtré par un passe-bande résonant ; réglé sur un slider « Position » dédié, et non sur le slider Noise
  comme sur la machine (où le bouton NOISE change de rôle). Hauteurs et cadences : réglages maison.
- D-MOTION : pad XY (actif tant qu'on appuie, comme le bouton) ; inclinaison réelle en option (« Maintenir et incliner »).
  Amplitudes maison : cutoff ±3 octaves, résonance et niveaux d'effets ±50 %. Le manuel ne documente que l'axe roll en détail.
