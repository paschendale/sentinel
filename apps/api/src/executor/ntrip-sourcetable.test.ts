import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSourcetableCache, parseSourcetable, NtripRequestError } from './ntrip-sourcetable.js'

const FIXTURE = [
  'CAS;rtcm-ntrip.org;2101;NtripInfoCaster;BKG;0;DEU;50.12;8.69;http://www.rtcm-ntrip.org/home',
  'NET;RBMC-IP;IBGE;B;N;http://www.ibge.gov.br;https://gps-ntrip.ibge.gov.br/skl/;none;none',
  'STR;SSRA03IGS0;RTCM-SSR APC;RTCM 3.1;1057(60);0;GPS+GLO+GAL+BDS;IGS;DEU;50.09;8.66;0;1;BNC;none;B;N;800;IGS Combination',
  'STR;VICO1;Vicosa;RTCM 3.0;1004(1),1006(1);2;GPS+GLO;RBMC-IP;BRA;-20.76;-42.87;0;0;TRIMBLE NETR9;none;B;N;1500;RBMC-VICO',
  'STR;VICO0;Vicosa;RTCM 3.2;1006(1),1077(1);2;GPS+GLO+GAL+BDS+SBAS;RBMC-IP;BRA;-20.76;-42.87;0;0;TRIMBLE NETR9;none;B;N;1500;RBMC-VICO',
  'STR;BRAZ0;Brasilia;RTCM 3.3;1006(1),1077(1);2;GPS+GLO;RBMC-IP;BRA;;;0;0;LEICA GR50;none;B;N;1500;RBMC-BRAZ',
  'ENDSOURCETABLE',
  '',
].join('\r\n')

describe('parseSourcetable', () => {
  it('returns only STR rows with the documented fields', () => {
    const rows = parseSourcetable(FIXTURE, 'http://caster/')
    expect(rows.map((r) => r.mountpoint)).toEqual(['SSRA03IGS0', 'VICO1', 'VICO0', 'BRAZ0'])
    expect(rows[2]).toEqual({
      mountpoint: 'VICO0',
      identifier: 'Vicosa',
      format: 'RTCM 3.2',
      formatDetails: '1006(1),1077(1)',
      navSystem: 'GPS+GLO+GAL+BDS+SBAS',
      network: 'RBMC-IP',
      country: 'BRA',
      lat: -20.76,
      lon: -42.87,
      generator: 'TRIMBLE NETR9',
    })
    expect(rows[3]!.lat).toBeNull()
  })

  it('throws NTRIP_PARSE_ERROR when the sentinel is missing', () => {
    expect(() => parseSourcetable('STR;VICO0;Vicosa', 'http://caster/')).toThrowError(NtripRequestError)
    try {
      parseSourcetable('garbage', 'http://caster/')
    } catch (err) {
      expect(err).toMatchObject({ code: 'NTRIP_PARSE_ERROR', url: 'http://caster/' })
    }
  })
})

describe('createSourcetableCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares one in-flight download between concurrent callers and then serves from cache', async () => {
    let resolveFetch: (text: string) => void = () => {}
    const fetchText = vi.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve }))
    const cache = createSourcetableCache({ ttlMs: 60_000, fetchText })

    const a = cache.get('http://caster/')
    const b = cache.get('http://caster/')
    expect(fetchText).toHaveBeenCalledTimes(1)
    resolveFetch(FIXTURE)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.cached).toBe(false)
    expect(rb.cached).toBe(false)
    expect(ra.rows).toHaveLength(4)

    const rc = await cache.get('http://caster/')
    expect(rc.cached).toBe(true)
    expect(fetchText).toHaveBeenCalledTimes(1)
    expect(cache.peek('http://caster/')).toHaveLength(4)
  })

  it('never caches a failure and refetches after the TTL', async () => {
    const fetchText = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(FIXTURE)
    const cache = createSourcetableCache({ ttlMs: 60_000, fetchText })

    await expect(cache.get('http://caster/')).rejects.toThrow('boom')
    expect(cache.peek('http://caster/')).toBeNull()

    expect((await cache.get('http://caster/')).cached).toBe(false)
    expect((await cache.get('http://caster/')).cached).toBe(true)

    vi.advanceTimersByTime(60_001)
    expect(cache.peek('http://caster/')).toBeNull()
    expect((await cache.get('http://caster/')).cached).toBe(false)
    expect(fetchText).toHaveBeenCalledTimes(3)
  })

  it('returns frozen rows so one test cannot mutate what another sees', async () => {
    const cache = createSourcetableCache({ ttlMs: 60_000, fetchText: async () => FIXTURE })
    const { rows } = await cache.get('http://caster/')
    expect(Object.isFrozen(rows)).toBe(true)
    expect(Object.isFrozen(rows[0])).toBe(true)
  })

  it('peek is null when cold and clear() empties the cache', async () => {
    const cache = createSourcetableCache({ ttlMs: 60_000, fetchText: async () => FIXTURE })
    expect(cache.peek('http://caster/')).toBeNull()
    await cache.get('http://caster/')
    cache.clear()
    expect(cache.peek('http://caster/')).toBeNull()
  })
})
