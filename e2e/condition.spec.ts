// Removalist Phase 4: condition reports, signatures, locks, amendments and the delivery comparison.
// Photos go in through Import (the test browsers have no camera); signatures are drawn on the canvas with the mouse.
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

async function setup(page: Page, lang: 'en' | 'bn' = 'en') {
  page.on('dialog', (d) => { void d.accept().catch(() => {}); });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boxtap.installGuideSnoozedAt', String(Date.now())));
  if (lang === 'bn') await page.getByRole('button', { name: 'বাংলা' }).click();
  await page.getByRole('button', { name: lang === 'bn' ? /BoxTap-এ নতুন|নতুন/ : 'New to BoxTap' }).first().click();
  await page.getByRole('button', { name: lang === 'bn' ? /রিমুভালিস্ট/ : /Removalist business/ }).click();
  await page.getByRole('button', { name: lang === 'bn' ? /শুরু/ : 'Start' }).first().click();
  await page.locator('input').nth(0).fill('Fast Movers');
  await page.locator('input[type=tel]').fill('0400 111 222');
  await page.locator('form button[type=submit]').click();
  await page.getByRole('button', { name: lang === 'bn' ? 'পরবর্তী' : 'Next' }).click();
  await page.getByRole('button', { name: lang === 'bn' ? 'বুঝেছি' : 'I understand' }).click();
  await passRecoveryCodeAny(page, lang);
  await page.getByRole('button', { name: lang === 'bn' ? 'বাদ দিন, ট্রাক নেই' : 'Skip, no trucks' }).click();
}
async function passRecoveryCodeAny(page: Page, lang: 'en' | 'bn') {
  if (lang === 'en') return passRecoveryCode(page);
  const items = await page.getByTestId('recovery-code').getByRole('listitem').allInnerTexts();
  const words = items.map((x) => x.replace(/^[\d০-৯]+\.\s*/, '').trim());
  await page.locator('button').filter({ hasNotText: /প্রিন্ট|Print/ }).last().click();
  const labels = await page.locator('label span').allInnerTexts();
  for (const label of labels) {
    const digits = (/[\d০-৯]+/.exec(label)?.[0] ?? '').replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
    await page.getByLabel(label, { exact: true }).fill(words[Number(digits) - 1]!);
  }
  await page.locator('form button[type=submit]').click();
}

async function newJobWithBoxes(page: Page, n: number) {
  await page.getByRole('button', { name: 'New job' }).first().click();
  await page.getByLabel('Customer name').fill('Ayesha Khan');
  await page.getByLabel('Crew leader').fill('Sam Lee');
  await page.getByRole('button', { name: 'Save job' }).click();
  await expect(page.getByRole('heading', { name: /^J-\d{4} · / })).toBeVisible();
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: '+ Box' }).click();
    await expect(page.getByTestId('box-context')).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^J-\d{4} · / })).toBeVisible();
  }
}

