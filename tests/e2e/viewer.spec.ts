import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))

async function openFixture(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles(fixture(name))
  await expect(page.getByTestId('grid')).toBeVisible({ timeout: 20_000 })
}

test('collapses 8 Spark part files into one table', async ({ page }) => {
  await openFixture(page, 'multipart')

  await expect(page.locator('.topbar')).toContainText('40,000 rows')
  await expect(page.locator('.topbar')).toContainText('8 parts')
  await expect(page.getByTestId('part-7')).toBeVisible()
})

test('recovers partition columns from directory names', async ({ page }) => {
  await openFixture(page, 'partitioned')

  await expect(page.getByTestId('col-year')).toBeVisible()
  await expect(page.getByTestId('col-month')).toBeVisible()
  await expect(page.getByTestId('schema-year')).toHaveClass(/partition/)

  const firstYearCell = page.locator('[data-testid="row-0"] .cell.partition').first()
  await expect(firstYearCell).toHaveText(/^202[34]$/)
})

test('clicking a row opens the row inspector', async ({ page }) => {
  await openFixture(page, 'simple')

  await page.getByTestId('row-3').click()
  const drawer = page.getByTestId('row-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('Row 4')
  await expect(drawer).toContainText('user_4')
  await expect(page.getByTestId('spark-snippet')).toContainText('filter($"id"')

  await page.getByTestId('close-drawer').click()
  await expect(drawer).toBeHidden()
})

test('clicking a column header opens its profile', async ({ page }) => {
  await openFixture(page, 'simple')

  await page.getByTestId('col-amount').click()
  const profile = page.getByTestId('column-profile')
  await expect(profile).toBeVisible()
  await expect(profile).toContainText('DOUBLE')
  await expect(profile).toContainText('SNAPPY')
  await expect(profile).toContainText('predicate pushdown')
})

test('nested structs, arrays and maps render and expand', async ({ page }) => {
  await openFixture(page, 'nested')

  await page.getByTestId('row-0').click()
  const drawer = page.getByTestId('row-drawer')
  await expect(drawer).toContainText('First1')
  await expect(drawer).toContainText('tag1')
})

test('scoping to one part restricts the grid', async ({ page }) => {
  await openFixture(page, 'multipart')

  await page.getByTestId('part-0').click()
  await expect(page.getByTestId('statusbar')).toContainText('part 0:')
  await expect(page.getByTestId('statusbar')).not.toContainText('40,000 rows')
})

test('a schema mismatch warns but still renders every row', async ({ page }) => {
  await openFixture(page, 'schema-mismatch')

  await expect(page.getByTestId('warnings')).toContainText('different schema')
  await expect(page.getByTestId('read-error')).toBeHidden()

  // The first part has `name`; the grafted-in part does not, so it reads as null.
  await expect(page.locator('[data-testid="row-0"] .cell').nth(1)).toHaveText('n_1')
  await page.getByTestId('grid').evaluate((el) => el.scrollTo(0, 150 * 28))
  await expect(page.locator('[data-testid="row-150"] .cell.null')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('statusbar')).not.toContainText('0 blocks cached')
})

test('reads zstd, the codec Spark uses when tuned for size', async ({ page }) => {
  await openFixture(page, 'zstd')

  await page.getByTestId('col-payload').click()
  await expect(page.getByTestId('column-profile')).toContainText('ZSTD')
})

test('nothing leaves the machine', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://localhost:4173')) external.push(request.url())
  })

  await openFixture(page, 'multipart')
  await page.getByTestId('row-5').click()
  await page.getByTestId('col-account').click()

  expect(external).toEqual([])
})

test('the 200-column table scrolls without rendering every column', async ({ page }) => {
  await openFixture(page, 'wide')

  const rendered = await page.locator('[data-testid="row-0"] .cell').count()
  expect(rendered).toBeLessThan(40)
  await expect(page.locator('.topbar')).toContainText('200 cols')
})
