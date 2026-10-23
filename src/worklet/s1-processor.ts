import { EnvTrigger, VoiceAllocator, VoiceMode } from '../dsp/allocator'
import { Arpeggiator } from '../dsp/arpeggiator'
import { Lfo } from '../dsp/lfo'
import { Riser } from '../dsp/riser'
import { fastTanh, Smoother } from '../dsp/math'
import {
  defaultParams,
  lfoSyncHz,
  mapChordShift,
  mapFilterBend,
  mapLfoPitch,
  mapLfoRate,
  mapOscBend,
  mapShuffle,
  mapTempo,
  mapMetronomeLevel,
  SYNTH_PARAMS,
  type ParamId,
} from '../dsp/params'
import { SequencerClock, transposed } from '../dsp/sequencer'
import { createWaveData, Voice } from '../dsp/voice'
import { PROCESSOR_NAME, type EngineMessage, type ProcessorMessage } from './messages'

const VOICE_COUNT = 4
// Gain de sommation par mode : plusieurs voix ensemble ne doivent pas saturer le master
const MODE_GAIN = [0.55, 1, 0.45, 0.55]
// Les contrôleurs MIDI arrivent par paliers : lissés pour éviter les escaliers audibles
const CONTROLLER_SMOOTH = 0.01

class S1Processor extends AudioWorkletProcessor {
  static parameterDescriptors: AudioParamDescriptor[] = SYNTH_PARAMS.map((p) => ({
    name: p.id,
    defaultValue: p.default,
    minValue: 0,
    maxValue: p.steps ? p.steps - 1 : 1,
    automationRate: 'k-rate',
  }))

  // Préalloué : aucune allocation dans process()
  private readonly params = defaultParams()
  private readonly voices = Array.from({ length: VOICE_COUNT }, (_, i) => new Voice(sampleRate, 0x9e3779b9 + i * 7919))
  private readonly allocator = new VoiceAllocator(this.voices)
  private readonly wave = createWaveData()
  private readonly riser = new Riser(sampleRate)
  private perfCutoff = 0
  private perfReso = 0
  private readonly lfo = new Lfo()

  private bend = 0
  private modWheel = 0
  private readonly sBend = new Smoother(0, CONTROLLER_SMOOTH, sampleRate)
  private readonly sMod = new Smoother(0, CONTROLLER_SMOOTH, sampleRate)

  // Pédale de sustain : les notes relâchées pendant qu'elle est enfoncée sont tenues jusqu'à son relâchement
  private hold = false
  private readonly sustained = new Set<number>()

  // Notes du séquenceur : directement aux voix. Notes de l'arpégiateur : marquées comme telles (règle du portamento).
  private readonly sequencer = new SequencerClock(
    { noteOn: (n) => this.voiceOn(n, false), noteOff: (n) => this.allocator.noteOff(n) },
    sampleRate,
  )
  private readonly arp = new Arpeggiator(
    { noteOn: (n) => this.voiceOn(n, true), noteOff: (n) => this.allocator.noteOff(n) },
    sampleRate,
  )
  private stepToReport = -1
  /** Notes jouées → notes envoyées après transposition, pour relâcher la bonne note. */
  private readonly liveTransposed = new Map<number, number>()

  // Métronome : sinus amorti, plus aigu sur l'accent
  private clickPhase = 0
  private clickFreq = 0
  private clickEnv = 0
  private readonly clickDecay = Math.exp(-1 / (0.012 * sampleRate))

  constructor() {
    super()
    for (const v of this.voices) v.wave = this.wave
    this.port.onmessage = (e: MessageEvent<EngineMessage>) => this.onMessage(e.data)
    this.sequencer.onStep = (index) => (this.stepToReport = index)
    this.sequencer.onClick = (accent) => {
      this.clickFreq = accent ? 2400 : 1600
      this.clickPhase = 0
      this.clickEnv = 1
    }
  }

  private post(msg: ProcessorMessage) {
    this.port.postMessage(msg)
  }

