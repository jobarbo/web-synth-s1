import { Noise } from './osc'
import type { NoteSink } from './sequencer'

/** Ordre du manuel S-1 (ARPEGGIO TYPE) et du .PRM (ARP_TYPE). */
export const ArpType = {
  Up: 0,
  Down: 1,
  UpDown: 2,
  Up2: 3,
  Down2: 4,
  UpDown2: 5,
  Random: 6,
  Random2: 7,
} as const

export const ARP_TYPE_LABELS = ['Up', 'Down', 'Up&Dn', 'Up 2oct', 'Dn 2oct', 'U&D 2oct', 'Rand', 'Rand 2oct']

/** Ordre du manuel (ARPEGGIO RATE) et du .PRM (ARP_RATE), en temps (noires). */
export const ARP_RATES: { label: string; beats: number }[] = [
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 1 / 2 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/32', beats: 1 / 8 },
  { label: '8t', beats: 1 / 3 },
  { label: '16t', beats: 1 / 6 },
  { label: '32t', beats: 1 / 12 },
]

const MAX_HELD = 16
const MAX_SEQUENCE = MAX_HELD * 4

/** Suite de notes jouée pour un accord donné (pure, testable). */
export function arpSequence(held: readonly number[], type: number, out: number[] = []): number[] {
  out.length = 0
  const sorted = [...held].sort((a, b) => a - b)
  if (sorted.length === 0) return out
  const twoOct = type === ArpType.Up2 || type === ArpType.Down2 || type === ArpType.UpDown2 || type === ArpType.Random2
  const up = twoOct ? [...sorted, ...sorted.map((n) => n + 12)] : sorted
  switch (type) {
    case ArpType.Down:
    case ArpType.Down2:
      out.push(...[...up].reverse())
      break
    case ArpType.UpDown:
    case ArpType.UpDown2:
      // Sans répéter les extrêmes : 1 2 3 2 (puis 1 2 3 2…)
      out.push(...up, ...up.slice(1, -1).reverse())
      break
    default:
      // Up, et l'ensemble de notes tiré au hasard pour Random
      out.push(...up)
  }
  return out
}

/**
 * Arpégiateur à l'échantillon près. Les notes s'enchaînent legato (la suivante démarre avant que la précédente
 * ne soit relâchée) : avec ENV TRG = Gate l'enveloppe n'est donc pas relancée, comme le décrit le manuel
 * (« Mono + GATE : le son s'arrête quand l'enveloppe finit à SUSTAIN 0 »).
 */
export class Arpeggiator {
  on = false
  type: number = ArpType.Up
  rate = 2
  tempo = 100
  /** HOLD : l'arpège continue après le relâchement ; un nouvel accord remplace le précédent. */
  hold = false

  private readonly held: number[] = []
  private readonly latched: number[] = []
  private readonly sequence: number[] = []
  private physicalCount = 0
  private position = -1
  private countdown = 0
  private sounding = -1
  private readonly rng: Noise

  constructor(
    private readonly sink: NoteSink,
    private readonly sampleRate: number,
    seed = 0xa4b,
  ) {
    this.rng = new Noise(seed)
  }

  /** Note jouée au clavier pendant que l'arpégiateur est actif. */
  noteOn(note: number) {
    // Avec HOLD : un nouvel accord commence quand on rejoue après avoir tout relâché
    if (this.hold && this.physicalCount === 0) this.latched.length = 0
    this.physicalCount++
    if (!this.held.includes(note) && this.held.length < MAX_HELD) this.held.push(note)
    if (this.hold && !this.latched.includes(note) && this.latched.length < MAX_HELD) this.latched.push(note)
    const wasIdle = this.sequence.length === 0
    this.rebuild()
    // Premier appui : l'arpège démarre tout de suite
    if (wasIdle) this.countdown = 0
  }

  noteOff(note: number) {
    const i = this.held.indexOf(note)
    if (i === -1) return
    this.held.splice(i, 1)
    this.physicalCount = Math.max(0, this.physicalCount - 1)
    this.rebuild()
  }

  setHold(on: boolean) {
    this.hold = on
    if (on) {
      this.latched.length = 0
      this.latched.push(...this.held)
    } else this.latched.length = 0
    this.rebuild()
  }

  /** Coupe tout (arpégiateur désactivé, arrêt du son). */
  reset() {
    this.held.length = 0
    this.latched.length = 0
    this.physicalCount = 0
    this.rebuild()
  }

  private rebuild() {
    arpSequence(this.hold ? this.latched : this.held, this.type, this.sequence)
    if (this.sequence.length > MAX_SEQUENCE) this.sequence.length = MAX_SEQUENCE
    if (this.sequence.length === 0) {
      this.position = -1
      this.release()
    }
  }

  private release() {
    if (this.sounding >= 0) this.sink.noteOff(this.sounding)
    this.sounding = -1
  }

  tick() {
    if (!this.on || this.sequence.length === 0) return
    if (this.countdown <= 0) {
      const random = this.type === ArpType.Random || this.type === ArpType.Random2
      this.position = random
        ? Math.floor(((this.rng.next() + 1) / 2) * this.sequence.length) % this.sequence.length
        : (this.position + 1) % this.sequence.length
      const note = this.sequence[this.position]
      const previous = this.sounding
      // Legato : nouvelle note d'abord, puis relâchement de la précédente
      if (note !== previous) {
        this.sink.noteOn(note)
        if (previous >= 0) this.sink.noteOff(previous)
      } else {
        this.sink.noteOff(note)
        this.sink.noteOn(note)
      }
      this.sounding = note
      const beats = (ARP_RATES[this.rate] ?? ARP_RATES[2]).beats
      this.countdown += (60 / this.tempo) * beats * this.sampleRate
    }
    this.countdown--
  }
}