/** A real photo made in the page (a coloured rectangle), as an Import would pick it. */
async function testPhoto(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d')!; g.fillStyle = '#3a7'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillRect(40, 40, 120, 80);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

async function drawSignature(page: Page) {
  const pad = page.getByTestId('signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 15, box.y + box.height / 2 + (i % 2 ? -15 : 15));
  await page.mouse.up();
}

test('pickup condition with photos, both signatures, lock, amendment, delivery comparison, auto-close', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await newJobWithBoxes(page, 2);
  const photo = await testPhoto(page);

  await page.getByRole('button', { name: /^Pickup condition/ }).click();
  await expect(page.getByTestId('cond-summary')).toHaveText('2 pieces · 0 with existing damage');
  await page.getByRole('button', { name: 'Start: first piece not recorded' }).click();
  await expect(page.getByRole('heading', { name: 'Box 1 · Pickup' })).toBeVisible();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Import photo').setInputFiles({ name: 'box1.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('Imported photo — time not verified')).toBeVisible();
  await expect(page.getByTestId('not-recorded')).toHaveText('Not recorded yet: Box 2');
  await page.getByRole('button', { name: 'Next piece' }).click();
  await expect(page.getByRole('heading', { name: 'Box 2 · Pickup' })).toBeVisible();
  await page.getByRole('button', { name: 'Scratched' }).click();
  await page.getByRole('button', { name: 'Already damaged before move' }).click();
  await page.getByLabel('Note (optional)').fill('Corner scuff');
  await page.getByLabel('Note (optional)').blur();
  await expect(page.getByTestId('not-recorded')).toHaveText('Every piece is recorded.');
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.getByTestId('cond-summary')).toHaveText('2 pieces · 1 with existing damage');

  // Sign-off: customer, then crew leader; the disclaimer shows and never claims a legal status.
  await page.getByRole('button', { name: 'Sign off Pickup' }).click();
  await expect(page.getByTestId('disclaimer')).toHaveText("This record was made on the removalist's phone to document the condition of goods. It is not legal advice.");
  await expect(page.locator('body')).not.toContainText(/legally binding|court-approved/i);
  await page.getByRole('button', { name: 'Next: crew leader' }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign in the box first.');
  await drawSignature(page);
  await page.getByRole('button', { name: 'Next: crew leader' }).click();
  await expect(page.getByLabel('Name (Crew leader)')).toHaveValue('Sam Lee');
  await drawSignature(page);
  await page.getByRole('button', { name: 'Sign and lock' }).click();
  await expect(page.getByTestId('stage-locked')).toBeVisible();

  // Locked: tags can't change; an amendment can be added.
  await page.getByRole('button', { name: /^Box 2/ }).click();
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add amendment' }).click();
  await page.getByRole('button', { name: 'Add amendment' }).click();
  await expect(page.getByRole('alert')).toHaveText('An amendment needs a note.');
  await page.getByLabel('What changed (required)').fill('Scuff is on both corners');
  await page.getByRole('button', { name: 'Add amendment' }).click();
  await expect(page.getByTestId('amendment')).toContainText('Amendment after sign-off: Scuff is on both corners');
  // A photo can go on the amendment (the locked record's photos stay as they were).
  await page.getByLabel('Import photo').setInputFiles({ name: 'later.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.getByTestId('amendment').getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // Delivery: Box 1 arrives Dented (OK at pickup), Box 2 unchanged.
  await page.getByRole('button', { name: /^Delivery condition/ }).click();
  await page.getByRole('button', { name: 'Start: first piece not recorded' }).click();
  await page.getByRole('button', { name: 'Dented' }).click();
  await page.getByRole('button', { name: 'Next piece' }).click();
  await page.getByRole('button', { name: 'Scratched' }).click();
  await page.getByRole('button', { name: 'Already damaged before move' }).click();
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.getByTestId('comparison')).toContainText('Box 1: OK at pickup → Dented at delivery');
  await expect(page.getByTestId('comparison')).not.toContainText('Box 2');

  // Customer refuses at delivery: locked with the crew signature only; the job closes.
  await page.getByRole('button', { name: 'Sign off Delivery' }).click();
  await page.getByLabel('Customer refused to sign').check();
  await page.getByRole('button', { name: 'Next: crew leader' }).click();
  await drawSignature(page);
  await page.getByRole('button', { name: 'Sign and lock' }).click();
  await expect(page.getByTestId('stage-locked')).toContainText('The customer refused to sign');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Status')).toHaveValue('closed');
  await expect(page.getByTestId('signed-note')).toHaveText('This job has a signed report, so it can only be archived, not deleted.');
  await expect(page.getByRole('button', { name: 'Move job to Bin' })).toHaveCount(0);
});

test('accessibility: the condition and sign-off screens have no axe violations', async ({ page }) => {
  await setup(page);
  await newJobWithBoxes(page, 1);
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const check = async () => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  };
  await page.getByRole('button', { name: /^Pickup condition/ }).click();
  await check();
  await page.getByRole('button', { name: 'Start: first piece not recorded' }).click();
  await page.getByRole('button', { name: 'Scratched' }).click();
  await check();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Sign off Pickup' }).click();
  await check();
});

test('Bangla: the condition screens and the disclaimer are in Bangla', async ({ page }) => {
  await setup(page, 'bn');
  await expect(page.getByRole('heading', { name: 'কাজ' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'নতুন কাজ' }).first().click();
  await page.getByLabel('গ্রাহকের নাম').fill('আয়েশা খান');
  await page.getByRole('button', { name: 'কাজ সংরক্ষণ করুন' }).click();
  await page.getByRole('button', { name: '+ বাক্স' }).click();
  await page.getByRole('button', { name: 'পেছনে', exact: true }).click();
  await page.getByRole('button', { name: /মাল তোলার সময়ের অবস্থা/ }).click();
  await expect(page.getByTestId('cond-summary')).toHaveText('১টি জিনিস · ০টিতে আগে থেকে ক্ষতি');
  await page.getByRole('button', { name: /মাল তোলা স্বাক্ষর করুন/ }).click();
  await expect(page.getByTestId('disclaimer')).toHaveText('এই রেকর্ডটি মালের অবস্থা লিখে রাখার জন্য রিমুভালিস্টের ফোনে তৈরি। এটি আইনি পরামর্শ নয়।');
});
