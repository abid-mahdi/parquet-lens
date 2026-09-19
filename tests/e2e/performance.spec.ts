import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))

const BUDGET = {
  firstRowsMs: 1_000,
  jumpMs: 700,
  longFrameMs: 50,
  p95FrameMs: 24,
  heapMb: 500,
}

/** The big fixture is gitignored; CI measures the committed stand-in instead. */
const bigFixture = existsSync(fixture('big')) ? 'big' : 'manyrowgroups'

test.use({ viewport: { width: 1440, height: 900 } })
test.setTimeout(180_000)

async function open(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  const started = Date.now()
  await page.getByTestId('file-input').setInputFiles(fixture(name))
  await page.getByTestId('grid').waitFor({ timeout: 60_000 })
  await page.locator('[data-testid="row-0"] .cell:not(:has(.skeleton))').first().waitFor({ timeout: 60_000 })
  return Date.now() - started
}

test(`first rows paint within ${BUDGET.firstRowsMs}ms on ${bigFixture}`, async ({ page }) => {
  const elapsed = await open(page, bigFixture)
  console.log(`[perf] first rows painted in ${elapsed}ms (${bigFixture})`)
  expect(elapsed).toBeLessThan(BUDGET.firstRowsMs)
})

test('sustained scroll holds frame budget', async ({ page }) => {
  await open(page, bigFixture)

  const frames = await page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="grid"]') as HTMLElement
    const deltas: number[] = []
    let last = performance.now()
    let running = true

    const tick = () => {
      const now = performance.now()
      deltas.push(now - last)
      last = now
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    const start = performance.now()
    while (performance.now() - start < 6000) {
      grid.scrollTop += 220
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    running = false
    return deltas
  })

  const sorted = [...frames].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const worst = sorted[sorted.length - 1] ?? 0
  const long = frames.filter((f) => f > BUDGET.longFrameMs).length

  console.log(
    `[perf] ${frames.length} frames, p95 ${p95.toFixed(1)}ms, worst ${worst.toFixed(1)}ms, ` +
      `${long} over ${BUDGET.longFrameMs}ms`,
  )

  expect(frames.length).toBeGreaterThan(100)
  expect(p95).toBeLessThan(BUDGET.p95FrameMs)
  expect(long).toBe(0)
})

test('jumping to an arbitrary row stays responsive', async ({ page }) => {
  await open(page, bigFixture)

  const elapsed = await page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="grid"]') as HTMLElement
    const started = performance.now()
    grid.scrollTop = grid.scrollHeight * 0.5

    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 16))
      const cells = grid.querySelectorAll('.row .cell')
      const loaded = [...cells].some((cell) => !cell.querySelector('.skeleton'))
      if (loaded) return performance.now() - started
      if (performance.now() - started > 20_000) return performance.now() - started
    }
  })

  console.log(`[perf] mid-table jump resolved in ${elapsed.toFixed(0)}ms`)
  expect(elapsed).toBeLessThan(BUDGET.jumpMs)
})

test('memory stays bounded while scrolling', async ({ page }) => {
  await open(page, bigFixture)

  await page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="grid"]') as HTMLElement
    for (let i = 0; i < 200; i++) {
      grid.scrollTop += 4000
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  })

  const heapMb = await page.evaluate(
    () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
  ) / (1024 * 1024)

  console.log(`[perf] heap after deep scroll: ${heapMb.toFixed(0)} MB`)
  expect(heapMb).toBeLessThan(BUDGET.heapMb)
})
