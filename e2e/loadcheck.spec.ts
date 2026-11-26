// Removalist Phase 3: load and unload check.
// The browsers in these tests have no camera, so scans are fed through a test-only hook that exists only in a build
// made with VITE_E2E_SCAN_HOOK=1 (like the Pro preview build):
//   VITE_E2E_SCAN_HOOK=1 npm run build && SCAN_E2E=1 npx playwright test e2e/loadcheck.spec.ts
// The speed test uses Chromium's fake camera with a video of real QR codes made at test time, and runs on any build.
import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';

const SCAN = process.env.SCAN_E2E === '1';

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

async function newRemovalist(page: Page) {
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
  await page.getByRole('button', { name: 'Skip, no trucks' }).click();
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible({ timeout: 15_000 });
}

async function newJob(page: Page, name: string) {
  await page.getByRole('button', { name: 'New job' }).first().click();
  await page.getByLabel('Customer name').fill(name);
  await page.getByRole('button', { name: 'Save job' }).click();
  await expect(page.getByRole('heading', { name: /^J-\d{4} · / })).toBeVisible();
}

/** Adds a box (or furniture piece) from the job screen and returns its label code; ends back on the job screen. */
async function addBox(page: Page, piece = false, name?: string): Promise<string> {
  await page.getByRole('button', { name: piece ? '+ Furniture piece' : '+ Box' }).click();
  await expect(page.getByTestId('box-context')).toBeVisible();
  if (name) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await expect(page.getByTestId('autosave')).toHaveText('Saved');
  }
  const code = (await page.getByTestId('label-code').textContent())!.trim();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: /^J-\d{4} · / })).toBeVisible();
  return code;
}

const scan = (page: Page, code: string) => page.evaluate((c) => (window as unknown as { __boxtapScan: (t: string) => void }).__boxtapScan(`https://boxtap.app/b/${c}`), code);

test('load and unload check: counter, Already loaded, wrong job, not BoxTap, manual tick, missing reasons, status', async ({ page }) => {
  test.skip(!SCAN, 'needs a VITE_E2E_SCAN_HOOK=1 build (SCAN_E2E=1)');
  await newRemovalist(page);
  // Another job with a box, for the wrong-job warning.
  await newJob(page, 'Tom Brown');
  const otherBox = await addBox(page);
  await page.getByRole('button', { name: 'Back' }).click();
  await newJob(page, 'Ayesha Khan');
  const b1 = await addBox(page);
  const b2 = await addBox(page);
  await addBox(page); // box 3: never loaded
  await addBox(page, true, 'Sofa');

  await page.getByRole('button', { name: /^Load check/ }).click();
  await expect(page.getByRole('heading', { name: 'Loading · J-0002' })).toBeVisible();
  const counter = page.getByTestId('check-counter');
  const message = page.getByTestId('check-message');
  await expect(counter).toHaveText('0 of 4 loaded');
  await expect(page.getByText('Keep this screen on while loading')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __boxtapScan?: unknown }).__boxtapScan)).toBe('function');

  await scan(page, b1);
  await expect(counter).toHaveText('1 of 4 loaded');
  await expect(message).toHaveText('Box 1 loaded');
  await scan(page, b2);
  await expect(counter).toHaveText('2 of 4 loaded');
  // The same label again: a code held in view is ignored for 1.5 s, then it counts as a new scan.
  await page.waitForTimeout(1600);
  await scan(page, b1);
  await expect(message).toHaveText('Already loaded: Box 1');
  await expect(counter).toHaveText('2 of 4 loaded');
  await scan(page, otherBox);
  await expect(page.getByRole('alert')).toHaveText('This is Box 1 of J-0001, Brown');
  await page.evaluate(() => (window as unknown as { __boxtapScan: (t: string) => void }).__boxtapScan('https://example.com/not-a-label'));
  await expect(page.getByRole('alert')).toHaveText("That code isn't a BoxTap label.");
  await scan(page, 'ZZZZZZZZZZ');
  await expect(page.getByRole('alert')).toHaveText("This box isn't in your BoxTap.");
  await expect(counter).toHaveText('2 of 4 loaded');

  // Damaged label on the sofa: tick by hand.
  await page.getByRole('button', { name: 'Tick Piece 1 by hand' }).click();
  await expect(counter).toHaveText('3 of 4 loaded');
  await expect(page.getByTestId('manual-tick')).toHaveText('Ticked by hand');

  // Finish: box 3 is missing and needs a reason.
  await page.getByRole('button', { name: 'Finish loading' }).click();
  await page.getByRole('button', { name: 'Confirm and finish' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose a reason for each missing piece. Other needs a note.');
  await page.getByLabel('Why is it missing? (Box 3)').selectOption('other');
  await page.getByRole('button', { name: 'Confirm and finish' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); // Other needs a note
  await page.getByLabel('Note (Box 3)').fill('Customer repacked it');
  await page.getByRole('button', { name: 'Confirm and finish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Load check finished' })).toBeVisible();
  await expect(page.getByLabel('Status')).toHaveValue('loaded');

  // Unload: expects the 3 loaded pieces.
  await page.getByRole('button', { name: /^Unload check/ }).click();
  await expect(counter).toHaveText('0 of 3 unloaded');
  await scan(page, b1);
  await expect(counter).toHaveText('1 of 3 unloaded');
  await page.getByRole('button', { name: 'Tick Box 2 by hand' }).click();
  await expect(counter).toHaveText('2 of 3 unloaded');
  await page.getByRole('button', { name: 'Finish unloading' }).click();
  await page.getByLabel('Why is it missing? (Piece 1)').selectOption('customer_taking');
  await page.getByRole('button', { name: 'Confirm and finish' }).click();
  await expect(page.getByLabel('Status')).toHaveValue('delivered');
});

