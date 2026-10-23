import { clamp, midiToHz, polyBlep } from './math'

/*
 * Moteur 303 : port en TypeScript d'Open303 (Robin Schmidt, licence MIT, github.com/RobinSchmidt/Open303).
 * Même chaîne que l'original : oscillateur scie / carré 303 → passe-haut → filtre TB_303 (équations de
 * mystran et kunn, ajustements d'antto) suréchantillonné 4x → filtre anti-repliement → passe-tout, passe-haut,
 * coupe-bande → VCA. Enveloppe principale (MEG) à décroissance seule, accent et slide comme sur la machine.
 * Écarts avec l'original : formes d'onde calculées (PolyBLEP) au lieu des tables mip-mappées, pile de notes
 * de taille fixe (pas d'allocation dans le worklet).
 *
 * Copyright (c) 2009 Robin Schmidt — MIT : Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software (...) THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

const OVERSAMPLING = 4
const TINY = 1e-20

/** Passe-bas / passe-haut / passe-tout à un pôle (rosic::OnePoleFilter). */
class OnePole {
  private b0 = 1
  private b1 = 0
  private a1 = 0
  private x1 = 0
  private y1 = 0

  highpass(cutoff: number, sampleRate: number) {
    const x = Math.exp((-2 * Math.PI * cutoff) / sampleRate)
    this.b0 = 0.5 * (1 + x)
    this.b1 = -0.5 * (1 + x)
    this.a1 = x
    return this
  }

  allpass(cutoff: number, sampleRate: number) {
    const t = Math.tan((Math.PI * cutoff) / sampleRate)
    const x = (t - 1) / (t + 1)
    this.b0 = x
    this.b1 = 1
    this.a1 = -x
    return this
  }

  reset() {
    this.x1 = this.y1 = 0
  }

  process(x: number) {
    this.y1 = this.b0 * x + this.b1 * this.x1 + this.a1 * this.y1 + TINY
    this.x1 = x
    return this.y1
  }
}

