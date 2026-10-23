import { Noise } from './osc'

/*
 * Séquenceur pas à pas du S-1 (manuel v1.02, pages « Inputting with the step pads » et « Editing a step ») :
 * 64 pas, jusqu'à 4 notes par pas (polyphonie de la machine), gate 1..100, probabilité 1..100,
 * sub-steps (le pas est découpé en parties jouées ou muettes), tie vers le pas suivant.
 * Module pur : l'horloge avance d'un échantillon à la fois et émet des notes via un `NoteSink`.
 */

export const MAX_STEPS = 64
export const MAX_NOTES_PER_STEP = 4
export const MAX_SUB_STEPS = 4
export const PAGE_SIZE = 16

export interface StepNote {
  note: number
  /** 1..127 : enregistré comme sur la machine (les voix n'y sont pas sensibles). */
  velocity: number
  /** 1..100 : durée de la note en % du pas ; 100 + même note au pas suivant = liaison. */
  gate: number
}

export interface Step {
  notes: StepNote[]
  /** 1..100 */
  probability: number
  /** Parties du pas, jouées (true) ou muettes (false). Une seule partie = pas normal. */
  subSteps: boolean[]
  /** Prolonge la note jusqu'à la fin du pas suivant. */
  tie: boolean
}

/** Motion : valeurs d'un paramètre enregistrées pas par pas (null = pas de valeur sur ce pas). */
export interface Motion {
  /** Identifiant du paramètre (ParamId), ou 'bend' pour le pitch bend. */
  param: string
  values: (number | null)[]
}

/** Manuel : 8 paramètres + le pitch bend par pattern. */
export const MAX_MOTIONS = 8
export const BEND_MOTION = 'bend'

export interface Pattern {
  steps: Step[]
  /** Nombre de pas joués, 1..64 (INIT : 16). */
  length: number
  /** Transposition du clavier et du séquenceur, -60..+60 (TRANSPOSE du .PRM). */
  transpose: number
  /** -100..+100 par pas de 10 : ajouté à la probabilité des pas réglés à 99 % ou moins (manuel). */
  masterProbability: number
  motions: Motion[]
}

export const emptyStep = (): Step => ({ notes: [], probability: 100, subSteps: [true], tie: false })

export const emptyPattern = (length = 16): Pattern => ({
  steps: Array.from({ length: MAX_STEPS }, emptyStep),
  length,
  transpose: 0,
  masterProbability: 0,
  motions: [],
})

export const emptyMotionValues = (): (number | null)[] => Array.from({ length: MAX_STEPS }, () => null)

/** Probabilité effective d'un pas, avec la probabilité globale (sans effet sur les pas à 100 %). */
export function effectiveProbability(step: Step, master: number): number {
  if (step.probability >= 100) return 100
  return Math.min(100, Math.max(0, step.probability + master))
}

/** Note jouée après transposition, bornée à la plage MIDI. */
export const transposed = (note: number, transpose: number) => Math.min(127, Math.max(0, note + transpose))

/** Insère un pas vide à `index` ; les suivants reculent d'un pas (le 64e est perdu). Motions comprises. */
export function insertStep(pattern: Pattern, index: number) {
  pattern.steps.splice(index, 0, emptyStep())
  pattern.steps.length = MAX_STEPS
  for (const m of pattern.motions) {
    m.values.splice(index, 0, null)
    m.values.length = MAX_STEPS
  }
  pattern.length = Math.min(MAX_STEPS, pattern.length + 1)
}

/** Double le pattern : les pas 1..longueur sont recopiés à la suite (manuel : DUPL). */
export function duplicatePattern(pattern: Pattern) {
  const len = pattern.length
  const copyStep = (s: Step): Step => ({ ...s, notes: s.notes.map((n) => ({ ...n })), subSteps: [...s.subSteps] })
  for (let i = 0; i < len && len + i < MAX_STEPS; i++) {
    pattern.steps[len + i] = copyStep(pattern.steps[i])
    for (const m of pattern.motions) m.values[len + i] = m.values[i]
  }
  pattern.length = Math.min(MAX_STEPS, len * 2)
}

