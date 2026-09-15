import { describe, expect, it } from 'vitest'
import type { CandidateTest, RbmcStationWithTest } from '../db/queries/rbmc.js'
import { planSync } from './sync.js'
import { RBMC_TEMPLATE_VERSION, buildStationTestCode, buildStationTestName } from './template.js'

function station(code: string, overrides: Partial<RbmcStationWithTest> = {}): RbmcStationWithTest {
  return {
    code,
    test_id: null,
    station_id: null,
    uf: 'MG',
    geocodigo: null,
    lat: -20,
    lon: -42,
    alt_geom: null,
    name: null,
    in_shapefile: true,
    template_version: null,
    synced_at: null,
    test_exists: false,
    test_name: null,
    test_code: null,
    test_enabled: null,
    ...overrides,
  }
}

function candidate(id: string, name: string, overrides: Partial<CandidateTest> = {}): CandidateTest {
  return { id, name, code: `// ${name}`, enabled: true, created_at: new Date('2026-05-14T20:48:40Z'), ...overrides }
}

const noCity = () => null
let seq = 0
const newId = () => `new-${++seq}`

describe('planSync', () => {
  it('adopts the XXXX0 test, keeps its city, and disables the XXXX1 sibling', () => {
    const plan = planSync({
      stationRows: [station('VICO')],
      removed: [],
      returned: [],
      candidates: [candidate('t0', 'RBMC - VICO0 - Vicosa'), candidate('t1', 'RBMC - VICO1 - Vicosa')],
      cityLookup: noCity,
      newId,
    })
    expect(plan.adoptions).toEqual([
      { code: 'VICO', id: 't0', name: 'RBMC - VICO - Vicosa', testCode: buildStationTestCode('VICO') },
    ])
    expect(plan.disables).toEqual(['t1'])
    expect(plan.creates).toEqual([])
    expect(plan.links).toEqual([{ code: 'VICO', test_id: 't0', name: 'Vicosa', template_version: RBMC_TEMPLATE_VERSION }])
  })

  it('adopts the XXXX1 test when there is no XXXX0', () => {
    const plan = planSync({
      stationRows: [station('VICO')],
      removed: [],
      returned: [],
      candidates: [candidate('t1', 'RBMC - VICO1 - Vicosa')],
      cityLookup: noCity,
      newId,
    })
    expect(plan.adoptions.map((a) => a.id)).toEqual(['t1'])
    expect(plan.disables).toEqual([])
  })

  it('prefers the oldest when two XXXX0 tests exist and disables the newer one', () => {
    const plan = planSync({
      stationRows: [station('VICO')],
      removed: [],
      returned: [],
      candidates: [
        candidate('newer', 'RBMC - VICO0 - Vicosa', { created_at: new Date('2026-06-01T00:00:00Z') }),
        candidate('older', 'RBMC - VICO0 - Vicosa', { created_at: new Date('2026-05-01T00:00:00Z') }),
      ],
      cityLookup: noCity,
      newId,
    })
    expect(plan.adoptions[0]!.id).toBe('older')
    expect(plan.disables).toEqual(['newer'])
  })

  it('falls back to a quoted code literal in the JS when the name was changed', () => {
    const plan = planSync({
      stationRows: [station('VICO')],
      removed: [],
      returned: [],
      candidates: [candidate('renamed', 'Vicosa GNSS', { code: "return parts[1] === 'VICO0'" })],
      cityLookup: () => 'Vicosa',
      newId,
    })
    expect(plan.adoptions[0]).toMatchObject({ id: 'renamed', name: 'RBMC - VICO - Vicosa' })
  })

  it('creates a test with the defaults and the sourcetable city when nothing is adoptable', () => {
    seq = 0
    const plan = planSync({
      stationRows: [station('AMCO')],
      removed: [],
      returned: [],
      candidates: [candidate('t0', 'RBMC - VICO0 - Vicosa')],
      cityLookup: (c) => (c === 'AMCO' ? 'Coari' : null),
      newId,
    })
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0]!.test).toMatchObject({
      id: 'new-1',
      name: 'RBMC - AMCO - Coari',
      code: buildStationTestCode('AMCO'),
      schedule_ms: 900_000,
      timeout_ms: 10_000,
      retries: 1,
      failure_threshold: 3,
      cooldown_ms: 86_400_000,
      tags: ['rbmc'],
      enabled: true,
    })
    expect(plan.links).toEqual([{ code: 'AMCO', test_id: 'new-1', name: 'Coari', template_version: RBMC_TEMPLATE_VERSION }])
    // The unrelated VICO0 test is left alone.
    expect(plan.disables).toEqual([])
  })

  it('never adopts a test already linked to another station', () => {
    const plan = planSync({
      stationRows: [
        station('VICO', { test_id: 't0', test_exists: true, test_name: 'RBMC - VICO - Vicosa', test_code: buildStationTestCode('VICO'), template_version: RBMC_TEMPLATE_VERSION }),
        station('VIC2'),
      ],
      removed: [],
      returned: [],
      candidates: [candidate('t0', 'RBMC - VICO - Vicosa', { code: "'VIC2'" })],
      cityLookup: noCity,
      newId,
    })
    expect(plan.adoptions).toEqual([])
    expect(plan.creates.map((c) => c.code)).toEqual(['VIC2'])
  })

  it('recreates the test when the linked one was deleted by an operator', () => {
    const plan = planSync({
      stationRows: [station('VICO', { test_id: 'gone', test_exists: false })],
      removed: [],
      returned: [],
      candidates: [],
      cityLookup: noCity,
      newId,
    })
    expect(plan.creates).toHaveLength(1)
    expect(plan.links[0]!.test_id).not.toBe('gone')
  })

  it('reports linked, up-to-date tests as unchanged (idempotent second run)', () => {
    const plan = planSync({
      stationRows: [
        station('VICO', {
          test_id: 't0',
          test_exists: true,
          test_name: 'RBMC - VICO - Vicosa',
          test_code: buildStationTestCode('VICO'),
          template_version: RBMC_TEMPLATE_VERSION,
          name: 'Vicosa',
        }),
      ],
      removed: [],
      returned: [],
      candidates: [candidate('t0', 'RBMC - VICO - Vicosa')],
      cityLookup: noCity,
      newId,
    })
    expect(plan).toEqual({ creates: [], adoptions: [], updates: [], disables: [], enables: [], links: [], unchanged: 1 })
  })

  it('rewrites code and name when the linked test drifted (manual edit or template bump)', () => {
    const plan = planSync({
      stationRows: [
        station('VICO', {
          test_id: 't0',
          test_exists: true,
          test_name: 'RBMC - VICO0 - Vicosa',
          test_code: 'return true',
          template_version: 0,
        }),
      ],
      removed: [],
      returned: [],
      candidates: [],
      cityLookup: noCity,
      newId,
    })
    expect(plan.updates).toEqual([{ code: 'VICO', id: 't0', name: 'RBMC - VICO - Vicosa', testCode: buildStationTestCode('VICO') }])
    expect(plan.links).toEqual([{ code: 'VICO', test_id: 't0', name: 'Vicosa', template_version: RBMC_TEMPLATE_VERSION }])
    expect(plan.unchanged).toBe(0)
  })

  it('keeps an operator-customised city label on a linked, generated-style name', () => {
    const plan = planSync({
      stationRows: [
        station('VICO', {
          test_id: 't0',
          test_exists: true,
          test_name: 'RBMC - VICO - Viçosa (UFV)',
          test_code: buildStationTestCode('VICO'),
          template_version: RBMC_TEMPLATE_VERSION,
          name: 'Viçosa (UFV)',
        }),
      ],
      removed: [],
      returned: [],
      candidates: [],
      cityLookup: () => 'Vicosa',
      newId,
    })
    expect(plan.updates).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it('disables the test of a station that left the shapefile and skips its row', () => {
    const plan = planSync({
      stationRows: [
        station('GONE', { in_shapefile: false, test_id: 'tg', test_exists: true, test_name: 'RBMC - GONE - Somewhere', test_enabled: true }),
        station('VICO', { test_id: 't0', test_exists: true, test_name: 'RBMC - VICO - Vicosa', test_code: buildStationTestCode('VICO'), template_version: RBMC_TEMPLATE_VERSION, name: 'Vicosa' }),
      ],
      removed: [{ code: 'GONE', test_id: 'tg' }],
      returned: [],
      candidates: [],
      cityLookup: noCity,
      newId,
    })
    expect(plan.disables).toEqual(['tg'])
    expect(plan.creates).toEqual([])
    expect(plan.unchanged).toBe(1)
  })
})

