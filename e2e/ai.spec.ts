import { expect, test, type Page } from '@playwright/test';
import { chooseTool, DISK, downloadAndReadAlpha, openTestImage, tapImage, testImage, toScreen } from './helpers';

/**
 * The AI tools, against the stand-in AI worker of the e2e build (src/ml/fake-worker.ts):
 * the same messages, progress and caching as the real models, with simple colour rules for results.
 */

/** Change how the stand-in behaves (it reads this before each step). */
async function fakeAi(page: Page, config: { downloadMs?: number; fail?: boolean }): Promise<void> {
  await page.evaluate(async (c) => {
    await (await caches.open('fake-ai')).put('/config', new Response(JSON.stringify(c)));
  }, config);
}

const autoButton = (page: Page) => page.getByRole('button', { name: /^Remove background|^Run again$/ });

test('Auto asks first, shows the download, then removes the background', async ({ page }) => {
  await openTestImage(page);
  // Nothing downloads until asked.
  await expect(page.getByRole('button', { name: 'Remove background (88 MB one-time download)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await fakeAi(page, { downloadMs: 1500 });
  await autoButton(page).click();
  await expect(page.getByText(/Downloading AI model… \d+ \/ 88 MB/)).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 10_000 });

  const [corner, centre] = await downloadAndReadAlpha(page, [[10, 10], [DISK.x, DISK.y]]);
  expect(corner).toBe(0);
  expect(centre).toBe(255);
});

test('cancelling the download leaves the image untouched, and asking again starts afresh', async ({ page }) => {
  await openTestImage(page);
  await fakeAi(page, { downloadMs: 20_000 });
  await autoButton(page).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/Download cancelled/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Downloading' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // Still not downloaded, so it still says so.
  await expect(page.getByRole('button', { name: 'Remove background (88 MB one-time download)' })).toBeVisible();

  await fakeAi(page, { downloadMs: 300 });
  await autoButton(page).click();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 10_000 });
  const [corner] = await downloadAndReadAlpha(page, [[10, 10]]);
  expect(corner).toBe(0);
});

test('once downloaded, Auto runs by itself when the next image opens', async ({ page }) => {
  await openTestImage(page);
  await fakeAi(page, { downloadMs: 200 });
  await autoButton(page).click();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 10_000 });

  // Open a second image, confirming that the edits to the first may go.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open another image' }).click();
  await (await chooser).setFiles({ name: 'again.png', mimeType: 'image/png', buffer: testImage() });
  await page.getByRole('dialog', { name: 'Open a new image?' }).getByRole('button', { name: 'Open new image' }).click();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  const [corner, centre] = await downloadAndReadAlpha(page, [[10, 10], [DISK.x, DISK.y]]);
  expect(corner).toBe(0);
  expect(centre).toBe(255);
});

test('a restored session is not overwritten by Auto', async ({ page }) => {
  await openTestImage(page);
  await fakeAi(page, { downloadMs: 200 });
  await autoButton(page).click();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 10_000 });
  // Bring the background back by hand.
  await chooseTool(page, 'Color');
  await page.getByRole('button', { name: 'Keep' }).click();
  await tapImage(page, 10, 10);
  await page.waitForTimeout(1500); // autosave

  await page.reload();
  await expect(page.getByText('Welcome back — your last image was restored.')).toBeVisible();
  await chooseTool(page, 'Auto');
  await page.waitForTimeout(1000);
  const [corner] = await downloadAndReadAlpha(page, [[10, 10]]);
  expect(corner).toBe(255);
});

test('when the model fails, a message says so and nothing changes', async ({ page }) => {
  await openTestImage(page);
  await fakeAi(page, { downloadMs: 100, fail: true });
  await autoButton(page).click();
  await expect(page.getByText("The AI model couldn't run. Check your connection and try again.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('Select: a tap on the object cuts it out', async ({ page }) => {
  await openTestImage(page);
  await fakeAi(page, { downloadMs: 200 });
  await chooseTool(page, 'Select');
  await tapImage(page, DISK.x, DISK.y);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 10_000 });

  // Keep on an untouched image hides everything else.
  const [centre, corner] = await downloadAndReadAlpha(page, [[DISK.x, DISK.y], [10, 10]]);
  expect(centre).toBe(255);
  expect(corner).toBe(0);
});

test('Select: a loop drawn around the object cuts out the object, not the loop', async ({ page }) => {
  await openTestImage(page);
  await fakeAi(page, { downloadMs: 200 });
  await chooseTool(page, 'Select');
  // Let the image be prepared first, so the loop's gesture isn't racing the download.
  await tapImage(page, DISK.x, DISK.y);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Undo' }).click();

  const loop: { x: number; y: number }[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.15) {
    loop.push(await toScreen(page, DISK.x + (DISK.r + 25) * Math.cos(a), DISK.y + (DISK.r + 25) * Math.sin(a)));
  }
  await page.mouse.move(loop[0].x, loop[0].y);
  await page.mouse.down();
  for (const p of loop.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 10_000 });

  const [centre, betweenLoopAndDisk, corner] = await downloadAndReadAlpha(page, [
    [DISK.x, DISK.y],
    [DISK.x + DISK.r + 12, DISK.y],
    [10, 10],
  ]);
  expect(centre).toBe(255);
  expect(betweenLoopAndDisk).toBe(0);
  expect(corner).toBe(0);
});
