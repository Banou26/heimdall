import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react-swc'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => ({
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
