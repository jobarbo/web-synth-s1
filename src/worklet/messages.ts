import type { Pattern } from '../dsp/sequencer'

/** Messages envoyés du thread principal vers le processeur (événements, pas de paramètres continus). */
export type EngineMessage =
  | { type: 'noteOn'; note: number }
  | { type: 'noteOff'; note: number }
  | { type: 'allNotesOff' }
  /** -1..1 */
  | { type: 'pitchBend'; value: number }
  /** Molette de modulation (CC1), 0..1 */
  | { type: 'modWheel'; value: number }
  /** Pédale de sustain (CC64) */
  | { type: 'hold'; on: boolean }
  /** Contenu du pattern (pas, longueur), renvoyé à chaque édition. */
  | { type: 'setPattern'; pattern: Pattern }
  | { type: 'transport'; playing: boolean }
  /** HOLD de l'arpégiateur : l'arpège continue après le relâchement des touches. */
  | { type: 'arpHold'; on: boolean }
  /** REC : enregistrement en temps réel pendant la lecture. */
  | { type: 'recording'; on: boolean }
  /** Boucle de pas (vide = pattern entier). */
  | { type: 'stepLoop'; steps: number[] }
  /** Forme OSC DRAW (16 valeurs -100..100) et masques OSC CHOP (carré, scie, sub, bruit ; bit n = pas n+1). */
  | { type: 'setWave'; draw: number[]; chop: number[] }
  /** Décalages de jeu (D-MOTION) appliqués autour des réglages : cutoff en octaves, résonance en 0..1. */
  | { type: 'perf'; cutoffOct: number; reso: number }

/** Messages envoyés par le processeur vers le thread principal. */
export type ProcessorMessage =
  | { type: 'step'; index: number }
  /** Note enregistrée en temps réel (à l'attaque, puis au relâchement avec son gate définitif). */
  | { type: 'recNote'; step: number; note: number; gate: number }

export const PROCESSOR_NAME = 's1-processor'
