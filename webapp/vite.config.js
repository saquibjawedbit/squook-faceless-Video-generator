import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The editor imports the Remotion composition straight from the sibling
// renderer/ project so the preview and the final render share one source.
const rendererSrc = fileURLToPath(new URL('../renderer/src', import.meta.url))
const rendererPublic = fileURLToPath(new URL('../renderer/public', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@renderer': rendererSrc },
    // One copy of react/remotion for both projects — two instances break hooks/contexts.
    dedupe: ['react', 'react-dom', 'remotion', '@remotion/player', '@remotion/lottie'],
  },
  server: { fs: { allow: ['.', rendererSrc, rendererPublic] } },
  optimizeDeps: { include: ['remotion', '@remotion/player', '@remotion/lottie', 'lottie-web'] },
})
