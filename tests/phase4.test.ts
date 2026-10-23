import { describe, expect, it } from 'vitest'
import { CC_MAP, parseMidi } from '../src/audio/midi'
import { generateReverbIr, ReverbType } from '../src/audio/reverbIr'
import {
  cutFrequency,
  defaultParams,
  formatParam,
  HIGH_CUT_LABELS,
  LOW_CUT_LABELS,
  mapDelayTime,
  mapOscBend,
  PARAMS,
  SYNTH_PARAMS,
} from '../src/dsp/params'
import { VoiceMode } from '../src/dsp/allocator'

const def = (id: string) => PARAMS.find((p) => p.id === id)!

describe('parseMidi', () => {
  it('décode notes, note off par vélocité 0 et pitch bend', () => {
    expect(parseMidi([0x90, 60, 100], 0)).toEqual({ type: 'noteOn', note: 60 })
    expect(parseMidi([0x90, 60, 0], 0)).toEqual({ type: 'noteOff', note: 60 })
    expect(parseMidi([0x80, 60, 64], 0)).toEqual({ type: 'noteOff', note: 60 })
    expect(parseMidi([0xe0, 0, 64], 0)).toEqual({ type: 'pitchBend', value: 0 })
    expect(parseMidi([0xe0, 127, 127], 0)!).toMatchObject({ type: 'pitchBend' })
    expect((parseMidi([0xe0, 0, 0], 0) as { value: number }).value).toBe(-1)
  })

  it('filtre par canal, omni accepte tout', () => {
    expect(parseMidi([0x92, 60, 100], 3)).toEqual({ type: 'noteOn', note: 60 })
    expect(parseMidi([0x90, 60, 100], 3)).toBeNull()
    expect(parseMidi([0x9f, 60, 100], 0)).not.toBeNull()
  })

  it('molette, sustain, portamento et all notes off', () => {
    expect(parseMidi([0xb0, 1, 127], 0)).toEqual({ type: 'modWheel', value: 1 })
    expect(parseMidi([0xb0, 64, 127], 0)).toEqual({ type: 'hold', on: true })
    expect(parseMidi([0xb0, 64, 0], 0)).toEqual({ type: 'hold', on: false })
    expect(parseMidi([0xb0, 65, 127], 0)).toEqual({ type: 'param', id: 'portaMode', value: 1 })
    expect(parseMidi([0xb0, 123, 0], 0)).toEqual({ type: 'allNotesOff' })
  })

  it('CC des potards du S-1, y compris les ordres d’options de la machine', () => {
    expect(parseMidi([0xb0, 74, 127], 0)).toEqual({ type: 'param', id: 'cutoff', value: 1 })
    expect(parseMidi([0xb0, 14, 3], 0)).toEqual({ type: 'param', id: 'range', value: 3 })
    // CC80 : 0 = Mono sur la machine
    expect(parseMidi([0xb0, 80, 0], 0)).toEqual({ type: 'param', id: 'voiceMode', value: VoiceMode.Mono })
    expect(parseMidi([0xb0, 80, 2], 0)).toEqual({ type: 'param', id: 'voiceMode', value: VoiceMode.Poly })
    // CC31 : 1 = Auto sur la machine
    expect(parseMidi([0xb0, 31, 1], 0)).toEqual({ type: 'param', id: 'portaMode', value: 2 })
    // CC85 : 64 + 7 = +7 demi-tons → index 19
    expect(parseMidi([0xb0, 85, 71], 0)).toEqual({ type: 'param', id: 'chord2Shift', value: 19 })
    // Index hors bornes ramené au dernier choix
    expect(parseMidi([0xb0, 12, 100], 0)).toEqual({ type: 'param', id: 'lfoWave', value: 5 })
  })

  it('ignore les messages système et les CC inconnus', () => {
    expect(parseMidi([0xf8], 0)).toBeNull()
    expect(parseMidi([0xb0, 2, 10], 0)).toBeNull()
  })

  it('toutes les cibles du CC_MAP existent', () => {
    for (const [id] of Object.values(CC_MAP)) expect(def(id)).toBeDefined()
  })
})

