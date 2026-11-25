import { test, expect, type Page } from '@playwright/test';
import { needsPersistentStorage } from './env';

/** A real small PNG made in the page, like a camera photo. */
async function tinyPng(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d')!; g.fillStyle = '#c33'; g.fillRect(0, 0, 64, 48);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

/** Goes through first launch, including the recovery code check. Returns the 12-word code. */
async function newHome(page: Page, opts: { installGuide?: boolean } = {}): Promise<string> {
  await page.goto('/');
  if (!opts.installGuide) await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  await page.getByRole('button', { name: 'New to BoxTap' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  const items = await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts();
  const words = items.map((x) => x.replace(/^\d+\.\s*/, '').trim());
  expect(words).toHaveLength(12);
  await page.getByRole('button', { name: "I've written it down" }).click();
  for (const label of await page.locator('label span').allInnerTexts()) {
    const n = Number(/Word (\d+)/.exec(label)?.[1]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'My move' })).toBeVisible({ timeout: 15_000 });
  return words.join(' ');
}

test('the real CSP is applied and the app still starts (SQLite WASM loads)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(res?.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  await expect(page.getByRole('button', { name: 'New to BoxTap' })).toBeVisible();
  expect(errors.filter((e) => /Content Security Policy|CSP/i.test(e))).toEqual([]);
});

test('first launch offers restore choices before creating anything (audit B2)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Restore from Google Drive/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Restore from a backup file/ })).toBeVisible();
});

test('add a box and items, search, and the data survives a reload (critical test 1)', async ({ page }) => {
  needsPersistentStorage(test.info().project.name);
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await expect(page.getByRole('heading', { name: 'Box 1' })).toBeVisible();
  await page.getByLabel('Add item').fill('Electric kettle');
  await page.getByLabel('Add item').press('Enter');
  await page.getByLabel('Add item').fill('Tea towels');
  await page.getByLabel('Add item').press('Enter');
  await expect(page.getByRole('list', { name: 'items' }).getByRole('listitem')).toHaveCount(2);
  await page.getByLabel('Name', { exact: true }).fill('Kitchen');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByLabel('Search items or boxes').fill('kettle');
  await expect(page.getByRole('list', { name: 'results' })).toContainText('Electric kettle');

  await page.reload();
  await expect(page.getByRole('list', { name: 'boxes' })).toContainText('Kitchen');
  await expect(page.getByRole('list', { name: 'boxes' })).toContainText('2 items');
});

test('Home Free: box 13 shows the upgrade screen (critical test 12)', async ({ page }) => {
  await newHome(page);
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: 'Add box' }).click();
    await expect(page.getByRole('heading', { name: `Box ${i + 1}` })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  }
  await page.getByRole('button', { name: 'Add box' }).click();
  await expect(page.getByRole('dialog')).toContainText('BoxTap Free holds 12 boxes.');
});