/** Biquad (rosic::BiquadFilter) : passe-bas 12 dB et coupe-bande, convention y = b·x + a·y. */
class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  lowpass12(freq: number, q: number, sampleRate: number) {
    const w = (2 * Math.PI * freq) / sampleRate
    const s = Math.sin(w)
    const c = Math.cos(w)
    const alpha = s / (2 * q)
    const scale = 1 / (1 + alpha)
    this.a1 = 2 * c * scale
    this.a2 = (alpha - 1) * scale
    this.b1 = (1 - c) * scale
    this.b0 = this.b2 = 0.5 * this.b1
    return this
  }

  bandReject(freq: number, bandwidth: number, sampleRate: number) {
    const w = (2 * Math.PI * freq) / sampleRate
    const s = Math.sin(w)
    const c = Math.cos(w)
    const alpha = s * Math.sinh((0.5 * Math.log(2) * bandwidth * w) / s)
    const scale = 1 / (1 + alpha)
    this.a1 = 2 * c * scale
    this.a2 = (alpha - 1) * scale
    this.b0 = this.b2 = scale
    this.b1 = -2 * c * scale
    return this
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }

  process(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 + this.a1 * this.y1 + this.a2 * this.y2 + TINY
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Filtre elliptique d'ordre 12 coupant au quart de la fréquence d'échantillonnage (décimation 4x). */
class EllipticQuarterBand {
  private readonly w = new Float64Array(12)

  reset() {
    this.w.fill(0)
  }

  process(x: number) {
    const w = this.w
    const tmp =
      x + TINY -
      (-9.1891604652189471 * w[0] + 40.177553696870497 * w[1] - 110.11636661771178 * w[2] + 210.18506612078195 * w[3]) -
      (-293.8474477190324 * w[4] + 308.16345558359234 * w[5] - 244.06786780384243 * w[6] + 144.81877911392738 * w[7]) -
      (-62.770692151724198 * w[8] + 18.867762095902137 * w[9] - 3.5327094230551848 * w[10] + 0.31183189275203149 * w[11])
    const y =
      0.00013671732099945628 * tmp +
      (-0.00055538501265606384 * w[0] + 0.0013681887636296387 * w[1] - 0.0022158566490711852 * w[2] + 0.0028320091007278322 * w[3]) +
      (-0.0029776933151090413 * w[4] + 0.0030283628243514991 * w[5] - 0.0029776933151090413 * w[6] + 0.0028320091007278331 * w[7]) +
      (-0.0022158566490711861 * w[8] + 0.0013681887636296393 * w[9] - 0.00055538501265606384 * w[10] + 0.00013671732099945636 * w[11])
    w.copyWithin(1, 0, 11)
    w[0] = tmp
    return y
  }
}

/** Filtre TB_303 (rosic::TeeBeeFilter, mode TB_303) : 4 pôles, passe-haut dans la boucle de résonance. */
class TeeBeeFilter {
  private y1 = 0
  private y2 = 0
  private y3 = 0
  private y4 = 0
  private b0 = 0
  private k = 0
  private g = 1
  private resonanceSkewed = 0
  private readonly feedbackHighpass: OnePole

  constructor(private readonly sampleRate: number) {
    this.feedbackHighpass = new OnePole().highpass(150, sampleRate)
  }

  reset() {
    this.y1 = this.y2 = this.y3 = this.y4 = 0
    this.feedbackHighpass.reset()
  }

  /** Résonance 0..1, courbe « musicale » de l'original. */
  setResonance(r: number) {
    this.resonanceSkewed = (1 - Math.exp(-3 * r)) / (1 - Math.exp(-3))
  }

  setCutoff(cutoff: number) {
    const wc = ((2 * Math.PI) / this.sampleRate) * clamp(cutoff, 200, 20000)
    const r = this.resonanceSkewed
    const fx = (wc * Math.SQRT1_2) / (2 * Math.PI)
    this.b0 = (0.00045522346 + 6.1922189 * fx) / (1.0 + 12.358354 * fx + 4.4156345 * (fx * fx))
    let k = fx * (fx * (fx * (fx * (fx * (fx + 7198.6997) - 5837.7917) - 476.47308) + 614.95611) + 213.87126) + 16.998792
    let g = k / 17
    g = (g - 1) * r + 1
    this.g = g * (1 + r)
    this.k = k * r
  }

  process(x: number) {
    const b0 = this.b0
    const y0 = x - this.feedbackHighpass.process(this.k * this.y4)
    this.y1 += 2 * b0 * (y0 - this.y1 + this.y2)
    this.y2 += b0 * (this.y1 - 2 * this.y2 + this.y3)
    this.y3 += b0 * (this.y2 - 2 * this.y3 + this.y4)
    this.y4 += b0 * (this.y3 - 2 * this.y4)
    return 2 * this.g * this.y4
  }
}

/** Enveloppe d'ampli (rosic::AnalogEnvelope) : attaque nulle, décroissance, relâchement, temps en ms. */
class AmpEnvelope {
  private out = 0
  private time = 0
  private noteOn = false
  private decayCoeff = 0
  private releaseCoeff = 0
  private readonly increment: number

  constructor(
    private readonly sampleRate: number,
    private readonly decayMs: number,
    private readonly sustain: number,
  ) {
    this.increment = 1000 / sampleRate
    this.decayCoeff = this.coeff(decayMs)
  }

  private coeff(ms: number) {
    return ms > 0 ? 1 - Math.exp(-1 / (this.sampleRate * 0.001 * ms)) : 1
  }

  setRelease(ms: number) {
    this.releaseCoeff = this.coeff(ms)
  }

  get isNoteOn() {
    return this.noteOn
  }

  get level() {
    return this.out
  }

  trigger() {
    this.time = 0
    this.noteOn = true
  }

  release() {
    this.noteOn = false
    this.time = this.decayMs + this.increment
  }

  next() {
    if (this.time <= 0) {
      this.out = 1
      this.time += this.increment
    } else if (this.time <= this.decayMs || this.noteOn) {
      this.out += this.decayCoeff * (this.sustain - this.out)
      if (this.time <= this.decayMs) this.time += this.increment
    } else {
      this.out += this.releaseCoeff * -this.out
    }
    return this.out
  }
}

// Courbe mesurée sur machine (Open303, calculateEnvModScalerAndOffset) : profondeur et décalage de l'enveloppe
const CUTOFF_LOW = 313.8152786059267
const CUTOFF_HIGH = 2394.411986817546

/** Paramètres de la 303, en unités de l'original. */
export interface Tb303Settings {
  /** Hz, 314..2394 sur la plage du potard */
  cutoff: number
  /** 0..1 */
  resonance: number
  /** 0..1 */
  envMod: number
  /** ms, 200..2000 */
  decay: number
  /** 0..1 */
  accent: number
  /** 0 = scie, 1 = carré */
  waveform: number
}

const MAX_HELD = 16
const SLIDE_TIME_MS = 60
const NORMAL_RELEASE_MS = 1
const ACCENT_RELEASE_MS = 50
const ACCENT_DECAY_MS = 200
const AMP_DECAY_MS = 1230
// Carré 303 : scie mise en forme par tanh, décalée d'une demi-période (valeurs de l'original)
const SQUARE_DRIVE = Math.pow(10, 36.9 / 20)
const SQUARE_OFFSET = 4.37

/**
 * Voix 303 monophonique. Une note jouée pendant qu'une autre est tenue glisse vers elle (slide) sans
 * redéclencher les enveloppes ; au relâchement, retour à la note encore tenue la plus récente.
 */
export class Tb303 {
  private readonly osr: number
  private phase = 0
  private freq = 440
  private targetFreq = 440
  private readonly slideCoef: number

  private readonly highpass1: OnePole
  private readonly filter: TeeBeeFilter
  private readonly antiAlias = new EllipticQuarterBand()
  private readonly allpass: OnePole
  private readonly highpass2: OnePole
  private readonly notch: Biquad
  private readonly deClicker: Biquad
  private readonly ampEnv: AmpEnvelope

  // Enveloppe principale (MEG) : décroissance exponentielle seule, redéclenchée à chaque attaque
  private meg = 0
  private megCoef = 0
  private readonly rc2Coef: number
  private rc2 = 0
  private accentGain = 0
  private idle = true

  private readonly held = new Int16Array(MAX_HELD)
  private heldCount = 0
  /** Note jouée (après glissement) ; -1 si aucune. */
  note = -1

  constructor(private readonly sampleRate: number) {
    this.osr = sampleRate * OVERSAMPLING
    this.slideCoef = Math.exp(-1 / (sampleRate * 0.001 * 0.2 * SLIDE_TIME_MS))
    this.rc2Coef = Math.exp(-1 / (sampleRate * 0.001 * 15))
    this.highpass1 = new OnePole().highpass(44.486, this.osr)
    this.filter = new TeeBeeFilter(this.osr)
    this.allpass = new OnePole().allpass(14.008, sampleRate)
    this.highpass2 = new OnePole().highpass(24.167, sampleRate)
    this.notch = new Biquad().bandReject(7.5164, 4.7, sampleRate)
    this.deClicker = new Biquad().lowpass12(200, Math.SQRT1_2, sampleRate)
    this.ampEnv = new AmpEnvelope(sampleRate, AMP_DECAY_MS, 0)
  }

  /** Fréquence courante de l'oscillateur, sans pitch bend (pour les tests du slide). */
  get frequency() {
    return this.freq
  }

  get active() {
    return !this.idle
  }

  noteOn(note: number, accent: boolean, s: Tb303Settings) {
    const wasEmpty = this.heldCount === 0
    this.removeHeld(note)
    if (this.heldCount < MAX_HELD) this.held[this.heldCount++] = note
    this.setAccent(accent, s)
    this.targetFreq = midiToHz(note)
    this.note = note
    if (wasEmpty) this.trigger()
  }

  noteOff(note: number) {
    this.removeHeld(note)
    if (this.heldCount === 0) {
      this.ampEnv.release()
      return
    }
    // Retour glissé vers la note encore tenue la plus récente
    this.note = this.held[this.heldCount - 1]
    this.targetFreq = midiToHz(this.note)
  }

  allNotesOff() {
    this.heldCount = 0
    this.ampEnv.release()
  }

  private removeHeld(note: number) {
    let j = 0
    for (let i = 0; i < this.heldCount; i++) if (this.held[i] !== note) this.held[j++] = this.held[i]
    this.heldCount = j
  }

  private setAccent(accent: boolean, s: Tb303Settings) {
    this.accentGain = accent ? s.accent : 0
    this.megCoef = Math.exp(-1 / (0.001 * (accent ? ACCENT_DECAY_MS : s.decay) * this.sampleRate))
    this.ampEnv.setRelease(accent ? ACCENT_RELEASE_MS : NORMAL_RELEASE_MS)
  }

  private trigger() {
    // Oscillateur et filtres remis à zéro seulement si la voix était silencieuse (pas de clic)
    if (this.idle) {
      this.phase = 0
      this.filter.reset()
      this.highpass1.reset()
      this.highpass2.reset()
      this.allpass.reset()
      this.notch.reset()
      this.antiAlias.reset()
      this.deClicker.reset()
    }
    this.freq = this.targetFreq
    this.meg = 1 / this.megCoef
    this.ampEnv.trigger()
    this.idle = false
  }

  /** Oscillateur 303 au taux suréchantillonné : mélange scie / carré, phase en cycles. */
  private oscillator(dt: number, waveform: number) {
    const p = this.phase
    // Scie : montée de -1 à +1, saut à la moitié du cycle (table SAW303)
    let t = p + 0.5
    if (t >= 1) t -= 1
    const saw = 2 * t - 1 - polyBlep(t, dt)
    // Carré : -tanh(drive · scie décalée + offset), saut de -1 à +1 en début de cycle
    const square = -Math.tanh(SQUARE_DRIVE * (2 * p - 1) + SQUARE_OFFSET) + polyBlep(p, dt)
    this.phase = p + dt >= 1 ? p + dt - 1 : p + dt
    return (1 - waveform) * saw + waveform * 0.5 * square
  }

  /**
   * Un échantillon. pitchOffset : demi-tons ajoutés (range, fine tune, bend…). cutoffOffset : octaves ajoutées au cutoff.
   */
  render(s: Tb303Settings, pitchOffset: number, cutoffOffset: number): number {
    if (this.idle) return 0

    this.freq = this.targetFreq + (this.freq - this.targetFreq) * this.slideCoef
    const dt = Math.min((this.freq * Math.pow(2, pitchOffset / 12)) / this.osr, 0.25)

    // Cutoff : enveloppe principale mise à l'échelle selon la courbe mesurée, plus l'accent (filtre RC)
    this.meg *= this.megCoef
    const e = clamp(s.envMod, 0, 1)
    const c = clamp(Math.log(s.cutoff / CUTOFF_LOW) / Math.log(CUTOFF_HIGH / CUTOFF_LOW), 0, 1)
    const scaler = (1 - c) * (3.773996325111173 * e + 0.736965594166206) + c * (4.194548788411135 * e + 0.864344900642434)
    const offset = 0.048292930943553 * c + 0.294391201442418
    this.rc2 = (this.accentGain > 0 ? this.meg : 0) + this.rc2Coef * (this.rc2 - (this.accentGain > 0 ? this.meg : 0))
    const octaves = scaler * (this.meg - offset) + this.accentGain * this.rc2 + cutoffOffset
    this.filter.setResonance(s.resonance)
    this.filter.setCutoff(s.cutoff * Math.pow(2, octaves))

    let amp = this.ampEnv.next()
    if (this.ampEnv.isNoteOn) amp += 0.45 * this.meg + this.accentGain * 4 * this.meg
    amp = this.deClicker.process(amp)

    let x = 0
    for (let i = 0; i < OVERSAMPLING; i++) {
      x = -this.oscillator(dt, s.waveform)
      x = this.highpass1.process(x)
      x = this.filter.process(x)
      x = this.antiAlias.process(x)
    }
    x = this.allpass.process(x)
    x = this.highpass2.process(x)
    x = this.notch.process(x)

    if (!this.ampEnv.isNoteOn && this.ampEnv.level < 1e-5 && Math.abs(amp) < 1e-5) this.idle = true
    return x * amp
  }
}
