import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseDbf, parseShpPoints, readRbmcShapefile, shapefileMtimeMs } from './shapefile.js'

const DATA_DIR = resolve(import.meta.dirname, '../../data/rbmc')

/** Builds a minimal Point .shp with the given coordinates (null entries become null shapes). */
function buildShp(points: Array<[number, number] | null>): Buffer {
  const records = points.map((p, i) => {
    const contentLen = p ? 20 : 4
    const rec = Buffer.alloc(8 + contentLen)
    rec.writeInt32BE(i + 1, 0)
    rec.writeInt32BE(contentLen / 2, 4)
    if (p) {
      rec.writeInt32LE(1, 8)
      rec.writeDoubleLE(p[0], 12)
      rec.writeDoubleLE(p[1], 20)
    } else {
      rec.writeInt32LE(0, 8)
    }
    return rec
  })
  const body = Buffer.concat(records)
  const header = Buffer.alloc(100)
  header.writeInt32BE(9994, 0)
  header.writeInt32BE((100 + body.length) / 2, 24)
  header.writeInt32LE(1000, 28)
  header.writeInt32LE(1, 32)
  return Buffer.concat([header, body])
}

interface FieldSpec { name: string; type: string; length: number }

/** Builds a minimal dBASE .dbf with C/N fields; values are NUL-padded like IBGE's file. */
function buildDbf(fields: FieldSpec[], rows: Array<Record<string, string> | 'deleted'>): Buffer {
  const recordLen = 1 + fields.reduce((s, f) => s + f.length, 0)
  const headerLen = 32 + fields.length * 32 + 1
  const header = Buffer.alloc(headerLen)
  header[0] = 0x03
  header.writeUInt32LE(rows.length, 4)
  header.writeUInt16LE(headerLen, 8)
  header.writeUInt16LE(recordLen, 10)
  fields.forEach((f, i) => {
    const off = 32 + i * 32
    header.write(f.name, off, 'latin1')
    header[off + 11] = f.type.charCodeAt(0)
    header[off + 16] = f.length
  })
  header[headerLen - 1] = 0x0d
  const recs = rows.map((row) => {
    const rec = Buffer.alloc(recordLen, 0)
    if (row === 'deleted') {
      rec[0] = 0x2a
      return rec
    }
    rec[0] = 0x20
    let pos = 1
    for (const f of fields) {
      const v = row[f.name] ?? ''
      rec.write(v, pos, f.length, 'latin1')
      pos += f.length
    }
    return rec
  })
  return Buffer.concat([header, ...recs])
}

const FIELDS: FieldSpec[] = [
  { name: 'ESTACAO', type: 'C', length: 8 },
  { name: 'UF', type: 'C', length: 2 },
  { name: 'LATITUDE', type: 'N', length: 20 },
  { name: 'LONGITUDE', type: 'N', length: 20 },
  { name: 'SG_RBMC', type: 'C', length: 8 },
]

describe('shapefile reader — shipped IBGE file', () => {
  it('reads all 157 stations with unique codes and sane coordinates', async () => {
    const { stations, skipped } = await readRbmcShapefile(DATA_DIR)
    expect(skipped).toEqual([])
    expect(stations).toHaveLength(157)
    expect(new Set(stations.map((s) => s.code)).size).toBe(157)
    for (const s of stations) {
      expect(s.code).toMatch(/^[A-Z0-9]{4}$/)
      expect(s.lat).toBeGreaterThan(-40)
      expect(s.lat).toBeLessThan(10)
      expect(s.lon).toBeGreaterThan(-80)
      expect(s.lon).toBeLessThan(-30)
      expect(s.code.includes('\0')).toBe(false)
      expect(s.uf?.includes('\0') ?? false).toBe(false)
    }
    const vico = stations.find((s) => s.code === 'VICO')
    expect(vico).toBeDefined()
    expect(vico!.lon).toBeCloseTo(-42.87, 1)
    expect(vico!.lat).toBeCloseTo(-20.76, 1)
    expect(vico!.uf).toBe('MG')
  })

  it('exposes the raw DBF fields, including NUL-padded text cleaned up', async () => {
    const { fields, records } = parseDbf(await readFile(resolve(DATA_DIR, 'RBMCPoint.dbf')))
    expect(fields.map((f) => f.name)).toContain('SG_RBMC')
    expect(records).toHaveLength(157)
    const first = records[0]!
    expect(first['SITUACAO']).toBe('BOM')
    expect(first['NOTA']).toBe('')
    expect(typeof first['LATITUDE']).toBe('number')
  })

  it('reports the shapefile mtime and null when missing', async () => {
    expect(await shapefileMtimeMs(DATA_DIR)).toBeGreaterThan(0)
    expect(await shapefileMtimeMs('/definitely/not/here')).toBeNull()
  })
})

