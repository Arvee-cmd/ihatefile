import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'

// 8x8 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64')

const convertCalls = (page: Page) => {
  const calls: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/v1/convert')) calls.push(r.method()) })
  return calls
}
const addFiles = (page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) =>
  page.getByTestId('file-input').setInputFiles(files)
async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()])
  const file = await dl.path()
  return { name: dl.suggestedFilename(), bytes: readFileSync(file!) }
}
const makePdf = async (pages: number) => {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([200, 200])
  return Buffer.from(await d.save())
}

test('home page: search finds a real conversion and preselects it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Files in')
  await page.getByRole('combobox', { name: 'Search conversions' }).fill('png to jpeg')
  await page.getByRole('option', { name: /PNG to JPEG/ }).first().click()
  await expect(page).toHaveURL(/\/convert\?.*target=jpeg/)
  await expect(page.getByRole('heading', { name: 'Convert files' })).toBeVisible()
  await addFiles(page, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.getByTestId('target-select')).toContainText('JPEG')
})

test('browser conversion: PNG to JPEG downloads a real JPEG and never calls the server', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/convert?tool=image-raster&target=jpeg&from=png')
  await addFiles(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.getByTestId('mode-note')).toContainText('never leaves your device')
  await page.getByTestId('convert-button').click()
  await expect(page.getByTestId('result-name')).toHaveText('photo.jpg')
  const { name, bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(name).toBe('photo.jpg')
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  expect(calls).toEqual([])
})

test('invalid and unsupported files get clear messages', async ({ page }) => {
  await page.goto('/convert')
  await addFiles(page, [
    { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is plain text') },
    { name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
  ])
  await expect(page.getByTestId('queue-item').nth(0)).toContainText("doesn't look like a valid PNG")
  await expect(page.getByTestId('queue-item').nth(1)).toContainText('not supported')
  await expect(page.getByTestId('queue-item').nth(0).getByTestId('convert-button')).toHaveCount(0)
})

test('malformed JSON fails with the parser error; nothing is downloadable', async ({ page }) => {
  await page.goto('/convert')
  await addFiles(page, [{ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"a":') }])
  await page.getByTestId('convert-button').click()
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'failed')
  await expect(page.getByTestId('queue-item').getByRole('alert')).toContainText('Invalid JSON')
  await expect(page.getByTestId('download-button')).toHaveCount(0)
})

test('CSV to JSON in the browser', async ({ page }) => {
  await page.goto('/convert')
  await addFiles(page, [{ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,Ann\n2,"Bob, Jr."\n') }])
  await page.getByTestId('convert-button').click()
  const { name, bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(name).toBe('people.json')
  expect(JSON.parse(bytes.toString())).toEqual([{ id: '1', name: 'Ann' }, { id: '2', name: 'Bob, Jr.' }])
})

test('merge PDFs and create ZIP from the queue', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/convert')
  await addFiles(page, [
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) },
  ])
  await expect(page.getByTestId('queue-item')).toHaveCount(2)
  await page.getByTestId('combine-pdf-merge').click()
  const { name, bytes } = await download(page, () => page.getByTestId('combined-result').getByRole('button', { name: 'Download' }).click())
  expect(name).toBe('merged.pdf')
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3)
  await page.getByTestId('combine-zip-create').click()
  const zip = await download(page, () => page.getByTestId('combined-result').getByRole('button', { name: 'Download' }).click())
  expect(zip.name).toBe('archive.zip')
  expect(zip.bytes.subarray(0, 2).toString()).toBe('PK')
  expect(calls).toEqual([])
})

test('server conversion asks before uploading, then converts for real (PNG to ICO)', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/convert?tool=image-server&target=ico&from=png')
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-online', 'true')
  await addFiles(page, [{ name: 'logo.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.getByTestId('mode-note')).toContainText('Uploaded to the conversion server')
  await page.getByTestId('convert-button').click()
  await expect(page.getByRole('alertdialog')).toContainText('Upload to the conversion server?')
  expect(calls).toEqual([]) // nothing sent before consent
  await page.getByTestId('consent-accept').click()
  await expect(page.getByTestId('result-name')).toHaveText('logo.ico')
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  expect(calls).toEqual(['POST'])
})

test('declining the upload keeps the file local', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/convert?tool=image-server&target=bmp&from=png')
  await addFiles(page, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])
  await page.getByTestId('convert-button').click()
  await page.getByRole('button', { name: 'Keep files local' }).click()
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready')
  expect(calls).toEqual([])
})

test('DOCX to PDF through LibreOffice on the server', async ({ page }) => {
  await page.goto('/convert?tool=office-to-pdf&target=pdf&from=docx')
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-online', 'true')
  await addFiles(page, [{ name: 'sample.docx', mimeType: 'application/octet-stream', buffer: readFileSync(path.join(import.meta.dirname, 'fixtures/sample.docx')) }])
  await page.getByTestId('convert-button').click()
  await page.getByTestId('consent-accept').click()
  await expect(page.getByTestId('result-name')).toHaveText('sample.pdf', { timeout: 60_000 })
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
})

test('server errors are shown to the user (corrupt image with a valid signature)', async ({ page }) => {
  await page.goto('/convert?tool=image-server&target=tiff&from=png')
  await addFiles(page, [{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.concat([PNG.subarray(0, 8), Buffer.from('garbage garbage garbage')]) }])
  await page.getByTestId('convert-button').click()
  await page.getByTestId('consent-accept').click()
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'failed')
  await expect(page.getByTestId('queue-item').getByRole('alert')).toContainText('corrupted')
})

test('backend unavailable: server targets are disabled, browser tools keep working', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort())
  await page.goto('/convert')
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-online', 'false')
  await addFiles(page, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])
  await page.getByTestId('target-select').click()
  await expect(page.getByTestId('target-ico')).toHaveAttribute('data-disabled', '')
  await expect(page.getByTestId('target-ico')).toContainText('server unavailable')
  await page.getByTestId('target-jpeg').click()
  await page.getByTestId('convert-button').click()
  await expect(page.getByTestId('result-name')).toHaveText('a.jpg')
})

