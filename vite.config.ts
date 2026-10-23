/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// Isolation cross-origin : prépare l'usage de SharedArrayBuffer entre l'UI et le worklet
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [svelte()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