  private voiceOn(note: number, fromArp: boolean) {
    // Key Trigger : le LFO repart à chaque nouvelle note
    if (Math.round(this.params.lfoKeyTrig) === 1) this.lfo.reset()
    this.allocator.noteOn(note, fromArp)
  }

  /**
   * Notes jouées (clavier, MIDI) : transposées comme le séquenceur (manuel : Key transpose), enregistrées si REC,
   * puis vers l'arpégiateur s'il est actif, sinon directement aux voix.
   */
  private liveOn(note: number) {
    const recorded = this.sequencer.recordNoteOn(note)
    if (recorded) this.post({ type: 'recNote', ...recorded })
    const played = transposed(note, this.sequencer.pattern.transpose)
    this.liveTransposed.set(note, played)
    if (this.arp.on) this.arp.noteOn(played)
    else this.voiceOn(played, false)
  }

  private liveOff(note: number) {
    const recorded = this.sequencer.recordNoteOff(note)
    if (recorded) this.post({ type: 'recNote', ...recorded })
    const played = this.liveTransposed.get(note) ?? note
    this.liveTransposed.delete(note)
    if (this.arp.on) this.arp.noteOff(played)
    else this.allocator.noteOff(played)
  }

  private onMessage(msg: EngineMessage) {
    switch (msg.type) {
      case 'noteOn':
        this.sustained.delete(msg.note)
        this.liveOn(msg.note)
        break
      case 'noteOff':
        if (this.hold) this.sustained.add(msg.note)
        else this.liveOff(msg.note)
        break
      case 'allNotesOff':
        this.sustained.clear()
        this.arp.reset()
        this.allocator.allNotesOff()
        break
      case 'setPattern':
        this.sequencer.pattern = msg.pattern
        break
      case 'transport':
        if (msg.playing) {
          this.sequencer.start()
          this.riser.resetPhase()
        } else this.sequencer.stop()
        break
      case 'arpHold':
        this.arp.setHold(msg.on)
        break
      case 'recording':
        this.sequencer.recording = msg.on
        break
      case 'stepLoop':
        this.sequencer.loopSteps = [...msg.steps].sort((a, b) => a - b)
        break
      case 'setWave':
        this.wave.draw.set(msg.draw.slice(0, this.wave.draw.length))
        this.wave.chop.set(msg.chop.slice(0, this.wave.chop.length))
        break
      case 'perf':
        this.perfCutoff = msg.cutoffOct
        this.perfReso = msg.reso
        break
      case 'pitchBend':
        this.bend = msg.value
        break
      case 'modWheel':
        this.modWheel = msg.value
        break
      case 'hold':
        this.hold = msg.on
        if (!msg.on) {
          for (const note of this.sustained) this.liveOff(note)
          this.sustained.clear()
        }
        break
    }
  }

