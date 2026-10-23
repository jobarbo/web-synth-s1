import { PortaMode } from '../dsp/allocator'
import { DrawMode } from '../dsp/draw'
import type { ParamDef, ParamId } from '../dsp/params'

// Contrôles sans effet dans l'état actuel : grisés et inactifs, mais gardés en place pour ne pas décaler le panneau
const ENABLED_IF: Partial<Record<ParamId, (v: Record<ParamId, number>) => boolean>> = {
  portaTime: (v) => Math.round(v.portaMode) !== PortaMode.Off,
  // LFO Sync : la vitesse vient du tempo, et le mode Fast est désactivé (manuel)
  lfoRate: (v) => Math.round(v.lfoSync) === 0,
  lfoMode: (v) => Math.round(v.lfoSync) === 0,
  lfoNote: (v) => Math.round(v.lfoSync) === 1,
  delayTime: (v) => Math.round(v.delaySync) === 0,
  delayNote: (v) => Math.round(v.delaySync) === 1,
  // OSC DRAW remplace le carré : pas de PWM (manuel)
  pulseWidth: (v) => Math.round(v.drawMode) === DrawMode.Off,
  pwmSource: (v) => Math.round(v.drawMode) === DrawMode.Off,
  drawMult: (v) => Math.round(v.drawMode) !== DrawMode.Off,
  // Riser : réglages actifs seulement si un mode est choisi
  riserPos: (v) => Math.round(v.riserMode) !== 0,
  riserReso: (v) => Math.round(v.riserMode) !== 0,
  riserShape: (v) => Math.round(v.riserMode) !== 0,
  riserLevel: (v) => Math.round(v.riserMode) !== 0,
}

export const isEnabled = (p: ParamDef, values: Record<ParamId, number>) => ENABLED_IF[p.id]?.(values) ?? true
