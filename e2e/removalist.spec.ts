// Removalist mode: onboarding, jobs, free job limit, Settings (Phase 1); boxes, pieces, labels, links (Phase 2); axe.
import { test, expect, type Page } from '@playwright/test';
import { needsPersistentStorage } from './env';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
async function axe(page: Page): Promise<string[]> {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '));
}

/** The 12-word code screen: read the words, then type back the three asked for. */
async function passRecoveryCode(page: Page) {
  const items = await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts();
  const words = items.map((x) => x.replace(/^\d+\.\s*/, '').trim());
  expect(words).toHaveLength(12);
  await page.getByRole('button', { name: "I've written it down" }).click();
  for (const label of await page.locator('label span').allInnerTexts()) {
    const n = Number(/Word (\d+)/.exec(label)?.[1]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
}

async function start(page: Page) {
  page.on('dialog', (d) => { void d.accept().catch(() => {}); });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  await page.getByRole('button', { name: 'New to BoxTap' }).click();
}

/** First launch as a Removalist business, with the three example trucks. */
async function newRemovalist(page: Page) {
  await start(page);
  await expect(page.getByRole('button', { name: /Removalist business/ })).toContainText('Jobs, condition photos, load check');
  await page.getByRole('button', { name: /Removalist business/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Your business' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('alert')).toHaveText('Business name and phone are needed.');
  await page.getByLabel('Business name').fill('Fast Movers');
  await page.getByLabel('Phone').fill('0400 111 222');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Where do you work?' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click(); // Australia
  await expect(page.getByRole('heading', { name: 'Your data stays on this phone' })).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await passRecoveryCode(page);
  await expect(page.getByText('Example — change to your trucks')).toBeVisible();
  await expect(page.getByLabel('Capacity (m³)')).toHaveCount(3);
  await page.getByRole('button', { name: 'Start using BoxTap' }).click();
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible({ timeout: 15_000 });
}

async function newJob(page: Page, name: string, extra: { phone?: string; pickup?: string } = {}) {
  await page.getByRole('button', { name: 'New job' }).first().click();
  await page.getByLabel('Customer name').fill(name);
  if (extra.phone) await page.getByLabel('Customer phone').fill(extra.phone);
  if (extra.pickup) await page.getByLabel('Pickup address').fill(extra.pickup);
  await page.getByRole('button', { name: 'Save job' }).click();
  // Wait for the job screen (or the upgrade sheet), so a following Back can't hit the form's Back first.
  await expect(page.getByRole('heading', { name: /^J-\d{4} · / }).or(page.getByTestId('upgrade-reason'))).toBeVisible();
}

test('Removalist: onboarding, teal mode and tabs, new job, search, status, Bin and restore', async ({ page }) => {
  await newRemovalist(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode)).toBe('removalist');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveText(['Jobs', 'Settings']);
  await expect(page.getByRole('button', { name: 'Scan' })).toBeVisible();
  await expect(page.getByText('No jobs yet.')).toBeVisible();

  // New job: the label name follows the last name.
  await page.getByRole('button', { name: 'Add your first job' }).click();
  await page.getByLabel('Customer name').fill('Ayesha Rahman Khan');
  await expect(page.getByLabel('Name on labels')).toHaveValue('Khan');
  await page.getByLabel('Customer phone').fill('+61 400 123 456');
  await page.getByLabel('Pickup address').fill('5 Rose St, Blacktown, NSW 2148');
  await page.getByRole('button', { name: 'Save job' }).click();
  await expect(page.getByRole('heading', { name: 'J-0001 · Khan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Call +61 400 123 456' })).toHaveAttribute('href', 'tel:+61400123456');
  await expect(page.getByRole('link', { name: /Open in maps/ })).toHaveAttribute('href', /google\.com\/maps\/search/);

  // Status change asks first (the dialog is accepted).
  await page.getByLabel('Status').selectOption('packing');
  await expect(page.getByLabel('Status')).toHaveValue('packing');
  await page.getByRole('button', { name: 'Back' }).click();

  await newJob(page, 'Tom Brown', { pickup: 'Mirpur 10, Dhaka' });
  await page.getByRole('button', { name: 'Back' }).click();
  const jobs = page.getByRole('list', { name: 'jobs' });
  await expect(jobs.getByRole('listitem')).toHaveCount(2);
  await expect(jobs).toContainText('Blacktown');
  await expect(jobs).toContainText('Packing');

  await page.getByLabel('Search name, phone, address or job number').fill('400123');
  await expect(jobs.getByRole('listitem')).toHaveCount(1);
  await expect(jobs).toContainText('Ayesha Rahman Khan');
  await page.getByLabel('Search name, phone, address or job number').fill('J-0002');
  await expect(jobs).toContainText('Tom Brown');
  await page.getByLabel('Search name, phone, address or job number').fill('');
  await page.getByRole('button', { name: 'In progress' }).click();
  await expect(jobs.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'In progress' }).click();

  // Bin and restore.
  await jobs.getByRole('button', { name: /Tom Brown/ }).click();
  await page.getByRole('button', { name: 'Move job to Bin' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'J-0002 moved to Bin' })).toBeVisible();
  await expect(jobs.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Bin/ }).click();
  await expect(page.getByText('J-0002 · Tom Brown')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The bin is empty.')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await expect(jobs.getByRole('listitem')).toHaveCount(2);
});

test('Removalist Free: the third open job shows the upgrade screen', async ({ page }) => {
  await newRemovalist(page);
  await newJob(page, 'One');
  await page.getByRole('button', { name: 'Back' }).click();
  await newJob(page, 'Two');
  await page.getByRole('button', { name: 'Back' }).click();
  await newJob(page, 'Three');
  await expect(page.getByTestId('upgrade-reason')).toContainText('2 open jobs');
  await expect(page.getByText(/Removalist Pro/)).toBeVisible();
});

test('Removalist Settings: business details, trucks, the starter volume list', async ({ page }) => {
  await newRemovalist(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Volume list' }).click();
  await expect(page.getByTestId('catalogue-starter')).toHaveText('Starter values — adjust to your own experience');
  await expect(page.getByRole('list', { name: 'Volume list' }).getByRole('listitem')).toHaveCount(22);
  await expect(page.getByRole('list', { name: 'Volume list' })).toContainText('Standard carton');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Trucks' }).click();
  await expect(page.getByLabel('Truck name')).toHaveCount(4); // 3 examples + the add form
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Business details' }).click();
  await page.getByLabel('Business name').fill('Faster Movers');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
});

test('Settings: adding a Removalist list to a Home phone skips the recovery code (one code per phone)', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Start' }).click(); // Home is the default mode
  await passRecoveryCode(page);
  await expect(page.getByRole('heading', { name: 'My move' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Add another list' }).click();
  await page.getByRole('button', { name: /Removalist business/ }).click();
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.getByLabel('Business name').fill('Dhaka Shifting');
  await page.getByLabel('Phone').fill('01700000000');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Bangladesh/ }).click();
  await expect(page.getByRole('button', { name: 'Cubic feet (ft³)' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByTestId('recovery-code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip, no trucks' }).click();
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('list', { name: 'Your lists on this phone' })).toContainText('Dhaka Shifting · Removalist business');
});

test('Home and Seller first launch are unchanged by Removalist mode', async ({ page }) => {
  await start(page);
  await expect(page.getByRole('heading', { name: 'What will you use BoxTap for?' })).toBeVisible();
  await page.getByRole('button', { name: /Selling stock/ }).click();
  await expect(page.getByLabel('Name this list')).toBeVisible();
  await expect(page.getByText(/kept only in this browser/)).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await passRecoveryCode(page);
  await expect(page.getByRole('heading', { name: 'My shop' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode)).toBe('seller');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveText(['Stock', 'Booked', 'Settings']);
});

test('accessibility: the Jobs and job screens have no axe violations (WCAG 2.2 AA)', async ({ page }) => {
  await newRemovalist(page);
  expect(await axe(page)).toEqual([]);
  await newJob(page, 'Ayesha Khan', { phone: '0400 123 456', pickup: '5 Rose St, Blacktown' });
  await expect(page.getByRole('heading', { name: 'J-0001 · Khan' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('list', { name: 'jobs' })).toContainText('Ayesha Khan');
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'New job' }).click();
  expect(await axe(page)).toEqual([]);
});

// Phase 2: boxes, furniture pieces and labels ------------------------------------------------------

test('Removalist: quick add 10 boxes, a single box and 2 furniture pieces, then print their labels', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await newRemovalist(page);
  await newJob(page, 'Ayesha Khan');
  await expect(page.getByText('No boxes or furniture yet.')).toBeVisible();
  await page.getByRole('button', { name: '+ 10 boxes' }).click();
  await expect(page.getByTestId('piece-counts')).toHaveText('10 boxes · 0 furniture');
  await expect(page.getByText('Packing').first()).toBeVisible(); // Booked -> Packing on the first box

  // One more box: it opens in job context, with the default box size.
  await page.getByRole('button', { name: '+ Box' }).click();
  await expect(page.getByTestId('box-context')).toContainText('Box 11 · J-0001 · Khan');
  await expect(page.getByLabel('Box size')).toHaveValue(/.+/);
  await expect(page.getByLabel('Box size').locator('option:checked')).toHaveText('Standard carton');
  await page.getByRole('button', { name: 'Fragile' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  for (const name of ['Sofa', 'Fridge']) {
    await page.getByRole('button', { name: '+ Furniture piece' }).click();
    await expect(page.getByTestId('box-context')).toContainText(/Piece \d · J-0001/);
    await page.getByLabel('Name', { exact: true }).fill(name);
    await expect(page.getByTestId('autosave')).toHaveText('Saved');
    await page.getByLabel('Furniture type').selectOption({ label: name === 'Sofa' ? '3-seater sofa' : 'Fridge, large' });
    await page.getByRole('button', { name: 'Back' }).click();
  }
  await expect(page.getByTestId('piece-counts')).toHaveText('11 boxes · 2 furniture');
  const list = page.getByRole('list', { name: 'Boxes and furniture' });
  await expect(list.getByRole('listitem')).toHaveCount(13);
  await expect(list).toContainText('Piece 2 · Fridge');

  await page.getByRole('button', { name: 'Print labels' }).click();
  await expect(page.getByLabel('All boxes and furniture (13)')).toBeChecked();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make PDF' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('BoxTap-J-0001-labels-L7165.pdf');
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(await d.path()).subarray(0, 5).toString()).toBe('%PDF-');

  // A box added after printing: the job screen says older labels show the old total.
  // (The print is recorded right after the file is handed over, when "Label PDF ready." shows.)
  await expect(page.getByRole('status').filter({ hasText: 'Label PDF ready.' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: '+ Box' }).click();
  await expect(page.getByTestId('box-context')).toContainText('Box 12 · J-0001');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('labels-stale')).toContainText('old total (11 boxes, 2 furniture)');
});

test('Removalist labels: a Bangla box name prints as drawn text on L7165, not "?"', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await newRemovalist(page);
  await page.getByRole('button', { name: 'New job' }).first().click();
  await page.getByLabel('Customer name').fill('Ayesha Khan'); // Latin, so the only drawn text is the box name
  await page.getByRole('button', { name: 'Save job' }).click();
  await page.getByRole('button', { name: '+ Box' }).click();
  await page.getByLabel('Name', { exact: true }).fill('রান্নাঘরের বাসন');
  await expect(page.getByTestId('autosave')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Print labels' }).click();
  await expect(page.getByLabel('Label sheet')).toHaveValue('L7165');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make PDF' }).click();
  const { readFileSync } = await import('node:fs');
  const pdf = readFileSync(await (await dl).path()).toString('latin1');
  expect(pdf).toMatch(/\/Subtype\s*\/Image/);
});

test('Removalist: a job box label link opens the box in its job context; Settings prints spares', async ({ page }) => {
  needsPersistentStorage(test.info().project.name);
  await newRemovalist(page);
  await newJob(page, 'Tom Brown');
  await page.getByRole('button', { name: '+ Box' }).click();
  const code = (await page.getByTestId('label-code').textContent())!.trim();
  await page.goto(`/b/${code}`);
  await expect(page.getByTestId('box-context')).toContainText('Box 1 · J-0001 · Brown');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'J-0001 · Brown' })).toBeVisible();
  // Settings → Print labels prints blank spares in Removalist mode.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Print labels' }).click();
  await expect(page.getByText(/Job labels are printed from each job/)).toBeVisible();
});

test('accessibility: the job Pieces section, a job box and the labels screen have no axe violations', async ({ page }) => {
  await newRemovalist(page);
  await newJob(page, 'Ayesha Khan');
  await page.getByRole('button', { name: '+ 10 boxes' }).click();
  await page.getByRole('button', { name: '+ Furniture piece' }).click();
  await expect(page.getByTestId('box-context')).toContainText('Piece 1');
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('piece-counts')).toHaveText('10 boxes · 1 furniture');
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Print labels' }).click();
  expect(await axe(page)).toEqual([]);
});