  private readBlockParams(parameters: Record<string, Float32Array>) {
    const p = this.params
    for (let i = 0; i < SYNTH_PARAMS.length; i++) {
      const id: ParamId = SYNTH_PARAMS[i].id
      p[id] = parameters[id][0]
    }
    // D-MOTION : la résonance varie autour du réglage du slider
    if (this.perfReso !== 0) p.resonance = Math.min(1, Math.max(0, p.resonance + this.perfReso))
    const a = this.allocator
    a.setMode(Math.round(p.voiceMode))
    a.priority = Math.round(p.notePriority)
    a.envTrigger = Math.round(p.envTrigger)
    a.portaMode = Math.round(p.portaMode)
    a.chordOn[0] = Math.round(p.chord2On) === 1
    a.chordOn[1] = Math.round(p.chord3On) === 1
    a.chordOn[2] = Math.round(p.chord4On) === 1
    a.chordShift[0] = mapChordShift(p.chord2Shift)
    a.chordShift[1] = mapChordShift(p.chord3Shift)
    a.chordShift[2] = mapChordShift(p.chord4Shift)
    for (let v = 0; v < this.voices.length; v++) this.voices[v].updateBlock(p)

    const tempo = mapTempo(p.tempo)
    const seq = this.sequencer
    seq.tempo = tempo
    seq.scale = Math.round(p.stepScale)
    seq.shuffle = mapShuffle(p.shuffle)
    seq.metronome = Math.round(p.metronome)
    seq.countIn = Math.round(p.countIn) === 0 ? 0 : Math.round(p.countIn) + 1
    const arpOn = Math.round(p.arpOn) === 1
    // Changement d'état de l'arpégiateur : les relâchements des touches en cours iraient au mauvais endroit,
    // on coupe donc tout pour ne laisser aucune note bloquée
    if (this.arp.on !== arpOn) {
      this.arp.reset()
      this.allocator.allNotesOff()
    }
    this.arp.on = arpOn
    this.arp.type = Math.round(p.arpType)
    this.arp.rate = Math.round(p.arpRate)
    this.arp.tempo = tempo
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const out = outputs[0]
    const left = out[0]
    if (!left) return true
    const right = out[1] ?? null

    this.readBlockParams(parameters)
    const p = this.params
    // LFO Sync : un cycle par valeur de note ; le mode Fast est alors désactivé (manuel)
    const rate =
      Math.round(p.lfoSync) === 1 ? lfoSyncHz(mapTempo(p.tempo), p.lfoNote) : mapLfoRate(p.lfoRate, Math.round(p.lfoMode) === 1)
    const wave = Math.round(p.lfoWave)
    const lfoTrig = this.allocator.envTrigger === EnvTrigger.Lfo
    const gain = MODE_GAIN[Math.round(p.voiceMode)] ?? MODE_GAIN[VoiceMode.Poly]
    const bendSemis = mapOscBend(p.oscBendSens)
    const bendOct = mapFilterBend(p.filterBendSens)
    const modSemis = mapLfoPitch(p.modDepth)
    const clickLevel = mapMetronomeLevel(p.metronomeLevel)
    const riserMode = Math.round(p.riserMode)
    const tempo = mapTempo(p.tempo)

    for (let i = 0; i < left.length; i++) {
      this.sequencer.tick()
      this.arp.tick()
      // Le LFO tourne en continu, même sans note, comme sur la machine
      const lfo = this.lfo.process(rate, wave, sampleRate)
      const bend = this.sBend.next(this.bend)
      // Molette : ajoute le LFO à la hauteur, dosé par Mod depth (schéma de signal : MODULATION → LFO MOD DEPTH)
      const pitchMod = bend * bendSemis + lfo * this.sMod.next(this.modWheel) * modSemis
      const filterMod = bend * bendOct + this.perfCutoff
      let sum = 0
      for (let v = 0; v < this.voices.length; v++) {
        const voice = this.voices[v]
        if (lfoTrig && this.lfo.wrapped) voice.retriggerEnv()
        if (voice.active) sum += voice.render(p, lfo, pitchMod, filterMod)
      }
      // Saturation douce au master : jamais d'écrêtage numérique, même résonance et volume au maximum
      let out = fastTanh(sum * gain)
      if (this.clickEnv > 1e-4) {
        this.clickPhase += (2 * Math.PI * this.clickFreq) / sampleRate
        out += Math.sin(this.clickPhase) * this.clickEnv * clickLevel
        this.clickEnv *= this.clickDecay
      }
      // Riser : stéréo (panoramique en mode QvPn)
      this.riser.process(riserMode, p.riserPos, p.riserReso, p.riserShape, p.riserLevel, tempo)
      left[i] = out + this.riser.left
      if (right) right[i] = out + this.riser.right
    }
    for (let ch = 2; ch < out.length; ch++) out[ch].set(left)
    // Position du séquenceur pour l'affichage : au plus un message par bloc
    if (this.stepToReport >= 0) {
      this.post({ type: 'step', index: this.stepToReport })
      this.stepToReport = -1
    }
    return true
  }
}

registerProcessor(PROCESSOR_NAME, S1Processor)
