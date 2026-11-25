import { test, expect, type Page } from '@playwright/test';

// Runs only against a build made with VITE_PREVIEW_PAID_PLANS=1 (paid plans are skipped for now):
//   VITE_PREVIEW_PAID_PLANS=1 npm run build && PRO_E2E=1 npx playwright test e2e/pro.spec.ts --project=chromium
const PRO = process.env.PRO_E2E === '1';

async function newShop(page: Page) {
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
}

test('free sellers see the upgrade screen for Orders and Reports', async ({ page }) => {
  test.skip(PRO, 'this build has paid plans unlocked');
  await newShop(page);
  await page.getByRole('button', { name: /^Orders/ }).click();
  await expect(page.getByRole('dialog')).toContainText('This needs a paid plan.');
});

test('Pro: cost price, an order that books and packs stock, then the report shows the profit', async ({ page }) => {
  test.skip(!PRO, 'needs a VITE_PREVIEW_PAID_PLANS=1 build');
  test.setTimeout(60_000);
  await newShop(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Ring');
  await page.getByLabel('Add item').press('Enter');
  await page.getByRole('button', { name: /^Ring/ }).click();
  await page.getByLabel('How many').fill('5');
  await page.getByRole('button', { name: 'Restock', exact: true }).click();
  await page.getByLabel('Sale price (৳)').fill('1000');
  await page.getByLabel('Cost price (what you paid)').fill('600');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved|wrong/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Sale price (৳)')).toHaveValue('1000');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: /^Orders/ }).click();
  await page.getByRole('button', { name: 'New order' }).click();
  await page.getByLabel('Customer name').fill('Nusrat');
  await page.getByRole('button', { name: 'Create order' }).click();
  await page.getByLabel('Choose an item').selectOption({ index: 1 });
  await page.getByLabel('How many').fill('2');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByTestId('order-total')).toHaveText('Total: ৳2,000');
  await page.getByRole('button', { name: /Mark packed/ }).click();
  await expect(page.getByTestId('order-status')).toHaveText('Packed');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: /^Reports/ }).click();
  await expect(page.getByTestId('report-totals')).toContainText('2');
  await expect(page.getByTestId('report-totals')).toContainText('৳2,000');
  await expect(page.getByTestId('report-totals')).toContainText('৳800');
});

test('Pro: add a variant (size) with its own stock', async ({ page }) => {
  test.skip(!PRO, 'needs a VITE_PREVIEW_PAID_PLANS=1 build');
  await newShop(page);
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('Ring');
  await page.getByLabel('Add item').press('Enter');
  await page.getByRole('button', { name: /^Ring/ }).click();
  await page.getByLabel('New variant, e.g. Size 8').fill('Size 8');
  await page.getByRole('button', { name: 'Add variant' }).click();
  await expect(page.getByRole('heading', { name: 'Ring · Size 8' })).toBeVisible();
  await page.getByLabel('How many').fill('4');
  await page.getByRole('button', { name: 'Restock', exact: true }).click();
  await expect(page.getByRole('list', { name: 'variants' })).toContainText('Size 8');
  await expect(page.getByText('All variants: 4 in stock')).toBeVisible();
});

test('Move Pass (preview): family and insurance lists download as PDFs', async ({ page }) => {
  test.skip(!PRO, 'needs a VITE_PREVIEW_PAID_PLANS=1 build');
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  await page.getByRole('button', { name: 'New to BoxTap' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('recovery-code').getByRole('listitem')).toHaveCount(12);
  const words = (await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts()).map((x) => x.replace(/^\d+\.\s*/, '').trim());
  await page.getByRole('button', { name: "I've written it down" }).click();
  for (const label of (await page.locator('label span').allInnerTexts()).filter((l) => l.startsWith('Word '))) {
    const n = Number(/Word (\d+)/.exec(label)?.[1]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'My move' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add box' }).click();
  await page.getByLabel('Add item').fill('রাইস কুকার');
  await page.getByLabel('Add item').press('Enter');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  for (const [btn, file] of [[/^Family box list/, 'BoxTap-family-list.pdf'], [/^Insurance list/, 'BoxTap-insurance-list.pdf']] as const) {
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: btn }).click();
    expect((await dl).suggestedFilename()).toBe(file);
  }
});
