/** Preserve input order while limiting concurrent database requests. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => PromiseLike<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer')
  }
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index], index)
    }
  }))
  return results
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Chunk size must be a positive integer')
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

type PageResult<T> = { data: T[] | null; error: unknown; count?: number | null }

/**
 * Read every page of a PostgREST query with as few round trips as possible.
 *
 * Page 0 is requested first. If the caller asked for `{ count: 'exact' }` on
 * that request, every remaining page is fetched at once (bounded by
 * `concurrency`). Without a count, pages are fetched speculatively in waves of
 * `concurrency` until a short page arrives. Either way this replaces the old
 * one-page-at-a-time loop, which cost one full Supabase round trip per 1,000 rows.
 *
 * The query MUST have a unique ORDER BY (e.g. add `.order('id')` as a final
 * tie-breaker), otherwise concurrent ranges can skip or duplicate rows.
 */
export async function readAllPages<T>(
  readPage: (from: number, to: number, isFirst: boolean) => PromiseLike<PageResult<T>>,
  { pageSize = 1000, concurrency = 6 }: { pageSize?: number; concurrency?: number } = {},
): Promise<T[]> {
  const first = await readPage(0, pageSize - 1, true)
  if (first.error) throw first.error
  const rows = [...(first.data ?? [])]
  if (rows.length < pageSize) return rows

  const read = async (from: number) => {
    const { data, error } = await readPage(from, from + pageSize - 1, false)
    if (error) throw error
    return data ?? []
  }

  if (typeof first.count === 'number') {
    const starts: number[] = []
    for (let from = pageSize; from < first.count; from += pageSize) starts.push(from)
    for (const page of await mapConcurrent(starts, concurrency, read)) rows.push(...page)
    return rows
  }

  for (let from = pageSize; ; from += pageSize * concurrency) {
    const starts = Array.from({ length: concurrency }, (_, i) => from + i * pageSize)
    const pages = await mapConcurrent(starts, concurrency, read)
    for (const page of pages) {
      rows.push(...page)
      if (page.length < pageSize) return rows
    }
  }
}

// RPC names the database reported as missing (migration not run yet). This is
// schema knowledge, not user data, so sharing it across requests is safe.
const missingRpcs = new Set<string>()

/**
 * Call a Postgres function that returns a JSON array in ONE round trip.
 * If the function is not installed, errors, times out, or returns anything
 * other than an array, run `fallback` (the original multi-request code), so
 * the page keeps working exactly as before.
 */
export async function rowsViaRpc<T>(
  db: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> },
  fn: string,
  args: Record<string, unknown>,
  fallback: () => Promise<T[]>,
): Promise<T[]> {
  if (!missingRpcs.has(fn)) {
    try {
      const { data, error } = await db.rpc(fn, args)
      if (!error && Array.isArray(data)) return data as T[]
      if (error?.code === 'PGRST202' || error?.code === '42883') missingRpcs.add(fn)
      if (error && process.env.NODE_ENV === 'development') {
        console.warn(`[crm:rpc] ${fn} unavailable (${error.code ?? 'error'}); using fallback queries`)
      }
    } catch { /* fall through to the original query path */ }
  }
  return fallback()
}

/**
 * Drop null / undefined / false / empty-array / empty-object fields before a
 * large list is serialized to the browser. Every consumer reads these fields
 * with `??`, `?.` or truthiness, so a missing key behaves exactly like the
 * dropped value while the page payload shrinks substantially.
 */
export function compactRow<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const key in row) {
    const value = row[key]
    if (value === null || value === undefined || value === false) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue
    out[key] = value
  }
  return out as Partial<T>
}
