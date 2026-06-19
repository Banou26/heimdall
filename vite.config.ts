import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react-swc'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => ({
  // The file-linked @fkn/lib build leaves `@mfkn/web-extension` as an external
  // import (the published build inlines it, but the local build can't resolve
  // it). Point it at the extension's built, self-contained page lib.
  resolve: {
    alias: {
      '@mfkn/web-extension': fileURLToPath(
        new URL('../fkn/web-extension/lib/lib/index.js', import.meta.url),
      ),
    },
  },
  server: {
    // Allow serving the file-linked @fkn/lib and the aliased web-extension lib,
    // both of which live outside heimdall under ~/dev.
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
    // @fkn/lib's barrel statically pulls in the webvpn net/dgram/http polyfills,
    // which import node stdlib (stream, events, buffer). heimdall only touches
    // the extension fetch, but the barrel still imports them, so shim node
    // stdlib for the browser bundle.
    nodePolyfills(),
  ],
}))
