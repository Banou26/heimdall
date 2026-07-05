import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react-swc'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => ({
  // The file-linked @fkn/lib leaves @mfkn/web-extension external; point it at the built page lib.
  resolve: {
    alias: {
      '@mfkn/web-extension': fileURLToPath(new URL('../fkn/web-extension/lib/lib/index.js', import.meta.url)),
    },
  },
  server: {
    // The file-linked @fkn/lib and the aliased web-extension lib live outside heimdall.
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
  build: {
    outDir: 'build',
    rollupOptions: {
      treeshake: {
        // preset: 'smallest',
        // moduleSideEffects: 'no-external',
      },
    },
  },
  plugins: [
    tsconfigPaths(),
    react(),
    // @fkn/lib's barrel pulls in the webvpn polyfills, which import node stdlib.
    nodePolyfills(),
  ],
}))
