// Disposition type piano sur la rangée du milieu (AZERTY et QWERTY partagent ces touches via `code`)
const KEY_TO_SEMITONE: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
}

export interface KeyboardHandlers {
  noteOn(note: number): void
  noteOff(note: number): void
  /** Octave partagée avec le clavier à l'écran. */
  getOctave(): number
  setOctave(octave: number): void
}

export const MIN_OCTAVE = -3
export const MAX_OCTAVE = 3
export const BASE_NOTE = 48

/**
 * Clavier d'ordinateur → notes MIDI. Z / X changent d'octave.
 * Utilise `event.code` (position physique) pour fonctionner en AZERTY comme en QWERTY.
 */
export function attachKeyboard(h: KeyboardHandlers, baseNote = BASE_NOTE): () => void {
  const down = new Map<string, number>()

  const isTyping = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    return !!t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' || t.isContentEditable)
  }

  const onDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      const next = h.getOctave() + (e.code === 'KeyZ' ? -1 : 1)
      h.setOctave(Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, next)))
      return
    }
    const semi = KEY_TO_SEMITONE[e.code]
    if (semi === undefined || down.has(e.code)) return
    const note = baseNote + 12 * h.getOctave() + semi
    down.set(e.code, note)
    h.noteOn(note)
  }

  const onUp = (e: KeyboardEvent) => {
    const note = down.get(e.code)
    if (note === undefined) return
    down.delete(e.code)
    h.noteOff(note)
  }

  // Relâcher tout si la fenêtre perd le focus, sinon des notes restent bloquées
  const onBlur = () => {
    for (const note of down.values()) h.noteOff(note)
    down.clear()
  }

  window.addEventListener('keydown', onDown)
  window.addEventListener('keyup', onUp)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('keydown', onDown)
    window.removeEventListener('keyup', onUp)
    window.removeEventListener('blur', onBlur)
  }
}
