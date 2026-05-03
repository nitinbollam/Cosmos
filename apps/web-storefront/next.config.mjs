/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.platform === 'win32' ? {} : { output: 'standalone' }),
}
export default nextConfig