test('every category and popular link leads to a real page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('main a[href^="/tools/"]').first()).toBeVisible()
  const hrefs = await page.locator('main a[href^="/tools/"]').evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute('href')!))])
  expect(hrefs.length).toBe(8)
  for (const href of hrefs) {
    await page.goto(href)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('tool-card').first()).toBeVisible()
  }
  await page.goto('/tools/nonsense')
  await expect(page.getByText('Page Not Found')).toBeVisible()
  await page.goto('/')
  await expect(page.locator('[aria-label="Popular conversions"] a').first()).toBeVisible()
  const popular = await page.locator('[aria-label="Popular conversions"] a').evaluateAll((a) => a.map((x) => x.getAttribute('href')!))
  expect(popular.length).toBeGreaterThan(5)
  await page.goto(popular[0])
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('dropzone')).toBeVisible()
})

test('task tiles: home shows a tile for every task and each opens its own page', async ({ page }) => {
  await page.goto('/')
  const hrefs = await page.getByTestId('task-tile').evaluateAll((a) => a.map((x) => x.getAttribute('href')!))
  expect(hrefs.length).toBeGreaterThanOrEqual(20)
  for (const href of hrefs) {
    await page.goto(href)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('dropzone')).toBeVisible()
  }
  await page.goto('/tool/does-not-exist')
  await expect(page.getByText('Page Not Found')).toBeVisible()
})

test('Merge PDF task: reorder files, merge in the browser, download', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/tool/merge-pdf')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merge PDF')
  await addFiles(page, [
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) },
  ])
  await expect(page.getByTestId('queue-item')).toHaveCount(2)
  await expect(page.getByTestId('convert-button')).toHaveCount(0) // combine tasks have one action
  await page.getByRole('button', { name: 'Move one.pdf down' }).click()
  await expect(page.getByTestId('queue-item').first()).toContainText('two.pdf')
  await page.getByTestId('combine-pdf-merge').click()
  const { name, bytes } = await download(page, () => page.getByTestId('combined-result').getByRole('button', { name: 'Download' }).click())
  expect(name).toBe('merged.pdf')
  const merged = await PDFDocument.load(bytes)
  expect(merged.getPageCount()).toBe(3)
  expect(merged.getPage(0).getWidth()).toBe(200)
  expect(calls).toEqual([])
})