test('the round Scan button picks a job, then Loading or Unloading', async ({ page, browserName }) => {
  test.skip(!SCAN, 'needs a VITE_E2E_SCAN_HOOK=1 build (SCAN_E2E=1)');
  await newRemovalist(page);
  await newJob(page, 'Ayesha Khan');
  const b1 = await addBox(page);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await expect(page.getByRole('heading', { name: 'Scan for which job?' })).toBeVisible();
  await page.getByRole('button', { name: 'Loading J-0001', exact: true }).click();
  await expect(page.getByTestId('check-counter')).toHaveText('0 of 1 loaded');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __boxtapScan?: unknown }).__boxtapScan)).toBe('function');
  await scan(page, b1);
  await expect(page.getByTestId('check-counter')).toHaveText('1 of 1 loaded');
  // It is saved on the phone: a reload keeps the count. (Not in Windows WebKit, which has no lasting storage.)
  if (!(browserName === 'webkit' && process.platform === 'win32')) {
    await page.reload();
    await expect(page.getByTestId('check-counter')).toHaveText('1 of 1 loaded');
  }
});

test('accessibility: the load check screen has no axe violations', async ({ page }) => {
  await newRemovalist(page);
  await newJob(page, 'Ayesha Khan');
  await addBox(page);
  await page.getByRole('button', { name: /^Load check/ }).click();
  await expect(page.getByTestId('check-counter')).toHaveText('0 of 1 loaded');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
});

// Speed (plan §8): a fake camera plays a video of real QR codes; the screen records the time from the frame that held
// the code to the counter on screen (data-latency-ms). Chromium only: it is the browser with a fake camera.
test('speed with a fake camera: scan to counter is under 0.5 s', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'chromium', 'fake camera: desktop Chromium only');
  test.setTimeout(90_000);
  const video = join(mkdtempSync(join(tmpdir(), 'boxtap-cam-')), 'labels.y4m');
  writeFileSync(video, Buffer.alloc(0));
  // A browser of its own, with Chromium's fake camera playing that file (filled in once the label codes exist).
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  try {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL });
    const page = await context.newPage();
    await newRemovalist(page);
    await newJob(page, 'Ayesha Khan');
    const codes = [await addBox(page), await addBox(page), await addBox(page)];
    writeY4m(video, codes); // the fake camera opens the file when the load check starts
    await page.getByRole('button', { name: /^Load check/ }).click();
    const counter = page.getByTestId('check-counter');
    await expect(counter).toHaveText('3 of 3 loaded', { timeout: 45_000 });
    const ms = Number(await counter.getAttribute('data-latency-ms'));
    info.annotations.push({ type: 'scan-to-counter-ms', description: String(ms) });
    console.log(`scan-to-counter: ${ms} ms`);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  } finally {
    await browser.close();
  }
});

/** A Y4M (raw YUV 4:2:0) video, 640x480 at 10 fps: each code shown for 2 s with a blank 1 s between. */
function writeY4m(path: string, codes: string[]) {
  const W = 640, H = 480, FPS = 10;
  const frames: Buffer[] = [];
  const blank = () => { const y = Buffer.alloc(W * H, 235); const c = Buffer.alloc((W / 2) * (H / 2) * 2, 128); return Buffer.concat([Buffer.from('FRAME\n'), y, c]); };
  const qrFrame = (text: string) => {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const scale = Math.floor(360 / (n + 8));
    const side = (n + 8) * scale;
    const ox = Math.floor((W - side) / 2), oy = Math.floor((H - side) / 2);
    const y = Buffer.alloc(W * H, 235);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) y[(oy + (r + 4) * scale + dy) * W + ox + (c + 4) * scale + dx] = 16;
    }
    return Buffer.concat([Buffer.from('FRAME\n'), y, Buffer.alloc((W / 2) * (H / 2) * 2, 128)]);
  };
  for (let i = 0; i < FPS; i++) frames.push(blank());
  for (const code of codes) {
    const f = qrFrame(`https://boxtap.app/b/${code}`);
    for (let i = 0; i < 2 * FPS; i++) frames.push(f);
    for (let i = 0; i < FPS; i++) frames.push(blank());
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`), ...frames]));
}
