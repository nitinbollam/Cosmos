import { ShopHeader } from '@/components/shop-header'

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ShopHeader />
      {children}
    </>
  )
}
