import { nanoid } from 'nanoid'
import type { ClientBase } from 'pg'
import type { RbmcSyncReason, RbmcSyncSummary, Test } from '@sentinel/shared'
import { RBMC_NTRIP_URL, RBMC_SYNC_POLL_MS } from '../config.js'
import { pool } from '../db/pool.js'
import {
  disableTests,
  findRbmcCandidateTests,
  insertTests,
  linkStations,
  listStationsWithTests,
  markMissingStations,
  updateTestsNameAndCode,
  upsertStations,
} from '../db/queries/rbmc.js'
import type { CandidateTest, NewTestRow, RbmcStationInput, RbmcStationWithTest } from '../db/queries/rbmc.js'
import { testEvents } from '../events.js'
import { invalidateCache } from '../executor/compile.js'
import { ntripSourcetableCache } from '../executor/ctx.js'
import { logger } from '../logger.js'
import { readRbmcShapefile, shapefileMtimeMs } from './shapefile.js'
import {
  RBMC_TEMPLATE_VERSION,
  RBMC_TEST_DEFAULTS,
  STATION_TEST_NAME_RE,
  buildStationTestCode,
  buildStationTestName,
} from './template.js'

const syncLog = logger.child({ component: 'rbmc-sync' })

// ---------------------------------------------------------------------------
// Pure planning — no I/O, fully unit-tested
// ---------------------------------------------------------------------------

export interface SyncPlan {
  /** Brand-new tests for stations with no adoptable candidate. */
  creates: Array<{ code: string; test: NewTestRow }>
  /** Existing tests taken over for a station (renamed + code replaced). */
  adoptions: Array<{ code: string; id: string; name: string; testCode: string }>
  /** Linked tests whose name/code drifted from the template. */
  updates: Array<{ code: string; id: string; name: string; testCode: string }>
  /** Test ids to disable (leftover mountpoint siblings, removed stations). */
  disables: string[]
  /** Station rows to (re)link — always carries the template version. */
  links: Array<{ code: string; test_id: string; name: string | null; template_version: number }>
  unchanged: number
}

export interface PlanInput {
  /** Every station row after the upsert (both in and out of the shapefile). */
  stationRows: RbmcStationWithTest[]
  /** Stations that just flipped to `in_shapefile = false` in this run. */
  removed: Array<{ code: string; test_id: string | null }>
  candidates: CandidateTest[]
  /** City label for a code, e.g. from the sourcetable identifier. */
  cityLookup: (code: string) => string | null
  newId?: () => string
}

function suffixRank(suffix: string): number {
  if (suffix === '0') return 0
  if (suffix === '') return 1
  if (suffix === '1') return 2
  return 3
}

/** Candidates for one code: name matches, or the code literal appears quoted in the JS. */
function candidatesFor(code: string, candidates: CandidateTest[], taken: Set<string>): Array<{ t: CandidateTest; suffix: string; city: string | null }> {
  const literalRe = new RegExp(`['"\`]${code}[0-9]?['"\`]`)
  const out: Array<{ t: CandidateTest; suffix: string; city: string | null }> = []
  for (const t of candidates) {
    if (taken.has(t.id)) continue
    const m = STATION_TEST_NAME_RE.exec(t.name)
    if (m && m[1] === code) {
      out.push({ t, suffix: m[2] ?? '', city: m[3]?.trim() ?? null })
    } else if (!m && literalRe.test(t.code)) {
      out.push({ t, suffix: '', city: null })
    }
  }
  out.sort((a, b) => {
    const r = suffixRank(a.suffix) - suffixRank(b.suffix)
    if (r !== 0) return r
    return new Date(a.t.created_at).getTime() - new Date(b.t.created_at).getTime()
  })
  return out
}

