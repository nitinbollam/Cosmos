import './globals.css'

export const metadata = { title: 'Cosmos Storefront' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ minHeight: '100vh' }}>{children}</body>
    </html>
  )
}
