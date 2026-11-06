import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCtx, FtpRequestError, HttpRequestError, S3_LIST_MAX_KEYS, S3RequestError } from './ctx.js'
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

  it('identifies Sentinel in the User-Agent unless the test sets its own', async () => {
    fetchMock.mockResolvedValue({ status: 200, body: null, headers: { forEach: vi.fn() } })

    const { ctx } = buildCtx()
    await ctx.http.get('https://example.com')
    await ctx.http.post('https://example.com', {}, { headers: { 'User-Agent': 'custom/1.0' } })

    const getHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(getHeaders['user-agent']).toMatch(/^Sentinel \(/)
    const postHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>
    expect(postHeaders['User-Agent']).toBe('custom/1.0')
    expect(postHeaders['user-agent']).toBeUndefined()
    expect(postHeaders['content-type']).toBe('application/json')
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

describe('executor ctx s3 list', () => {
  const creds = {
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
  }

  const listXml = (opts: { keys: string[]; truncated?: boolean; next?: string; prefixes?: string[] }) =>
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>examplebucket</Name>' +
    `<IsTruncated>${opts.truncated ? 'true' : 'false'}</IsTruncated>` +
    (opts.next ? `<NextContinuationToken>${opts.next}</NextContinuationToken>` : '') +
    opts.keys
      .map(
        (key, i) =>
          `<Contents><Key>${key}</Key><LastModified>2026-11-0${(i % 9) + 1}T00:00:00.000Z</LastModified>` +
          `<ETag>&quot;etag-${i}&quot;</ETag><Size>${(i + 1) * 100}</Size><StorageClass>STANDARD</StorageClass></Contents>`
      )
      .join('') +
    (opts.prefixes ?? []).map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join('') +
    '</ListBucketResult>'

  // doFetch reads `body` as an iterable of chunks, like undici's Response.body.
  const xmlResponse = (xml: string, status = 200) => ({
    status,
    body: [Buffer.from(xml)],
    headers: { forEach: vi.fn() },
  })

  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('sends a signed ListObjectsV2 request and parses objects and common prefixes', async () => {
    fetchMock.mockResolvedValue(
      xmlResponse(listXml({ keys: ['photos/2026/a.jpg', 'photos/2026/b &amp; c.jpg'], prefixes: ['photos/2025/'] }))
    )
    const { ctx } = buildCtx()

    const result = await ctx.s3.list('https://examplebucket.s3.amazonaws.com/', {
      ...creds,
      prefix: 'photos/20',
      delimiter: '/',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }]
    expect(url).toBe('https://examplebucket.s3.amazonaws.com/?list-type=2&prefix=photos%2F20&delimiter=%2F')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\//)
    expect(init.headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')

    expect(result.truncated).toBe(false)
    expect(result.prefixes).toEqual(['photos/2025/'])
    expect(result.objects).toEqual([
      { key: 'photos/2026/a.jpg', size: 100, lastModified: new Date('2026-11-01T00:00:00.000Z'), etag: 'etag-0', storageClass: 'STANDARD' },
      { key: 'photos/2026/b & c.jpg', size: 200, lastModified: new Date('2026-11-02T00:00:00.000Z'), etag: 'etag-1', storageClass: 'STANDARD' },
    ])
  })

  it('returns one page with truncated=true unless all is set, then follows continuation tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(xmlResponse(listXml({ keys: ['a'], truncated: true, next: 'tok 1' })))
      .mockResolvedValueOnce(xmlResponse(listXml({ keys: ['a'], truncated: true, next: 'tok 1' })))
      .mockResolvedValueOnce(xmlResponse(listXml({ keys: ['b'] })))
    const onS3Complete = vi.fn()
    const { ctx } = buildCtx({ onS3Complete })

    const onePage = await ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, maxKeys: 1 })
    expect(onePage.truncated).toBe(true)
    expect(onePage.objects.map((o) => o.key)).toEqual(['a'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const everything = await ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, maxKeys: 1, all: true })
    expect(everything.truncated).toBe(false)
    expect(everything.objects.map((o) => o.key)).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://examplebucket.s3.amazonaws.com/?list-type=2&max-keys=1&continuation-token=tok%201'
    )
    expect(onS3Complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'LIST', status: 200, region: 'us-east-1', keys: 2, pages: 2 })
    )
  })

  it('stops at S3_LIST_MAX_KEYS and reports truncated when a listing is larger than the cap', async () => {
    const pageKeys = Array.from({ length: 1000 }, (_, i) => `k${i}`)
    fetchMock.mockResolvedValue(xmlResponse(listXml({ keys: pageKeys, truncated: true, next: 'more' })))
    const { ctx } = buildCtx()

    const result = await ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, all: true })

    expect(result.objects).toHaveLength(S3_LIST_MAX_KEYS)
    expect(result.truncated).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(S3_LIST_MAX_KEYS / 1000)
  })

  it('throws S3_LIST_ERROR carrying the service error code on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      xmlResponse('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', 403)
    )
    const onIoError = vi.fn()
    const { ctx } = buildCtx({ onIoError })

    await expect(ctx.s3.list('https://examplebucket.s3.amazonaws.com/', creds)).rejects.toMatchObject({
      name: 'S3RequestError',
      code: 'S3_LIST_ERROR',
      message: 'S3 list failed for https://examplebucket.s3.amazonaws.com/: HTTP 403 AccessDenied: Access Denied',
    })
    expect(onIoError).toHaveBeenCalledWith(expect.objectContaining({ protocol: 's3', op: 'LIST', code: 'S3_LIST_ERROR' }))
  })

  it('decodes every XML entity form in keys and tolerates sparse Contents blocks', async () => {
    const xml =
      '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>' +
      '<Contents><Key>a &lt;b&gt; &apos;c&apos; &#65;&#x42;</Key></Contents>' +
      '<Contents><Key>no-date</Key><LastModified>not a date</LastModified><Size>7</Size></Contents>' +
      '</ListBucketResult>'
    fetchMock.mockResolvedValue(xmlResponse(xml))
    const { ctx } = buildCtx()

    const result = await ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, startAfter: 'Z' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://examplebucket.s3.amazonaws.com/?list-type=2&start-after=Z')
    expect(result.objects).toEqual([
      { key: "a <b> 'c' AB", size: 0, lastModified: null, etag: null, storageClass: null },
      { key: 'no-date', size: 7, lastModified: null, etag: null, storageClass: null },
    ])
    expect(result.prefixes).toEqual([])
  })

  it('stops after a truncated page that carries no continuation token', async () => {
    fetchMock.mockResolvedValue(xmlResponse(listXml({ keys: ['only'], truncated: true })))
    const { ctx } = buildCtx()

    const result = await ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, all: true })

    expect(result.objects.map((o) => o.key)).toEqual(['only'])
    expect(result.truncated).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws S3_LIST_ERROR on a 2xx body that is not a listing, and on an error body without Code/Message', async () => {
    const { ctx } = buildCtx()

    fetchMock.mockResolvedValueOnce(xmlResponse('<html><body>Sign in</body></html>', 200))
    await expect(ctx.s3.list('https://examplebucket.s3.amazonaws.com/', creds)).rejects.toMatchObject({
      code: 'S3_LIST_ERROR',
      message: expect.stringContaining('unexpected body'),
    })

    fetchMock.mockResolvedValueOnce(xmlResponse('', 502))
    await expect(ctx.s3.list('https://examplebucket.s3.amazonaws.com/', creds)).rejects.toMatchObject({
      code: 'S3_LIST_ERROR',
      message: 'S3 list failed for https://examplebucket.s3.amazonaws.com/: HTTP 502',
    })
  })

  it('maps a per-page timeout to S3_TIMEOUT_ERROR', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    )
    const { ctx } = buildCtx()

    await expect(ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, timeout: 5 })).rejects.toMatchObject({
      code: 'S3_TIMEOUT_ERROR',
    })
  })

  it('rejects an out-of-range maxKeys and a malformed URL before any request', async () => {
    const { ctx } = buildCtx()
    await expect(ctx.s3.list('https://examplebucket.s3.amazonaws.com/', { ...creds, maxKeys: 0 })).rejects.toThrow(TypeError)
    await expect(ctx.s3.list('not a url', creds)).rejects.toMatchObject({ code: 'S3_SIGNING_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
