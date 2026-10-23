import { CHOP_NONE, decodeDrawPoints, DRAW_STEPS, INIT_DRAW_FORM } from '../dsp/draw'
import { highCutFromPrm, mapTempo, PARAMS, tempoToUnit, type ParamId } from '../dsp/params'
import {
  BEND_MOTION,
  emptyMotionValues,
  emptyPattern,
  MAX_MOTIONS,
  MAX_NOTES_PER_STEP,
  MAX_STEPS,
  type Motion,
  type Pattern,
  type Step,
} from '../dsp/sequencer'
import { CC_MAP } from './midi'

/*
 * Fichiers .PRM du S-1 : backup d'un pattern (son + séquence), en texte, une ligne `CLÉ\t= valeur` par entrée.
 * Roland ne publie pas le format. Encodages des paramètres d'après la doc de S1Utility (docs/PRM_FORMAT.md),
 * vérifiés sur des backups réels. Structure des motions déduite de backups contenant des motions actives :
 * `STEP_MOTION <pas><sous-position>` (pas 1..64, sous-position 1..8), M1..M8 = valeurs CC 0..127 des
 * emplacements MOTION_CC1..8, -1 = pas de valeur. Encodage du pitch bend (PB) jamais observé actif : supposé ±8192.
 *
 * À l'export, le fichier importé sert de base : les clés que l'app ne modélise pas (DELAY_SW, PRM1..11…)
 * et les valeurs inchangées sont recopiées telles quelles, pour un aller-retour sans perte.
 */

export interface PrmState {
  values: Record<ParamId, number>
  pattern: Pattern
  drawForm: number[]
  chopMasks: number[]
}

export interface PrmImport {
  /** Seuls les paramètres présents dans le .PRM ; les autres (Priority, Arp On…) restent tels quels. */
  values: Partial<Record<ParamId, number>>
  pattern: Pattern
  drawForm: number[]
  chopMasks: number[]
  warnings: string[]
}

export interface PrmExport {
  text: string
  warnings: string[]
}

