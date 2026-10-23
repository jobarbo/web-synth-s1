import { Noise } from './osc'

/*
 * Riser / Downer du S-1 (manuel v1.02) : son montant pour faire monter la tension, et descendant après le climax.
 * Position 0..1 (sur la machine : le bouton NOISE quand Riser Mode ≠ OFF) :
 *   0 → 0,5 : r.0 → r.100, son montant, intermittent selon le mode ;
 *   0,5 → 1 : son descendant continu, jusqu'à d.0 (muet).
 * Modes : Sync (sur les contretemps des noires, au tempo), Quiv (intervalles de plus en plus courts),
 * QvPn (balayage gauche-droite de plus en plus rapide). Resonance : stridence ; Shape : enveloppe dent de scie → carrée.
 * Le manuel décrit le comportement, pas l'algorithme : bruit filtré par un passe-bande résonant, réglages maison.
 */

export const RiserMode = { Off: 0, Sync: 1, Quiv: 2, QvPn: 3 } as const

const frac = (x: number) => x - Math.floor(x)

/** Enveloppe d'une bouffée : dent de scie décroissante (shape 0) → porte carrée (shape 1). w : 0..1 dans la bouffée. */
const envelope = (w: number, shape: number) => (1 - w) * (1 - shape) + shape

/** Libellé de position comme sur l'afficheur : r.0..r.100 puis d.100..d.0. */
export function riserLabel(pos: number): string {
  return pos <= 0.5 ? `r.${Math.round(pos * 200)}` : `d.${Math.round((1 - pos) * 200)}`
}

export class Riser {
  /** Sorties gauche / droite du dernier échantillon. */
  left = 0
  right = 0

  private readonly noise = new Noise(0x7215e)
  private low = 0
  private band = 0
  private samples = 0
  private gatePhase = 0
  private panPhase = 0

  constructor(private readonly sampleRate: number) {}

  /** Recale le rythme sur le début de la lecture. */
  resetPhase() {
    this.samples = 0
    this.gatePhase = 0
  }

  /**
   * mode : RiserMode ; pos, reso, shape, level : 0..1 ; tempo en BPM.
   */
  process(mode: number, pos: number, reso: number, shape: number, level: number, tempo: number) {
    this.samples++
    if (mode === RiserMode.Off || level <= 0 || pos <= 0 || pos >= 1) {
      this.left = this.right = 0
      return
    }
    const rising = pos <= 0.5
    // Intensité 0..1 dans chaque moitié de course
    const amount = rising ? pos * 2 : (1 - pos) * 2

    // Passe-bande à variables d'état ; la fréquence monte avec r, puis redescend vers d.0
    const cutoff = 150 * Math.pow(2, amount * 5.5)
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, this.sampleRate / 6)) / this.sampleRate)
    const q = 1 / (0.7 + reso * 12)
    const x = this.noise.next()
    this.low += f * this.band
    const high = x - this.low - q * this.band
    this.band += f * high
    let y = this.band * (0.6 + reso)

    let gain = amount
    let pan = 0
    if (rising && mode === RiserMode.Sync) {
      // Contretemps des noires : la seconde moitié de chaque temps
      const beat = frac((this.samples / this.sampleRate) * (tempo / 60))
      gain *= beat >= 0.5 ? envelope((beat - 0.5) * 2, shape) : 0
    } else if (rising && mode === RiserMode.Quiv) {
      // Bouffées de 2 à 32 par seconde à mesure que r augmente
      this.gatePhase = frac(this.gatePhase + (2 * Math.pow(2, amount * 4)) / this.sampleRate)
      gain *= this.gatePhase < 0.5 ? envelope(this.gatePhase * 2, shape) : 0
    } else if (mode === RiserMode.QvPn) {
      // Balayage gauche-droite de 0,5 à 16 Hz
      this.panPhase = frac(this.panPhase + (0.5 * Math.pow(2, amount * 5)) / this.sampleRate)
      pan = Math.sin(2 * Math.PI * this.panPhase)
    }

    y *= gain * level * level * 0.5
    // Panoramique à puissance constante
    const angle = ((pan + 1) * Math.PI) / 4
    this.left = y * Math.cos(angle) * Math.SQRT2
    this.right = y * Math.sin(angle) * Math.SQRT2
  }
}
