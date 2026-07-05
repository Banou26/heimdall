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
    // @fkn/lib's barrel pulls in the webvpn polyfills, which import node stdlib.
    nodePolyfills(),
  ],
}))
