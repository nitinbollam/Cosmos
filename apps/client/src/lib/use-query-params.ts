import { useSearchParams } from 'react-router-dom'

/** React Router returns `[params, setParams]` — not a URLSearchParams object directly. */
export function useQueryParams(): URLSearchParams {
  const [searchParams] = useSearchParams()
  return searchParams
}