interface Codec {
  key: string
  id: ParamId
  read: (raw: number) => number
  write: (v: number) => number
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const stepsOf = (id: ParamId) => PARAMS.find((p) => p.id === id)?.steps ?? 1

/** Valeur 0..max ↔ slider 0..1. */
const lin = (key: string, id: ParamId, max: number): Codec => ({
  key,
  id,
  read: (raw) => clamp(raw / max, 0, 1),
  write: (v) => Math.round(clamp(v, 0, 1) * max),
})

/** Index de sélecteur, même ordre que le panneau. */
const direct = (key: string, id: ParamId): Codec => ({
  key,
  id,
  read: (raw) => clamp(Math.round(raw), 0, stepsOf(id) - 1),
  write: (v) => Math.round(v),
})

/** Index de sélecteur dans l'ordre de la machine ; order[index machine] = index du panneau. */
const ordered = (key: string, id: ParamId, order: number[]): Codec => ({
  key,
  id,
  read: (raw) => order[clamp(Math.round(raw), 0, order.length - 1)],
  write: (v) => Math.max(0, order.indexOf(Math.round(v))),
})

/** Multiply et Comb : 7..255 = 1.0..32.0 (S1Utility, vérifié sur 64 backups). */
const anchored = (key: string, id: ParamId): Codec => ({
  key,
  id,
  read: (raw) => clamp((raw - 7) / 248, 0, 1),
  write: (v) => 7 + Math.round(clamp(v, 0, 1) * 248),
})

/** Key Shift : demi-tons signés ; index 12 du panneau = 0. */
const shift = (key: string, id: ParamId): Codec => ({
  key,
  id,
  read: (raw) => clamp(Math.round(raw) + 12, 0, 24),
  write: (v) => Math.round(v) - 12,
})

/** High Cut : le .PRM a un « Flat » en tête (0) en plus de celui de fin. */
const highCut = (key: string, id: ParamId): Codec => ({
  key,
  id,
  read: highCutFromPrm,
  write: (v) => Math.round(v) + 1,
})

const CODECS: Codec[] = [
  // Séquenceur
  direct('SCALE', 'stepScale'),
  lin('LEVEL', 'volume', 127),
  { key: 'TEMPO', id: 'tempo', read: (raw) => clamp(tempoToUnit(raw / 100), 0, 1), write: (v) => Math.round(mapTempo(v) * 100) },
  lin('SHUFFLE', 'shuffle', 50),
  direct('ARP_TYPE', 'arpType'),
  direct('ARP_RATE', 'arpRate'),
  // Son
  lin('LFO_RATE', 'lfoRate', 255),
  direct('LFO_WAVE_FORM', 'lfoWave'),
  lin('VCO_MOD_DEPTH', 'oscLfo', 255),
  direct('VCO_RANGE', 'range'),
  lin('VCO_PULSE_WIDTH', 'pulseWidth', 255),
  direct('VCO_PWM_SOURCE', 'pwmSource'),
  lin('VCO_PWM_LEVEL', 'pulseLevel', 255),
  lin('VCO_SAW_LEVEL', 'sawLevel', 255),
  lin('VCO_SUB_LEVEL', 'subLevel', 255),
  direct('VCO_SUB_TYPE', 'subMode'),
  lin('VCO_NOISE_LEVEL', 'noiseLevel', 255),
  lin('VCF_CUTOFF', 'cutoff', 255),
  lin('VCF_RESONANCE', 'resonance', 255),
  lin('VCF_ENV_DEPTH', 'envMod', 255),
  lin('VCF_MOD_DEPTH', 'filterLfo', 255),
  lin('VCF_KEY_FOLLOW', 'keyFollow', 255),
  direct('VCA_ENV_MODE', 'vcaMode'),
  direct('ENV_TRG_MODE', 'envTrigger'),
  lin('ENV_ATTACK', 'attack', 255),
  lin('ENV_DECAY', 'decay', 255),
  lin('ENV_SUSTAIN', 'sustain', 255),
  lin('ENV_RELEASE', 'release', 255),
  // Machine : Mono, Unison, Poly, Chord → panneau : Poly, Mono, Unison, Chord
  ordered('ASSIGN_MODE', 'voiceMode', [1, 2, 0, 3]),
  direct('CHORD_VOICE2_SW', 'chord2On'),
  direct('CHORD_VOICE3_SW', 'chord3On'),
  direct('CHORD_VOICE4_SW', 'chord4On'),
  shift('CHORD_VOICE2_KEY_SHIFT', 'chord2Shift'),
  shift('CHORD_VOICE3_KEY_SHIFT', 'chord3Shift'),
  shift('CHORD_VOICE4_KEY_SHIFT', 'chord4Shift'),
  lin('VCO_BEND_SENS', 'oscBendSens', 240),
  lin('VCF_BEND_SENS', 'filterBendSens', 255),
  lin('LFO_MOD_DEPTH', 'modDepth', 255),
  // Machine : Off, Auto, On → panneau : Off, On, Auto
  ordered('PORTAMENTO_MODE', 'portaMode', [0, 2, 1]),
  lin('PORTAMENTO_TIME', 'portaTime', 255),
  direct('NOISE_MODE', 'noiseMode'),
  direct('LFO_MODE', 'lfoMode'),
  lin('FINE_TUNE', 'fineTune', 255),
  direct('TEMPO_SYNC', 'delaySync'),
  direct('CHORUS', 'chorusType'),
  lin('DELAY_LEVEL', 'delayLevel', 255),
  lin('DELAY_TIME', 'delayTime', 255),
  direct('DELAY_TEMPO', 'delayNote'),
  lin('DELAY_FEEDBACK', 'delayFeedback', 255),
  direct('DELAY_LOW_CUT', 'delayLowCut'),
  highCut('DELAY_HIGH_CUT', 'delayHighCut'),
  direct('REVERB_TYPE', 'reverbType'),
  lin('REVERB_TIME', 'reverbTime', 255),
  lin('REVERB_LEVEL', 'reverbLevel', 255),
  lin('REVERB_PRE_DELAY', 'reverbPreDelay', 100),
  direct('REVERB_LOW_CUT', 'reverbLowCut'),
  highCut('REVERB_HIGH_CUT', 'reverbHighCut'),
  direct('REVERB_DENSITY', 'reverbDensity'),
  direct('OSC_DRAW_SW', 'drawMode'),
  anchored('OSC_DRAW_MULT', 'drawMult'),
  lin('OSC_CHOP_OVERTONE', 'chopOvertone', 200),
  anchored('OSC_CHOP_COMB', 'chopComb'),
  direct('RISER_MODE', 'riserMode'),
  lin('RISER_RESO', 'riserReso', 100),
  lin('RISER_LEVEL', 'riserLevel', 100),
  direct('DM_ASSIGN_X', 'dmX'),
  direct('DM_ASSIGN_Y', 'dmY'),
  direct('DM_SENS_X', 'dmSensX'),
  direct('DM_SENS_Y', 'dmSensY'),
  direct('LFO_KEY_TRIG', 'lfoKeyTrig'),
  direct('LFO_SYNC', 'lfoSync'),
  lin('RISER_SHAPE', 'riserShape', 100),
]

const CHOP_KEYS = ['OSC_CHOP_PWM', 'OSC_CHOP_SAW', 'OSC_CHOP_SUB', 'OSC_CHOP_NOISE']
const DRAW_KEYS = Array.from({ length: DRAW_STEPS / 2 }, (_, i) => `OSC_DRAW_P${i + 1}`)
const MOTION_CC_KEYS = Array.from({ length: MAX_MOTIONS }, (_, i) => `MOTION_CC${i + 1}`)
const SUB_POSITIONS = 8
const NO_MOTION = -1
const NO_BEND = -32768
const BEND_RANGE = 8192

/** Ordre et valeurs INIT des clés d'en-tête, comme dans les backups de la machine. Sert de base sans fichier importé. */
const INIT_HEADER: [string, number][] = [
  ['LENG', 16], ['SCALE', 1], ['TRANSPOSE', 0], ['LEVEL', 70], ['TEMPO', 10000], ['SHUFFLE', 0], ['ARP_TYPE', 0], ['ARP_RATE', 2],
  ...MOTION_CC_KEYS.map((k): [string, number] => [k, -1]),
  ['LFO_RATE', 120], ['LFO_WAVE_FORM', 2], ['VCO_MOD_DEPTH', 0], ['VCO_RANGE', 2], ['VCO_PULSE_WIDTH', 0], ['VCO_PWM_SOURCE', 2],
  ['VCO_PWM_LEVEL', 255], ['VCO_SAW_LEVEL', 0], ['VCO_SUB_LEVEL', 0], ['VCO_SUB_TYPE', 2], ['VCO_NOISE_LEVEL', 0],
  ['VCF_CUTOFF', 255], ['VCF_RESONANCE', 0], ['VCF_ENV_DEPTH', 0], ['VCF_MOD_DEPTH', 0], ['VCF_KEY_FOLLOW', 0],
  ['VCA_ENV_MODE', 1], ['ENV_TRG_MODE', 2], ['ENV_ATTACK', 0], ['ENV_DECAY', 84], ['ENV_SUSTAIN', 51], ['ENV_RELEASE', 42],
  ['ASSIGN_MODE', 2], ['CHORD_VOICE2_SW', 1], ['CHORD_VOICE3_SW', 1], ['CHORD_VOICE4_SW', 1],
  ['CHORD_VOICE2_KEY_SHIFT', 12], ['CHORD_VOICE3_KEY_SHIFT', 7], ['CHORD_VOICE4_KEY_SHIFT', 5],
  ['VCO_BEND_SENS', 20], ['VCF_BEND_SENS', 0], ['LFO_MOD_DEPTH', 30], ['PORTAMENTO_MODE', 0], ['PORTAMENTO_TIME', 30],
  ['NOISE_MODE', 0], ['LFO_MODE', 0], ['FINE_TUNE', 128], ['TEMPO_SYNC', 1], ['CHORUS', 0],
  ['DELAY_LEVEL', 0], ['DELAY_TIME', 174], ['DELAY_TEMPO', 14], ['DELAY_FEEDBACK', 136], ['DELAY_LOW_CUT', 12], ['DELAY_HIGH_CUT', 14],
  ['DELAY_SW', 1], ['REVERB_TYPE', 5], ['REVERB_TIME', 200], ['REVERB_LEVEL', 0], ['REVERB_PRE_DELAY', 20],
  ['REVERB_LOW_CUT', 12], ['REVERB_HIGH_CUT', 13], ['REVERB_DENSITY', 10], ['OSC_DRAW_SW', 0], ['OSC_DRAW_MULT', 7],
  ...DRAW_KEYS.map((k): [string, number] => [k, 0]),
  ['OSC_CHOP_TYPE', 0], ['OSC_CHOP_OVERTONE', 100], ['OSC_CHOP_COMB_TYPE', 0], ['OSC_CHOP_COMB', 7],
  ...CHOP_KEYS.map((k): [string, number] => [k, CHOP_NONE]),
  ['RISER_MODE', 0], ['RISER_SW', 0], ['RISER_CTRL', 0], ['RISER_BEAT', 0], ['RISER_RESO', 50], ['RISER_LEVEL', 70],
  ['DM_ASSIGN_X', 5], ['DM_ASSIGN_Y', 6], ['DM_ASSIGN_TAP', 0], ['DM_ASSIGN_FF', 0], ['DM_SENS_X', 5], ['DM_SENS_Y', 5],
  ['LFO_KEY_TRIG', 0], ['LFO_SYNC', 0], ['RISER_SHAPE', 0],
  ...Array.from({ length: 11 }, (_, i): [string, number] => [`PRM${i + 1}`, 0]),
]

const noteKey = (step: number) => `STEP_NOTE ${step + 1}`
const motionKey = (step: number, sub: number) => `STEP_MOTION ${step + 1}${sub + 1}`

/** Fichier .PRM lu en conservant l'ordre des clés (pour réécrire au même endroit). */
class PrmDoc {
  readonly keys: string[] = []
  readonly map = new Map<string, string>()
  eol = '\n'

