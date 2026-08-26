import { Outlet } from 'react-router-dom'
import { ShopHeader } from '@/components/shop-header'
import { CelestialChat } from '@/components/celestial/celestial-chat'

export function ShopLayout() {
  return (
    <div className="pleros-shop" style={{ paddingBottom: '5rem' }}>
      <ShopHeader />
      <Outlet />
      <CelestialChat surface="shop" />
    </div>
  )
}