describe('shapefile reader — synthetic files', () => {
  it('rejects a bad magic number', () => {
    const shp = buildShp([[-42, -20]])
    shp.writeInt32BE(1234, 0)
    expect(() => parseShpPoints(shp)).toThrow(/magic/)
  })

  it('rejects non-point shape types', () => {
    const shp = buildShp([[-42, -20]])
    shp.writeInt32LE(5, 32) // Polygon
    expect(() => parseShpPoints(shp)).toThrow(/shape type 5/)
  })

  it('rejects a truncated .shp (header length mismatch)', () => {
    const shp = buildShp([[-42, -20], [-43, -21]])
    expect(() => parseShpPoints(shp.subarray(0, shp.length - 10))).toThrow(/truncated/)
  })

  it('rejects a .dbf whose declared records run past the file', () => {
    const dbf = buildDbf(FIELDS, [{ SG_RBMC: 'AAAA' }, { SG_RBMC: 'BBBB' }])
    expect(() => parseDbf(dbf.subarray(0, dbf.length - 5))).toThrow(/only/)
  })

  it('keeps indexes aligned when a DBF record is deleted or a shape is null', () => {
    const shp = buildShp([[-42, -20], null, [-44, -22]])
    const dbf = buildDbf(FIELDS, [
      { SG_RBMC: 'AAAA', UF: 'MG' },
      'deleted',
      { SG_RBMC: 'CCCC', UF: 'SP' },
    ])
    const points = parseShpPoints(shp)
    const { records } = parseDbf(dbf)
    expect(points[1]).toBeNull()
    expect(records[1]).toBeNull()
    expect(records[2]!['SG_RBMC']).toBe('CCCC')
  })

  it('skips rows with a blank or malformed SG_RBMC and duplicates, keeping the rest', async () => {
    const shp = buildShp([[-42, -20], [-43, -21], [-44, -22], [-45, -23]])
    const dbf = buildDbf(FIELDS, [
      { SG_RBMC: 'AAAA', UF: 'MG', LATITUDE: '-20', LONGITUDE: '-42' },
      { SG_RBMC: '', UF: 'SP' },
      { SG_RBMC: 'aaaa', UF: 'RJ' }, // lower-case → uppercased → duplicate of AAAA
      { SG_RBMC: 'TOO-LONG', UF: 'RS' },
    ])
    const { stations, skipped } = await readFromBuffers(shp, dbf)
    expect(stations.map((s) => s.code)).toEqual(['AAAA'])
    expect(skipped.map((s) => s.index)).toEqual([1, 2, 3])
    expect(skipped[0]!.reason).toMatch(/invalid SG_RBMC/)
    expect(skipped[1]!.reason).toMatch(/duplicate/)
  })

  it('falls back to DBF LATITUDE/LONGITUDE when the shape is null', async () => {
    const shp = buildShp([null])
    const dbf = buildDbf(FIELDS, [{ SG_RBMC: 'ZZZZ', LATITUDE: '-10.5', LONGITUDE: '-50.25' }])
    const { stations } = await readFromBuffers(shp, dbf)
    expect(stations[0]).toMatchObject({ code: 'ZZZZ', lat: -10.5, lon: -50.25 })
  })

  it('rejects a missing directory with ENOENT instead of hanging', async () => {
    await expect(readRbmcShapefile('/definitely/not/here')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

// Writes the synthetic pair into a temp dir and runs the real reader against it.
async function readFromBuffers(shp: Buffer, dbf: Buffer) {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'rbmc-shp-'))
  try {
    await writeFile(join(dir, 'T.shp'), shp)
    await writeFile(join(dir, 'T.dbf'), dbf)
    return await readRbmcShapefile(dir, 'T')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
