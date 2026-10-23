import { clamp, fastTanh } from './math'

/**
 * Passe-bas 4 pôles (24 dB/oct) en topologie ZDF/TPT (Zavalishin, « The Art of VA Filter Design »).
 * La boucle de résonance est résolue sans délai, puis saturée par tanh :
 * c'est ce qui borne l'auto-oscillation et donne la couleur analogique.
 */
export class LadderFilter {
  private s1 = 0
  private s2 = 0
  private s3 = 0
  private s4 = 0

  reset() {
    this.s1 = this.s2 = this.s3 = this.s4 = 0
  }

  /** cutoff en Hz, k = résonance (0..~4.2, auto-oscillation vers 4). */
  process(x: number, cutoff: number, k: number, sampleRate: number): number {
    const fc = clamp(cutoff, 10, sampleRate * 0.45)
    const g = Math.tan((Math.PI * fc) / sampleRate)
    const G = g / (1 + g)
    const beta = 1 / (1 + g)
    const G2 = G * G
    const G4 = G2 * G2

    // Contribution des états à la sortie du 4e étage
    const S = beta * (G2 * G * this.s1 + G2 * this.s2 + G * this.s3 + this.s4)

    // Compensation partielle de la perte de graves quand la résonance monte
    const input = x * (1 + 0.5 * k)
    const u = fastTanh((input - k * S) / (1 + k * G4))

    let v = (u - this.s1) * G
    const y1 = v + this.s1
    this.s1 = y1 + v

    v = (y1 - this.s2) * G
    const y2 = v + this.s2
    this.s2 = y2 + v

    v = (y2 - this.s3) * G
    const y3 = v + this.s3
    this.s3 = y3 + v

    v = (y3 - this.s4) * G
    const y4 = v + this.s4
    this.s4 = y4 + v

    return y4
  }
}
