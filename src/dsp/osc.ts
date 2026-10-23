import { polyBlep } from './math'

/** Ordre de la machine (manuel S-1 : -2o.A, -2oc, -1oc). */
export const SubMode = {
  OctDown2Pulse: 0, // pulse 25 % -2 octaves (asymétrique)
  OctDown2: 1, // carré -2 octaves
  OctDown1: 2, // carré -1 octave
} as const

export interface OscFrame {
  saw: number
  pulse: number
  sub: number
}

const naivePulse = (phase: number, width: number) => (phase < width ? 1 : -1)

function blepPulse(phase: number, dt: number, width: number): number {
  let y = naivePulse(phase, width)
  y += polyBlep(phase, dt)
  let t = phase - width
  if (t < 0) t += 1
  y -= polyBlep(t, dt)
  return y
}

/**
 * Oscillateur type SH-101 : un seul phaseur produit la dent de scie et le pulse.
 * Le sub est dérivé du même phaseur (compteur de cycles), donc verrouillé en phase.
 */
export class Oscillator {
  phase = 0
  /** Phase et incrément de l'échantillon qui vient d'être produit (pour Draw et Chop). */
  lastPhase = 0
  lastDt = 0
  private cycle = 0
  readonly frame: OscFrame = { saw: 0, pulse: 0, sub: 0 }

  reset() {
    this.phase = 0
    this.cycle = 0
  }

  /** freq en Hz, width = rapport cyclique du pulse (0.05..0.5). */
  process(freq: number, width: number, subMode: number, sampleRate: number): OscFrame {
    const dt = Math.min(freq / sampleRate, 0.5)
    const phase = this.phase
    this.lastPhase = phase
    this.lastDt = dt
    const f = this.frame

    f.saw = 2 * phase - 1 - polyBlep(phase, dt)
    f.pulse = blepPulse(phase, dt, width)

    const div = subMode === SubMode.OctDown1 ? 2 : 4
    const subPhase = ((this.cycle % div) + phase) / div
    const subWidth = subMode === SubMode.OctDown2Pulse ? 0.25 : 0.5
    f.sub = blepPulse(subPhase, dt / div, subWidth)

    this.phase += dt
    if (this.phase >= 1) {
      this.phase -= 1
      this.cycle = (this.cycle + 1) % 4
    }
    return f
  }
}

/** Bruit blanc xorshift32, déterministe et sans allocation. */
export class Noise {
  private state: number

  constructor(seed = 0x9e3779b9) {
    this.state = seed | 0 || 1
  }

  next(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x
    return (x >>> 0) / 2147483648 - 1
  }
}

/**
 * Bruit rose (-3 dB/octave) par filtrage du bruit blanc (filtre « economy » de Paul Kellet).
 * Gain ajusté pour un niveau efficace proche du bruit blanc d'entrée.
 */
export class PinkFilter {
  private b0 = 0
  private b1 = 0
  private b2 = 0

  next(white: number): number {
    this.b0 = 0.99765 * this.b0 + white * 0.099046
    this.b1 = 0.963 * this.b1 + white * 0.2965164
    this.b2 = 0.57 * this.b2 + white * 1.0526913
    return (this.b0 + this.b1 + this.b2 + white * 0.1848) * 0.25
  }
}
