import { Noise } from './osc'

/** Ordre du panneau S-1 (manuel v1.02, section LFO). */
export const LfoWave = { Saw: 0, InvSaw: 1, Triangle: 2, Square: 3, Random: 4, Noise: 5 } as const

/**
 * LFO global, partagé par toutes les voix comme sur la machine.
 * `wrapped` passe à true sur l'échantillon où un cycle se termine (utilisé par ENV TRG = LFO).
 */
export class Lfo {
  phase = 0
  wrapped = false
  private held = 0
  private readonly noise = new Noise(0x2545f491)

  /** Key Trigger : repart du début du cycle à chaque note. */
  reset() {
    this.phase = 0
    this.held = this.noise.next()
  }

  process(rateHz: number, wave: number, sampleRate: number): number {
    this.phase += rateHz / sampleRate
    this.wrapped = false
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase)
      this.wrapped = true
      this.held = this.noise.next()
    }
    const p = this.phase
    switch (wave) {
      case LfoWave.Saw:
        return 2 * p - 1
      case LfoWave.InvSaw:
        return 1 - 2 * p
      case LfoWave.Triangle:
        return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
      case LfoWave.Square:
        return p < 0.5 ? 1 : -1
      case LfoWave.Random:
        return this.held
      default:
        return this.noise.next()
    }
  }
}
