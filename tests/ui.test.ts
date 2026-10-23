import { describe, expect, it } from 'vitest'
import { formatParam, PARAMS } from '../src/dsp/params'
import { dragStep, FINE_FACTOR, keyStep } from '../src/ui/dragValue'

const def = (id: string) => PARAMS.find((p) => p.id === id)!

describe('dragStep', () => {
  it('parcourt toute la plage sur la course en pixels', () => {
    expect(dragStep(0, 100, 100, false)).toBe(1)
    expect(dragStep(1, -50, 100, false)).toBe(0.5)
  })

  it('divise la sensibilité en mode fin', () => {
    expect(dragStep(0.5, 100, 100, true)).toBeCloseTo(0.5 + 1 / FINE_FACTOR)
  })

  it('reste dans 0..1', () => {
    expect(dragStep(0.9, 500, 100, false)).toBe(1)
    expect(dragStep(0.1, -500, 100, false)).toBe(0)
  })
})

describe('keyStep', () => {
  it('applique les pas ARIA', () => {
    expect(keyStep(0.5, 'ArrowUp', false)).toBeCloseTo(0.51)
    expect(keyStep(0.5, 'ArrowDown', true)).toBeCloseTo(0.499)
    expect(keyStep(0.5, 'PageUp', false)).toBeCloseTo(0.6)
    expect(keyStep(0.5, 'Home', false)).toBe(0)
    expect(keyStep(0.5, 'End', false)).toBe(1)
    expect(keyStep(0.5, 'KeyA', false)).toBeNull()
  })
})

describe('formatParam', () => {
  it('affiche des unités réelles', () => {
    expect(formatParam(def('cutoff'), 0)).toBe('20 Hz')
    expect(formatParam(def('cutoff'), 1)).toBe('20.5 kHz')
    expect(formatParam(def('attack'), 0)).toBe('1 ms')
    expect(formatParam(def('release'), 1)).toBe('16.25 s')
    expect(formatParam(def('pulseWidth'), 0)).toBe('50 %')
    expect(formatParam(def('range'), 3)).toBe("8'")
    expect(formatParam(def('sustain'), 0.3)).toBe('3.0')
    expect(formatParam(def('volume'), 70 / 127)).toBe('70')
    expect(formatParam(def('portaTime'), 0)).toBe('0 ms')
    expect(formatParam(def('portaTime'), 1)).toBe('4.50 s')
  })
})