test('task pages only accept their own file types', async ({ page }) => {
  await page.goto('/tool/word-to-pdf')
  await addFiles(page, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'invalid')
  await expect(page.getByTestId('queue-item')).toContainText("doesn't accept PNG")
})

test('Image to PDF task converts in the browser with a fixed output', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/tool/image-to-pdf')
  await addFiles(page, [{ name: 'scan.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.getByTestId('target-locked')).toHaveText('PDF')
  await page.getByTestId('convert-button').click()
  const { name, bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(name).toBe('scan.pdf')
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(calls).toEqual([])
})

test('Word to PDF task uses the server after consent', async ({ page }) => {
  await page.goto('/tool/word-to-pdf')
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-online', 'true')
  await addFiles(page, [{ name: 'sample.docx', mimeType: 'application/octet-stream', buffer: readFileSync(path.join(import.meta.dirname, 'fixtures/sample.docx')) }])
  await page.getByTestId('convert-button').click()
  await page.getByTestId('consent-accept').click()
  await expect(page.getByTestId('result-name')).toHaveText('sample.pdf', { timeout: 60_000 })
})

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name))
const textPdf = async (pages = 1) => {
  const d = await PDFDocument.create()
  const font = await d.embedFont('Helvetica')
  for (let i = 0; i < pages; i++) d.addPage([400, 400]).drawText(`Quarterly report page ${i + 1}`, { x: 40, y: 340, size: 18, font })
  return Buffer.from(await d.save())
}
async function runServerTask(page: Page, slug: string, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto(`/tool/${slug}`)
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-online', 'true')
  await addFiles(page, files)
  await page.getByTestId('convert-button').click()
  await page.getByTestId('consent-accept').click()
}

test('Rotate PDF task rotates pages in the browser', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/tool/rotate-pdf')
  await addFiles(page, [{ name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(3) }])
  await page.getByTestId('convert-button').click()
  const { name, bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(name).toBe('doc-rotated.pdf')
  expect((await PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle)).toEqual([90, 90, 90])
  expect(calls).toEqual([])
})

test('Split PDF task returns a ZIP with one PDF per page', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/tool/split-pdf')
  await addFiles(page, [{ name: 'book.pdf', mimeType: 'application/pdf', buffer: await makePdf(3) }])
  await page.getByTestId('convert-button').click()
  const { name, bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(name).toBe('book-split.zip')
  expect(Object.keys(unzipSync(new Uint8Array(bytes)))).toEqual(['book-part-01.pdf', 'book-part-02.pdf', 'book-part-03.pdf'])
  expect(calls).toEqual([])
})

test('Watermark PDF task stamps text and keeps the pages', async ({ page }) => {
  const calls = convertCalls(page)
  await page.goto('/tool/watermark-pdf')
  const src = await makePdf(2)
  await addFiles(page, [{ name: 'memo.pdf', mimeType: 'application/pdf', buffer: src }])
  await page.getByRole('button', { name: 'Options' }).click()
  await page.getByLabel('Watermark text').fill('DRAFT COPY')
  await page.getByTestId('convert-button').click()
  const { name, bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(name).toBe('memo-watermarked.pdf')
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
  expect(bytes.length).toBeGreaterThan(src.length) // font + stamp were added
  expect(calls).toEqual([])
})

test('Compress PDF task shrinks an image-heavy PDF on the server', async ({ page }) => {
  const src = fixture('photo.pdf')
  await runServerTask(page, 'compress-pdf', [{ name: 'photo.pdf', mimeType: 'application/pdf', buffer: src }])
  await expect(page.getByTestId('result-name')).toHaveText('photo-compressed.pdf', { timeout: 60_000 })
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(bytes.length).toBeLessThan(src.length * 0.6)
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
})

test('PDF to Word task produces a DOCX that contains the text', async ({ page }) => {
  await runServerTask(page, 'pdf-to-word', [{ name: 'report.pdf', mimeType: 'application/pdf', buffer: await textPdf(2) }])
  await expect(page.getByTestId('result-name')).toHaveText('report.docx', { timeout: 60_000 })
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  const xml = Buffer.from(unzipSync(new Uint8Array(bytes))['word/document.xml']).toString()
  expect(xml).toContain('Quarterly report page 1')
  expect(xml).toContain('Quarterly report page 2')
})

test('PDF to Word on a scanned PDF explains that OCR is needed', async ({ page }) => {
  // an image-only PDF: the PNG scan embedded in a page, no text layer
  const d = await PDFDocument.create()
  const img = await d.embedPng(fixture('scan.png'))
  d.addPage([600, 150]).drawImage(img, { x: 0, y: 0, width: 600, height: 120 })
  await runServerTask(page, 'pdf-to-word', [{ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) }])
  await expect(page.getByTestId('queue-item')).toContainText('OCR', { timeout: 60_000 })
})

test('Scan to text task reads an image with OCR', async ({ page }) => {
  await runServerTask(page, 'scan-to-text', [{ name: 'scan.png', mimeType: 'image/png', buffer: fixture('scan.png') }])
  await expect(page.getByTestId('result-name')).toHaveText('scan-ocr.txt', { timeout: 90_000 })
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(bytes.toString().toUpperCase()).toContain('IHATEFILE')
})

test('OCR task turns a scanned image into a searchable PDF', async ({ page }) => {
  await runServerTask(page, 'ocr-pdf', [{ name: 'scan.png', mimeType: 'image/png', buffer: fixture('scan.png') }])
  await expect(page.getByTestId('result-name')).toHaveText('scan-ocr.pdf', { timeout: 90_000 })
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
})

test('HTML to PDF task converts an HTML file', async ({ page }) => {
  await runServerTask(page, 'html-to-pdf', [{ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Hello page</h1><p>Some <b>text</b></p><script>alert(1)</script>') }])
  await expect(page.getByTestId('result-name')).toHaveText('page.pdf', { timeout: 60_000 })
  const { bytes } = await download(page, () => page.getByTestId('download-button').click())
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
})

test('production build ships a strict CSP and the app runs without violating it', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()) })
  page.on('pageerror', (e) => violations.push(String(e)))
  await page.goto('/')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/)
  // browser-side conversion, a server conversion (consent + upload + download) and a PDF tool, all under the policy
  await page.goto('/tool/png-to-jpg')
  await addFiles(page, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }])
  await page.getByTestId('convert-button').click()
  await download(page, () => page.getByTestId('download-button').click())
  await page.goto('/tool/word-to-pdf')
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-online', 'true')
  await addFiles(page, [{ name: 'sample.docx', mimeType: 'application/octet-stream', buffer: fixture('sample.docx') }])
  await page.getByTestId('convert-button').click()
  await page.getByTestId('consent-accept').click()
  await expect(page.getByTestId('result-name')).toHaveText('sample.pdf', { timeout: 60_000 })
  await download(page, () => page.getByTestId('download-button').click())
  await page.goto('/tool/watermark-pdf')
  await addFiles(page, [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) }])
  await page.getByTestId('convert-button').click()
  await download(page, () => page.getByTestId('download-button').click())
  expect(violations).toEqual([])
})

test('formats page lists every tool and the unsupported list', async ({ page }) => {
  await page.goto('/formats')
  await expect(page.getByTestId('format-row').first()).toBeVisible()
  expect(await page.getByTestId('format-row').count()).toBeGreaterThanOrEqual(17)
  await expect(page.getByTestId('unsupported-list').getByText(/Word tables/)).toBeVisible()
})

test('keyboard: dropzone button and skip link are reachable', async ({ page }) => {
  await page.goto('/tool/merge-pdf')
  await page.waitForLoadState('networkidle')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to Main' })).toBeFocused()
  await page.getByRole('button', { name: 'Browse files' }).focus()
  await expect(page.getByRole('button', { name: 'Browse files' })).toBeFocused()
})

for (const [w, h, label] of [[320, 640, 'phone-320'], [390, 844, 'phone-390'], [768, 1024, 'tablet']] as const) {
  test(`no horizontal overflow at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    for (const url of ['/', '/formats', '/tools/image', '/privacy']) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${url} at ${w}px`).toBeLessThanOrEqual(0)
    }
    await page.goto('/convert')
    await addFiles(page, [{ name: 'a-rather-long-file-name-that-should-truncate-properly.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('target-select').waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  })
}
