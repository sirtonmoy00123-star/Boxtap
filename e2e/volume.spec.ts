// Removalist Phase 5: volume estimate, buffer, suggested truck, m³ / ft³, Bangla digits, and the volume list editor.
import { test, expect, type Page } from '@playwright/test';

async function passRecoveryCode(page: Page) {
  const items = await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts();
  const words = items.map((x) => x.replace(/^\d+\.\s*/, '').trim());
  await page.getByRole('button', { name: "I've written it down" }).click();
  for (const label of await page.locator('label span').allInnerTexts()) {
    const n = Number(/Word (\d+)/.exec(label)?.[1]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  await page.getByRole('button', { name: 'Confirm' }).click();
}

/** A Removalist business with the three example trucks (20, 30, 45 m³) and a job with 10 boxes and a sofa. */
async function setup(page: Page) {
  page.on('dialog', (d) => { void d.accept().catch(() => {}); });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  await page.getByRole('button', { name: 'New to BoxTap' }).click();
  await page.getByRole('button', { name: /Removalist business/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByLabel('Business name').fill('Fast Movers');
  await page.getByLabel('Phone').fill('0400 111 222');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await passRecoveryCode(page);
  await page.getByRole('button', { name: 'Start using BoxTap' }).click();
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'New job' }).first().click();
  await page.getByLabel('Customer name').fill('Ayesha Khan');
  await page.getByRole('button', { name: 'Save job' }).click();
  await expect(page.getByRole('heading', { name: /^J-\d{4} · / })).toBeVisible();
  await page.getByRole('button', { name: '+ 10 boxes' }).click();
  await expect(page.getByTestId('piece-counts')).toHaveText('10 boxes · 0 furniture');
  await page.getByRole('button', { name: '+ Furniture piece' }).click();
  await page.getByLabel('Furniture type').selectOption({ label: '3-seater sofa' });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^J-\d{4} · / })).toBeVisible();
}

test('volume: counted boxes and sofa, lines with + / −, total, buffer, truck, then ft³ and Bangla digits', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await page.getByRole('button', { name: /^Volume estimate/ }).click();
  // 10 × 0.10 (Standard carton) + 1.50 (sofa) = 2.50 m³; +10 % = 2.75 → the 20 m³ truck.
  await expect(page.getByTestId('vol-total')).toHaveText('2.50 m³');
  await expect(page.getByTestId('vol-needed')).toHaveText('With 10% buffer: 2.75 m³');
  await expect(page.getByTestId('vol-truck')).toHaveText('Suggested truck: Truck 1 (20.00 m³)');
  await expect(page.getByRole('list', { name: 'Counted from boxes and furniture' })).toContainText('Standard carton × 10');

  await page.getByLabel('Search the volume list').fill('fridge, l');
  await page.getByRole('button', { name: /^Add Fridge, large/ }).click();
  await page.getByRole('button', { name: 'One more Fridge, large' }).click();
  await page.getByRole('button', { name: 'One more Fridge, large' }).click();
  await page.getByRole('button', { name: 'One less Fridge, large' }).click();
  await expect(page.getByTestId('line-qty')).toHaveText('2');
  await page.getByLabel('Item name').fill('Shed contents');
  await page.getByLabel('Size (m³)').fill('17');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // 2.50 + 2 × 1.00 + 17 = 21.50; +10 % = 23.65 → the 30 m³ truck.
  await expect(page.getByTestId('vol-total')).toHaveText('21.50 m³');
  await expect(page.getByTestId('vol-truck')).toHaveText('Suggested truck: Truck 2 (30.00 m³)');
  await page.getByLabel('Buffer (%)').fill('120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Buffer must be 0 to 100.');
  await page.getByLabel('Buffer (%)').fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('vol-truck')).toHaveText('Suggested truck: Truck 2 (30.00 m³)');
  await page.getByLabel('Item name').fill('Garage');
  await page.getByLabel('Size (m³)').fill('30');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('vol-truck')).toHaveText('Bigger than your largest truck (Truck 3, 45.00 m³)');

  // Switch the business to ft³: the same volume, converted (51.50 m³ = 1818.7 ft³).
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Business details' }).click();
  await page.getByLabel('Volume unit').selectOption('ft3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Trucks' }).click();
  await expect(page.getByLabel('Capacity (ft³)').first()).toHaveValue('706.3'); // 20 m³
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await page.getByRole('list', { name: 'jobs' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /^Volume estimate/ }).click();
  await expect(page.getByTestId('vol-total')).toHaveText('1818.7 ft³');

  // Bangla: Bangla digits.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'বাংলা' }).click();
  await page.getByRole('button', { name: 'কাজ' }).click();
  await page.getByRole('list', { name: 'jobs' }).getByRole('button').first().click();
  await page.getByRole('button', { name: /^আয়তনের হিসাব/ }).click();
  await expect(page.getByTestId('vol-total')).toHaveText('১৮১৮.৭ ft³');
});

test('volume list editor: edit a size, add an item, hide one, move one; starter note', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Volume list' }).click();
  await expect(page.getByTestId('catalogue-starter')).toHaveText('Starter values — adjust to your own experience');
  const list = page.getByRole('list', { name: 'Volume list' });
  await list.getByRole('button', { name: /^Desk/ }).click();
  await page.getByLabel('Size (m³)').fill('0.75');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Desk' })).toContainText('0.75 m³');
  await page.getByRole('button', { name: 'Add an item' }).click();
  await page.getByLabel('Name in English').fill('Piano');
  await page.getByLabel('Name in Bangla').fill('পিয়ানো');
  await page.getByLabel('Size (m³)').fill('1.2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(23);
  await page.getByRole('button', { name: 'Move Piano up' }).click();
  await expect(list.getByRole('listitem').nth(21)).toContainText('Piano');
  await page.getByRole('button', { name: 'Hide Bicycle' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'Hide Standard carton' })).toHaveCount(0); // the default box size stays
});

test('accessibility: the volume screen has no axe violations', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /^Volume estimate/ }).click();
  await page.getByLabel('Search the volume list').fill('sofa');
  await expect(page.getByRole('button', { name: /^Add 2-seater sofa/ })).toBeVisible();
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
});
