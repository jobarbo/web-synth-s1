import { polyBlep } from './math'

/*
 * OSC DRAW et OSC CHOP du S-1 (manuel v1.02) :
 * - DRAW : un cycle découpé en 16 pas de -100..+100, joué en marches (Step) ou en pentes (Slope)
 *   à la place du carré (sans PWM). Multiply 1..32 : le cycle dessiné est relu plus vite à l'intérieur
 *   d'une période (effet de synchro), +1 octave à chaque doublement.
 * - CHOP : pour chaque forme (carré, scie, sub, bruit), 16 pas par cycle ; les pas « coupés » sont multipliés
 *   par 1 - Overtone/100 (0 : aucun effet, 100 : muets, 101..200 : phase inversée). Comb répète le motif
 *   dans le cycle. Sans effet au-dessus de 1 kHz (manuel).
 * Les sauts de valeur reçoivent une correction PolyBLEP pour limiter le repliement (aliasing).
 */

export const DRAW_STEPS = 16
export const CHOP_STEPS = 16
/** Masque « aucune coupe » : tous les pas laissent passer l'onde (valeur INIT du .PRM). */
export const CHOP_NONE = 0xffff
export const CHOP_MAX_FREQ = 1000

export const DrawMode = { Off: 0, Step: 1, Slope: 2 } as const

/** Forme INIT de la machine (décodée de OSC_DRAW_P1..P8) : un triangle. */
export const INIT_DRAW_FORM = [-100, -75, -50, -25, 0, 25, 50, 75, 100, 75, 50, 25, 0, -25, -50, -75]

/** Décodage .PRM : chaque OSC_DRAW_Pn (16 bits) contient deux pas en octets signés, octet bas d'abord. */
export function decodeDrawPoints(raw: number[]): number[] {
  const signed = (b: number) => (b > 127 ? b - 256 : b)
  return raw.flatMap((v) => [signed(v & 0xff), signed((v >> 8) & 0xff)])
}

const frac = (x: number) => x - Math.floor(x)

/** Valeur du cycle dessiné à la position u (0..1), en -1..1. */
export function drawValue(table: ArrayLike<number>, slope: boolean, u: number): number {
  const v = frac(u) * DRAW_STEPS
  const i = Math.floor(v) % DRAW_STEPS
  const a = table[i] / 100
  if (!slope) return a
  const b = table[(i + 1) % DRAW_STEPS] / 100
  return a + (b - a) * (v - Math.floor(v))
}

/**
 * Échantillon de l'oscillateur Draw. phase et dt : phaseur de l'oscillateur principal (0..1, incrément).
 * mult : Multiply (1..32).
 */
export function drawSample(table: ArrayLike<number>, slope: boolean, phase: number, dt: number, mult: number): number {
  const u = phase * mult
  let y = drawValue(table, slope, u)

  // Synchro : au début de chaque période, la lecture repart à 0 (saut si Multiply n'est pas entier)
  if (phase < dt || phase > 1 - dt) {
    const jump = drawValue(table, slope, 0) - drawValue(table, slope, mult - 1e-9)
    y += (jump / 2) * polyBlep(phase, dt)
    return y
  }
  if (slope) return y

  // Marches : un saut à chaque frontière de pas
  const v = u * DRAW_STEPS
  const dv = dt * mult * DRAW_STEPS
  if (dv >= 1) return y
  const t = frac(v)
  const seg = Math.floor(v) % DRAW_STEPS
  if (t < dv) {
    const prev = (seg + DRAW_STEPS - 1) % DRAW_STEPS
    y += ((table[seg] - table[prev]) / 200) * polyBlep(t, dv)
  } else if (t > 1 - dv) {
    const next = (seg + 1) % DRAW_STEPS
    y += ((table[next] - table[seg]) / 200) * polyBlep(t, dv)
  }
  return y
}

/** Gain d'un pas pour un masque de coupe : 1 si le pas laisse passer l'onde, sinon `cut`. */
const stepGain = (mask: number, seg: number, cut: number) => ((mask >> seg) & 1 ? 1 : cut)

export interface ChopInput {
  /** Échantillons pondérés par leur niveau de mixage : carré (ou Draw), scie, sub, bruit. */
  square: number
  saw: number
  sub: number
  noise: number
}

/**
 * Mixe les 4 formes en appliquant le motif de coupe de chacune.
 * masks : [carré, scie, sub, bruit] ; overtone 0..200 ; comb 1..32.
 */
export function chopMix(
  x: ChopInput,
  masks: ArrayLike<number>,
  overtone: number,
  comb: number,
  phase: number,
  dt: number,
  freq: number,
): number {
  const plain = x.square + x.saw + x.sub + x.noise
  if (overtone <= 0 || freq > CHOP_MAX_FREQ) return plain
  if (masks[0] === CHOP_NONE && masks[1] === CHOP_NONE && masks[2] === CHOP_NONE && masks[3] === CHOP_NONE) return plain

  const cut = 1 - overtone / 100
  const v = frac(phase * comb) * CHOP_STEPS
  const seg = Math.floor(v) % CHOP_STEPS

  let y = mixAt(x, masks, seg, cut)
  const dv = dt * comb * CHOP_STEPS
  if (dv < 1 && phase >= dt && phase <= 1 - dt) {
    const t = v - Math.floor(v)
    if (t < dv) y += ((y - mixAt(x, masks, (seg + CHOP_STEPS - 1) % CHOP_STEPS, cut)) / 2) * polyBlep(t, dv)
    else if (t > 1 - dv) y += ((mixAt(x, masks, (seg + 1) % CHOP_STEPS, cut) - y) / 2) * polyBlep(t, dv)
  }
  return y
}

function mixAt(x: ChopInput, masks: ArrayLike<number>, seg: number, cut: number) {
  return (
    x.square * stepGain(masks[0], seg, cut) +
    x.saw * stepGain(masks[1], seg, cut) +
    x.sub * stepGain(masks[2], seg, cut) +
    x.noise * stepGain(masks[3], seg, cut)
  )
}
