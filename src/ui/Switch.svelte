<script lang="ts">
  interface Props {
    value: number
    label: string
    options: string[]
    onchange: (v: number) => void
    /** Grisé et sans réaction quand le réglage n'a pas d'effet. */
    disabled?: boolean
  }

  let { value, label, options, onchange, disabled = false }: Props = $props()

  const selected = $derived(Math.round(value))
  const id = $props.id()

  // Navigation clavier d'un radiogroup : les flèches déplacent la sélection
  function onkeydown(e: KeyboardEvent) {
    if (disabled) return
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (selected + delta + options.length) % options.length
    onchange(next)
    ;(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus()
  }
</script>

<div class="switch" class:disabled>
  <div class="options" role="radiogroup" aria-labelledby="{id}-label" tabindex="-1" {onkeydown}>
    {#each options as option, i (i)}
      <button
        type="button"
        role="radio"
        aria-checked={selected === i}
        tabindex={selected === i && !disabled ? 0 : -1}
        {disabled}
        onclick={() => onchange(i)}
      >
        <span class="led" class:lit={selected === i}></span>
        <span class="text">{option}</span>
      </button>
    {/each}
  </div>
  <span class="label" id="{id}-label">{label}</span>
</div>

<style>
  .switch.disabled {
    opacity: 0.35;
  }
  .switch.disabled button {
    cursor: default;
  }
  .switch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 2px;
    outline: none;
  }
  button {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    font: 0.7rem var(--mono);
    color: var(--panel-text-muted);
    white-space: nowrap;
  }
  button:hover {
    color: var(--panel-text);
    background: var(--panel-hover);
  }
  button[aria-checked='true'] {
    color: var(--panel-text);
  }
  button:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
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
  .label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--panel-text);
  }
</style>
