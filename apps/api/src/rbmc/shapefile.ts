import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RBMC_SHAPEFILE_BASENAME, RBMC_SHAPEFILE_DIR } from '../config.js'
import type { RbmcStationInput } from '../db/queries/rbmc.js'

/**
 * Minimal, dependency-free ESRI Shapefile reader — just enough for the IBGE
 * `RBMCPoint` file: Point geometries (shape type 1) from `.shp` and C/N/D/L
 * attributes from the latin-1 `.dbf`. Everything is read with async fs calls
 * (RULES #12) and every row is parsed inside its own try/catch (RULES #16).
 */

export interface ShpPoint {
  x: number
  y: number
}

const SHP_MAGIC = 9994
const SHAPE_NULL = 0
const SHAPE_POINT = 1
const DBF_DELETED_FLAG = 0x2a
const DBF_HEADER_TERMINATOR = 0x0d

/** Parses a Point-type `.shp`. Null shapes become `null` so indexes stay aligned with the `.dbf`. */
export function parseShpPoints(buf: Buffer): Array<ShpPoint | null> {
  if (buf.length < 100) throw new Error('shp: file shorter than the 100-byte header')
  if (buf.readInt32BE(0) !== SHP_MAGIC) throw new Error('shp: bad magic number (not a shapefile)')
  const declaredBytes = buf.readInt32BE(24) * 2
  if (declaredBytes !== buf.length) {
    throw new Error(`shp: header declares ${declaredBytes} bytes but file has ${buf.length} (truncated or partially copied?)`)
  }
  const fileShapeType = buf.readInt32LE(32)
  if (fileShapeType !== SHAPE_POINT) {
    throw new Error(`shp: unsupported shape type ${fileShapeType} (only Point = 1 is supported)`)
  }

  const points: Array<ShpPoint | null> = []
  let off = 100
  while (off + 8 <= buf.length) {
    const contentLen = buf.readInt32BE(off + 4) * 2
    const recordEnd = off + 8 + contentLen
    if (recordEnd > buf.length) throw new Error(`shp: record at byte ${off} runs past end of file`)
    const shapeType = buf.readInt32LE(off + 8)
    if (shapeType === SHAPE_POINT) {
      points.push({ x: buf.readDoubleLE(off + 12), y: buf.readDoubleLE(off + 20) })
    } else if (shapeType === SHAPE_NULL) {
      points.push(null)
    } else {
      throw new Error(`shp: record ${points.length} has shape type ${shapeType}, expected Point`)
    }
    off = recordEnd
  }
  return points
}

export interface DbfField {
  name: string
  type: string
  length: number
  decimals: number
}

export type DbfValue = string | number | null
export type DbfRecord = Record<string, DbfValue>

const latin1 = new TextDecoder('latin1')

/** Strips both space padding and NUL padding — IBGE writes `\0` into unused character bytes. */
function cleanText(raw: Uint8Array): string {
  return latin1.decode(raw).replace(/^[\s\0]+|[\s\0]+$/g, '')
}