  static parse(text: string): PrmDoc {
    const doc = new PrmDoc()
    if (text.includes('\r\n')) doc.eol = '\r\n'
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith(';') || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 1) continue
      doc.set(t.slice(0, eq).trim().toUpperCase().replace(/\s+/g, ' '), t.slice(eq + 1).trim())
    }
    return doc
  }

  static init(): PrmDoc {
    const doc = new PrmDoc()
    for (const [k, v] of INIT_HEADER) doc.set(k, String(v))
    return doc
  }

  get(key: string) {
    return this.map.get(key)
  }

  num(key: string): number | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : undefined
  }

  set(key: string, value: string) {
    if (!this.map.has(key)) this.keys.push(key)
    this.map.set(key, value)
  }

  toString() {
    return this.keys.map((k) => `${k}\t= ${this.map.get(k)}`).join(this.eol) + this.eol
  }
}

/** Champs `NOM=valeur` d'une ligne de pas. */
function fields(value: string | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const part of (value ?? '').split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const n = parseInt(part.slice(eq + 1), 10)
    if (Number.isFinite(n)) out.set(part.slice(0, eq).toUpperCase(), n)
  }
  return out
}

function readStep(value: string | undefined): { step: Step; subStep: number } {
  const f = fields(value)
  const notes = []
  for (let k = 1; k <= MAX_NOTES_PER_STEP; k++) {
    const note = f.get(`NOTE${k}`) ?? -1
    if (note < 0 || note > 127) continue
    notes.push({ note, velocity: clamp(f.get(`VELO${k}`) ?? 100, 1, 127), gate: clamp(f.get(`LENG${k}`) ?? 100, 1, 100) })
  }
  // PROB : 0..10 (dizaines de %)
  const probability = clamp((f.get('PROB') ?? 10) * 10, 0, 100)
  return { step: { notes, probability, subSteps: [true], tie: false }, subStep: f.get('SUBSTEP') ?? 0 }
}