/** Longueur de pas (P.SCL du manuel) en temps (noires). */
export const STEP_SCALES: { label: string; beats: number }[] = [
  { label: '1/8', beats: 1 / 2 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/32', beats: 1 / 8 },
  { label: '4t', beats: 2 / 3 },
  { label: '8t', beats: 1 / 3 },
  { label: '16t', beats: 1 / 6 },
]

export const stepSamples = (tempo: number, scale: number, sampleRate: number) =>
  ((60 / tempo) * (STEP_SCALES[scale] ?? STEP_SCALES[1]).beats * sampleRate)

export interface NoteSink {
  noteOn(note: number): void
  noteOff(note: number): void
}

/** Ordre du menu Ntro du manuel. */
export const MetronomeMode = { Off: 0, Rec: 1, RecPlay: 2 } as const

/** Note enregistrée en temps réel : pas de destination (quantifié au plus proche). */
export interface Recorded {
  step: number
  note: number
  gate: number
}

interface Pending {
  note: number
  on: boolean
  /** Échantillons restants avant l'événement. */
  remaining: number
}

const MAX_PENDING = 64

/**
 * Horloge du séquenceur, à l'échantillon près. `tick()` est appelé une fois par échantillon dans le worklet ;
 * les événements sont stockés dans un tableau préalloué (aucune allocation pendant la lecture).
 */
export class SequencerClock {
  pattern: Pattern = emptyPattern()
  tempo = 100
  scale = 1
  /** 0..50 : retard des pas pairs en % de la durée d'un pas. */
  shuffle = 0
  playing = false
  /** Pas en cours de lecture (-1 à l'arrêt). */
  current = -1
  /** Appelé à chaque nouveau pas (affichage). */
  onStep: ((index: number) => void) | null = null
  /** Clic du métronome ; accent sur le premier temps du pattern et du décompte. */
  onClick: ((accent: boolean) => void) | null = null

  /** REC : les notes jouées pendant la lecture s'écrivent dans le pattern. */
  recording = false
  metronome: number = MetronomeMode.Off
  /** Décompte avant l'enregistrement, en temps (0 = aucun). */
  countIn = 0
  /** Boucle de pas : pas joués en boucle, dans l'ordre (vide = pattern entier). */
  loopSteps: number[] = []

  private countdown = 0
  private stepLength = 0
  private beatCountdown = 0
  private preRoll = 0
  private preRollBeats = 0
  private sampleCount = 0
  // Notes enregistrées pendant ce passage : on ne les rejoue pas une 2e fois au même pas
  private readonly skip: { step: number; note: number }[] = []
  private readonly recordStart = new Map<number, { step: number; at: number }>()
  private readonly pending: Pending[] = Array.from({ length: MAX_PENDING }, () => ({ note: 0, on: false, remaining: -1 }))
  /** Notes actuellement enclenchées par le séquenceur, pour les couper proprement. */
  private readonly sounding = new Set<number>()
  private readonly rng: Noise

  constructor(
    private readonly sink: NoteSink,
    private readonly sampleRate: number,
    seed = 0x5eed,
  ) {
    this.rng = new Noise(seed)
  }

  start() {
    this.playing = true
    this.current = -1
    this.countdown = 0
    this.skip.length = 0
    // Décompte (manuel : Cnt.I) seulement quand on enregistre
    this.preRollBeats = this.recording ? this.countIn : 0
    this.preRoll = Math.round(this.preRollBeats * this.beatSamples())
    this.beatCountdown = 0
  }

  private beatSamples() {
    return (60 / this.tempo) * this.sampleRate
  }

  private get clicking() {
    return this.metronome === MetronomeMode.RecPlay || (this.metronome === MetronomeMode.Rec && this.recording)
  }

  stop() {
    this.playing = false
    this.current = -1
    for (const p of this.pending) p.remaining = -1
    for (const note of this.sounding) this.sink.noteOff(note)
    this.sounding.clear()
  }

  tick() {
    if (!this.playing) return
    this.sampleCount++
    if (this.preRoll > 0) {
      // Décompte : clics à la noire, puis la lecture démarre au pas 1
      if (this.beatCountdown <= 0) {
        this.onClick?.(this.beatCountdown === 0 && this.preRoll === Math.round(this.preRollBeats * this.beatSamples()))
        this.beatCountdown += this.beatSamples()
      }
      this.beatCountdown--
      this.preRoll--
      if (this.preRoll === 0) this.beatCountdown = 0
      return
    }
    for (let i = 0; i < MAX_PENDING; i++) {
      const p = this.pending[i]
      if (p.remaining < 0) continue
      if (p.remaining === 0) {
        p.remaining = -1
        this.fire(p.note, p.on)
      } else p.remaining--
    }
    if (this.countdown <= 0) {
      this.current = this.nextPlayed(this.current)
      // Le métronome repart au début du pattern (manuel, v1.02)
      if (this.current === 0) this.beatCountdown = 0
      const len = stepSamples(this.tempo, this.scale, this.sampleRate)
      // Shuffle : les pas pairs (2e, 4e…) arrivent en retard ; la durée totale de deux pas est conservée
      const swing = (this.shuffle / 100) * len
      const odd = this.current % 2 === 1
      this.stepLength = odd ? len - swing : len + swing
      this.countdown += this.stepLength
      this.triggerStep(this.current, this.stepLength)
      this.onStep?.(this.current)
    }
    if (this.clicking) {
      if (this.beatCountdown <= 0) {
        this.onClick?.(this.current === 0 && this.countdown >= this.stepLength - 1)
        this.beatCountdown += this.beatSamples()
      }
      this.beatCountdown--
    }
    this.countdown--
  }

  /** Pas suivant : dans la boucle de pas si elle est active, sinon dans la longueur du pattern. */
  private nextPlayed(current: number): number {
    const loop = this.loopSteps
    if (loop.length > 0) {
      for (let i = 0; i < loop.length; i++) if (loop[i] > current) return loop[i]
      return loop[0]
    }
    return (current + 1) % Math.max(1, Math.min(MAX_STEPS, this.pattern.length))
  }

  /**
   * Enregistrement en temps réel : la note va au pas en cours, ou au suivant si elle arrive
   * dans sa deuxième moitié (quantification au pas le plus proche).
   */
  recordNoteOn(note: number): Recorded | null {
    if (!this.playing || !this.recording || this.preRoll > 0 || this.current < 0) return null
    const phase = this.stepLength > 0 ? 1 - this.countdown / this.stepLength : 0
    const step = phase < 0.5 ? this.current : this.nextPlayed(this.current)
    const target = this.pattern.steps[step]
    if (target.notes.length >= MAX_NOTES_PER_STEP && !target.notes.some((n) => n.note === note)) return null
    if (!target.notes.some((n) => n.note === note)) target.notes.push({ note, velocity: 100, gate: 50 })
    // Déjà jouée en direct : ne pas la redéclencher quand le séquenceur atteindra ce pas
    if (step !== this.current) this.skip.push({ step, note })
    this.recordStart.set(note, { step, at: this.sampleCount })
    return { step, note, gate: 50 }
  }

  /** Fin de la note enregistrée : son gate vient de la durée réellement tenue (1..100 % du pas). */
  recordNoteOff(note: number): Recorded | null {
    const start = this.recordStart.get(note)
    if (!start) return null
    this.recordStart.delete(note)
    const len = stepSamples(this.tempo, this.scale, this.sampleRate)
    const gate = Math.min(100, Math.max(1, Math.round(((this.sampleCount - start.at) / len) * 100)))
    const n = this.pattern.steps[start.step].notes.find((m) => m.note === note)
    if (n) n.gate = gate
    return { step: start.step, note, gate }
  }

  private triggerStep(index: number, length: number) {
    const step = this.pattern.steps[index]
    if (!step || step.notes.length === 0) return
    const probability = effectiveProbability(step, this.pattern.masterProbability)
    if (probability < 100 && (this.rng.next() + 1) * 50 >= probability) return
    const transpose = this.pattern.transpose

    const parts = step.subSteps.length > 0 ? step.subSteps : [true]
    const partLen = length / parts.length
    for (let k = 0; k < parts.length; k++) {
      if (!parts[k]) continue
      const at = Math.round(k * partLen)
      for (const n of step.notes) {
        if (this.consumeSkip(index, n.note)) continue
        const played = transposed(n.note, transpose)
        // Note liée depuis le pas précédent : elle sonne déjà, pas de nouvelle attaque
        if (parts.length === 1 && this.continuesFromPrevious(index, n.note, played)) continue
        const duration = parts.length === 1 ? this.noteDuration(index, n) : (partLen * n.gate) / 100
        this.schedule(played, true, at)
        this.schedule(played, false, at + Math.max(1, Math.round(duration)))
      }
    }
  }

  private next(index: number) {
    return (index + 1) % Math.max(1, Math.min(MAX_STEPS, this.pattern.length))
  }

  /**
   * Durée en échantillons. Tie : la note couvre aussi le pas suivant (vide).
   * Gate 100 : la note se prolonge tant que le pas suivant contient la même note (liaison).
   */
  private noteDuration(index: number, n: StepNote): number {
    const len = stepSamples(this.tempo, this.scale, this.sampleRate)
    const step = this.pattern.steps[index]
    if (step.tie && this.pattern.steps[this.next(index)].notes.length === 0) return len * 2

    let total = 0
    let current = n
    let i = index
    for (let guard = 0; guard < this.pattern.length; guard++) {
      if (current.gate < 100) return total + (len * current.gate) / 100
      total += len
      i = this.next(i)
      const following = this.pattern.steps[i]
      const same = following.subSteps.length === 1 ? following.notes.find((m) => m.note === n.note) : undefined
      // Gate 100 vers une autre note : relâchée juste après l'attaque suivante, donc jouée legato
      if (!same) return total + 1
      current = same
    }
    return total
  }

  private consumeSkip(step: number, note: number): boolean {
    for (let i = 0; i < this.skip.length; i++) {
      if (this.skip[i].step === step && this.skip[i].note === note) {
        this.skip.splice(i, 1)
        return true
      }
    }
    return false
  }

  /** La note est-elle déjà tenue, liée depuis le pas précédent (gate 100, même note) ? */
  private continuesFromPrevious(index: number, note: number, played: number): boolean {
    if (!this.sounding.has(played)) return false
    const length = Math.max(1, Math.min(MAX_STEPS, this.pattern.length))
    const prev = this.pattern.steps[(index - 1 + length) % length]
    return prev.subSteps.length === 1 && prev.notes.some((m) => m.note === note && m.gate >= 100)
  }

  private schedule(note: number, on: boolean, delay: number) {
    if (delay <= 0) {
      this.fire(note, on)
      return
    }
    for (let i = 0; i < MAX_PENDING; i++) {
      const p = this.pending[i]
      if (p.remaining >= 0) continue
      p.note = note
      p.on = on
      p.remaining = delay - 1
      return
    }
  }

  private fire(note: number, on: boolean) {
    if (on) {
      // Même note encore enclenchée : on la relâche avant de la rejouer
      if (this.sounding.has(note)) this.sink.noteOff(note)
      this.sounding.add(note)
      this.sink.noteOn(note)
    } else if (this.sounding.has(note)) {
      this.sounding.delete(note)
      this.sink.noteOff(note)
    }
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Nom de note comme sur la machine (plage C-1..G9 : MIDI 0 = C-1, 60 = C4). */
export const noteName = (note: number) => NOTE_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1)

/** Note par défaut d'un pas saisi au clic (manuel : C5). */
export const DEFAULT_STEP_NOTE = 72