describe('planSync — returning stations', () => {
  it('re-enables the linked test of a station that comes back into the shapefile', () => {
    const plan = planSync({
      stationRows: [
        station('BACK', {
          test_id: 'tb',
          test_exists: true,
          test_enabled: false,
          test_name: 'RBMC - BACK - Backtown',
          test_code: buildStationTestCode('BACK'),
          template_version: RBMC_TEMPLATE_VERSION,
          name: 'Backtown',
        }),
      ],
      removed: [],
      returned: [{ code: 'BACK', test_id: 'tb' }],
      candidates: [],
      cityLookup: noCity,
      newId,
    })
    expect(plan.enables).toEqual(['tb'])
    expect(plan.disables).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it('does not touch a returning station whose test is already enabled', () => {
    const plan = planSync({
      stationRows: [
        station('BACK', {
          test_id: 'tb',
          test_exists: true,
          test_enabled: true,
          test_name: 'RBMC - BACK - Backtown',
          test_code: buildStationTestCode('BACK'),
          template_version: RBMC_TEMPLATE_VERSION,
          name: 'Backtown',
        }),
      ],
      removed: [],
      returned: [{ code: 'BACK', test_id: 'tb' }],
      candidates: [],
      cityLookup: noCity,
      newId,
    })
    expect(plan.enables).toEqual([])
  })
})

describe('template', () => {
  it('names fall back to the code when no city is known', () => {
    expect(buildStationTestName('VICO', null)).toBe('RBMC - VICO - VICO')
    expect(buildStationTestName('VICO', ' Vicosa ')).toBe('RBMC - VICO - Vicosa')
  })

  it('generated code is a valid async function body that filters by network and prefix', async () => {
    const code = buildStationTestCode('VICO')
    expect(code).toContain("const CODE = 'VICO'")
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (ctx: unknown) => Promise<unknown>
    const fn = new AsyncFunction('ctx', code)
    const logs: string[] = []
    const assertions: Array<[string, boolean]> = []
    const rows = [
      { mountpoint: 'VICO0', format: 'RTCM 3.2', navSystem: 'GPS+GLO', network: 'RBMC-IP', generator: 'TRIMBLE' },
      { mountpoint: 'VICOX', format: 'RTCM 3.1', navSystem: 'GPS', network: 'IGS', generator: 'BNC' },
    ]
    const ctx = {
      ntrip: { sourcetable: async () => rows },
      log: (m: string) => logs.push(m),
      assert: (name: string, value: unknown) => assertions.push([name, Boolean(value)]),
    }
    await expect(fn(ctx)).resolves.toBe(true)
    expect(logs).toEqual(['VICO0: RTCM 3.2 GPS+GLO via TRIMBLE'])
    expect(assertions).toEqual([['Station VICO is listed in the RBMC-IP sourcetable', true]])
    expect(() => buildStationTestCode("x'; process.exit()")).toThrow()
  })
})
