type CompiledFn = (ctx: unknown) => Promise<unknown>

interface CacheEntry {
  code: string
  fn: CompiledFn
}

const cache = new Map<string, CacheEntry>()

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => CompiledFn

/** Compiles test code without caching it. Returns the syntax error message, or null when it compiles. */
export function compileError(code: string): string | null {
  try {
    new AsyncFunction('ctx', code)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Throws the SyntaxError when the code does not compile. */
export function getCompiledFn(testId: string, code: string): CompiledFn {
  const entry = cache.get(testId)
  if (entry && entry.code === code) {
    return entry.fn
  }
  const fn = new AsyncFunction('ctx', code)
  cache.set(testId, { code, fn })
  return fn
}

export function invalidateCache(testId: string): void {
  cache.delete(testId)
}