function decodeField(field: DbfField, raw: Uint8Array): DbfValue {
  const text = cleanText(raw)
  switch (field.type) {
    case 'N':
    case 'F': {
      if (text === '') return null
      const n = Number(text.replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    case 'D': {
      if (!/^\d{8}$/.test(text) || text === '00000000') return null
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    }
    case 'L':
      return /^[YyTt]$/.test(text) ? 'true' : /^[NnFf]$/.test(text) ? 'false' : null
    default:
      return text
  }
}

/** Parses a dBASE III/IV `.dbf`. Deleted records become `null` so indexes stay aligned with the `.shp`. */
export function parseDbf(buf: Buffer): { fields: DbfField[]; records: Array<DbfRecord | null> } {
  if (buf.length < 32) throw new Error('dbf: file shorter than the 32-byte header')
  const recordCount = buf.readUInt32LE(4)
  const headerLen = buf.readUInt16LE(8)
  const recordLen = buf.readUInt16LE(10)
  if (headerLen < 33 || recordLen < 1) throw new Error('dbf: malformed header lengths')
  if (headerLen + recordCount * recordLen > buf.length) {
    throw new Error(`dbf: header declares ${recordCount} records of ${recordLen} bytes but file has only ${buf.length} bytes`)
  }

  const fields: DbfField[] = []
  let off = 32
  while (off + 32 <= headerLen && buf[off] !== DBF_HEADER_TERMINATOR) {
    const nameBytes = buf.subarray(off, off + 11)
    const nulIdx = nameBytes.indexOf(0)
    const name = latin1.decode(nulIdx === -1 ? nameBytes : nameBytes.subarray(0, nulIdx)).trim()
    fields.push({
      name,
      type: String.fromCharCode(buf[off + 11]!),
      length: buf[off + 16]!,
      decimals: buf[off + 17]!,
    })
    off += 32
  }
  const fieldBytes = fields.reduce((sum, f) => sum + f.length, 0)
  if (fieldBytes + 1 !== recordLen) {
    throw new Error(`dbf: field lengths sum to ${fieldBytes + 1} but record length is ${recordLen}`)
  }

  const records: Array<DbfRecord | null> = []
  for (let i = 0; i < recordCount; i++) {
    const start = headerLen + i * recordLen
    if (buf[start] === DBF_DELETED_FLAG) {
      records.push(null)
      continue
    }
    const rec: DbfRecord = {}
    let pos = start + 1
    for (const f of fields) {
      rec[f.name] = decodeField(f, buf.subarray(pos, pos + f.length))
      pos += f.length
    }
    records.push(rec)
  }
  return { fields, records }
}

export interface ShapefileReadResult {
  stations: RbmcStationInput[]
  skipped: Array<{ index: number; reason: string }>
}

const CODE_RE = /^[A-Z0-9]{4}$/

function asText(v: DbfValue | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function asNumber(v: DbfValue | undefined): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Reads `<dir>/<base>.shp` + `.dbf` and returns one station per valid row.
 * Row-level problems (bad code, bad coordinates, duplicates) are reported in
 * `skipped` rather than thrown; file-level problems (missing/corrupt file) throw.
 */
export async function readRbmcShapefile(
  dir: string = RBMC_SHAPEFILE_DIR,
  base: string = RBMC_SHAPEFILE_BASENAME
): Promise<ShapefileReadResult> {
  const [shpBuf, dbfBuf] = await Promise.all([
    readFile(join(dir, `${base}.shp`)),
    readFile(join(dir, `${base}.dbf`)),
  ])
  const points = parseShpPoints(shpBuf)
  const { records } = parseDbf(dbfBuf)
  if (points.length !== records.length) {
    throw new Error(`shapefile: .shp has ${points.length} records but .dbf has ${records.length}`)
  }

  const stations: RbmcStationInput[] = []
  const skipped: ShapefileReadResult['skipped'] = []
  const seen = new Set<string>()

  for (let i = 0; i < records.length; i++) {
    try {
      const rec = records[i]
      if (rec === null || rec === undefined) {
        skipped.push({ index: i, reason: 'record flagged as deleted' })
        continue
      }
      const code = asText(rec['SG_RBMC'])?.toUpperCase() ?? null
      if (code === null || !CODE_RE.test(code)) {
        skipped.push({ index: i, reason: `invalid SG_RBMC ${JSON.stringify(code)}` })
        continue
      }
      if (seen.has(code)) {
        skipped.push({ index: i, reason: `duplicate SG_RBMC ${code}` })
        continue
      }
      const point = points[i] ?? null
      const lon = point?.x ?? asNumber(rec['LONGITUDE'])
      const lat = point?.y ?? asNumber(rec['LATITUDE'])
      if (lon === null || lat === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        skipped.push({ index: i, reason: `station ${code} has no usable coordinates` })
        continue
      }
      seen.add(code)
      stations.push({
        code,
        station_id: asText(rec['ESTACAO']),
        uf: asText(rec['UF']),
        geocodigo: asText(rec['GEOCODIGO']),
        lat,
        lon,
        alt_geom: asText(rec['ALTGEOM']),
      })
    } catch (err) {
      skipped.push({ index: i, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return { stations, skipped }
}

/** Newest mtime of the `.shp`/`.dbf` pair, or `null` if either is missing. Never throws. */
export async function shapefileMtimeMs(
  dir: string = RBMC_SHAPEFILE_DIR,
  base: string = RBMC_SHAPEFILE_BASENAME
): Promise<number | null> {
  try {
    const [shp, dbf] = await Promise.all([
      stat(join(dir, `${base}.shp`)),
      stat(join(dir, `${base}.dbf`)),
    ])
    return Math.max(shp.mtimeMs, dbf.mtimeMs)
  } catch {
    return null
  }
}
