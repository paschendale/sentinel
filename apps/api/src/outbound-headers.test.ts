import { afterEach, describe, expect, it, vi } from 'vitest'

async function load(instance?: string) {
  vi.resetModules()
  if (instance === undefined) vi.stubEnv('SENTINEL_INSTANCE', undefined)
  else vi.stubEnv('SENTINEL_INSTANCE', instance)
  return import('./outbound-headers.js')
}

describe('withSentinelHeaders', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('adds a Sentinel User-Agent and no instance header when SENTINEL_INSTANCE is unset', async () => {
    const { withSentinelHeaders } = await load()
    expect(withSentinelHeaders()).toEqual({
      'user-agent': 'Sentinel (+https://github.com/paschendale/sentinel)',
    })
  })

  it('names the instance in the User-Agent and X-Sentinel-Instance when configured', async () => {
    const { withSentinelHeaders } = await load('sao-paulo-1')
    expect(withSentinelHeaders({ accept: 'text/plain' })).toEqual({
      'user-agent': 'Sentinel (+https://github.com/paschendale/sentinel; instance=sao-paulo-1)',
      'x-sentinel-instance': 'sao-paulo-1',
      accept: 'text/plain',
    })
  })

  it('lets a caller-supplied header win regardless of case', async () => {
    const { withSentinelHeaders } = await load('eu-1')
    const headers = withSentinelHeaders({ 'User-Agent': 'custom/1.0' })
    expect(headers['User-Agent']).toBe('custom/1.0')
    expect(headers['user-agent']).toBeUndefined()
    expect(headers['x-sentinel-instance']).toBe('eu-1')
  })

  it('rejects a malformed SENTINEL_INSTANCE at startup', async () => {
    await expect(load('bad value\n')).rejects.toThrow('SENTINEL_INSTANCE')
  })
})
