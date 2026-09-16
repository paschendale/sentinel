import type { PublicStatusOutcome, TestStatus } from '@sentinel/shared'

export interface PublicStatusPrevState {
  /** null when the test has never produced a `test_state` row yet. */
  public_status: PublicStatusOutcome | null
  failing_since: Date | null
  succeeding_since: Date | null
}

export interface PublicStatusResult {
  public_status: PublicStatusOutcome
  failing_since: Date | null
  succeeding_since: Date | null
}

/**
 * A test only reads "down" once it has failed continuously for longer than `windowMs`, and only
 * reads "up" again (after trouble) once it has succeeded continuously for longer than `windowMs`.
 * In between — a single blip, an ongoing-but-not-yet-a-full-window failure streak, or a recovery
 * that hasn't held long enough yet — it reads "degraded": a point of attention, not an outage.
 *
 * `failing_since`/`succeeding_since` mark the start of whichever streak is currently open; the
 * caller persists whatever this returns and passes it back in as `prev` on the next run.
 */
export function computePublicStatus(
  prev: PublicStatusPrevState,
  lastStatus: TestStatus,
  runAt: Date,
  windowMs: number,
): PublicStatusResult {
  if (lastStatus === 'warn') {
    // A warning is its own immediate signal, independent of the failure/recovery streaks —
    // it doesn't start or extend either one, just flags attention for this run.
    return { public_status: 'degraded', failing_since: null, succeeding_since: prev.succeeding_since }
  }

  if (lastStatus !== 'success') {
    const failingSince = prev.failing_since ?? runAt
    const down = runAt.getTime() - failingSince.getTime() >= windowMs
    return { public_status: down ? 'down' : 'degraded', failing_since: failingSince, succeeding_since: null }
  }

  // A clean run. A test that was already "up" (or has no history at all) stays "up" — the
  // one-window proving period is only for recovering from trouble, not re-verified forever.
  const prevStatus = prev.public_status ?? 'unknown'
  if (prevStatus === 'up' || prevStatus === 'unknown') {
    return { public_status: 'up', failing_since: null, succeeding_since: null }
  }

  const succeedingSince = prev.succeeding_since ?? runAt
  const recovered = runAt.getTime() - succeedingSince.getTime() >= windowMs
  return {
    public_status: recovered ? 'up' : 'degraded',
    failing_since: null,
    succeeding_since: recovered ? null : succeedingSince,
  }
}
