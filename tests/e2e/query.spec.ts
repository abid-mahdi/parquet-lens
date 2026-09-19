import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))

async function openFixture(page: Page, name: string) {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(fixture(name))
  await expect(page.getByTestId('grid')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('query-panel')).toBeVisible()
}

const cells = (page: Page, row: number) => page.locator(`[data-testid="row-${row}"] .cell`)

test('starts with a plain read and no clauses', async ({ page }) => {
  await openFixture(page, 'multipart')

  const code = page.getByTestId('query-code')
  await expect(code).toContainText('spark.read.parquet("multipart")')
  await expect(code).toContainText('.show(20, truncate = false)')
  await expect(code).not.toContainText('.filter')
  await expect(page.getByTestId('query-stats')).toContainText('nothing applied yet')
})

async function columnValues(page: Page, column: number, rows: number): Promise<number[]> {
  const values: number[] = []
  for (let row = 0; row < rows; row++) {
    const cell = cells(page, row).nth(column)
    await expect(cell).not.toHaveText('', { timeout: 20_000 })
    values.push(Number(await cell.textContent()))
  }
  return values
}

test('sorting descending actually reorders the grid, not just the command', async ({ page }) => {
  await openFixture(page, 'multipart')

  // Capture the unsorted leading values so the assertion cannot pass by coincidence.
  const before = await columnValues(page, 2, 6)

  await page.getByTestId('col-amount').click()
  await page.getByTestId('action-sort-desc').click()
  await expect(page.getByTestId('query-code')).toContainText('.orderBy($"amount".desc)')
  await expect(page.getByTestId('sort-amount')).toContainText('▼')
  await page.getByTestId('close-drawer').click()

  await expect
    .poll(async () => (await columnValues(page, 2, 6)).join(','), { timeout: 20_000 })
    .not.toBe(before.join(','))

  const after = await columnValues(page, 2, 6)
  expect(after).toEqual([...after].sort((a, b) => b - a))
  expect(after[0]).toBeGreaterThan(0)
})

test('sorting ascending puts the smallest values first', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('col-id').click()
  await page.getByTestId('action-sort-asc').click()
  await expect(page.getByTestId('chip-sort')).toContainText('order by id asc')
  await page.getByTestId('close-drawer').click()

  await expect.poll(async () => (await columnValues(page, 0, 1))[0], { timeout: 20_000 }).toBe(1)
  const ids = await columnValues(page, 0, 6)
  expect(ids).toEqual([...ids].sort((a, b) => a - b))
})

test('shift-clicking a header sorts without opening the panel', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('col-id').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('query-code')).toContainText('.orderBy($"id".asc)')
  await expect(page.getByTestId('column-profile')).toBeHidden()
})

test('filtering from the column panel narrows the table', async ({ page }) => {
  await openFixture(page, 'multipart')
  await expect(page.getByTestId('row-count')).toContainText('40,000 rows')

  await page.getByTestId('col-amount').click()
  await page.getByTestId('filter-op').selectOption('gt')
  await page.getByTestId('filter-value').fill('1000')
  await page.getByTestId('apply-filter').click()

  await expect(page.getByTestId('query-code')).toContainText('.filter($"amount" > 1000)')
  await expect(page.getByTestId('chip-filter-amount')).toBeVisible()
  await expect(page.getByTestId('row-count')).toContainText('of 40,000 rows', { timeout: 20_000 })

  const count = await page.getByTestId('row-count').textContent()
  expect(count).not.toContain('40,000 of')

  await page.getByTestId('close-drawer').click()
  await expect(cells(page, 0).nth(2)).not.toHaveText('', { timeout: 20_000 })
  const amount = await cells(page, 0).nth(2).textContent()
  expect(Number(amount)).toBeGreaterThan(1000)
})

test('filtering to a value straight from a row', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('row-0').click()
  await page.getByTestId('filter-to-region').click()

  await expect(page.getByTestId('query-code')).toContainText('.filter($"region" ===')
  await expect(page.getByTestId('chip-filter-region')).toBeVisible()
})

test('a partition filter prunes directories and says so', async ({ page }) => {
  await openFixture(page, 'partitioned')

  await page.getByTestId('col-year').click()
  await page.getByTestId('filter-value').fill('2024')
  await page.getByTestId('apply-filter').click()

  await expect(page.getByTestId('query-code')).toContainText('prunes whole directories')
  await expect(page.getByTestId('stat-pruned')).toContainText('partitions pruned', { timeout: 20_000 })
  await expect(page.getByTestId('row-count')).toContainText('12,000 of 24,000 rows')

  await page.getByTestId('close-drawer').click()
  await expect(page.locator('[data-testid="row-0"] .cell.partition').first()).toHaveText('2024')
})

test('statistics skip row groups that cannot match', async ({ page }) => {
  await openFixture(page, 'manyrowgroups')

  await page.getByTestId('col-bucket').click()
  await page.getByTestId('filter-op').selectOption('lt')
  await page.getByTestId('filter-value').fill('5')
  await page.getByTestId('apply-filter').click()

  await expect(page.getByTestId('stat-skipped')).toContainText('row groups skipped unread', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('query-panel')).toContainText('pushdown Spark performs')
})

test('selecting columns projects the grid and the command', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('col-id').click()
  await page.getByTestId('action-select').click()
  await page.getByTestId('close-drawer').click()

  await expect(page.getByTestId('query-code')).toContainText('.select($"id")')
  await expect(page.getByTestId('col-id')).toBeVisible()
  await expect(page.getByTestId('col-amount')).toBeHidden()
})

test('reset clears every clause at once', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('col-amount').click()
  await page.getByTestId('action-sort-desc').click()
  await page.getByTestId('filter-op').selectOption('gt')
  await page.getByTestId('filter-value').fill('500')
  await page.getByTestId('apply-filter').click()
  await page.getByTestId('close-drawer').click()

  await expect(page.getByTestId('chip-sort')).toBeVisible()
  await expect(page.getByTestId('chip-filter-amount')).toBeVisible()

  await page.getByTestId('reset-query').click()
  await expect(page.getByTestId('chip-sort')).toBeHidden()
  await expect(page.getByTestId('chip-filter-amount')).toBeHidden()
  await expect(page.getByTestId('row-count')).toContainText('40,000 rows', { timeout: 20_000 })
})

test('removing one chip keeps the others', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('col-amount').click()
  await page.getByTestId('filter-op').selectOption('gt')
  await page.getByTestId('filter-value').fill('100')
  await page.getByTestId('apply-filter').click()
  await page.getByTestId('action-sort-asc').click()
  await page.getByTestId('close-drawer').click()

  await page.getByTestId('chip-filter-amount').click()
  await expect(page.getByTestId('chip-filter-amount')).toBeHidden()
  await expect(page.getByTestId('chip-sort')).toBeVisible()
})

test('filters and sort compose', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('col-amount').click()
  await page.getByTestId('filter-op').selectOption('gt')
  await page.getByTestId('filter-value').fill('900')
  await page.getByTestId('apply-filter').click()
  await page.getByTestId('action-sort-asc').click()
  await page.getByTestId('close-drawer').click()

  const code = page.getByTestId('query-code')
  await expect(code).toContainText('.filter($"amount" > 900)')
  await expect(code).toContainText('.orderBy($"amount".asc)')

  await expect(cells(page, 0).nth(2)).not.toHaveText('', { timeout: 20_000 })
  const first = Number(await cells(page, 0).nth(2).textContent())
  const second = Number(await cells(page, 1).nth(2).textContent())
  expect(first).toBeGreaterThan(900)
  expect(second).toBeGreaterThanOrEqual(first)
})
