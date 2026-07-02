import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCtx, FtpRequestError, HttpRequestError } from './ctx.js'
import { FTP_MAX_DOWNLOAD_BYTES } from '../config.js'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock('undici', () => ({
  fetch: fetchMock,
}))

const { accessMock, listMock, downloadToMock, closeMock, trackProgressMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  listMock: vi.fn(),
  downloadToMock: vi.fn(),
  closeMock: vi.fn(),
  trackProgressMock: vi.fn(),
}))

vi.mock('basic-ftp', () => ({
  Client: class {
    access = accessMock
    list = listMock
    downloadTo = downloadToMock
    close = closeMock
    trackProgress = trackProgressMock
  },
}))

const { mkdirMock, readFileMock, unlinkMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  readFileMock: vi.fn(),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  unlink: unlinkMock,
}))

describe('executor ctx http', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('passes redirect mode to undici fetch', async () => {
    const mockResponse = {
      status: 302,
      text: vi.fn().mockResolvedValue(''),
      headers: {
        forEach: vi.fn(),
      },
    }
    fetchMock.mockResolvedValue(mockResponse)

    const { ctx } = buildCtx()
    await ctx.http.get('https://example.com', { redirect: 'manual' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'GET', redirect: 'manual' })
    )
  })

  it('throws explicit redirect error when redirect limit is exceeded', async () => {
    const redirectCause = new Error('redirect count exceeded')
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: redirectCause }))

    const { ctx } = buildCtx()

    await expect(ctx.http.get('https://example.com')).rejects.toMatchObject({
      name: 'HttpRequestError',
      code: 'HTTP_REDIRECT_ERROR',
      url: 'https://example.com',
      method: 'GET',
    })
  })

  it('throws generic fetch error for non-redirect failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))

    const { ctx } = buildCtx()

    try {
      await ctx.http.get('https://example.com')
      throw new Error('expected request to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpRequestError)
      expect(err).toMatchObject({
        code: 'HTTP_FETCH_ERROR',
      })
    }
  })
})

describe('executor ctx ftp', () => {
  beforeEach(() => {
    accessMock.mockReset()
    listMock.mockReset()
    downloadToMock.mockReset()
    closeMock.mockReset()
    trackProgressMock.mockReset()
    mkdirMock.mockReset().mockResolvedValue(undefined)
    readFileMock.mockReset()
    unlinkMock.mockReset().mockResolvedValue(undefined)
  })

  it('ls returns mapped FtpEntry list and closes the connection', async () => {
    accessMock.mockResolvedValue(undefined)
    listMock.mockResolvedValue([
      { name: 'file.txt', size: 123, isFile: true, isDirectory: false, modifiedAt: new Date('2024-01-01T00:00:00Z') },
      { name: 'sub', size: 0, isFile: false, isDirectory: true, modifiedAt: undefined },
    ])

    const { ctx } = buildCtx()
    const entries = await ctx.ftp.ls('ftp://user:pass@host/path')

    expect(entries).toEqual([
      { name: 'file.txt', type: 'file', size: 123, modifiedAt: new Date('2024-01-01T00:00:00Z') },
      { name: 'sub', type: 'directory', size: 0, modifiedAt: null },
    ])
    expect(accessMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'host', port: 21, user: 'user', password: 'pass', secure: false })
    )
    expect(listMock).toHaveBeenCalledWith('/path')
    expect(closeMock).toHaveBeenCalled()
  })

  it('get downloads to a temp file, reads it, and always cleans it up', async () => {
    accessMock.mockResolvedValue(undefined)
    downloadToMock.mockResolvedValue(undefined)
    readFileMock.mockResolvedValue(Buffer.from('hello world'))

    const { ctx } = buildCtx()
    const result = await ctx.ftp.get('ftp://host/file.txt')

    expect(result).toEqual({ body: 'hello world', size: 11 })
    expect(downloadToMock).toHaveBeenCalledWith(expect.stringContaining('sentinel-ftp'), '/file.txt')
    expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining('sentinel-ftp'))
    expect(closeMock).toHaveBeenCalled()
  })

  it('throws FtpRequestError with FTP_CONNECT_ERROR on connect failure and closes the client', async () => {
    accessMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const { ctx } = buildCtx()

    try {
      await ctx.ftp.ls('ftp://host/')
      throw new Error('expected connect to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(FtpRequestError)
      expect(err).toMatchObject({ code: 'FTP_CONNECT_ERROR' })
    }
    expect(closeMock).toHaveBeenCalled()
  })

  it('throws FTP_SIZE_LIMIT_ERROR when a download exceeds the cap, and still cleans up the temp file', async () => {
    accessMock.mockResolvedValue(undefined)
    downloadToMock.mockImplementation(async () => {
      const handler = trackProgressMock.mock.calls[0]?.[0] as (info: { bytes: number }) => void
      handler({ bytes: FTP_MAX_DOWNLOAD_BYTES + 1 })
      throw new Error('closed mid transfer')
    })

    const { ctx } = buildCtx()

    try {
      await ctx.ftp.get('ftp://host/huge.bin')
      throw new Error('expected download to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(FtpRequestError)
      expect(err).toMatchObject({ code: 'FTP_SIZE_LIMIT_ERROR' })
    }
    expect(unlinkMock).toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalled()
  })

  it('throws FTP_DOWNLOAD_ERROR for a generic download failure', async () => {
    accessMock.mockResolvedValue(undefined)
    downloadToMock.mockRejectedValue(new Error('connection reset'))

    const { ctx } = buildCtx()

    try {
      await ctx.ftp.get('ftp://host/file.txt')
      throw new Error('expected download to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(FtpRequestError)
      expect(err).toMatchObject({ code: 'FTP_DOWNLOAD_ERROR' })
    }
    expect(unlinkMock).toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalled()
  })
})
