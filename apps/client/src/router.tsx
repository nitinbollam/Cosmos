import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { RootLayout } from '@/layouts/RootLayout'
import { ShopLayout } from '@/layouts/ShopLayout'
import { AdminLayout } from '@/layouts/AdminLayout'
import { MobileLayout } from '@/layouts/MobileLayout'

function page(importFn: () => Promise<{ default: ComponentType }>) {
  const Lazy = lazy(importFn)
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading…</div>}>
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
        ],
      },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: page(() => import('@/pages/admin/page')) },
          { path: 'login', element: page(() => import('@/pages/admin/login/page')) },
          { path: 'general/users', element: page(() => import('@/pages/admin/general/users/page')) },
          { path: 'general/roles', element: page(() => import('@/pages/admin/general/roles/page')) },
          { path: 'general/ecom-theme', element: page(() => import('@/pages/admin/general/ecom-theme/page')) },
          { path: 'general/customer-display', element: page(() => import('@/pages/admin/general/customer-display/page')) },
          { path: 'product/categories', element: page(() => import('@/pages/admin/product/categories/page')) },
          { path: 'product/brands', element: page(() => import('@/pages/admin/product/brands/page')) },
          { path: 'product/products', element: page(() => import('@/pages/admin/product/products/page')) },
          { path: 'product/groups', element: page(() => import('@/pages/admin/product/groups/page')) },
          { path: 'purchase/suppliers', element: page(() => import('@/pages/admin/purchase/suppliers/page')) },
          { path: 'purchase/orders', element: page(() => import('@/pages/admin/purchase/orders/page')) },
          { path: 'purchase/receive', element: page(() => import('@/pages/admin/purchase/receive/page')) },
          { path: 'purchase/returns', element: page(() => import('@/pages/admin/purchase/returns/page')) },
          { path: 'purchase/stock-transfer', element: page(() => import('@/pages/admin/purchase/stock-transfer/page')) },
          { path: 'purchase/store-channels', element: page(() => import('@/pages/admin/purchase/store-channels/page')) },
          { path: 'sales/customers', element: page(() => import('@/pages/admin/sales/customers/page')) },
          { path: 'sales/customer-groups', element: page(() => import('@/pages/admin/sales/customer-groups/page')) },
          { path: 'sales/orders', element: page(() => import('@/pages/admin/sales/orders/page')) },
          { path: 'sales/returns', element: page(() => import('@/pages/admin/sales/returns/page')) },
          { path: 'sales/receive-payment', element: page(() => import('@/pages/admin/sales/receive-payment/page')) },
          { path: 'sales/promotions', element: page(() => import('@/pages/admin/sales/promotions/page')) },
          { path: 'reports/sale-summary', element: page(() => import('@/pages/admin/reports/sale-summary/page')) },
          { path: 'reports/daily-summary', element: page(() => import('@/pages/admin/reports/daily-summary/page')) },
          { path: 'reports/payment-received', element: page(() => import('@/pages/admin/reports/payment-received/page')) },
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
          { path: 'customers', element: page(() => import('@/pages/admin/customers/page')) },
          {
            path: 'customers/:id',
            element: page(() => import('@/pages/admin/customers/[id]/page')),
          },
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
          { path: 'warehouse', element: page(() => import('@/pages/admin/warehouse/page')) },
        ],
      },
      {
        path: '/m',
        element: <MobileLayout />,
        children: [
          { path: 'warehouse', element: page(() => import('@/pages/m/warehouse/page')) },
          {
            path: 'warehouse/receiving',
            element: page(() => import('@/pages/m/warehouse/receiving/page')),
          },
          {
            path: 'warehouse/task/:id',
            element: page(() => import('@/pages/m/warehouse/task/[id]/page')),
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
