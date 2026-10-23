import { FX_SECTIONS, PARAMS, type ParamId } from '../dsp/params'
import type { Pattern } from '../dsp/sequencer'
import { PROCESSOR_NAME, type EngineMessage, type ProcessorMessage } from '../worklet/messages'
import processorUrl from '../worklet/s1-processor.ts?worker&url'
import { Effects } from './effects'

const FX_IDS = new Set(PARAMS.filter((p) => FX_SECTIONS.has(p.section)).map((p) => p.id))
// Le tempo concerne aussi les effets (Delay Sync)
const FX_DEPENDENCIES = new Set<ParamId>(['tempo'])

/** Côté thread principal : AudioContext, nœud du worklet, chaîne d'effets, master et analyseur. */
export class Engine {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  private node: AudioWorkletNode | null = null
  private readonly master: GainNode
  private readonly effects: Effects
  private values: Record<ParamId, number> | null = null
  /** Pas en cours de lecture, renvoyé par le worklet. */
  onStep: ((index: number) => void) | null = null
  /** Note enregistrée en temps réel par le worklet. */
  onRecNote: ((step: number, note: number, gate: number) => void) | null = null

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.effects = new Effects(this.ctx)
    this.master = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.effects.output.connect(this.master)
    this.master.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  get running() {
    return this.node !== null && this.ctx.state === 'running'
  }

  /** À appeler depuis un geste utilisateur (politique d'autoplay des navigateurs). */
  async start(initial: Record<ParamId, number>) {
    if (!this.node) {
      await this.ctx.audioWorklet.addModule(processorUrl)
      this.node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
        numberOfInputs: 0,
        outputChannelCount: [2],
      })
      this.node.connect(this.effects.input)
      this.node.port.onmessage = (e: MessageEvent<ProcessorMessage>) => {
        const msg = e.data
        if (msg.type === 'step') this.onStep?.(msg.index)
        else if (msg.type === 'recNote') this.onRecNote?.(msg.step, msg.note, msg.gate)
      }
      this.values = { ...initial }
      for (const [id, v] of Object.entries(initial)) this.setParam(id as ParamId, v)
    }
    await this.ctx.resume()
  }

  async stop() {
    this.send({ type: 'allNotesOff' })
    await this.ctx.suspend()
  }

  setParam(id: ParamId, value: number) {
    if (this.values) this.values[id] = value
    if (FX_IDS.has(id) || FX_DEPENDENCIES.has(id)) {
      if (this.values) this.effects.update(this.values)
      if (FX_IDS.has(id)) return
    }
    this.node?.parameters.get(id)?.setValueAtTime(value, this.ctx.currentTime)
  }

  noteOn(note: number) {
    this.send({ type: 'noteOn', note })
  }

  noteOff(note: number) {
    this.send({ type: 'noteOff', note })
  }

  allNotesOff() {
    this.send({ type: 'allNotesOff' })
  }

  /** -1..1 */
  pitchBend(value: number) {
    this.send({ type: 'pitchBend', value })
  }

  /** 0..1 */
  modWheel(value: number) {
    this.send({ type: 'modWheel', value })
  }

  hold(on: boolean) {
    this.send({ type: 'hold', on })
  }

  setPattern(pattern: Pattern) {
    this.send({ type: 'setPattern', pattern })
  }

  transport(playing: boolean) {
    this.send({ type: 'transport', playing })
  }

  arpHold(on: boolean) {
    this.send({ type: 'arpHold', on })
  }

  /** Forme OSC DRAW et masques OSC CHOP. */
  setWave(draw: number[], chop: number[]) {
    // Copies simples : un tableau réactif (proxy Svelte) ne peut pas être transmis au worklet
    this.send({ type: 'setWave', draw: Array.from(draw), chop: Array.from(chop) })
  }

  /** Décalages de jeu D-MOTION : cutoff (octaves), résonance, niveaux delay / reverb. */
  perf(cutoffOct: number, reso: number, delayLevel: number, reverbLevel: number) {
    this.send({ type: 'perf', cutoffOct, reso })
    this.effects.setLevelOffsets(delayLevel, reverbLevel)
  }

  /** -1..1 (CC10, D-MOTION) */
  setPan(pan: number) {
    this.effects.setPan(pan)
  }

  /** 0..1 (CC11, D-MOTION) */
  setExpression(value: number) {
    this.effects.setExpression(value)
  }

  recording(on: boolean) {
    this.send({ type: 'recording', on })
  }

  stepLoop(steps: number[]) {
    this.send({ type: 'stepLoop', steps: Array.from(steps) })
  }

  private send(msg: EngineMessage) {
    this.node?.port.postMessage(msg)
  }
}
