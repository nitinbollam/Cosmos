import Link from 'next/link'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const items = [
    { href: '/', label: 'Dashboard' },
    { href: '/orders', label: 'Orders' },
    { href: '/fulfillment', label: 'Fulfillment' },
    { href: '/inventory', label: 'Inventory' },
    { href: '/customers', label: 'Customers' },
    { href: '/compliance', label: 'Compliance' },
    { href: '/finance', label: 'Finance' },
  ]
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-cosmos-border p-4">
        <div className="text-cosmos-white font-bold mb-6">COSMOS</div>
        <nav className="space-y-1">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="block px-3 py-2 rounded-md text-sm text-cosmos-text hover:bg-cosmos-surface-2"
            >
              {i.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  )
}
