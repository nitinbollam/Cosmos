import { parseProxyParts } from './parseProxyParts'

describe('parseProxyParts', () => {
  it('extracts service and remainder', () => {
    expect(parseProxyParts('/api/v1/_proxy/auth/users/me')).toEqual({
      service: 'auth',
      restPath: 'users/me',
    })
  })

  it('returns null when path is not proxy', () => {
    expect(parseProxyParts('/api/v1/health')).toBeNull()
  })
})