export function planSync(input: PlanInput): SyncPlan {
  const newId = input.newId ?? nanoid
  const plan: SyncPlan = { creates: [], adoptions: [], updates: [], disables: [], links: [], unchanged: 0 }
  const disableSet = new Set<string>()
  const taken = new Set<string>()
  for (const s of input.stationRows) if (s.test_id && s.test_exists) taken.add(s.test_id)

  for (const station of input.stationRows) {
    if (!station.in_shapefile) continue
    const code = station.code
    const desiredCode = buildStationTestCode(code)

    if (station.test_id && station.test_exists) {
      const currentName = station.test_name ?? ''
      const nameMatch = STATION_TEST_NAME_RE.exec(currentName)
      const keepsName = nameMatch !== null && nameMatch[1] === code && (nameMatch[2] ?? '') === ''
      const city = keepsName ? (nameMatch![3]?.trim() ?? null) : (input.cityLookup(code) ?? nameMatch?.[3]?.trim() ?? null)
      const desiredName = keepsName ? currentName : buildStationTestName(code, city)
      const codeDrift = station.test_code !== desiredCode
      const nameDrift = currentName !== desiredName
      const versionDrift = station.template_version !== RBMC_TEMPLATE_VERSION
      const learnedName = station.name === null && city !== null
      if (codeDrift || nameDrift) {
        plan.updates.push({ code, id: station.test_id, name: desiredName, testCode: desiredCode })
      }
      if (codeDrift || nameDrift || versionDrift || learnedName) {
        plan.links.push({ code, test_id: station.test_id, name: city, template_version: RBMC_TEMPLATE_VERSION })
      }
      if (!codeDrift && !nameDrift && !versionDrift) plan.unchanged++
      continue
    }

    const pool = candidatesFor(code, input.candidates, taken)
    const chosen = pool[0]
    if (chosen) {
      taken.add(chosen.t.id)
      const city = chosen.city ?? input.cityLookup(code)
      plan.adoptions.push({ code, id: chosen.t.id, name: buildStationTestName(code, city), testCode: desiredCode })
      plan.links.push({ code, test_id: chosen.t.id, name: city, template_version: RBMC_TEMPLATE_VERSION })
      for (const other of pool.slice(1)) {
        taken.add(other.t.id)
        if (other.t.enabled) disableSet.add(other.t.id)
      }
      continue
    }

    const city = input.cityLookup(code)
    const id = newId()
    plan.creates.push({
      code,
      test: {
        id,
        name: buildStationTestName(code, city),
        code: desiredCode,
        enabled: true,
        ...RBMC_TEST_DEFAULTS,
        tags: [...RBMC_TEST_DEFAULTS.tags],
      },
    })
    plan.links.push({ code, test_id: id, name: city, template_version: RBMC_TEMPLATE_VERSION })
  }

  for (const r of input.removed) {
    if (r.test_id) disableSet.add(r.test_id)
  }
  plan.disables = [...disableSet]
  return plan
}

// ---------------------------------------------------------------------------
// Transactional core — runs on a caller-provided client (tests wrap it in a
// transaction they roll back), never emits events itself
// ---------------------------------------------------------------------------

export interface ApplyResult {
  plan: SyncPlan
  created: Test[]
  updated: Test[]
  disabled: Test[]
}

export async function applyStations(
  client: ClientBase,
  stations: RbmcStationInput[],
  cityLookup: (code: string) => string | null,
  newId?: () => string
): Promise<ApplyResult> {
  await upsertStations(client, stations)
  const removed = await markMissingStations(client, stations.map((s) => s.code))
  const stationRows = await listStationsWithTests(client)
  const candidates = await findRbmcCandidateTests(client)
  const plan = planSync({ stationRows, removed, candidates, cityLookup, ...(newId ? { newId } : {}) })

  // Order matters for the scheduler: disables first, so leftover sibling timers stop
  // before adopted/created tests start.
  const disabled = await disableTests(client, plan.disables)
  const updated = await updateTestsNameAndCode(
    client,
    [...plan.adoptions, ...plan.updates].map((u) => ({ id: u.id, name: u.name, code: u.testCode }))
  )
  const created = await insertTests(client, plan.creates.map((c) => c.test))
  await linkStations(client, plan.links)
  return { plan, created, updated, disabled }
}

// ---------------------------------------------------------------------------
// Orchestration — shapefile in, events out; never throws
// ---------------------------------------------------------------------------

let inFlight: Promise<RbmcSyncSummary> | null = null
let lastSyncedMtime: number | null = null

async function warmCityLookup(): Promise<(code: string) => string | null> {
  let rows = ntripSourcetableCache.peek(RBMC_NTRIP_URL)
  if (rows === null) {
    try {
      rows = (await ntripSourcetableCache.get(RBMC_NTRIP_URL)).rows
    } catch (err) {
      syncLog.warn({ event: 'rbmc.sync.sourcetable_unavailable', err }, 'rbmc sync: sourcetable unavailable, new stations will be named by code')
      rows = null
    }
  }
  const byCode = new Map<string, string>()
  for (const r of rows ?? []) {
    const code = r.mountpoint.slice(0, 4)
    if (r.network === 'RBMC-IP' && r.identifier.trim() !== '' && !byCode.has(code)) byCode.set(code, r.identifier.trim())
  }
  return (code) => byCode.get(code) ?? null
}

