import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type ShellConfig = {
  shellRoutes: string[]
  staticAssets: string[]
}

function loadShellConfig(): ShellConfig {
  const cfgPath = path.resolve(__dirname, 'pwa-shell-routes.json')
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as ShellConfig
  return {
    shellRoutes: raw.shellRoutes ?? [],
    staticAssets: raw.staticAssets ?? [],
  }
}

function replaceConstArray(source: string, constName: string, values: string[]): string {
  const next = `const ${constName} = ${JSON.stringify(values, null, 2)}`
  const re = new RegExp(`const ${constName} = \\[[\\s\\S]*?\\]`)
  const replaced = source.replace(re, next)
  if (replaced === source) {
    console.warn(`[pwa] Could not inject ${constName} into sw.js`)
  }
  return replaced
}

/** After build, inject shell routes + hashed /assets/* URLs into dist/sw.js. */
function injectSwPrecache(): Plugin {
  return {
    name: 'pleros-inject-sw-precache',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist')
      const swPath = path.join(dist, 'sw.js')
      if (!fs.existsSync(swPath)) return

      const { shellRoutes, staticAssets } = loadShellConfig()
      const shell = [...staticAssets, ...shellRoutes]

      const assetsDir = path.join(dist, 'assets')
      const assetUrls: string[] = []
      if (fs.existsSync(assetsDir)) {
        for (const name of fs.readdirSync(assetsDir)) {
          if (/\.(js|css|woff2?)$/i.test(name)) {
            assetUrls.push(`/assets/${name}`)
          }
        }
      }

      const precache = [...shell, ...assetUrls]
      let sw = fs.readFileSync(swPath, 'utf8')
      sw = replaceConstArray(sw, 'MOBILE_SHELL_ROUTES', shellRoutes)
      sw = replaceConstArray(sw, 'PRECACHE_URLS', precache)
      fs.writeFileSync(swPath, sw)
      console.log(
        `[pwa] Injected ${precache.length} PRECACHE_URLS + ${shellRoutes.length} shell routes into sw.js (${assetUrls.length} assets)`,
      )
    },
  }
}

/** UI build output — served by server/index.ts (dev: Vite middleware, prod: static). */
export default defineConfig({
  plugins: [react(), injectSwPrecache()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@pleros/web-gateway-client': path.resolve(
        __dirname,
        '../../packages/web-gateway-client/src/index.ts',
      ),
      '@pleros/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
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
