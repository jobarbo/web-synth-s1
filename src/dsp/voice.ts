import { CHOP_NONE, chopMix, DrawMode, drawSample, INIT_DRAW_FORM, type ChopInput } from './draw'
import { Envelope } from './envelope'
import { LadderFilter } from './filter'
import { midiToHz, onePoleCoef, Smoother } from './math'
import { Noise, Oscillator, PinkFilter } from './osc'
import {
  mapCutoff,
  mapEnvMod,
  mapFineTune,
  mapKeyFollow,
  mapMultiply,
  mapOvertone,
  mapAttackTime,
  mapDecayTime,
  mapLfoFilter,
  mapLfoPitch,
  mapPortaTime,
  mapPulseWidth,
  mapReleaseTime,
  mapRange,
  mapResonance,
  mapVolume,
  type ParamId,
} from './params'

const SMOOTH_TIME = 0.005
const GATE_TIME = 0.002
const OUTPUT_GAIN = 1.2
// Bruit de fond minimal, comme un circuit réel : permet au filtre d'auto-osciller sans signal d'entrée
const NOISE_FLOOR = 1e-4

export const PwmSource = { Env: 0, Manual: 1, Lfo: 2 } as const
export const NoiseMode = { Pink: 0, White: 1 } as const

/** Données de forme partagées par les voix : cycle Draw (16 pas, -100..100) et masques Chop (carré, scie, sub, bruit). */
export interface WaveData {
  draw: Float32Array
  chop: Int32Array
}

export const createWaveData = (): WaveData => ({
  draw: Float32Array.from(INIT_DRAW_FORM),
  chop: Int32Array.from([CHOP_NONE, CHOP_NONE, CHOP_NONE, CHOP_NONE]),
})
export const AmpMode = { Gate: 0, Env: 1 } as const

/** Une voix complète : OSC → MIXER → VCF → VCA. */
export class Voice {
  /** Note cible (MIDI). */
  note = 60
  gate = false
  /** Décalage fixe en demi-tons (désaccord de l'Unison). */
  detune = 0
  /** Hauteur courante, qui rejoint `note` à la vitesse du portamento. */
  private pitch = 60
  private gliding = false
  /** Une voix qui n'a encore rien joué n'a pas de note de départ pour glisser. */
  private played = false
  private portaCoef = 0

  private readonly osc = new Oscillator()
  private readonly noise: Noise
  private readonly pink = new PinkFilter()
  /** Préalloué : entrée de chopMix, réutilisée à chaque échantillon. */
  private readonly chopInput: ChopInput = { square: 0, saw: 0, sub: 0, noise: 0 }
  /** Forme Draw et masques Chop, partagés avec le processeur. */
  wave: WaveData = createWaveData()
  private readonly filter = new LadderFilter()
  private readonly env = new Envelope()

  private readonly sr: number
  private readonly sCutoff: Smoother
  private readonly sPw: Smoother
  private readonly sSaw: Smoother
  private readonly sPulse: Smoother
  private readonly sSub: Smoother
  private readonly sNoise: Smoother
  private readonly sVol: Smoother
  private readonly sGate: Smoother

  constructor(sampleRate: number, seed = 0x9e3779b9) {
    this.sr = sampleRate
    this.noise = new Noise(seed)
    this.sCutoff = new Smoother(0.5, SMOOTH_TIME, sampleRate)
    this.sPw = new Smoother(0.5, SMOOTH_TIME, sampleRate)
    this.sSaw = new Smoother(0, SMOOTH_TIME, sampleRate)
    this.sPulse = new Smoother(0, SMOOTH_TIME, sampleRate)
    this.sSub = new Smoother(0, SMOOTH_TIME, sampleRate)
    this.sNoise = new Smoother(0, SMOOTH_TIME, sampleRate)
    this.sVol = new Smoother(0, SMOOTH_TIME, sampleRate)
    this.sGate = new Smoother(0, GATE_TIME, sampleRate)
  }

  get currentPitch() {
    return this.pitch
  }

  get active() {
    return this.gate || this.env.active || this.sGate.value > 1e-4
  }

  /**
   * retrigger : relance l'attaque de l'enveloppe.
   * glide : rejoint la nouvelle note au temps de portamento au lieu d'y sauter.
   * from : hauteur de départ du glissé (en Poly, la dernière note jouée, quelle que soit la voix).
   *        Par défaut, la voix part de sa propre hauteur courante.
   */
  noteOn(note: number, retrigger: boolean, glide = false, from?: number) {
    this.note = note
    this.gliding = glide && (from !== undefined || this.played)
    this.played = true
    if (!this.gliding) this.pitch = note
    else if (from !== undefined) this.pitch = from
    if (retrigger || !this.gate) this.env.gateOn()
    this.gate = true
  }

