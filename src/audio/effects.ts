import {
  cutFrequency,
  delaySyncTime,
  HIGH_CUT_LABELS,
  LOW_CUT_LABELS,
  mapDelayFeedback,
  mapDelayTime,
  mapReverbPreDelay,
  mapReverbTime,
  mapTempo,
  type ParamId,
} from '../dsp/params'
import { generateReverbIr, ReverbType } from './reverbIr'

interface ChorusType {
  rate: number
  /** Profondeur de modulation du délai, secondes. */
  depth: number
  /** Délai de base, secondes. */
  base: number
  wet: number
  /** Modulation d'amplitude gauche/droite (effet de haut-parleur rotatif). */
  am: number
}

/*
 * Types de chorus du S-1, d'après le manuel : 1 standard, 2 plus rapide,
 * 3 rapide « comme un haut-parleur rotatif », 4 plus détendu. Réglages maison.
 */
const CHORUS_TYPES: (ChorusType | null)[] = [
  null,
  { rate: 0.5, depth: 0.0025, base: 0.008, wet: 0.5, am: 0 },
  { rate: 1.6, depth: 0.002, base: 0.007, wet: 0.5, am: 0 },
  { rate: 6.5, depth: 0.0006, base: 0.002, wet: 0.6, am: 0.35 },
  { rate: 0.25, depth: 0.004, base: 0.012, wet: 0.5, am: 0 },
]

const RAMP = 0.02
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
// Pas de filtre quand la coupure est « Flat » : on pousse le filtre hors de la bande audible
const FLAT_LOW = 10
const FLAT_HIGH = 22000
const MODULATE_DEPTH = 0.0015
const IR_DEBOUNCE_MS = 120

/**
 * Chaîne d'effets, d'après le schéma de signal du manuel S-1 :
 * synthé → CHORUS (insert) → bus ─┬───────────────────────────────┬─→ bus 2 ─┬──────────────────────┬─→ sortie
 *                                 └─ DELAY (send, level pré/post) ─┘          └─ REVERB (send) ───────┘
 * La reverb reçoit donc aussi les répétitions du delay.
 */
export class Effects {
  readonly input: GainNode
  readonly output: GainNode

  private readonly ctx: BaseAudioContext
  private readonly lfo: OscillatorNode

  private readonly chorusDry: GainNode
  private readonly chorusWetL: GainNode
  private readonly chorusWetR: GainNode
  private readonly chorusDelayL: DelayNode
  private readonly chorusDelayR: DelayNode
  private readonly chorusDepthL: GainNode
  private readonly chorusDepthR: GainNode
  private readonly chorusAmL: GainNode
  private readonly chorusAmR: GainNode

  private readonly delayPre: GainNode
  private readonly delayLine: DelayNode
  private readonly delayLowCut: BiquadFilterNode
  private readonly delayHighCut: BiquadFilterNode
  private readonly delayFeedback: GainNode
  private readonly delayPost: GainNode

  private readonly reverbSend: GainNode
  private readonly reverbPreDelay: DelayNode
  private readonly reverbLowCut: BiquadFilterNode
  private readonly reverbHighCut: BiquadFilterNode
  private readonly convolver: ConvolverNode
  private readonly reverbModDelay: DelayNode
  private readonly reverbModDepth: GainNode
  private readonly reverbModLfo: OscillatorNode

  private readonly panner: StereoPannerNode
  private readonly expression: GainNode
  /** Décalages de jeu (D-MOTION) sur les niveaux de delay et de reverb, autour des réglages. */
  private delayOffset = 0
  private reverbOffset = 0
  private last: Record<ParamId, number> | null = null

  private irKey = ''
  private irTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    const gain = (v = 1) => new GainNode(ctx, { gain: v })
    this.input = gain()
    this.output = gain()

