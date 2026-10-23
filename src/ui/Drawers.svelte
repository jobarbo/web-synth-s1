<script lang="ts">
  import { CHOP_NONE, DrawMode } from '../dsp/draw'
  import { DMOTION_TARGETS, formatParam, mapOvertone, PARAMS, type ParamId, type Section } from '../dsp/params'
  import ChopGrid from './ChopGrid.svelte'
  import DrawEditor from './DrawEditor.svelte'
  import MotionPad from './MotionPad.svelte'
  import ParamControl from './ParamControl.svelte'

  interface Props {
    values: Record<ParamId, number>
    onchange: (id: ParamId, v: number) => void
    /** Forme OSC DRAW (16 pas) et masques OSC CHOP. */
    drawForm: number[]
    chopMasks: number[]
    onWave: (drawForm: number[], chopMasks: number[]) => void
    /** Pad D-MOTION : -1..1 sur chaque axe. */
    onMotion: (x: number, y: number) => void
  }

  let { values, onchange, drawForm, chopMasks, onWave, onMotion }: Props = $props()

  const def = (id: ParamId) => PARAMS.find((p) => p.id === id)!
  const show = (id: ParamId) => formatParam(def(id), values[id], values)

  interface Drawer {
    id: Section
    title: string
    /** L'effet est-il audible ? (témoin allumé sur l'onglet) */
    active: () => boolean
    /** Résumé affiché sur l'onglet fermé. */
    summary: () => string
  }

  // Comme sur le S-1, où ces réglages sont dans des menus (SHIFT + pad) : repliés par défaut
  const DRAWERS: Drawer[] = [
    {
      id: 'ctrl',
      title: 'Bend / Mod',
      active: () => values.modDepth > 0 || values.oscBendSens > 0 || values.filterBendSens > 0,
      summary: () => `${show('oscBendSens')} · ${show('modDepth')}`,
    },
    {
      id: 'chorus',
      title: 'Chorus',
      active: () => Math.round(values.chorusType) > 0,
      summary: () => (Math.round(values.chorusType) > 0 ? `Type ${show('chorusType')}` : 'Off'),
    },
    {
      id: 'delay',
      title: 'Delay',
      active: () => values.delayLevel > 0,
      summary: () => {
        if (values.delayLevel <= 0) return 'Off'
        const time = Math.round(values.delaySync) === 1 ? show('delayNote') : show('delayTime')
        return `${time} · ${show('delayLevel')}`
      },
    },
    {
      id: 'reverb',
      title: 'Reverb',
      active: () => values.reverbLevel > 0,
      summary: () => (values.reverbLevel > 0 ? `${show('reverbType')} · ${show('reverbLevel')}` : 'Off'),
    },
    {
      id: 'draw',
      title: 'Draw',
      active: () => Math.round(values.drawMode) !== DrawMode.Off,
      summary: () => (Math.round(values.drawMode) !== DrawMode.Off ? `${show('drawMode')} ×${show('drawMult')}` : 'Off'),
    },
    {
      id: 'chop',
      title: 'Chop',
      active: () => mapOvertone(values.chopOvertone) > 0 && chopMasks.some((m) => m !== CHOP_NONE),
      summary: () =>
        chopMasks.some((m) => m !== CHOP_NONE) ? `Ovt ${show('chopOvertone')} · ×${show('chopComb')}` : 'Off',
    },
    {
      id: 'riser',
      title: 'Riser',
      active: () => Math.round(values.riserMode) !== 0 && values.riserPos > 0 && values.riserPos < 1,
      summary: () => (Math.round(values.riserMode) !== 0 ? `${show('riserMode')} · ${show('riserPos')}` : 'Off'),
    },
    {
      id: 'dmotion',
      title: 'D-Motion',
      active: () => Math.round(values.dmX) !== 0 || Math.round(values.dmY) !== 0,
      summary: () => `X ${DMOTION_TARGETS[Math.round(values.dmX)]} · Y ${DMOTION_TARGETS[Math.round(values.dmY)]}`,
    },
  ]

  const STORAGE_KEY = 's1web.openDrawer'

  // Préférence de confort : le tiroir ouvert est mémorisé localement, sans garantie (navigation privée, etc.)
  function readOpen(): Section | null {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      return DRAWERS.some((d) => d.id === v) ? (v as Section) : null
    } catch {
      return null
    }
  }

  let open: Section | null = $state(readOpen())

  function toggle(id: Section) {
    open = open === id ? null : id
    try {
      if (open) localStorage.setItem(STORAGE_KEY, open)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }

  const openDrawer = $derived(DRAWERS.find((d) => d.id === open))
</script>

<div class="drawers">
  <div class="tabs">
    {#each DRAWERS as d (d.id)}
      <button
        type="button"
        class="tab"
        class:open={open === d.id}
        aria-expanded={open === d.id}
        aria-controls="drawer-{d.id}"
        onclick={() => toggle(d.id)}
      >
        <span class="led" class:lit={d.active()} aria-hidden="true"></span>
        <span class="title">{d.title}</span>
        <span class="summary">{d.summary()}</span>
        <svg class="chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 L5 6.5 L8 3.5" />
        </svg>
      </button>
    {/each}
  </div>

  {#if openDrawer}
    <div class="content" id="drawer-{openDrawer.id}" role="region" aria-label={openDrawer.title}>
      {#each PARAMS.filter((p) => p.section === openDrawer.id) as p (p.id)}
        <ParamControl {p} {values} {onchange} />
      {/each}
      {#if openDrawer.id === 'draw'}
        <DrawEditor
          form={drawForm}
          slope={Math.round(values.drawMode) === DrawMode.Slope}
          onchange={(form) => onWave(form, chopMasks)}
        />
      {:else if openDrawer.id === 'chop'}
        <ChopGrid masks={chopMasks} onchange={(masks) => onWave(drawForm, masks)} />
      {:else if openDrawer.id === 'dmotion'}
        <MotionPad onmove={onMotion} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .drawers {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    overflow: hidden;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .tab {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    border-right: 1px solid var(--panel-border);
    border-bottom: 1px solid var(--panel-border);
    margin: 0 -1px -1px 0;
    min-width: 0;
  }
  .tab:hover {
    background: var(--panel-hover);
  }
  .tab:focus-visible {
    box-shadow: inset 0 0 0 2px var(--focus);
  }
  .tab.open {
    background: var(--panel-hover);
  }
  .title {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--accent);
    white-space: nowrap;
  }
  .summary {
    font: 0.68rem var(--mono);
    color: var(--panel-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .led {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--panel-led-off);
    flex: none;
  }
  .led.lit {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .chevron {
    flex: none;
    fill: none;
    stroke: var(--panel-text-muted);
    stroke-width: 1.5;
    transition: transform 0.15s ease;
  }
  .tab.open .chevron {
    transform: rotate(180deg);
  }
  .content {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 6px;
    padding: 14px;
    border-top: 1px solid var(--panel-border);
    margin-top: -1px;
  }
  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
