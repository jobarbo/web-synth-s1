import { describe, expect, it } from 'vitest'
import { VoiceAllocator, VoiceMode } from '../src/dsp/allocator'
import { midiToHz } from '../src/dsp/math'
import { defaultParams } from '../src/dsp/params'
import { Tb303, type Tb303Settings } from '../src/dsp/tb303'
import { Voice } from '../src/dsp/voice'

const SR = 48000
const rms = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
const peak = (a: number[]) => Math.max(...a.map(Math.abs))

const settings = (over: Partial<Tb303Settings> = {}): Tb303Settings => ({
  cutoff: 1000,
  resonance: 0.5,
  envMod: 0.25,
  decay: 400,
  accent: 0.5,
  waveform: 0.85,
  ...over,
})

function render(tb: Tb303, s: Tb303Settings, samples: number, pitch = 0) {
  const out: number[] = []
  for (let i = 0; i < samples; i++) out.push(tb.render(s, pitch, 0))
  return out
}

describe('Moteur 303', () => {
  it('silencieux sans note, puis jamais de NaN aux réglages extrêmes', () => {
    const tb = new Tb303(SR)
    expect(render(tb, settings(), 100).every((x) => x === 0)).toBe(true)
    for (const extreme of [0, 1]) {
      const s = settings({ cutoff: extreme ? 2394 : 314, resonance: extreme, envMod: extreme, decay: extreme ? 2000 : 200, accent: extreme, waveform: extreme })
      const t = new Tb303(SR)
      t.noteOn(extreme ? 96 : 24, true, s)
      const out = render(t, s, SR / 2)
      expect(out.every(Number.isFinite)).toBe(true)
      // Accent à fond : enveloppe d'ampli + jusqu'à 4,45 × MEG, comme l'original ; le master (tanh) borne la sortie
      expect(peak(out)).toBeLessThan(8)
    }
  })

  it('joue à la hauteur de la note (A2 = 110 Hz)', () => {
    const tb = new Tb303(SR)
    const s = settings({ waveform: 0, resonance: 0, cutoff: 2394, envMod: 0 })
    tb.noteOn(45, false, s)
    const out = render(tb, s, SR)
    // Fondamental estimé par autocorrélation sur la deuxième moitié (régime établi)
    const x = out.slice(SR / 2)
    let best = 0
    let bestLag = 0
    for (let lag = Math.round(SR / 140); lag <= Math.round(SR / 90); lag++) {
      let c = 0
      for (let i = 0; i + lag < x.length; i++) c += x[i] * x[i + lag]
      if (c > best) {
        best = c
        bestLag = lag
      }
    }
    expect(SR / bestLag).toBeCloseTo(110, 0)
  })

  it('slide : une note jouée legato glisse en ~60 ms sans redéclencher les enveloppes', () => {
    const tb = new Tb303(SR)
    const s = settings()
    tb.noteOn(36, false, s)
    render(tb, s, SR / 10)
    tb.noteOn(48, false, s)
    render(tb, s, 1)
    const mid = tb.frequency
    expect(mid).toBeGreaterThan(midiToHz(36))
    expect(mid).toBeLessThan(midiToHz(48))
    render(tb, s, Math.round(SR * 0.1))
    expect(tb.frequency).toBeCloseTo(midiToHz(48), 0)
    // Relâchement de la 2e note : retour glissé vers la 1re, toujours tenue
    tb.noteOff(48)
    render(tb, s, Math.round(SR * 0.1))
    expect(tb.frequency).toBeCloseTo(midiToHz(36), 0)
  })

  it('accent : plus fort qu’une note normale', () => {
    const s = settings()
    const normal = new Tb303(SR)
    normal.noteOn(36, false, s)
    const accented = new Tb303(SR)
    accented.noteOn(36, true, s)
    expect(peak(render(accented, s, SR / 4))).toBeGreaterThan(peak(render(normal, s, SR / 4)) * 1.2)
  })

  it('se tait après le relâchement', () => {
    const tb = new Tb303(SR)
    const s = settings()
    tb.noteOn(36, false, s)
    render(tb, s, SR / 4)
    tb.noteOff(36)
    render(tb, s, SR / 2)
    expect(tb.active).toBe(false)
  })

  it('niveau proche d’une voix S-1 au patch INIT (±6 dB), avec le gain du worklet', () => {
    const p = defaultParams()
    const voices = Array.from({ length: 4 }, () => new Voice(SR))
    const a = new VoiceAllocator(voices)
    a.setMode(VoiceMode.Mono)
    for (const v of voices) v.updateBlock(p)
    a.noteOn(48)
    const s1: number[] = []
    for (let i = 0; i < SR / 2; i++) s1.push(voices[0].render(p, 0))

    // Mêmes conversions que le worklet (s1-processor.ts) : réglages INIT, range 16' = -12 demi-tons
    const TB303_GAIN = 0.35
    const s = settings({ cutoff: 314 * Math.pow(2394 / 314, p.cutoff), resonance: p.resonance, envMod: p.envMod, decay: 200 * Math.pow(10, p.decay), waveform: 1 })
    const tb = new Tb303(SR)
    tb.noteOn(48, false, s)
    const volume = p.volume * p.volume
    const out = render(tb, s, SR / 2, -12).map((x) => x * volume * TB303_GAIN)
    const db = 20 * Math.log10(rms(out) / rms(s1))
    expect(Math.abs(db)).toBeLessThan(6)
  })
})
