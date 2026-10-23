import type { Action } from 'svelte/action'
import { clamp } from '../dsp/math'

/** Shift divise la sensibilité par ce facteur (réglage fin). */
export const FINE_FACTOR = 10

/** Nouvelle valeur après un déplacement vertical de `dy` pixels (positif vers le haut). */
export function dragStep(value: number, dy: number, travelPx: number, fine: boolean): number {
  return clamp(value + dy / travelPx / (fine ? FINE_FACTOR : 1), 0, 1)
}

/** Pas clavier façon ARIA : flèches = 1 %, Shift = 0,1 %, Page = 10 %, Home/End = bornes. */
export function keyStep(value: number, key: string, fine: boolean): number | null {
  const small = fine ? 0.001 : 0.01
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return clamp(value + small, 0, 1)
    case 'ArrowDown':
    case 'ArrowLeft':
      return clamp(value - small, 0, 1)
    case 'PageUp':
      return clamp(value + 0.1, 0, 1)
    case 'PageDown':
      return clamp(value - 0.1, 0, 1)
    case 'Home':
      return 0
    case 'End':
      return 1
    default:
      return null
  }
}

export interface DragOptions {
  value: number
  /** Course en pixels pour parcourir toute la plage 0..1. */
  travelPx: number
  onchange: (v: number) => void
  /** Contrôle inactif : ignore glisser et molette (la molette fait alors défiler la page). */
  disabled?: boolean
}

/**
 * Action Svelte : glisser verticalement (souris, stylet, tactile) et molette.
 * Déplacement relatif, donc pas de saut de valeur au clic, comme un potard réel.
 */
export const dragValue: Action<HTMLElement | SVGElement, DragOptions> = (node, initial) => {
  let opts = initial
  let lastY = 0
  let current = opts.value
  let dragging = false

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || opts.disabled) return
    e.preventDefault()
    ;(node as HTMLElement).focus?.()
    node.setPointerCapture(e.pointerId)
    dragging = true
    lastY = e.clientY
    current = opts.value
  }

  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    current = dragStep(current, lastY - e.clientY, opts.travelPx, e.shiftKey)
    lastY = e.clientY
    opts.onchange(current)
  }

  const onUp = (e: PointerEvent) => {
    dragging = false
    if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId)
  }

  const onWheel = (e: WheelEvent) => {
    if (opts.disabled) return
    e.preventDefault()
    opts.onchange(dragStep(opts.value, -e.deltaY * 0.25, opts.travelPx, e.shiftKey))
  }

  node.addEventListener('pointerdown', onDown as EventListener)
  node.addEventListener('pointermove', onMove as EventListener)
  node.addEventListener('pointerup', onUp as EventListener)
  node.addEventListener('pointercancel', onUp as EventListener)
  node.addEventListener('wheel', onWheel as EventListener, { passive: false })

  return {
    update(next) {
      opts = next
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown as EventListener)
      node.removeEventListener('pointermove', onMove as EventListener)
      node.removeEventListener('pointerup', onUp as EventListener)
      node.removeEventListener('pointercancel', onUp as EventListener)
      node.removeEventListener('wheel', onWheel as EventListener)
    },
  }
}
