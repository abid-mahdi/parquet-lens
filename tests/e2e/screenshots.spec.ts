import { test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))
const shot = (name: string) => fileURLToPath(new URL(`../../docs/screenshots/${name}.png`, import.meta.url))

test.use({ viewport: { width: 1440, height: 860 }, colorScheme: 'dark' })
test.setTimeout(120_000)

test('capture every state', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(400)
  await page.screenshot({ path: shot('01-empty') })

  await page.getByTestId('file-input').setInputFiles(fixture('multipart'))
  await page.getByTestId('grid').waitFor()
  await page.waitForTimeout(600)
  await page.screenshot({ path: shot('02-multipart') })

  await page.getByTestId('row-5').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot('03-row-drawer') })
  await page.getByTestId('close-drawer').click()

  await page.getByTestId('col-amount').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot('04-column-profile') })
  await page.getByTestId('close-drawer').click()

  await page.getByTestId('part-2').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: shot('05-scoped-part') })

  await page.goto('/')
  await page.waitForTimeout(250)
  await page.getByTestId('file-input').setInputFiles(fixture('partitioned'))
  await page.getByTestId('grid').waitFor()
  await page.waitForTimeout(600)
  await page.screenshot({ path: shot('06-partitioned') })

  await page.getByTestId('col-year').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot('07-partition-profile') })
  await page.getByTestId('close-drawer').click()

  await page.goto('/')
  await page.waitForTimeout(250)
  await page.getByTestId('file-input').setInputFiles(fixture('nested'))
  await page.getByTestId('grid').waitFor()
  await page.waitForTimeout(500)
  await page.getByTestId('row-0').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot('08-nested') })

  await page.goto('/')
  await page.waitForTimeout(250)
  await page.getByTestId('file-input').setInputFiles(fixture('wide'))
  await page.getByTestId('grid').waitFor()
  await page.waitForTimeout(600)
  await page.screenshot({ path: shot('09-wide') })

  await page.goto('/')
  await page.waitForTimeout(250)
  await page.getByTestId('file-input').setInputFiles(fixture('schema-mismatch'))
  await page.getByTestId('grid').waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: shot('10-mismatch') })

  await page.goto('/')
  await page.waitForTimeout(250)
  await page.getByTestId('file-input').setInputFiles(fixture('nulls'))
  await page.getByTestId('grid').waitFor()
  await page.waitForTimeout(500)
  await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot('11-light-theme') })

  await page.setViewportSize({ width: 390, height: 780 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: shot('12-mobile') })
})
