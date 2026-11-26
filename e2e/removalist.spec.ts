// Removalist mode, Phase 1: onboarding, jobs (create, search, filter, status, Bin), free job limit, Settings, axe.
import { test, expect, type Page } from '@playwright/test';

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