async function runSync(reason: RbmcSyncReason): Promise<RbmcSyncSummary> {
  const summary: RbmcSyncSummary = { ok: false, reason, stations: 0, created: 0, adopted: 0, updated: 0, disabled: 0, skipped: 0 }
  const mtimeBefore = await shapefileMtimeMs()

  let stations: RbmcStationInput[]
  try {
    const read = await readRbmcShapefile()
    stations = read.stations
    summary.stations = stations.length
    summary.skipped = read.skipped.length
    for (const s of read.skipped) {
      syncLog.warn({ event: 'rbmc.sync.row_skipped', index: s.index, reason: s.reason }, `rbmc sync: skipped shapefile row ${s.index}: ${s.reason}`)
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err)
    syncLog.error({ event: 'rbmc.sync.failed', reason, err }, `rbmc sync failed (${reason}): could not read shapefile: ${summary.error}`)
    return summary
  }
  if (stations.length === 0) {
    summary.error = 'shapefile contains no usable stations'
    syncLog.error({ event: 'rbmc.sync.failed', reason }, `rbmc sync failed (${reason}): ${summary.error}`)
    return summary
  }

  const cityLookup = await warmCityLookup()

  let result: ApplyResult
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    result = await applyStations(client, stations, cityLookup)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    summary.error = err instanceof Error ? err.message : String(err)
    syncLog.error({ event: 'rbmc.sync.failed', reason, err }, `rbmc sync failed (${reason}): ${summary.error}`)
    return summary
  } finally {
    client.release()
  }

  // Side effects only after COMMIT, in scheduler-friendly order.
  for (const t of result.disabled) {
    invalidateCache(t.id)
    testEvents.emit('test:updated', t)
  }
  for (const t of result.updated) {
    invalidateCache(t.id)
    testEvents.emit('test:updated', t)
  }
  for (const t of result.created) testEvents.emit('test:created', t)

  summary.ok = true
  summary.created = result.created.length
  summary.adopted = result.plan.adoptions.length
  summary.updated = result.plan.updates.length
  summary.disabled = result.disabled.length
  lastSyncedMtime = mtimeBefore
  syncLog.info(
    { event: 'rbmc.sync.complete', ...summary },
    `rbmc sync complete (${reason}): stations=${summary.stations} created=${summary.created} adopted=${summary.adopted} updated=${summary.updated} disabled=${summary.disabled} skipped=${summary.skipped}`
  )
  return summary
}

/** Runs one sync. Concurrent callers share the in-flight run. Never throws. */
export function syncRbmcStations(opts: { reason: RbmcSyncReason }): Promise<RbmcSyncSummary> {
  if (inFlight) return inFlight
  inFlight = runSync(opts.reason).finally(() => {
    inFlight = null
  })
  return inFlight
}

// ---------------------------------------------------------------------------
// Startup + mtime poller
// ---------------------------------------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null
let lastSeenMtime: number | null = null
let stablePolls = 0
let warnedMissing = false

export async function pollShapefile(): Promise<void> {
  try {
    const mtime = await shapefileMtimeMs()
    if (mtime === null) {
      if (!warnedMissing) {
        syncLog.warn({ event: 'rbmc.sync.shapefile_missing' }, 'rbmc sync: shapefile not found; keeping the last synced station list')
        warnedMissing = true
      }
      return
    }
    warnedMissing = false
    if (mtime !== lastSeenMtime) {
      lastSeenMtime = mtime
      stablePolls = 0
      return
    }
    if (mtime === lastSyncedMtime) return
    stablePolls++
    // Two consecutive identical polls: the copy finished, not a half-written bind mount.
    if (stablePolls >= 1) {
      syncLog.info({ event: 'rbmc.sync.shapefile_changed', mtime }, 'rbmc sync: shapefile changed, re-syncing stations')
      await syncRbmcStations({ reason: 'mtime' })
    }
  } catch (err) {
    syncLog.error({ event: 'rbmc.sync.poll_failed', err }, 'rbmc sync: mtime poll failed')
  }
}

export function startRbmcSync(): void {
  void syncRbmcStations({ reason: 'startup' })
  intervalHandle = setInterval(() => {
    void pollShapefile()
  }, RBMC_SYNC_POLL_MS)
  syncLog.info({ event: 'rbmc.sync.scheduled', poll_ms: RBMC_SYNC_POLL_MS }, 'rbmc shapefile poller scheduled')
}

export function stopRbmcSync(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
