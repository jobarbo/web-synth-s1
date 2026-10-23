import { PARAMS, type ParamId } from '../dsp/params'

/*
 * Réception MIDI calée sur la charte d'implémentation MIDI du S-1 (manuel v1.02) :
 * Note On/Off (vélocité ignorée : pas de sensibilité au toucher sur la machine), Pitch Bend,
 * CC1 molette, CC10 pan, CC11 expression, CC64 sustain, CC65 portamento, et les CC des potards (table « Knob assignments »).
 * Les sélecteurs reçoivent leur index directement (0, 1, 2…), comme le fait l'éditeur S1Utility.
 */

export type MidiEvent =
  | { type: 'noteOn'; note: number }
  | { type: 'noteOff'; note: number }
  | { type: 'pitchBend'; value: number }
  | { type: 'modWheel'; value: number }
  | { type: 'hold'; on: boolean }
  | { type: 'allNotesOff' }
  | { type: 'param'; id: ParamId; value: number }
  /** CC10, -1..1 */
  | { type: 'pan'; value: number }
  /** CC11, 0..1 */
  | { type: 'expression'; value: number }

type Decode = (cc: number) => number

const continuous: Decode = (v) => v / 127
const index =
  (steps: number): Decode =>
  (v) =>
    Math.min(steps - 1, v)
const flag: Decode = (v) => (v > 0 ? 1 : 0)
// Ordres d'options côté machine → index de notre panneau
const fromOrder =
  (order: number[]): Decode =>
  (v) =>
    order[Math.min(order.length - 1, v)]
// Key Shift : CC = demi-tons + 64 ; notre index 12 = 0
const keyShift: Decode = (v) => Math.min(24, Math.max(0, v - 64 + 12))

const stepsOf = (id: ParamId) => PARAMS.find((p) => p.id === id)?.steps ?? 1

export const CC_MAP: Record<number, [ParamId, Decode]> = {
  3: ['lfoRate', continuous],
  5: ['portaTime', continuous],
  12: ['lfoWave', index(stepsOf('lfoWave'))],
  13: ['oscLfo', continuous],
  14: ['range', index(stepsOf('range'))],
  15: ['pulseWidth', continuous],
  16: ['pwmSource', index(stepsOf('pwmSource'))],
  17: ['modDepth', continuous],
  18: ['oscBendSens', continuous],
  19: ['pulseLevel', continuous],
  20: ['sawLevel', continuous],
  21: ['subLevel', continuous],
  22: ['subMode', index(stepsOf('subMode'))],
  23: ['noiseLevel', continuous],
  24: ['envMod', continuous],
  25: ['filterLfo', continuous],
  26: ['keyFollow', continuous],
  27: ['filterBendSens', continuous],
  28: ['vcaMode', index(stepsOf('vcaMode'))],
  29: ['envTrigger', index(stepsOf('envTrigger'))],
  30: ['sustain', continuous],
  // Machine : Off, Auto, On → panneau : Off, On, Auto
  31: ['portaMode', fromOrder([0, 2, 1])],
  71: ['resonance', continuous],
  72: ['release', continuous],
  73: ['attack', continuous],
  74: ['cutoff', continuous],
  75: ['decay', continuous],
  76: ['fineTune', continuous],
  78: ['noiseMode', index(stepsOf('noiseMode'))],
  79: ['lfoMode', index(stepsOf('lfoMode'))],
  // Machine : Mono, Unison, Poly, Chord → panneau : Poly, Mono, Unison, Chord
  80: ['voiceMode', fromOrder([1, 2, 0, 3])],
  81: ['chord2On', flag],
  82: ['chord3On', flag],
  83: ['chord4On', flag],
  85: ['chord2Shift', keyShift],
  86: ['chord3Shift', keyShift],
  87: ['chord4Shift', keyShift],
  89: ['reverbTime', continuous],
  90: ['delayTime', continuous],
  91: ['reverbLevel', continuous],
  92: ['delayLevel', continuous],
  93: ['chorusType', index(stepsOf('chorusType'))],
  102: ['drawMult', continuous],
  103: ['chopOvertone', continuous],
  104: ['chopComb', continuous],
  105: ['lfoKeyTrig', index(stepsOf('lfoKeyTrig'))],
  106: ['lfoSync', index(stepsOf('lfoSync'))],
  107: ['drawMode', index(stepsOf('drawMode'))],
}

/** Canal par défaut de la partie synthé du S-1. 0 = omni (tous les canaux). */
export const S1_DEFAULT_CHANNEL = 3

/**
 * Décode un message MIDI brut. `channel` : 1..16, ou 0 pour accepter tous les canaux.
 * Retourne null pour les messages ignorés.
 */
export function parseMidi(data: ArrayLike<number>, channel: number): MidiEvent | null {
  const status = data[0] ?? 0
  if (status < 0x80 || status >= 0xf0) return null
  if (channel !== 0 && (status & 0x0f) + 1 !== channel) return null
  const d1 = data[1] ?? 0
  const d2 = data[2] ?? 0

  switch (status & 0xf0) {
    case 0x90:
      return d2 > 0 ? { type: 'noteOn', note: d1 } : { type: 'noteOff', note: d1 }
    case 0x80:
      return { type: 'noteOff', note: d1 }
    case 0xe0:
      return { type: 'pitchBend', value: Math.max(-1, (((d2 << 7) | d1) - 8192) / 8192) }
    case 0xb0:
      return parseControlChange(d1, d2)
    default:
      return null
  }
}

function parseControlChange(cc: number, v: number): MidiEvent | null {
  switch (cc) {
    case 1:
      return { type: 'modWheel', value: v / 127 }
    case 10:
      return { type: 'pan', value: (v - 64) / 64 }
    case 11:
      return { type: 'expression', value: v / 127 }
    case 64:
      return { type: 'hold', on: v >= 64 }
    case 65:
      // Portamento On/Off : Off ou On (pas Auto)
      return { type: 'param', id: 'portaMode', value: v >= 64 ? 1 : 0 }
    case 120:
    case 123:
      return { type: 'allNotesOff' }
  }
  const entry = CC_MAP[cc]
  return entry ? { type: 'param', id: entry[0], value: entry[1](v) } : null
}

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

/** Accès Web MIDI : liste des entrées, sélection et canal. */
export class MidiInput {
  channel = 0
  private access: MIDIAccess | null = null
  private selected = 'all'

  constructor(
    private readonly onEvent: (e: MidiEvent) => void,
    private readonly onDevicesChange: (inputs: { id: string; name: string }[]) => void,
  ) {}

  /** Doit être déclenché par un geste utilisateur : le navigateur demande l'autorisation. */
  async connect() {
    this.access = await navigator.requestMIDIAccess()
    this.access.onstatechange = () => this.refresh()
    this.refresh()
  }

  select(id: string) {
    this.selected = id
    this.refresh()
  }

  private refresh() {
    if (!this.access) return
    const inputs = [...this.access.inputs.values()]
    for (const input of inputs) {
      const listening = this.selected === 'all' || this.selected === input.id
      input.onmidimessage = listening
        ? (e) => {
            if (!e.data) return
            const event = parseMidi(e.data, this.channel)
            if (event) this.onEvent(event)
          }
        : null
    }
    this.onDevicesChange(inputs.map((i) => ({ id: i.id, name: i.name ?? i.id })))
  }
}
