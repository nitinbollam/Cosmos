/** @type {import('next').NextConfig} */
const gatewayOrigin = (process.env.GATEWAY_SERVICE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cosmos/ui', '@cosmos/types', '@cosmos/analytics-engine'],
  ...(process.platform === 'win32' ? {} : { output: 'standalone' }),
  /** Same-origin proxy to gateway — avoids browser CORS / "Network Error" on login and API calls. */
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${gatewayOrigin}/api/v1/:path*`,
      },
    ]
  },
}
export default nextConfig