function writeStep(step: Step, subStep: number): string {
  const parts: string[] = []
  for (let k = 0; k < MAX_NOTES_PER_STEP; k++) {
    const n = step.notes[k]
    parts.push(n ? `NOTE${k + 1}=${n.note} VELO${k + 1}=${n.velocity} LENG${k + 1}=${n.gate}` : `NOTE${k + 1}=-1 VELO${k + 1}=0 LENG${k + 1}=0`)
  }
  parts.push(`SUBSTEP=${subStep}`, `PROB=${clamp(Math.round(step.probability / 10), 0, 10)}`)
  return parts.join(' ')
}

const sameStep = (a: Step, b: Step) =>
  a.probability === b.probability &&
  a.tie === b.tie &&
  a.subSteps.length === b.subSteps.length &&
  a.subSteps.every((x, i) => x === b.subSteps[i]) &&
  a.notes.length === b.notes.length &&
  a.notes.every((n, i) => n.note === b.notes[i].note && n.velocity === b.notes[i].velocity && n.gate === b.notes[i].gate)

/** Valeurs brutes d'un emplacement de motion (M1..M8 ou PB) sur les 8 sous-positions d'un pas. */
function motionRaw(doc: PrmDoc, step: number, field: string, none: number): number[] {
  return Array.from({ length: SUB_POSITIONS }, (_, sub) => fields(doc.get(motionKey(step, sub))).get(field) ?? none)
}

