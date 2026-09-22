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
