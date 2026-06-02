import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** UI build output — served by server/index.ts (dev: Vite middleware, prod: static). */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cosmos/web-gateway-client': path.resolve(
        __dirname,
        '../../packages/web-gateway-client/src/index.ts',
      ),
      '@cosmos/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 4000,
    strictPort: true,
  },
})