test('bin: a deleted box can be restored', async ({ page }) => {
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByRole('button', { name: 'Move box to bin' }).click();
  await expect(page.getByText('No boxes yet')).toBeVisible();
  await page.getByRole('button', { name: 'Bin' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('list', { name: 'boxes' })).toContainText('Box 1');
});

test('label link: own box opens; unknown code says not mine (critical tests 6-7 via link)', async ({ page }) => {
  needsPersistentStorage(test.info().project.name);
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  const code = (await page.getByTestId('label-code').textContent())!.trim();
  await page.goto(`/b/${code}`);
  await expect(page.getByRole('heading', { name: 'Box 1' })).toBeVisible();
  await page.goto('/b/ZZZZZZZZZZ');
  await expect(page.getByText("This box isn't in your BoxTap.").first()).toBeVisible();
});

test('label link in a browser with no BoxTap data shows only the landing message (critical test 8)', async ({ page }) => {
  await page.goto('/b/K7Q2M9XR4T');
  await expect(page.getByText('This is a BoxTap label. Open BoxTap and tap Scan.')).toBeVisible();
});

test('second tab is told BoxTap is open elsewhere and can take over (critical test 4)', async ({ page, context }) => {
  needsPersistentStorage(test.info().project.name);
  await newHome(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('BoxTap is open in another tab or window.')).toBeVisible();
  await second.getByRole('button', { name: 'Use here instead' }).click();
  await expect(second.getByRole('heading', { name: 'My move' })).toBeVisible();
  await expect(page.getByText('BoxTap was opened in another tab.')).toBeVisible();
});

test('a browser without usable storage shows the data-loss banner instead of failing', async ({ page, browserName }) => {
  test.skip(!(browserName === 'webkit' && process.platform === 'win32'), 'only this build lacks OPFS');
  await page.goto('/');
  await expect(page.getByText("This browser can't store BoxTap data.")).toBeVisible();
});

test('back up, then restore on a fresh browser with the code; a wrong code changes nothing (critical tests 9, 10)', async ({ page, browser }) => {
  needsPersistentStorage(test.info().project.name);
  test.setTimeout(90_000);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  const code = await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Wedding album');
  await page.getByLabel('Add item').press('Enter');
  await expect(page.getByRole('list', { name: 'items' })).toContainText('Wedding album');
  await page.getByLabel('Add photo', { exact: true }).setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await tinyPng(page) });
  await expect(page.getByRole('list', { name: 'photos' }).locator('img')).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up now' }).click();
  const file = await (await download).path();
  await expect(page.getByTestId('last-backup')).toContainText('Last backup');

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/');
  await p2.getByRole('button', { name: 'Restore from a backup file' }).click();
  await p2.getByLabel('Choose backup file').setInputFiles(file);
  // Wrong (but valid-looking) code first: clear error, nothing created.
  const wrong = code.split(' ').reverse().join(' ');
  await p2.getByLabel('12-word recovery code').fill(wrong);
  await p2.getByRole('button', { name: 'Restore' }).click();
  await expect(p2.getByRole('alert')).toContainText(/doesn't open this backup|isn't a BoxTap backup/, { timeout: 20_000 });
  await p2.getByLabel('12-word recovery code').fill(code.toUpperCase());
  await p2.getByRole('button', { name: 'Restore' }).click();
  await expect(p2.getByRole('heading', { name: 'My move' })).toBeVisible({ timeout: 30_000 });
  await p2.getByLabel('Search items or boxes').fill('wedding');
  await expect(p2.getByRole('list', { name: 'results' })).toContainText('Wedding album');
  // The photo came back too, with a rebuilt thumbnail.
  await p2.getByRole('list', { name: 'results' }).getByText('Wedding album').click();
  await expect(p2.getByRole('list', { name: 'photos' }).locator('img')).toHaveCount(1, { timeout: 15_000 });
  await p2.getByRole('button', { name: 'Back' }).click();
  // The restored device can make its own backups with the restored key.
  await p2.getByLabel('Search items or boxes').fill('');
  await p2.getByRole('button', { name: 'Settings' }).click();
  await expect(p2.getByRole('button', { name: 'Back up now' })).toBeEnabled();
  await other.close();
});

test('print labels for all boxes produces a PDF (Phase 1 step 3)', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Print labels' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make PDF' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('BoxTap-labels-L7165.pdf');
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(await d.path()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('scan screen without a camera explains how to allow it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'camera denial is simulated in Chromium only');
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) });
  });
  await newHome(page);
  await page.getByRole('button', { name: 'Scan' }).click();
  await expect(page.getByRole('alert')).toContainText("BoxTap can't use the camera.");
});

test('works offline after the first load (critical test 3)', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'service-worker offline control is reliable in Chromium only under Playwright');
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Torch');
  await page.getByLabel('Add item').press('Enter');
  await expect(page.getByRole('list', { name: 'items' })).toContainText('Torch');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('list', { name: 'boxes' })).toContainText('1 items');
  await page.getByLabel('Search items or boxes').fill('torch');
  await expect(page.getByRole('list', { name: 'results' })).toContainText('Torch');
  await context.setOffline(false);
});

