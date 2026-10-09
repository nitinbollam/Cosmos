import { Outlet } from 'react-router-dom'
import { useDocumentTitle } from '@/lib/use-document-title'

export function RootLayout() {
  useDocumentTitle()
  return <Outlet />
}
