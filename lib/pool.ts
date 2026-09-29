// Chhota concurrency-limited runner: N items ek saath, ek dusre ka wait nahi karte.
// Isse 20 emails sequentially bhejne me lagne wala time (aur function-timeout risk) kaafi kam ho jaata hai.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