test('add a photo to a box, see it after reload, and the free limit of 1 photo applies', async ({ page }) => {
  needsPersistentStorage(test.info().project.name);
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  // A real 64x48 PNG made in the page, handed to the file input like a camera photo.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d')!; g.fillStyle = '#c33'; g.fillRect(0, 0, 64, 48);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByLabel('Add photo', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByRole('list', { name: 'photos' }).locator('img')).toHaveCount(1, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole('list', { name: 'photos' }).locator('img')).toHaveCount(1, { timeout: 15_000 });
  await page.getByLabel('Add photo', { exact: true }).setInputFiles({ name: 'photo2.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByRole('dialog')).toContainText(/photo limit/);
});

test('before the 5th box, BoxTap asks to install it first; Not now carries on (B14)', async ({ page }) => {
  // The guide shows on Android/desktop only while storage isn't protected yet; the test browser often grants it.
  await page.addInitScript(() => { Object.defineProperty(navigator.storage, 'persisted', { value: () => Promise.resolve(false) }); });
  await newHome(page, { installGuide: true });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Add box' }).click();
    await expect(page.getByRole('heading', { name: `Box ${i + 1}` })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  }
  await page.getByRole('button', { name: 'Add box' }).click();
  await expect(page.getByRole('dialog')).toContainText('Install BoxTap first');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('heading', { name: 'Box 5' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Add box' }).click();
  await expect(page.getByRole('heading', { name: 'Box 6' })).toBeVisible(); // asked once a day at most
});

test('arrival check: mark boxes arrived and see the count on home', async ({ page }) => {
  await newHome(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Add box' }).click();
    await expect(page.getByRole('heading', { name: `Box ${i + 1}` })).toBeVisible();
    const which = page.getByRole('button', { name: i === 0 ? 'Arrived' : 'Packed', exact: true });
    await which.click();
    await expect(which).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Back' }).click();
  }
  await expect(page.getByTestId('move-summary')).toHaveText('1 of 2 boxes arrived · 0 unpacked');
});

test('export CSV, then erase all data (asks twice) and return to the first screen (C-13)', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Lamp');
  await page.getByLabel('Add item').press('Enter');
  await expect(page.getByRole('list', { name: 'items' })).toContainText('Lamp');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as spreadsheet (CSV)' }).click();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(await (await dl).path(), 'utf8')).toContain('Lamp');

  let n = 0; // first dialog: confirm; second: type ERASE
  page.on('dialog', (d) => { n++; void (n === 1 ? d.accept() : d.accept('ERASE')); });
  await page.getByRole('button', { name: 'Erase all data' }).click();
  await expect(page.getByRole('button', { name: 'New to BoxTap' })).toBeVisible();
  expect(n).toBe(2);
  await page.reload();
  await expect(page.getByRole('button', { name: 'New to BoxTap' })).toBeVisible();
});

test('Seller: sell, undo, book, pack, move between boxes, low stock (critical tests 19-21)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  await page.getByRole('button', { name: 'New to BoxTap' }).click();
  await page.getByRole('button', { name: /Selling stock/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  const words = (await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts()).map((x) => x.replace(/^\d+\.\s*/, '').trim());
  await page.getByRole('button', { name: "I've written it down" }).click();
  for (const label of await page.locator('label span').allInnerTexts()) {
    const n = Number(/Word (\d+)/.exec(label)?.[1]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'My shop' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Gold ring');
  await page.getByLabel('Add item').press('Enter');
  const stock = page.getByTestId('stock-Gold ring');
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Add 1 Gold ring' }).click();
  await expect(stock).toHaveText('10 in stock');
  await page.getByRole('button', { name: 'Sell 1 Gold ring' }).click();
  await expect(stock).toHaveText('9 in stock');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(stock).toHaveText('10 in stock');

  // Item page: book 2, pack them, then move 3 to a new box.
  await page.getByRole('button', { name: /^Gold ring/ }).click();
  await page.getByLabel('How many').fill('2');
  await page.getByRole('button', { name: 'Booked', exact: true }).click();
  await expect(page.getByTestId('item-stock')).toHaveText('8 in stock · 2 booked');
  await page.getByRole('button', { name: 'Booked → Packed' }).click();
  await expect(page.getByTestId('item-stock')).toHaveText('8 in stock');
  await page.getByLabel('Warn me when stock is at or below').fill('5');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Add box' }).click();
  await expect(page.getByRole('heading', { name: 'Box 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('list', { name: 'boxes' }).getByText('Box 1').click();
  await page.getByRole('button', { name: /^Gold ring/ }).click();
  await page.getByLabel('How many').fill('3');
  await page.getByLabel('Move to box').selectOption({ label: 'Box 2' });
  await page.getByRole('button', { name: 'Move to another box' }).click();
  await expect(page.getByTestId('item-stock')).toHaveText('5 in stock');

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  // Both boxes are now at or below 5 (the moved copy keeps the warning level).
  await page.getByRole('button', { name: 'Low stock (2)' }).click();
  await expect(page.getByRole('list', { name: 'low stock' }).getByRole('listitem')).toHaveCount(2);
});

test('item photos: camera button beside each item, thumbnail, large view, survives reload', async ({ page }) => {
  needsPersistentStorage(test.info().project.name);
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Kettle');
  await page.getByLabel('Add item').press('Enter');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photo of Kettle' }).click();
  await (await chooser).setFiles({ name: 'k.png', mimeType: 'image/png', buffer: await tinyPng(page) });
  const thumb = page.getByRole('button', { name: 'Photo of Kettle' });
  await expect(thumb.locator('img')).toHaveCount(1, { timeout: 15_000 });
  await page.reload();
  await expect(thumb.locator('img')).toHaveCount(1, { timeout: 15_000 });
  await thumb.click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'Kettle' })).toBeVisible();
  await page.getByRole('button', { name: 'Open item' }).click();
  await expect(page.getByRole('heading', { name: 'Kettle' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'photos' }).locator('img')).toHaveCount(1);
});

test('Seller: make and share an in-stock picture (catalogue image, ADR-015)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  await page.getByRole('button', { name: 'New to BoxTap' }).click();
  await page.getByRole('button', { name: /Selling stock/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  const words = (await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts()).map((x) => x.replace(/^\d+\.\s*/, '').trim());
  await page.getByRole('button', { name: "I've written it down" }).click();
  for (const label of await page.locator('label span').allInnerTexts()) {
    const n = Number(/Word (\d+)/.exec(label)?.[1]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'My shop' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('সোনার আংটি');
  await page.getByLabel('Add item').press('Enter');
  await page.getByRole('button', { name: 'Add 1 সোনার আংটি' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photo of সোনার আংটি' }).click();
  await (await chooser).setFiles({ name: 'r.png', mimeType: 'image/png', buffer: await tinyPng(page) });
  await expect(page.getByRole('button', { name: 'Photo of সোনার আংটি' }).locator('img')).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Share this box as a picture' }).click();
  await expect(page.getByRole('list', { name: 'catalogue items' }).getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Make picture' }).click();
  await expect(page.getByRole('img', { name: 'In-stock picture' })).toBeVisible({ timeout: 15_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Share/ }).click();
  expect((await dl).suggestedFilename()).toMatch(/^in-stock-\d{4}-\d{2}-\d{2}\.jpg$/);
});

test('labels: a Bangla box name prints as drawn text, not "?"', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await newHome(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Name', { exact: true }).fill('রান্নাঘর');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Print labels' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make PDF' }).click();
  const { readFileSync } = await import('node:fs');
  const pdf = readFileSync(await (await dl).path()).toString('latin1');
  expect(pdf).toMatch(/\/Subtype\s*\/Image/);
});