    // CHORUS : deux lignes à délai modulées en opposition de phase, gauche et droite
    this.lfo = new OscillatorNode(ctx, { frequency: 0.5 })
    this.chorusDry = gain()
    this.chorusDelayL = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.008 })
    this.chorusDelayR = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.008 })
    this.chorusDepthL = gain(0)
    this.chorusDepthR = gain(0)
    this.chorusWetL = gain(0)
    this.chorusWetR = gain(0)
    this.chorusAmL = gain(0)
    this.chorusAmR = gain(0)
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
    const chorusOut = gain()
    const bus1 = gain()

    this.input.connect(this.chorusDry).connect(chorusOut)
    this.input.connect(this.chorusDelayL).connect(this.chorusWetL).connect(merger, 0, 0)
    this.input.connect(this.chorusDelayR).connect(this.chorusWetR).connect(merger, 0, 1)
    merger.connect(chorusOut)
    // Schéma de signal : CHORUS → PAN ; l'expression (CC11, D-MOTION) agit au même endroit
    this.panner = new StereoPannerNode(ctx, { pan: 0 })
    this.expression = gain()
    chorusOut.connect(this.panner).connect(this.expression).connect(bus1)
    this.lfo.connect(this.chorusDepthL).connect(this.chorusDelayL.delayTime)
    this.lfo.connect(this.chorusDepthR).connect(this.chorusDelayR.delayTime)
    this.lfo.connect(this.chorusAmL).connect(this.chorusWetL.gain)
    this.lfo.connect(this.chorusAmR).connect(this.chorusWetR.gain)

    // DELAY : boucle de feedback filtrée (Low Cut / High Cut dans la boucle)
    this.delayPre = gain(0)
    // 2 s : assez pour une noire synchronisée jusqu'à 30 BPM
    this.delayLine = new DelayNode(ctx, { maxDelayTime: 2 })
    this.delayLowCut = new BiquadFilterNode(ctx, { type: 'highpass', frequency: FLAT_LOW, Q: 0.5 })
    this.delayHighCut = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: FLAT_HIGH, Q: 0.5 })
    this.delayFeedback = gain(0)
    this.delayPost = gain(1)
    const bus2 = gain()

    bus1.connect(bus2)
    bus1.connect(this.delayPre).connect(this.delayLine).connect(this.delayLowCut).connect(this.delayHighCut)
    this.delayHighCut.connect(this.delayFeedback).connect(this.delayLine)
    this.delayHighCut.connect(this.delayPost).connect(bus2)

    // REVERB : pré-délai, filtres, convolution, puis délai modulé (actif seulement pour le type Modulate)
    this.reverbSend = gain(0)
    this.reverbPreDelay = new DelayNode(ctx, { maxDelayTime: 0.1 })
    this.reverbLowCut = new BiquadFilterNode(ctx, { type: 'highpass', frequency: FLAT_LOW, Q: 0.5 })
    this.reverbHighCut = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: FLAT_HIGH, Q: 0.5 })
    this.convolver = new ConvolverNode(ctx, { disableNormalization: true })
    this.reverbModDelay = new DelayNode(ctx, { maxDelayTime: 0.02, delayTime: 0.005 })
    this.reverbModDepth = gain(0)
    this.reverbModLfo = new OscillatorNode(ctx, { frequency: 0.7 })

    bus2.connect(this.output)
    bus2
      .connect(this.reverbSend)
      .connect(this.reverbPreDelay)
      .connect(this.reverbLowCut)
      .connect(this.reverbHighCut)
      .connect(this.convolver)
      .connect(this.reverbModDelay)
      .connect(this.output)
    this.reverbModLfo.connect(this.reverbModDepth).connect(this.reverbModDelay.delayTime)

    this.lfo.start()
    this.reverbModLfo.start()
  }

  /** Applique tous les réglages d'effets. Bon marché, sauf la réponse impulsionnelle (recalculée en différé). */
  update(v: Record<ParamId, number>) {
    this.last = v
    const now = this.ctx.currentTime
    const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, RAMP)

    const chorus = CHORUS_TYPES[Math.round(v.chorusType)] ?? null
    set(this.chorusDry.gain, chorus ? 1 - chorus.wet * 0.5 : 1)
    set(this.chorusWetL.gain, chorus?.wet ?? 0)
    set(this.chorusWetR.gain, chorus?.wet ?? 0)
    set(this.chorusDepthL.gain, chorus?.depth ?? 0)
    set(this.chorusDepthR.gain, -(chorus?.depth ?? 0))
    set(this.chorusAmL.gain, (chorus?.am ?? 0) * (chorus?.wet ?? 0))
    set(this.chorusAmR.gain, -(chorus?.am ?? 0) * (chorus?.wet ?? 0))
    if (chorus) {
      set(this.chorusDelayL.delayTime, chorus.base)
      set(this.chorusDelayR.delayTime, chorus.base)
      set(this.lfo.frequency, chorus.rate)
    }

    const level = clamp01(v.delayLevel + this.delayOffset)
    const pre = Math.round(v.delayLevelMode) === 0
    set(this.delayPre.gain, pre ? level : 1)
    set(this.delayPost.gain, pre ? 1 : level)
    // Délai changé en douceur : glissement de hauteur comme une bande, plutôt qu'un clic
    const delayTime = Math.round(v.delaySync) === 1 ? delaySyncTime(mapTempo(v.tempo), v.delayNote) : mapDelayTime(v.delayTime)
    this.delayLine.delayTime.setTargetAtTime(Math.min(2, delayTime), now, 0.05)
    set(this.delayFeedback.gain, mapDelayFeedback(v.delayFeedback))
    set(this.delayLowCut.frequency, cutFrequency(LOW_CUT_LABELS, v.delayLowCut) ?? FLAT_LOW)
    set(this.delayHighCut.frequency, cutFrequency(HIGH_CUT_LABELS, v.delayHighCut) ?? FLAT_HIGH)

    set(this.reverbSend.gain, clamp01(v.reverbLevel + this.reverbOffset))
    set(this.reverbPreDelay.delayTime, mapReverbPreDelay(v.reverbPreDelay))
    set(this.reverbLowCut.frequency, cutFrequency(LOW_CUT_LABELS, v.reverbLowCut) ?? FLAT_LOW)
    set(this.reverbHighCut.frequency, cutFrequency(HIGH_CUT_LABELS, v.reverbHighCut) ?? FLAT_HIGH)
    set(this.reverbModDepth.gain, Math.round(v.reverbType) === ReverbType.Modulate ? MODULATE_DEPTH : 0)

    this.scheduleIr(Math.round(v.reverbType), mapReverbTime(v.reverbTime), Math.round(v.reverbDensity))
  }

  /** -1 (gauche) .. 1 (droite) */
  setPan(pan: number) {
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), this.ctx.currentTime, RAMP)
  }

  /** 0..1 */
  setExpression(value: number) {
    this.expression.gain.setTargetAtTime(clamp01(value), this.ctx.currentTime, RAMP)
  }

  /** Décalages D-MOTION des niveaux de delay et de reverb (-1..1, ajoutés au réglage). */
  setLevelOffsets(delay: number, reverb: number) {
    this.delayOffset = delay
    this.reverbOffset = reverb
    if (this.last) this.update(this.last)
  }

  private scheduleIr(type: number, rt60: number, density: number) {
    const key = `${type}:${rt60.toFixed(3)}:${density}`
    if (key === this.irKey) return
    const first = this.irKey === ''
    this.irKey = key
    if (this.irTimer) clearTimeout(this.irTimer)
    const build = () => {
      const sampleRate = this.ctx.sampleRate
      const [l, r] = generateReverbIr({ type, rt60, density, sampleRate })
      const buffer = new AudioBuffer({ numberOfChannels: 2, length: l.length, sampleRate })
      buffer.copyToChannel(l, 0)
      buffer.copyToChannel(r, 1)
      this.convolver.buffer = buffer
    }
    // Premier calcul immédiat ; ensuite en différé pour ne pas recalculer à chaque cran de potard
    if (first) build()
    else this.irTimer = setTimeout(build, IR_DEBOUNCE_MS)
  }
}
