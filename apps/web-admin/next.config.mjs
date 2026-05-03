/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cosmos/ui', '@cosmos/types'],
  ...(process.platform === 'win32' ? {} : { output: 'standalone' }),
}
export default nextConfig