  noteOff() {
    this.gate = false
    this.env.gateOff()
  }

  /** ENV TRG = LFO : relance l'attaque tant que la note est tenue. */
  retriggerEnv() {
    if (this.gate) this.env.gateOn()
  }

  /** Appelé une fois par bloc : coefficients d'enveloppe et de portamento. */
  updateBlock(p: Record<ParamId, number>) {
    this.env.setParams(mapAttackTime(p.attack), mapDecayTime(p.decay), p.sustain, mapReleaseTime(p.release), this.sr)
    this.portaCoef = onePoleCoef(mapPortaTime(p.portaTime) / 4, this.sr)
  }

  /**
   * lfo : sortie du LFO global, -1..1.
   * pitchMod : demi-tons ajoutés (pitch bend + molette). filterMod : octaves ajoutées au cutoff (bend filtre).
   */
  render(p: Record<ParamId, number>, lfo: number, pitchMod = 0, filterMod = 0): number {
    if (this.gliding) this.pitch = this.note + (this.pitch - this.note) * this.portaCoef
    else this.pitch = this.note

    const env = this.env.next()
    const semis =
      this.pitch + this.detune + 12 * mapRange(p.range) + mapFineTune(p.fineTune) + mapLfoPitch(p.oscLfo) * lfo + pitchMod
    const freq = midiToHz(semis)
    const width = this.pulseWidth(p, env, lfo)
    const o = this.osc.process(freq, this.sPw.next(width), Math.round(p.subMode), this.sr)

    // OSC DRAW remplace le carré (sans PWM)
    const drawMode = Math.round(p.drawMode)
    const square =
      drawMode === DrawMode.Off
        ? o.pulse
        : drawSample(this.wave.draw, drawMode === DrawMode.Slope, this.osc.lastPhase, this.osc.lastDt, mapMultiply(p.drawMult))

    const white = this.noise.next()
    const noise = Math.round(p.noiseMode) === NoiseMode.Pink ? this.pink.next(white) : white

    const x = this.chopInput
    x.square = square * this.sPulse.next(p.pulseLevel)
    x.saw = o.saw * this.sSaw.next(p.sawLevel)
    x.sub = o.sub * this.sSub.next(p.subLevel)
    x.noise = noise * this.sNoise.next(p.noiseLevel)
    const mix =
      chopMix(x, this.wave.chop, mapOvertone(p.chopOvertone), mapMultiply(p.chopComb), this.osc.lastPhase, this.osc.lastDt, freq) +
      white * NOISE_FLOOR

    // Modulations additionnées en octaves autour du cutoff du slider.
    // Kybd est associé à l'Env (sur le S-1, c'est la fonction SHIFT du potard Filter ENV) : plus l'Env est haut,
    // plus les touches aiguës ouvrent le filtre et plus les graves le referment ; Env à 0 = pas de suivi.
    const keyTrack = (mapKeyFollow(p.keyFollow) * p.envMod * (this.pitch - 60)) / 12
    const modOct = mapEnvMod(p.envMod) * env + mapLfoFilter(p.filterLfo) * lfo + keyTrack + filterMod
    const cutoff = mapCutoff(this.sCutoff.next(p.cutoff)) * Math.pow(2, modOct)
    const filtered = this.filter.process(mix, cutoff, mapResonance(p.resonance), this.sr)

    const gateAmp = this.sGate.next(this.gate ? 1 : 0)
    const amp = Math.round(p.vcaMode) === AmpMode.Gate ? gateAmp : env
    return filtered * amp * this.sVol.next(mapVolume(p.volume)) * OUTPUT_GAIN
  }

  /** PWM SRC : Man = largeur fixe réglée par PWM ; Env / LFO = PWM règle la profondeur de modulation. */
  private pulseWidth(p: Record<ParamId, number>, env: number, lfo: number): number {
    switch (Math.round(p.pwmSource)) {
      case PwmSource.Env:
        return mapPulseWidth(p.pulseWidth * env)
      case PwmSource.Lfo:
        return mapPulseWidth(p.pulseWidth * (0.5 + 0.5 * lfo))
      default:
        return mapPulseWidth(p.pulseWidth)
    }
  }
}