/** CC d'un paramètre, pour l'export des motions. */
function ccOf(param: string): number | undefined {
  for (const [cc, [id]] of Object.entries(CC_MAP)) if (id === param) return Number(cc)
  return undefined
}

/** Valeur CC dont le décodage est le plus proche de v (marche pour les sliders comme pour les sélecteurs). */
function encodeCc(cc: number, v: number): number {
  const decode = CC_MAP[cc][1]
  let best = 0
  for (let x = 1; x <= 127; x++) if (Math.abs(decode(x) - v) < Math.abs(decode(best) - v)) best = x
  return best
}

const decodeBend = (raw: number) => clamp(raw / BEND_RANGE, -1, 1)
const encodeBend = (v: number) => clamp(Math.round(v * BEND_RANGE), -BEND_RANGE, BEND_RANGE - 1)

/** Lit un .PRM : réglages, séquence, motions, forme Draw et motifs Chop. */
export function importPrm(text: string): PrmImport {
  const doc = PrmDoc.parse(text)
  if (doc.get('VCF_CUTOFF') === undefined && doc.get(noteKey(0)) === undefined) {
    throw new Error('Ce fichier ne ressemble pas à un .PRM du S-1.')
  }
  const warnings: string[] = []

  const values: Partial<Record<ParamId, number>> = {}
  for (const c of CODECS) {
    const raw = doc.num(c.key)
    if (raw !== undefined) values[c.id] = c.read(raw)
  }

  const pattern = emptyPattern(clamp(doc.num('LENG') ?? 16, 1, MAX_STEPS))
  pattern.transpose = clamp(doc.num('TRANSPOSE') ?? 0, -60, 60)
  const subStepped: number[] = []
  for (let i = 0; i < MAX_STEPS; i++) {
    const { step, subStep } = readStep(doc.get(noteKey(i)))
    pattern.steps[i] = step
    if (subStep !== 0) subStepped.push(i + 1)
  }
  if (subStepped.length) {
    warnings.push(`Sub-steps non importés (encodage inconnu) sur les pas ${subStepped.join(', ')} : conservés à l'export si le pas n'est pas modifié.`)
  }

  // Motions : l'app a une valeur par pas ; on garde la première sous-position renseignée
  let lossy = 0
  const readLane = (field: string, none: number, decode: (raw: number) => number): (number | null)[] | null => {
    const out = emptyMotionValues()
    let any = false
    for (let i = 0; i < MAX_STEPS; i++) {
      const active = motionRaw(doc, i, field, none).filter((x) => x !== none)
      if (!active.length) continue
      out[i] = decode(active[0])
      any = true
      if (active.some((x) => x !== active[0])) lossy++
    }
    return any ? out : null
  }

  MOTION_CC_KEYS.forEach((key, k) => {
    const cc = doc.num(key) ?? -1
    if (cc < 0) return
    const entry = CC_MAP[cc]
    if (!entry) {
      warnings.push(`Motion ${k + 1} (CC ${cc}) : paramètre non géré par l'app, ignorée.`)
      return
    }
    const [id, decode] = entry
    if (pattern.motions.some((m) => m.param === id)) return
    const lane = readLane(`M${k + 1}`, NO_MOTION, decode)
    if (lane) pattern.motions.push({ param: id, values: lane })
  })
  const bend = readLane('PB', NO_BEND, decodeBend)
  if (bend) {
    pattern.motions.push({ param: BEND_MOTION, values: bend })
    warnings.push('Motion de pitch bend importée avec un encodage supposé (jamais vérifié sur machine).')
  }
  if (lossy) {
    warnings.push(`${lossy} pas de motion ont plusieurs valeurs dans le pas (8 sous-positions sur la machine) : seule la première est gardée.`)
  }

  const drawRaw = DRAW_KEYS.map((k) => doc.num(k))
  const drawForm = drawRaw.every((x) => x !== undefined) ? decodeDrawPoints(drawRaw as number[]) : [...INIT_DRAW_FORM]
  const chopMasks = CHOP_KEYS.map((k) => clamp(doc.num(k) ?? CHOP_NONE, 0, 0xffff))

  return { values, pattern, drawForm, chopMasks, warnings }
}

