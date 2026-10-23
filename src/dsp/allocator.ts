import type { Voice } from './voice'

/** Ordre des sélecteurs du panneau (voir params.ts). */
export const VoiceMode = { Poly: 0, Mono: 1, Unison: 2, Chord: 3 } as const
export const NotePriority = { Last: 0, Low: 1 } as const
export const PortaMode = { Off: 0, On: 1, Auto: 2 } as const
export const EnvTrigger = { Lfo: 0, Gate: 1, Trig: 2 } as const

/**
 * Désaccord fixe des voix en Unison, en demi-tons (±8 et ±3 cents).
 * Le manuel S-1 ne documente aucun réglage de désaccord : valeur choisie à l'oreille.
 */
const UNISON_DETUNE = [-0.08, 0.08, -0.03, 0.03]

/**
 * Gain de sommation des voix avant la saturation du master.
 * Le même pour Poly, Mono et Chord : une note seule a le même niveau dans les trois modes,
 * et les accords sont plus forts, saturés en douceur par le tanh du master comme sur une machine analogique.
 * L'Unison empile toujours 4 voix sur chaque note : atténué pour garder son niveau d'avant face au Mono.
 */
const OUTPUT_GAIN = 0.7
const MODE_GAIN = [OUTPUT_GAIN, OUTPUT_GAIN, OUTPUT_GAIN * 0.45, OUTPUT_GAIN]

export const voiceModeGain = (mode: number) => MODE_GAIN[Math.round(mode)] ?? OUTPUT_GAIN

/**
 * Répartit les notes sur le pool de voix selon le mode (manuel S-1 v1.02, section Controller).
 * - Poly : une voix par note, vol de la voix la plus ancienne quand tout est occupé.
 * - Mono / Unison / Chord : pile de notes. Priorité Last ou Low ; avec ENV TRG = Trig, la dernière note gagne toujours.
 *   En Gate et LFO, jouer legato ne redéclenche pas l'enveloppe ; en Trig, chaque note la redéclenche.
 */
export class VoiceAllocator {
  mode: number = VoiceMode.Poly
  priority: number = NotePriority.Last
  envTrigger: number = EnvTrigger.Trig
  portaMode: number = PortaMode.Off
  /** Voix 2 à 4 du mode Chord : activée et décalage en demi-tons. */
  readonly chordOn = [true, true, false]
  readonly chordShift = [4, 7, 12]

  private readonly held: number[] = []
  private clock = 0
  private readonly startedAt: number[]
  /** Note actuellement jouée par la pile (modes non Poly). */
  private current = -1
  /** Dernière note jouée en Poly : point de départ du portamento de la note suivante. */
  private lastPolyNote = -1

  constructor(private readonly voices: Voice[]) {
    this.startedAt = voices.map(() => 0)
  }

  setMode(mode: number) {
    if (mode === this.mode) return
    this.allNotesOff()
    this.mode = mode
    this.lastPolyNote = -1
    for (let i = 0; i < this.voices.length; i++) {
      this.voices[i].detune = mode === VoiceMode.Unison ? UNISON_DETUNE[i % UNISON_DETUNE.length] : 0
    }
  }

  get heldCount() {
    return this.held.length
  }

  /**
   * arp : note venant de l'arpégiateur. Ses notes s'enchaînent toujours legato ; d'après le manuel,
   * le portamento Auto ne s'y applique que si ENV TRG = Gate.
   */
  noteOn(note: number, arp = false) {
    const i = this.held.indexOf(note)
    if (i !== -1) this.held.splice(i, 1)
    const legato = this.held.length > 0
    this.held.push(note)
    const glideLegato = arp ? this.envTrigger === EnvTrigger.Gate : legato

    if (this.mode === VoiceMode.Poly) {
      this.polyOn(note, glideLegato)
      return
    }
    const target = this.stackTarget()
    // En Low, une note plus haute ajoutée ne change rien
    if (target === this.current && legato) return
    this.stackPlay(target, legato, glideLegato)
  }

  noteOff(note: number) {
    const i = this.held.indexOf(note)
    if (i === -1) return
    this.held.splice(i, 1)

    if (this.mode === VoiceMode.Poly) {
      for (const v of this.voices) if (v.gate && v.note === note) v.noteOff()
      return
    }
    if (this.held.length === 0) {
      this.current = -1
      for (const v of this.voices) v.noteOff()
      return
    }
    const target = this.stackTarget()
    if (target !== this.current) this.stackPlay(target, true)
  }

  allNotesOff() {
    this.held.length = 0
    this.current = -1
    for (const v of this.voices) v.noteOff()
  }

  private glide(legato: boolean) {
    return this.portaMode === PortaMode.On || (this.portaMode === PortaMode.Auto && legato)
  }

  private polyOn(note: number, legato: boolean) {
    const index = this.pickPolyVoice(note)
    this.startedAt[index] = ++this.clock
    // Chaque note part sur une voix différente : le glissé part de la dernière note jouée, pas de la voix
    const from = this.lastPolyNote >= 0 ? this.lastPolyNote : undefined
    this.voices[index].noteOn(note, true, this.glide(legato), from)
    this.lastPolyNote = note
  }

  /** Même note déjà jouée > voix libre > voix en release la plus ancienne > voix tenue la plus ancienne. */
  private pickPolyVoice(note: number): number {
    let best = -1
    let bestScore = Infinity
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]
      if (v.note === note && v.active) return i
      // Score croissant = moins bon candidat ; l'âge départage à l'intérieur d'une catégorie
      const category = !v.active ? 0 : !v.gate ? 1 : 2
      const score = category * 1e12 + this.startedAt[i]
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  private stackTarget(): number {
    const last = this.held[this.held.length - 1]
    if (this.priority !== NotePriority.Low || this.envTrigger === EnvTrigger.Trig) return last
    let low = last
    for (const n of this.held) if (n < low) low = n
    return low
  }

  /** La note de la pile est jouée par 1 voix (Mono), toutes (Unison) ou la voix 1 + les voix d'accord actives (Chord). */
  private stackPlay(note: number, legato: boolean, glideLegato = legato) {
    this.current = note
    const retrigger = !legato || this.envTrigger === EnvTrigger.Trig
    const glide = this.glide(glideLegato)

    if (this.mode === VoiceMode.Mono) {
      this.voices[0].noteOn(note, retrigger, glide)
      return
    }
    if (this.mode === VoiceMode.Unison) {
      for (const v of this.voices) v.noteOn(note, retrigger, glide)
      return
    }
    this.voices[0].noteOn(note, retrigger, glide)
    for (let i = 1; i < this.voices.length; i++) {
      const c = i - 1
      if (c < this.chordOn.length && this.chordOn[c]) this.voices[i].noteOn(note + this.chordShift[c], retrigger, glide)
      else if (this.voices[i].gate) this.voices[i].noteOff()
    }
  }
}
