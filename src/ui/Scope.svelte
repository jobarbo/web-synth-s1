<script lang="ts">
  let { analyser }: { analyser: AnalyserNode | null } = $props()

  let canvas: HTMLCanvasElement
  let raf = 0
  let buffer: Float32Array<ArrayBuffer> | null = null

  function draw() {
    raf = requestAnimationFrame(draw)
    const g = canvas?.getContext('2d')
    if (!g) return
    const { width, height } = canvas
    const styles = getComputedStyle(canvas)
    g.fillStyle = styles.getPropertyValue('--scope-bg')
    g.fillRect(0, 0, width, height)
    if (!analyser) return

    if (!buffer || buffer.length !== analyser.fftSize) buffer = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(buffer)

    // Déclenchement sur front montant pour une image stable
    let start = 0
    for (let i = 1; i < buffer.length / 2; i++) {
      if (buffer[i - 1] < 0 && buffer[i] >= 0) {
        start = i
        break
      }
    }
    const span = buffer.length / 2
    g.strokeStyle = styles.getPropertyValue('--scope-line')
    g.lineWidth = 2
    g.beginPath()
    for (let i = 0; i < span; i++) {
      const x = (i / span) * width
      const y = height / 2 - buffer[start + i] * height * 0.45
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }

  $effect(() => {
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  })
</script>

<canvas bind:this={canvas} width="600" height="140" aria-label="Oscilloscope"></canvas>

<style>
  canvas {
    width: 100%;
    height: 140px;
    border-radius: 6px;
    display: block;
  }
</style>
