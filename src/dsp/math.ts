export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12)

/** Correction PolyBLEP pour une discontinuité de +2 à la phase 0. t et dt normalisés (0..1). */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

/** Approximation rationnelle de tanh, précise et bornée à ±1. */
export function fastTanh(x: number): number {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

/** Coefficient d'un filtre à un pôle pour une constante de temps donnée (secondes). */
export const onePoleCoef = (tau: number, sampleRate: number) =>
  tau <= 0 ? 0 : Math.exp(-1 / (tau * sampleRate))

/** Lissage à un pôle pour éviter les « zipper noises » sur les paramètres. */
export class Smoother {
  value: number
  private coef: number

  constructor(initial: number, timeSec: number, sampleRate: number) {
    this.value = initial
    this.coef = onePoleCoef(timeSec, sampleRate)
  }

  next(target: number): number {
    this.value = target + (this.value - target) * this.coef
    return this.value
  }
}
