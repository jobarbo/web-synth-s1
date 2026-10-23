<script lang="ts">
  import { VoiceMode } from '../dsp/allocator'
  import { PARAMS, type ParamId, type Section } from '../dsp/params'
  import ParamControl from './ParamControl.svelte'

  interface Props {
    values: Record<ParamId, number>
    onchange: (id: ParamId, v: number) => void
  }

  let { values, onchange }: Props = $props()

  // Ordre du flux de signal, de gauche à droite. Bend/Mod et effets sont dans les tiroirs (Drawers.svelte).
  const SECTIONS: { id: Section; title: string }[] = [
    { id: 'voice', title: 'Voice' },
    { id: 'lfo', title: 'LFO' },
    { id: 'osc', title: 'Osc' },
    { id: 'mixer', title: 'Mixer' },
    { id: 'filter', title: 'Filter' },
    { id: 'env', title: 'Env' },
    { id: 'amp', title: 'Amp' },
    { id: 'chord', title: 'Chord' },
  ]

  // Sur la machine, les réglages d'accord sont dans un menu : on ne les montre qu'en mode Chord
  const visibleSections = $derived(
    SECTIONS.filter((s) => s.id !== 'chord' || Math.round(values.voiceMode) === VoiceMode.Chord),
  )

  const bySection = (id: Section) => PARAMS.filter((p) => p.section === id)
</script>

<div class="panel">
  {#each visibleSections as section (section.id)}
    <section aria-label={section.title}>
      <h2>{section.title}</h2>
      <div class="controls">
        {#each bySection(section.id) as p (p.id)}
          <ParamControl {p} {values} {onchange} />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .panel {
    display: flex;
    flex-wrap: wrap;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 1px 0 var(--panel-highlight) inset, 0 12px 32px -16px rgb(0 0 0 / 0.5);
    overflow: hidden;
  }
  section {
    flex: 1 1 auto;
    padding: 12px 14px 14px;
    border-right: 1px solid var(--panel-border);
    border-bottom: 1px solid var(--panel-border);
    margin: 0 -1px -1px 0;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--accent);
  }
  .controls {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }
</style>
