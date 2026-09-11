import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router-dom'
import { RootLayout } from '@/layouts/RootLayout'
import { ShopLayout } from '@/layouts/ShopLayout'
import { AdminLayout } from '@/layouts/AdminLayout'
import { MobileLayout } from '@/layouts/MobileLayout'
import { OpsLayout } from '@/layouts/OpsLayout'

function AdminCustomersRedirect() {
  return <Navigate to="/admin/crm" replace />
}

function AdminCustomerDetailRedirect() {
  const { id } = useParams()
  return <Navigate to={`/admin/crm/customers/${id ?? ''}`} replace />
}

function page(importFn: () => Promise<{ default: ComponentType }>) {
  const Lazy = lazy(importFn)
  return (
    <Suspense fallback={<div className="p-8 text-center" style={{ color: 'var(--c-text-3)' }}>Loading…</div>}>
      <Lazy />
    </Suspense>
  )
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: page(() => import('@/pages/home/page')) },
      { path: '/login', element: page(() => import('@/pages/login/page')) },
      { path: '/signup', element: page(() => import('@/pages/signup/page')) },
      { path: '/forgot-password', element: page(() => import('@/pages/forgot-password/page')) },
      { path: '/reset-password', element: page(() => import('@/pages/reset-password/page')) },
      { path: '/accept-invite', element: page(() => import('@/pages/accept-invite/page')) },
      { path: '/verify-email', element: page(() => import('@/pages/verify-email/page')) },
      { path: '/terms', element: page(() => import('@/pages/legal/terms/page')) },
      { path: '/privacy', element: page(() => import('@/pages/legal/privacy/page')) },
      {
        element: <ShopLayout />,
        children: [
          { path: '/catalog', element: page(() => import('@/pages/catalog/page')) },
          { path: '/cart', element: page(() => import('@/pages/cart/page')) },
          { path: '/checkout', element: page(() => import('@/pages/checkout/page')) },
          { path: '/orders', element: page(() => import('@/pages/orders/page')) },
          { path: '/orders/:id', element: page(() => import('@/pages/orders/[id]/page')) },
          {
            path: '/orders/:id/confirmation',
            element: page(() => import('@/pages/orders/[id]/confirmation/page')),
          },
          { path: '/quotes', element: page(() => import('@/pages/quotes/page')) },
          { path: '/quotes/new', element: page(() => import('@/pages/quotes/new/page')) },
          { path: '/quotes/:id', element: page(() => import('@/pages/quotes/[id]/page')) },
          { path: '/invoices', element: page(() => import('@/pages/invoices/page')) },
          { path: '/invoices/:id', element: page(() => import('@/pages/invoices/[id]/page')) },
          { path: '/account', element: page(() => import('@/pages/account/page')) },
          { path: '/notifications', element: page(() => import('@/pages/notifications/page')) },
        ],
      },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: page(() => import('@/pages/admin/page')) },
          { path: 'onboarding', element: page(() => import('@/pages/admin/onboarding/page')) },
          { path: 'login', element: page(() => import('@/pages/admin/login/page')) },
          { path: 'compliance', element: page(() => import('@/pages/admin/compliance/page')) },
          {
            path: 'compliance/msa/:reportId',
            element: page(() => import('@/pages/admin/compliance/msa/[reportId]/page')),
          },
          { path: 'crm', element: page(() => import('@/pages/admin/crm/page')) },
          {
            path: 'crm/customers/:id',
            element: page(() => import('@/pages/admin/crm/customers/[id]/page')),
          },
          { path: 'quotes', element: page(() => import('@/pages/admin/quotes/page')) },
          { path: 'customers', element: <AdminCustomersRedirect /> },
          { path: 'customers/:id', element: <AdminCustomerDetailRedirect /> },
          { path: 'dispatch', element: page(() => import('@/pages/admin/dispatch/page')) },
          {
            path: 'dispatch/:routeId',
            element: page(() => import('@/pages/admin/dispatch/[routeId]/page')),
          },
          { path: 'finance', element: page(() => import('@/pages/admin/finance/page')) },
          {
            path: 'finance/journals/:id',
            element: page(() => import('@/pages/admin/finance/journals/[id]/page')),
          },
          { path: 'reports', element: page(() => import('@/pages/admin/reports/page')) },
          { path: 'fulfillment', element: page(() => import('@/pages/admin/fulfillment/page')) },
          {
            path: 'fulfillment/:taskId',
            element: page(() => import('@/pages/admin/fulfillment/[taskId]/page')),
          },
          { path: 'inventory', element: page(() => import('@/pages/admin/inventory/page')) },
          {
            path: 'inventory/:skuId',
            element: page(() => import('@/pages/admin/inventory/[skuId]/page')),
          },
          { path: 'notifications', element: page(() => import('@/pages/admin/notifications/page')) },
          { path: 'orders', element: page(() => import('@/pages/admin/orders/page')) },
          { path: 'orders/:id', element: page(() => import('@/pages/admin/orders/[id]/page')) },
          { path: 'purchasing', element: page(() => import('@/pages/admin/purchasing/page')) },
          {
            path: 'purchasing/:poId',
            element: page(() => import('@/pages/admin/purchasing/[poId]/page')),
          },
          { path: 'settings', element: page(() => import('@/pages/admin/settings/page')) },
          { path: 'pos', element: page(() => import('@/pages/admin/pos/page')) },
          { path: 'celestial', element: page(() => import('@/pages/admin/celestial/page')) },
          { path: 'warehouse', element: page(() => import('@/pages/admin/warehouse/page')) },
          { path: 'marketplace', element: page(() => import('@/pages/marketplace/page')) },
          {
            path: 'marketplace/create',
            element: page(() => import('@/pages/marketplace/create/page')),
          },
          {
            path: 'marketplace/orders',
            element: page(() => import('@/pages/marketplace/orders/page')),
          },
          {
            path: 'marketplace/my-listings',
            element: page(() => import('@/pages/marketplace/my-listings/page')),
          },
          {
            path: 'marketplace/payment-methods',
            element: page(() => import('@/pages/marketplace/payment-methods/page')),
          },
          {
            path: 'marketplace/alerts',
            element: page(() => import('@/pages/marketplace/alerts/page')),
          },
          {
            path: 'marketplace/:id',
            element: page(() => import('@/pages/marketplace/[id]/page')),
          },
        ],
      },
      {
        path: '/ops',
        element: <OpsLayout />,
        children: [
          { index: true, element: page(() => import('@/pages/ops/marketplace/page')) },
          { path: 'marketplace', element: page(() => import('@/pages/ops/marketplace/page')) },
        ],
      },
      {
        path: '/m',
        element: <MobileLayout />,
        children: [
          { path: 'login', element: page(() => import('@/pages/m/login/page')) },
          { path: 'warehouse', element: page(() => import('@/pages/m/warehouse/page')) },
          {
            path: 'warehouse/receiving',
            element: page(() => import('@/pages/m/warehouse/receiving/page')),
          },
          {
            path: 'warehouse/task/:id',
            element: page(() => import('@/pages/m/warehouse/task/[id]/page')),
          },
          {
            path: 'warehouse/waves/:id',
            element: page(() => import('@/pages/m/warehouse/waves/[id]/page')),
          },
          { path: 'delivery', element: page(() => import('@/pages/m/delivery/page')) },
          {
            path: 'delivery/route/:id',
            element: page(() => import('@/pages/m/delivery/route/[id]/page')),
          },
          { path: 'sales', element: page(() => import('@/pages/m/sales/page')) },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
