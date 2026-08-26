import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function getTitleForPath(pathname: string): string {
  // Mobile routes
  if (pathname === '/m/login') return 'Mobile Sign In | Pleros'
  if (pathname === '/m/warehouse/receiving') return 'Warehouse Receiving | Pleros Mobile'
  if (pathname.startsWith('/m/warehouse/task/')) return 'Warehouse Task | Pleros Mobile'
  if (pathname.startsWith('/m/warehouse/waves/')) return 'Pick Wave | Pleros Mobile'
  if (pathname.startsWith('/m/warehouse')) return 'Warehouse Operations | Pleros Mobile'
  if (pathname.startsWith('/m/delivery/route/')) return 'Delivery Route | Pleros Mobile'
  if (pathname.startsWith('/m/delivery')) return 'Delivery | Pleros Mobile'
  if (pathname.startsWith('/m/sales')) return 'Field Sales | Pleros Mobile'

  // Admin routes
  if (pathname === '/admin/login') return 'Sign In | Pleros Admin'
  if (pathname === '/admin/onboarding') return 'Onboarding | Pleros Admin'
  if (pathname === '/admin') return 'Dashboard | Pleros Admin'
  if (pathname.startsWith('/admin/compliance/msa/')) return 'MSA Report | Pleros Admin'
  if (pathname.startsWith('/admin/compliance')) return 'Compliance | Pleros Admin'
  if (pathname.startsWith('/admin/crm/customers/')) return 'Customer Profile | Pleros Admin'
  if (pathname.startsWith('/admin/crm')) return 'CRM & Accounts | Pleros Admin'
  if (pathname.startsWith('/admin/quotes')) return 'Quotes | Pleros Admin'
  if (pathname.startsWith('/admin/dispatch/')) return 'Route Details | Pleros Admin'
  if (pathname.startsWith('/admin/dispatch')) return 'Dispatch & Logistics | Pleros Admin'
  if (pathname.startsWith('/admin/finance/journals/')) return 'Journal Entry | Pleros Admin'
  if (pathname.startsWith('/admin/finance')) return 'Finance & Accounting | Pleros Admin'
  if (pathname.startsWith('/admin/reports')) return 'Reports & Analytics | Pleros Admin'
  if (pathname.startsWith('/admin/fulfillment/')) return 'Fulfillment Task | Pleros Admin'
  if (pathname.startsWith('/admin/fulfillment')) return 'Fulfillment | Pleros Admin'
  if (pathname.startsWith('/admin/inventory/')) return 'SKU Details | Pleros Admin'
  if (pathname.startsWith('/admin/inventory')) return 'Inventory Management | Pleros Admin'
  if (pathname.startsWith('/admin/notifications')) return 'Notifications | Pleros Admin'
  if (pathname.startsWith('/admin/orders/')) return 'Order Details | Pleros Admin'
  if (pathname.startsWith('/admin/orders')) return 'Orders | Pleros Admin'
  if (pathname.startsWith('/admin/purchasing/')) return 'Purchase Order | Pleros Admin'
  if (pathname.startsWith('/admin/purchasing')) return 'Purchasing | Pleros Admin'
  if (pathname.startsWith('/admin/settings')) return 'Settings | Pleros Admin'
  if (pathname.startsWith('/admin/pos')) return 'Point of Sale | Pleros Admin'
  if (pathname.startsWith('/admin/celestial')) return 'Celestial AI | Pleros Admin'
  if (pathname.startsWith('/admin/warehouse')) return 'Warehouse Management | Pleros Admin'

  // Storefront & Buyer Portal
  if (pathname === '/') return 'Pleros — Next-Gen B2B ERP & Distribution'
  if (pathname === '/login') return 'Sign In | Pleros'
  if (pathname === '/signup') return 'Create Account | Pleros'
  if (pathname === '/forgot-password') return 'Forgot Password | Pleros'
  if (pathname === '/reset-password') return 'Reset Password | Pleros'
  if (pathname === '/accept-invite') return 'Accept Invitation | Pleros'
  if (pathname === '/verify-email') return 'Verify Email | Pleros'
  if (pathname === '/terms') return 'Terms of Service | Pleros'
  if (pathname === '/privacy') return 'Privacy Policy | Pleros'
  if (pathname === '/catalog') return 'B2B Catalog | Pleros'
  if (pathname === '/cart') return 'Shopping Cart | Pleros'
  if (pathname === '/checkout') return 'Checkout | Pleros'
  if (pathname.endsWith('/confirmation')) return 'Order Confirmed | Pleros'
  if (pathname.startsWith('/orders/')) return 'Order Details | Pleros'
  if (pathname === '/orders') return 'My Orders | Pleros'
  if (pathname === '/quotes/new') return 'Request Quote | Pleros'
  if (pathname.startsWith('/quotes/')) return 'Quote Details | Pleros'
  if (pathname === '/quotes') return 'My Quotes | Pleros'
  if (pathname.startsWith('/invoices/')) return 'Invoice Details | Pleros'
  if (pathname === '/invoices') return 'My Invoices | Pleros'
  if (pathname === '/account') return 'My Account | Pleros'
  if (pathname === '/notifications') return 'Notifications | Pleros'

  return 'Pleros'
}

export function useDocumentTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    const title = getTitleForPath(pathname)
    document.title = title
  }, [pathname])
}
