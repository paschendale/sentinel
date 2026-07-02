import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCtx, FtpRequestError, HttpRequestError, S3RequestError } from './ctx.js'
import { FTP_MAX_DOWNLOAD_BYTES, FTP_TEMP_DIR } from '../config.js'

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

const { mkdirMock, readFileMock, unlinkMock, openMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  readFileMock: vi.fn(),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
  openMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  unlink: unlinkMock,
  open: openMock,
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

describe('executor ctx s3', () => {
  // ctx.s3.head has no response body — it goes through the same in-memory doFetch path as ctx.http.
  const okHeadResponse = () => ({
    status: 200,
    text: vi.fn().mockResolvedValue(''),
    headers: { forEach: vi.fn() },
  })

  // ctx.s3.get streams `body` (an async/sync-iterable of Buffer chunks, mirroring undici's
  // Response.body) to a temp file — the final string returned to the test comes from the
  // separately-mocked `readFile`, matching the existing ctx.ftp test style where downloadTo
  // and readFile are mocked independently rather than wired together.
  const okGetResponse = (bodyChunks: Buffer[] = []) => ({
    status: 200,
    body: bodyChunks,
    headers: { forEach: vi.fn() },
  })

  beforeEach(() => {
    fetchMock.mockReset()
    mkdirMock.mockReset().mockResolvedValue(undefined)
    readFileMock.mockReset().mockResolvedValue(Buffer.from(''))
    unlinkMock.mockReset().mockResolvedValue(undefined)
    openMock.mockReset().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs a GET request matching the AWS SigV4 published test vector', async () => {
    vi.useFakeTimers({ now: new Date('2013-05-24T00:00:00Z') })
    fetchMock.mockResolvedValue(okGetResponse())

    const { ctx } = buildCtx()
    await ctx.s3.get('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      headers: { Range: 'bytes=0-9' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://examplebucket.s3.amazonaws.com/test.txt',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Range: 'bytes=0-9',
          'x-amz-date': '20130524T000000Z',
          'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          Authorization:
            'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
            'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
            'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
        }),
      })
    )
  })

  it('head sends a HEAD request with signed headers', async () => {
    vi.useFakeTimers({ now: new Date('2013-05-24T00:00:00Z') })
    fetchMock.mockResolvedValue(okHeadResponse())

    const { ctx } = buildCtx()
    await ctx.s3.head('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://examplebucket.s3.amazonaws.com/test.txt',
      expect.objectContaining({
        method: 'HEAD',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('SignedHeaders=host;x-amz-content-sha256;x-amz-date,'),
        }),
      })
    )
  })

  it('includes x-amz-security-token and signs it when sessionToken is given', async () => {
    fetchMock.mockResolvedValue(okGetResponse())

    const { ctx } = buildCtx()
    await ctx.s3.get('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      sessionToken: 'FQoGZXIvYXdz-EXAMPLE',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://examplebucket.s3.amazonaws.com/test.txt',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-amz-security-token': 'FQoGZXIvYXdz-EXAMPLE',
          Authorization: expect.stringContaining('x-amz-security-token'),
        }),
      })
    )
  })

  it('includes and signs custom headers', async () => {
    fetchMock.mockResolvedValue(okGetResponse())

    const { ctx } = buildCtx()
    await ctx.s3.get('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      headers: { 'x-custom-header': 'value' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://examplebucket.s3.amazonaws.com/test.txt',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-custom-header': 'value',
          Authorization: expect.stringContaining('x-custom-header'),
        }),
      })
    )
  })

  it('throws S3RequestError with S3_SIGNING_ERROR for a malformed URL', async () => {
    const { ctx } = buildCtx()

    try {
      await ctx.s3.get('not-a-valid-url', {
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      })
      throw new Error('expected signing to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(S3RequestError)
      expect(err).toMatchObject({ code: 'S3_SIGNING_ERROR' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws S3RequestError with S3_FETCH_ERROR when the underlying request fails, and still cleans up the temp file', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))

    const { ctx } = buildCtx()

    try {
      await ctx.s3.get('https://examplebucket.s3.amazonaws.com/test.txt', {
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      })
      throw new Error('expected request to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(S3RequestError)
      expect(err).toMatchObject({ code: 'S3_FETCH_ERROR' })
    }
    expect(unlinkMock).toHaveBeenCalled()
  })

  it('resolves with the same shape as ctx.http', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      body: [Buffer.from('{"ok":true}')],
      headers: { forEach: (cb: (v: string, k: string) => void) => cb('application/json', 'content-type') },
    })
    readFileMock.mockResolvedValue(Buffer.from('{"ok":true}'))

    const { ctx } = buildCtx()
    const res = await ctx.s3.get('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    })

    expect(res.status).toBe(200)
    expect(res.body).toBe('{"ok":true}')
    expect(res.headers).toEqual({ 'content-type': 'application/json' })
    expect(res.json()).toEqual({ ok: true })
  })

  it('downloads to a temp file inside FTP_TEMP_DIR (same dir/sweep as ctx.ftp.get) and always cleans it up', async () => {
    fetchMock.mockResolvedValue(okGetResponse([Buffer.from('hello world')]))
    readFileMock.mockResolvedValue(Buffer.from('hello world'))

    const { ctx } = buildCtx()
    const res = await ctx.s3.get('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    })

    expect(res.body).toBe('hello world')
    expect(mkdirMock).toHaveBeenCalledWith(FTP_TEMP_DIR, { recursive: true })
    expect(openMock).toHaveBeenCalledWith(expect.stringContaining(FTP_TEMP_DIR), 'w')
    expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining(FTP_TEMP_DIR))
  })

  it('throws S3RequestError with S3_SIZE_LIMIT_ERROR when a download exceeds the cap, and still cleans up the temp file', async () => {
    fetchMock.mockResolvedValue(okGetResponse([Buffer.alloc(FTP_MAX_DOWNLOAD_BYTES + 1)]))

    const { ctx } = buildCtx()

    try {
      await ctx.s3.get('https://examplebucket.s3.amazonaws.com/huge.bin', {
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      })
      throw new Error('expected download to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(S3RequestError)
      expect(err).toMatchObject({ code: 'S3_SIZE_LIMIT_ERROR' })
    }
    expect(unlinkMock).toHaveBeenCalled()
  })
})