describe('Paramètres d’effets', () => {
  it('reprennent les valeurs INIT : effets coupés, réglages de la machine', () => {
    const p = defaultParams()
    expect(p.chorusType + p.delayLevel + p.reverbLevel).toBe(0)
    expect(formatParam(def('delayTime'), p.delayTime)).toBe('500 ms')
    expect(formatParam(def('delayLowCut'), p.delayLowCut)).toBe('250')
    expect(formatParam(def('delayHighCut'), p.delayHighCut)).toBe('12.5k')
    expect(formatParam(def('reverbHighCut'), p.reverbHighCut)).toBe('10k')
    expect(formatParam(def('reverbType'), p.reverbType)).toBe('Spring')
    expect(formatParam(def('reverbPreDelay'), p.reverbPreDelay)).toBe('20 ms')
    expect(mapOscBend(p.oscBendSens)).toBeCloseTo(2)
  })

  it('Delay Time suit les points mesurés (1 à 740 ms)', () => {
    expect(mapDelayTime(0) * 1000).toBeCloseTo(1)
    expect(mapDelayTime(106 / 255) * 1000).toBeCloseTo(273)
    expect(mapDelayTime(1) * 1000).toBeCloseTo(740)
  })

  it('coupures Flat = pas de filtre', () => {
    expect(cutFrequency(LOW_CUT_LABELS, 0)).toBeNull()
    expect(cutFrequency(HIGH_CUT_LABELS, HIGH_CUT_LABELS.length - 1)).toBeNull()
    expect(cutFrequency(HIGH_CUT_LABELS, 2)).toBe(1000)
    expect(cutFrequency(LOW_CUT_LABELS, 3)).toBe(31.5)
  })

  it('le worklet ne reçoit pas les paramètres d’effets', () => {
    expect(SYNTH_PARAMS.some((p) => ['chorus', 'delay', 'reverb'].includes(p.section))).toBe(false)
    expect(SYNTH_PARAMS.some((p) => p.id === 'modDepth')).toBe(true)
  })
})

describe('generateReverbIr', () => {
  const SR = 48000
  const energy = (a: Float32Array) => a.reduce((s, x) => s + x * x, 0)
  const rmsBetween = (a: Float32Array, t0: number, t1: number) => {
    let s = 0
    for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) s += a[i] * a[i]
    return Math.sqrt(s / ((t1 - t0) * SR))
  }

  it('est normalisée en énergie, quel que soit le type', () => {
    for (const type of Object.values(ReverbType)) {
      const [l, r] = generateReverbIr({ type, rt60: 2, density: 10, sampleRate: SR })
      expect((energy(l) + energy(r)) / 2).toBeCloseTo(1, 3)
    }
  })

  it('décroît d’environ 60 dB sur le RT60', () => {
    const rt60 = 2
    const [l] = generateReverbIr({ type: ReverbType.Plate, rt60, density: 10, sampleRate: SR })
    const early = rmsBetween(l, 0.1, 0.2)
    // Plate : timeScale 0,9 → RT60 effectif 1,8 s ; à ~1,8 s on doit être autour de -60 dB
    const late = rmsBetween(l, 1.75, 1.85)
    const dropDb = 20 * Math.log10(late / early)
    expect(dropDb).toBeLessThan(-45)
    expect(dropDb).toBeGreaterThan(-75)
  })

  it('une densité faible donne une queue plus clairsemée', () => {
    const zeros = (a: Float32Array) => a.filter((x) => Math.abs(x) < 1e-6).length
    const [dense] = generateReverbIr({ type: ReverbType.Hall1, rt60: 1, density: 10, sampleRate: SR })
    const [sparse] = generateReverbIr({ type: ReverbType.Hall1, rt60: 1, density: 0, sampleRate: SR })
    // Le passe-bas lisse les impulsions ; on compare donc la crête relative (facteur de crête)
    const crest = (a: Float32Array) => Math.max(...a.map(Math.abs)) / Math.sqrt(energy(a) / a.length)
    expect(crest(sparse)).toBeGreaterThan(crest(dense))
    expect(zeros(dense)).toBeLessThan(dense.length * 0.01)
  })

  it('gauche et droite sont décorrélées (largeur stéréo)', () => {
    const [l, r] = generateReverbIr({ type: ReverbType.Hall2, rt60: 1.5, density: 10, sampleRate: SR })
    let dot = 0
    for (let i = 0; i < l.length; i++) dot += l[i] * r[i]
    const corr = dot / Math.sqrt(energy(l) * energy(r))
    expect(Math.abs(corr)).toBeLessThan(0.3)
  })
})
