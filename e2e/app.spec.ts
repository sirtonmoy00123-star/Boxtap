import { test, expect, type Page } from '@playwright/test';
import { needsPersistentStorage } from './env';

/** Goes through first launch, including the recovery code check. Returns the 12-word code. */
async function newHome(page: Page): Promise<string> {
  await page.goto('/');
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
