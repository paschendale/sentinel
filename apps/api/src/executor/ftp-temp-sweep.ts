import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { FTP_TEMP_DIR, FTP_TEMP_MAX_AGE_MS, FTP_TEMP_SWEEP_INTERVAL_MS } from '../config.js'
import { logger } from '../logger.js'

const sweepLog = logger.child({ component: 'ftp-temp-sweep' })

let intervalHandle: ReturnType<typeof setInterval> | null = null

export async function sweepFtpTempDir(): Promise<void> {
  try {
    await mkdir(FTP_TEMP_DIR, { recursive: true })
    const entries = await readdir(FTP_TEMP_DIR)
    const cutoff = Date.now() - FTP_TEMP_MAX_AGE_MS
    let deleted = 0
    for (const entry of entries) {
      const filePath = join(FTP_TEMP_DIR, entry)
      try {
        const info = await stat(filePath)
        if (info.isFile() && info.mtimeMs < cutoff) {
          await unlink(filePath)
          deleted++
        }
      } catch {
        // File may have been removed concurrently by the request that created it — ignore.
      }
    }
    if (deleted > 0) {
      sweepLog.info({ event: 'ftp_temp_sweep.deleted', deleted }, `ftp temp sweep: removed ${deleted} orphaned file(s)`)
    }
  } catch (err) {
    sweepLog.error({ event: 'ftp_temp_sweep.failed', err }, 'ftp temp sweep failed')
  }
}

export function startFtpTempSweep(): void {
  void sweepFtpTempDir()
  intervalHandle = setInterval(() => {
    void sweepFtpTempDir()
  }, FTP_TEMP_SWEEP_INTERVAL_MS)
  sweepLog.info({ event: 'ftp_temp_sweep.scheduled' }, 'ftp temp sweep scheduled')
}

export function stopFtpTempSweep(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
