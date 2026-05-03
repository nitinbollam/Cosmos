declare module 'ioredis-mock' {
  import type { Redis } from 'ioredis'
  const Mock: new () => Redis
  export default Mock
}
