#!/usr/bin/env node
/** Apply Vite/React Router fixes after sync-client-from-web.mjs */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const clientSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'client', 'src')

function walk(dir, fn) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, fn)
    else fn(p)
  }
}

walk(clientSrc, (f) => {
  if (!/\.tsx?$/.test(f)) return
  let s = fs.readFileSync(f, 'utf8')
  const orig = s
  s = s.replace(/\busePathname\b/g, 'useLocation')
  s = s.replace(/const searchParams = useSearchParams\(\)/g, 'const searchParams = useQueryParams()')
  s = s.replace(
    /import \{ useSearchParams(, useNavigate)? \} from 'react-router-dom'/g,
    (m, nav) =>
      nav
        ? "import { useNavigate } from 'react-router-dom'\nimport { useQueryParams } from '@/lib/use-query-params'"
        : "import { useQueryParams } from '@/lib/use-query-params'",
  )
  s = s.replace(/const \[searchParams\] = useSearchParams\(\)/g, 'const searchParams = useQueryParams()')
  s = s.replace(/}, \[pathname, router\]\)/g, '}, [pathname, navigate])')
  s = s.replace(/import \{ Sidebar \} from '@src\/components\/layout\/sidebar'/g, "import { Sidebar } from '@/components/layout/sidebar'")
  if (s !== orig) fs.writeFileSync(f, s)
})

fs.writeFileSync(
  path.join(clientSrc, 'components', 'pleros-img.tsx'),
  `type ImgProps = {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  style?: React.CSSProperties
  priority?: boolean
}

export default function Image({ src, alt, width, height, className, style }: ImgProps) {
  return <img src={src} alt={alt} width={width} height={height} className={className} style={style} />
}
`,
)

fs.writeFileSync(
  path.join(clientSrc, 'lib', 'api.ts'),
  `import { createGatewayApi, DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'

const { api, gatewayApiBaseUrl, formatApiReachabilityError } = createGatewayApi({
  baseUrl: import.meta.env.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH,
  devWebPort: 4000,
  loginPath: '/login',
})

export { api, gatewayApiBaseUrl, formatApiReachabilityError }
`,
)

fs.writeFileSync(
  path.join(clientSrc, 'lib', 'api-admin.ts'),
  `import { createGatewayApi, DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'

const { api, gatewayApiBaseUrl, formatApiReachabilityError } = createGatewayApi({
  baseUrl: import.meta.env.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH,
  devWebPort: 4000,
  loginPath: '/admin/login',
})

export { api, api as adminApi, gatewayApiBaseUrl, formatApiReachabilityError }
`,
)

const homePage = path.join(clientSrc, 'pages', 'home', 'page.tsx')
if (fs.existsSync(homePage)) {
  let h = fs.readFileSync(homePage, 'utf8')
  h = h.replace(
    /Single Next\.js app — admin, B2B shop, and field mobile \(installable PWA\)/,
    'Vite UI + Next.js API — admin, B2B shop, and field mobile (installable PWA)',
  )
  fs.writeFileSync(homePage, h)
}

console.log('[patch-client] Vite client ready')
