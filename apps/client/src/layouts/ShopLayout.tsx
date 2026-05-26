import { Outlet } from 'react-router-dom'
import { ShopHeader } from '@/components/shop-header'

export function ShopLayout() {
  return (
    <div className="cosmos-shop">
      <ShopHeader />
      <Outlet />
    </div>
  )
}
