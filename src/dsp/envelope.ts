import { onePoleCoef } from './math'

const Stage = { Idle: 0, Attack: 1, Decay: 2, Release: 3 } as const
type Stage = (typeof Stage)[keyof typeof Stage]

// L'attaque vise au-dessus de 1, comme la charge d'un condensateur analogique
const ATTACK_TARGET = 1.3
const ATTACK_TAU_RATIO = 1 / Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1))
// Decay et release atteignent -60 dB de leur cible au temps demandé (même protocole que les mesures sur machine)
const DECAY_TAU_RATIO = 1 / Math.log(1000)

/** ADSR à courbes RC exponentielles. Temps en secondes, sustain 0..1. */
export class Envelope {
  value = 0
  private stage: Stage = Stage.Idle
  private attackCoef = 0
  private decayCoef = 0
  private releaseCoef = 0
  private sustain = 0.5

  setParams(attack: number, decay: number, sustain: number, release: number, sampleRate: number) {
    this.attackCoef = onePoleCoef(attack * ATTACK_TAU_RATIO, sampleRate)
    this.decayCoef = onePoleCoef(decay * DECAY_TAU_RATIO, sampleRate)
    this.releaseCoef = onePoleCoef(release * DECAY_TAU_RATIO, sampleRate)
    this.sustain = sustain
  }

  get active() {
    return this.stage !== Stage.Idle
  }

  gateOn() {
    this.stage = Stage.Attack
  }

  gateOff() {
    if (this.stage !== Stage.Idle) this.stage = Stage.Release
  }

  reset() {
    this.stage = Stage.Idle
    this.value = 0
  }

  next(): number {
    switch (this.stage) {
      case Stage.Attack:
        this.value = ATTACK_TARGET + (this.value - ATTACK_TARGET) * this.attackCoef
        if (this.value >= 1) {
          this.value = 1
          this.stage = Stage.Decay
        }
        break
      case Stage.Decay:
        this.value = this.sustain + (this.value - this.sustain) * this.decayCoef
        break
      case Stage.Release:
        this.value *= this.releaseCoef
        if (this.value < 1e-5) {
          this.value = 0
          this.stage = Stage.Idle
        }
        break
    }
    return this.value
  }
}