/** Encodage .PRM de la forme Draw : deux pas par clé, octets signés, octet bas d'abord. */
function encodeDrawPoints(form: number[]): number[] {
  const byte = (v: number) => clamp(Math.round(v), -100, 100) & 0xff
  return DRAW_KEYS.map((_, i) => byte(form[2 * i] ?? 0) | (byte(form[2 * i + 1] ?? 0) << 8))
}

/**
 * Écrit l'état courant en .PRM. `base` : texte du fichier importé, dont on garde les clés inconnues
 * et les valeurs que l'app n'a pas modifiées. Sans base, on part du patch INIT de la machine.
 */
export function exportPrm(state: PrmState, base?: string): PrmExport {
  const doc = base ? PrmDoc.parse(base) : PrmDoc.init()
  const warnings: string[] = []
  const { values, pattern } = state

  // Valeur inchangée côté app : on garde la valeur brute du fichier (arrondis, doubles encodages comme Flat)
  const put = (c: Codec, v: number) => {
    const old = doc.num(c.key)
    if (old !== undefined && Math.abs(c.read(old) - v) < 1e-9) return
    doc.set(c.key, String(c.write(v)))
  }

  doc.set('LENG', String(pattern.length))
  doc.set('TRANSPOSE', String(pattern.transpose))
  for (const c of CODECS) put(c, values[c.id])

  encodeDrawPoints(state.drawForm).forEach((raw, i) => doc.set(DRAW_KEYS[i], String(raw)))
  CHOP_KEYS.forEach((k, i) => doc.set(k, String(state.chopMasks[i] ?? CHOP_NONE)))

  // Pas : la ligne d'origine est gardée si le pas n'a pas changé (sub-steps inconnus compris)
  const ties: number[] = []
  const subs: number[] = []
  for (let i = 0; i < MAX_STEPS; i++) {
    const step = pattern.steps[i]
    if (step.tie) ties.push(i + 1)
    const old = doc.get(noteKey(i))
    if (old !== undefined && sameStep(readStep(old).step, step)) continue
    if (step.subSteps.length > 1) subs.push(i + 1)
    doc.set(noteKey(i), writeStep(step, 0))
  }
  if (ties.length) warnings.push(`Tie non exporté (encodage inconnu) sur les pas ${ties.join(', ')}.`)
  if (subs.length) warnings.push(`Sub-steps non exportés (encodage inconnu) sur les pas ${subs.join(', ')}.`)

  // Motions : un emplacement MOTION_CCn par paramètre, valeur sur la 1re sous-position du pas
  const lanes: { field: string; none: number; old: number; values: (number | null)[]; encode: (v: number) => number; decode: (raw: number) => number }[] = []
  const slots = MOTION_CC_KEYS.map(() => -1)
  let slot = 0
  for (const m of pattern.motions as Motion[]) {
    if (m.param === BEND_MOTION) continue
    const cc = ccOf(m.param)
    if (cc === undefined) {
      warnings.push(`Motion « ${PARAMS.find((p) => p.id === m.param)?.label ?? m.param} » non exportée : ce paramètre n'a pas de CC sur le S-1.`)
      continue
    }
    if (slot >= MAX_MOTIONS) break
    const field = `M${slot + 1}`
    lanes.push({ field, none: NO_MOTION, old: doc.num(MOTION_CC_KEYS[slot]) ?? -1, values: m.values, encode: (v) => encodeCc(cc, v), decode: CC_MAP[cc][1] })
    slots[slot++] = cc
  }
  for (let k = slot; k < MAX_MOTIONS; k++) {
    lanes.push({ field: `M${k + 1}`, none: NO_MOTION, old: doc.num(MOTION_CC_KEYS[k]) ?? -1, values: emptyMotionValues(), encode: () => NO_MOTION, decode: () => 0 })
  }
  const bend = pattern.motions.find((m) => m.param === BEND_MOTION)
  lanes.push({ field: 'PB', none: NO_BEND, old: 0, values: bend?.values ?? emptyMotionValues(), encode: encodeBend, decode: decodeBend })
  if (bend) warnings.push('Motion de pitch bend exportée avec un encodage supposé (jamais vérifié sur machine).')

  const motionCcChanged = lanes.map((l, k) => k < MAX_MOTIONS && l.old !== slots[k])
  slots.forEach((cc, k) => doc.set(MOTION_CC_KEYS[k], String(cc)))

  for (let i = 0; i < MAX_STEPS; i++) {
    const raws = lanes.map((lane, k) => {
      const old = motionRaw(doc, i, lane.field, lane.none)
      const firstOld = old.find((x) => x !== lane.none)
      const v = lane.values[i]
      // Pas inchangé : les 8 sous-positions d'origine sont gardées
      if (!motionCcChanged[k]) {
        if (v === null && firstOld === undefined) return old
        if (v !== null && firstOld !== undefined && Math.abs(lane.decode(firstOld) - v) < 1e-9) return old
      }
      const fresh = old.map(() => lane.none)
      if (v !== null) fresh[0] = lane.encode(v)
      return fresh
    })
    for (let sub = 0; sub < SUB_POSITIONS; sub++) {
      doc.set(motionKey(i, sub), lanes.map((lane, k) => `${lane.field}=${raws[k][sub]}`).join(' '))
    }
  }

  return { text: doc.toString(), warnings }
}
